/**
 * Live processing server shared by examples 09 and 10: a file is read from disk as a stream, piped
 * through ffmpeg and sent to the browser while it is being produced. Nothing is written to disk.
 *
 *   disk ─ createReadStream ─▶ ffmpeg stdin ─ your filters ─▶ ffmpeg stdout ─▶ HTTP response ─▶ <video> / <img>
 *
 * An example only decides WHAT ffmpeg does (extra inputs + filter graph) via `buildArgs`; this module
 * handles the rest: which files can be streamed, the two delivery formats, backpressure stats and the page.
 */
import { closeSync, createReadStream, openSync, readdirSync, readSync, statSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import path from 'node:path';
import { pipeline, Transform, type Readable } from 'node:stream';
import { ffmpegStream } from './ffmpeg.js';
import { decodeFrames, encodeFrames, processingSize } from './rawframes.js';
import { probeSummary } from './ffprobe.js';
import { humanBytes } from './format.js';

// ---------------------------------------------------------------- delivery formats

/**
 * How the processed video reaches the browser. `video` = the filter graph's output label, e.g. "[v]";
 * `audio` = what to map as sound ("0:a:0?" = the source's first audio track, if any, or a graph label).
 */
export const DELIVERY = {
  mp4: {
    contentType: 'video/mp4',
    args: (video: string, audio: string) => [
      '-map', video, '-map', audio,
      '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency',
      '-force_key_frames', 'expr:gte(t,n_forced*1)',   // a keyframe every second → a new fragment every second
      '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
      '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov+default_base_moof',   // streamable MP4: header first, then fragments
      'pipe:1',
    ],
  },
  mjpeg: {
    contentType: 'multipart/x-mixed-replace; boundary=ffmpeg',   // the mpjpeg muxer uses "ffmpeg" as boundary
    args: (video: string, _audio: string) => ['-map', video, '-c:v', 'mjpeg', '-q:v', '5', '-f', 'mpjpeg', 'pipe:1'],
  },
} as const;
export type Delivery = keyof typeof DELIVERY;

// ---------------------------------------------------------------- which files can be read as a stream?

/**
 * Walk the top-level boxes of an MP4/MOV: [size:4][type:4]…  If `moov` (the index) comes before
 * `mdat` (the media), a reader can start at byte 0 and never look back. Returns null for non-MP4 files.
 */
export function mp4IndexFirst(file: string): boolean | null {
  if (!/\.(mp4|m4v|mov|3gp)$/i.test(file)) return null;
  const fd = openSync(file, 'r');
  try {
    const size = statSync(file).size;
    const buf = Buffer.alloc(16);
    for (let offset = 0, i = 0; offset + 8 <= size && i < 64; i++) {
      readSync(fd, buf, 0, 16, offset);
      let boxSize = buf.readUInt32BE(0);
      const type = buf.toString('latin1', 4, 8);
      if (type === 'moov') return true;
      if (type === 'mdat') return false;
      if (boxSize === 1) boxSize = Number(buf.readBigUInt64BE(8));   // 64-bit size
      if (boxSize < 8) break;                                         // 0 = "to the end of file"
      offset += boxSize;
    }
    return false;
  } finally {
    closeSync(fd);
  }
}

export interface Source {
  path: string;                 // relative to the samples root
  codec: string;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  streamable: boolean;
  reason?: string;
}

/** Every video file under `root` (audio/ and streaming/ skipped), probed and checked for streamability. */
export async function listSources(root: string): Promise<Source[]> {
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return ['audio', 'streaming'].includes(e.name) ? [] : walk(p);
    return /\.(mp4|m4v|mov|mkv|webm|avi|flv|wmv|mpg|mpeg|ts|mxf|3gp|ogv)$/i.test(e.name) ? [p] : [];
  });
  const out: Source[] = [];
  for (const file of walk(root).sort()) {
    const s = await probeSummary(file).catch(() => null);
    if (!s?.video) continue;                                          // e.g. audio-only MXF
    const indexFirst = mp4IndexFirst(file);
    out.push({
      path: path.relative(root, file).split(path.sep).join('/'),
      codec: s.video.codec ?? '?',
      width: s.video.width ?? 0,
      height: s.video.height ?? 0,
      fps: s.video.fps || 30,
      hasAudio: Boolean(s.audio),
      streamable: indexFirst !== false,
      reason: indexFirst === false ? 'moov at the end — remux with -movflags +faststart' : undefined,
    });
  }
  return out;
}

// ---------------------------------------------------------------- server

export interface LiveOptions {
  title: string;
  subtitle: string;
  /** The pipeline diagram under the title (plain text). */
  flow?: string;
  port: number;
  root: string;                 // samples folder
  /**
   * Extra controls; every element with data-param="x" is sent as ?x=value.
   * A <select data-sources="default/path"> is filled with the streamable files (e.g. a second video).
   */
  controlsHtml: string;
  /**
   * What ffmpeg does. `params` are the page's data-param values; `find` looks up another source.
   * Returns:
   *   pipes   more files to stream from disk — they become inputs 1, 2, … (pipe:3, pipe:4, …)
   *   inputs  extra ffmpeg inputs after those, e.g. ['-loop', '1', '-i', 'logo.png']
   *   filter  a -filter_complex graph; input 0 is the main file; its video output is `label`
   *   audio   what to map as sound, default '0:a:0?' (the main file's audio, if any)
   */
  buildArgs?: (source: Source, params: URLSearchParams, find: (path: string | null) => Source | undefined) => {
    pipes?: Source[]; inputs?: string[]; filter: string; label: string; audio?: string;
  };
  /**
   * Instead of an ffmpeg filter graph: let Node touch every frame. The file is decoded into raw
   * yuv420p frames of `size` (src/lib/rawframes.ts), `push()` gets each one and returns a frame to
   * send (or null to hold it back), and a second ffmpeg encodes the result. No sound in this mode.
   */
  frames?: (source: Source, params: URLSearchParams, size: { width: number; height: number }) => FrameProcessor;
}

export interface FrameProcessor {
  push(frame: Buffer): Buffer | null;
  /** One line for the stats table, e.g. the tracker state. */
  info?(): string;
}

interface Stat {
  id: number; file: string; params: string; format: string; info?: string;
  startedAt: number; endedAt?: number; bytesIn: number; bytesOut: number; pauses: number; end?: string;
}

export async function startLiveServer(opts: LiveOptions) {
  const HOST = '127.0.0.1';
  const root = path.resolve(opts.root);
  const sources = await listSources(root);
  console.log(`${sources.filter((s) => s.streamable).length} of ${sources.length} video files in ${root} can be read as a stream`);

  const active = new Map<number, Stat>();
  const recent: Stat[] = [];
  let nextId = 1;

  function stream(res: ServerResponse, url: URL, format: Delivery) {
    const src = sources.find((s) => s.path === url.searchParams.get('file'));
    if (!src) return text(res, 404, 'unknown file');
    if (!src.streamable) return text(res, 422, `${src.path}: ${src.reason}`);

    const params = new URLSearchParams(url.searchParams);
    params.delete('file');
    if (opts.frames) return streamFrames(res, src, params, format);
    if (!opts.buildArgs) return text(res, 500, 'example defines neither buildArgs nor frames');
    const find = (p: string | null) => sources.find((s) => s.path === p);
    const { pipes = [], inputs = [], filter, label, audio = '0:a:0?' } = opts.buildArgs(src, params, find);
    const bad = pipes.find((p) => !p.streamable);
    if (bad) return text(res, 422, `${bad.path}: ${bad.reason}`);
    const stat = begin(src, params, format);

    // disk → ffmpeg: plain file streams, 64 KB at a time. -re = read each at playback speed.
    const open = (s: Source) => createReadStream(path.join(root, s.path), { highWaterMark: 64 * 1024 });
    const input = open(src);
    const extra = pipes.map(open);
    const output = ffmpegStream(input, [
      '-re', '-i', 'pipe:0',
      ...extra.flatMap((_, i) => ['-re', '-i', `pipe:${3 + i}`]),
      ...inputs,
      // MJPEG has no sound: a graph that builds an audio label must still have its output consumed
      '-filter_complex', format === 'mjpeg' && audio.startsWith('[') ? `${filter};${audio}anullsink` : filter,
      ...DELIVERY[format].args(label, audio),
    ], extra);
    // counters are attached after ffmpegStream() has piped the streams, so no chunk is missed
    for (const s of [input, ...extra]) {
      s.on('data', (c: Buffer | string) => { stat.bytesIn += c.length; });
      s.on('pause', () => { stat.pauses++; });         // pipe() pauses a file when ffmpeg is full = backpressure
    }

    send(res, output, stat, format);
  }

  function begin(src: Source, params: URLSearchParams, format: Delivery): Stat {
    const stat: Stat = { id: nextId++, file: src.path, params: [...params].map(([k, v]) => `${k}=${v}`).join(' '), format, startedAt: Date.now(), bytesIn: 0, bytesOut: 0, pauses: 0 };
    active.set(stat.id, stat);
    console.log(`▶ #${stat.id} ${src.path}  ${stat.params}  → ${format}`);
    return stat;
  }

  /** ffmpeg → browser. If the tab closes, pipeline destroys `output`, which kills ffmpeg(s) and closes the file. */
  function send(res: ServerResponse, output: Readable, stat: Stat, format: Delivery) {
    output.on('data', (c: Buffer | string) => { stat.bytesOut += c.length; });
    res.writeHead(200, { 'Content-Type': DELIVERY[format].contentType, 'Cache-Control': 'no-store' });
    pipeline(output, res, (err) => {
      stat.endedAt = Date.now();
      stat.end = !err ? 'finished' : res.destroyed && !res.writableFinished ? 'client closed' : err.message.split('\n').slice(0, 2).join(' ');
      active.delete(stat.id);
      recent.unshift(stat);
      recent.length = Math.min(recent.length, 10);
      const secs = ((stat.endedAt - stat.startedAt) / 1000).toFixed(1);
      console.log(`■ #${stat.id} ${secs} s  read ${humanBytes(stat.bytesIn)} from disk → sent ${humanBytes(stat.bytesOut)}  (disk reads paused ${stat.pauses}×)  [${stat.end}]${stat.info ? `  ${stat.info}` : ''}`);
    });
  }

  /** disk ─▶ ffmpeg (decode to raw frames) ─▶ Node: processor.push(frame) ─▶ ffmpeg (encode) ─▶ browser */
  function streamFrames(res: ServerResponse, src: Source, params: URLSearchParams, format: Delivery) {
    const size = processingSize(src.width || 1280, src.height || 720);
    const processor = opts.frames!(src, params, size);
    const stat = begin(src, params, format);
    const input = createReadStream(path.join(root, src.path), { highWaterMark: 64 * 1024 });
    const decoded = decodeFrames(input, size, { realtime: true });
    input.on('data', (c: Buffer | string) => { stat.bytesIn += c.length; });
    input.on('pause', () => { stat.pauses++; });
    const processed = new Transform({
      objectMode: true,
      transform(frame: Buffer, _enc, done) {
        const out = processor.push(frame);
        stat.info = processor.info?.();
        done(null, out ?? undefined);
      },
    });
    pipeline(decoded, processed, () => {});
    send(res, encodeFrames(processed, { ...size, fps: src.fps }, DELIVERY[format].args('0:v:0', '0:a:0?')), stat, format);
  }

  const page = renderPage(opts);
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${HOST}`);
    if (url.pathname === '/') return res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(page);
    if (url.pathname === '/api/sources') return json(res, { sources });
    if (url.pathname === '/api/stats') return json(res, { now: Date.now(), active: [...active.values()], recent });
    if (url.pathname === '/stream.mp4') return stream(res, url, 'mp4');
    if (url.pathname === '/stream.mjpeg') return stream(res, url, 'mjpeg');
    text(res, 404, 'not found');
  });
  server.on('error', (e: NodeJS.ErrnoException) => {
    console.error(e.code === 'EADDRINUSE' ? `Port ${opts.port} is busy — stop the other example or set LIVE_PORT=…` : e.message);
    process.exit(1);
  });
  server.listen(opts.port, HOST, () => {
    console.log(`\nLive page: http://${HOST}:${opts.port}\n(stop the example to shut the server down)\n`);
  });
  return server;
}

function text(res: ServerResponse, status: number, body: string) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }).end(body);
}
function json(res: ServerResponse, body: unknown) {
  res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
}

// ---------------------------------------------------------------- the page (plain HTML + JS, no build)

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

function renderPage({ title, subtitle, controlsHtml, flow }: LiveOptions): string {
  return /* html */ `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root { --bg:#f6f7f9; --surface:#fff; --border:#e5e7eb; --text:#111827; --muted:#6b7280; --accent:#2563eb; --soft:#eff6ff; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0b1120; --surface:#111827; --border:#1f2937; --text:#f3f4f6; --muted:#9ca3af; --accent:#3b82f6; --soft:#172554; } }
  * { box-sizing:border-box } body { margin:0; background:var(--bg); color:var(--text); font:14px/1.5 -apple-system,"Segoe UI",Inter,Arial,sans-serif; }
  header { background:var(--surface); border-bottom:1px solid var(--border); border-top:3px solid var(--accent); }
  header div, main { max-width:1100px; margin:0 auto; padding:14px 24px; }
  h1 { margin:0; font-size:17px } header p { margin:2px 0 0; color:var(--muted); font-size:13px }
  .flow { font:12px ui-monospace,Menlo,monospace; color:var(--muted); margin-top:6px }
  .panel { background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:16px; margin-top:16px }
  .controls { display:flex; flex-wrap:wrap; gap:12px; align-items:flex-end }
  label, .lbl { display:grid; gap:4px; font-size:11px; font-weight:600; letter-spacing:.04em; text-transform:uppercase; color:var(--muted) }
  select { height:36px; min-width:150px; padding:0 8px; border:1px solid var(--border); border-radius:8px; background:var(--surface); color:var(--text); font:13px inherit }
  select#file { min-width:260px }
  .check { display:flex; align-items:center; gap:6px; height:36px; text-transform:none; letter-spacing:0; font-size:13px; font-weight:500; color:var(--text) }
  .seg { display:flex; border:1px solid var(--border); border-radius:8px; overflow:hidden; height:36px }
  .seg label { display:block } .seg input { display:none } .seg span { display:grid; place-items:center; height:100%; padding:0 12px; cursor:pointer; font-size:13px; font-weight:500; text-transform:none; letter-spacing:0; color:var(--text) }
  .seg input:checked + span { background:var(--soft); color:var(--accent) }
  .buttons { display:flex; gap:8px }
  button { height:36px; padding:0 16px; border-radius:8px; font:600 13px inherit; cursor:pointer; border:1px solid var(--border); background:var(--surface); color:var(--text) }
  button.primary { background:var(--accent); border-color:var(--accent); color:#fff }
  .stage { margin-top:16px; background:#000; border-radius:10px; overflow:hidden; aspect-ratio:16/9; display:grid; place-items:center; color:#6b7280 }
  .stage video, .stage img { width:100%; height:100%; object-fit:contain; display:block }
  .note { margin-top:8px; font-size:12.5px; color:var(--muted) }
  table { width:100%; border-collapse:collapse; font-size:12.5px } th, td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--border) }
  th { color:var(--muted); font-weight:600 } td.num { font-variant-numeric:tabular-nums }
  .live { color:var(--accent); font-weight:600 }
  @media (max-width:720px) { header div, main { padding:12px 16px } select, select#file { min-width:0; width:100% } label { width:100% } }
</style></head>
<body>
<header><div>
  <h1>${esc(title)}</h1>
  <p>${esc(subtitle)}</p>
  <div class="flow">${esc(flow ?? 'disk ─ createReadStream ─▶ ffmpeg stdin ─ filters ─▶ ffmpeg stdout ─▶ HTTP response ─▶ <video> / <img>')}</div>
</div></header>
<main>
  <div class="panel">
    <div class="controls">
      <label>Source file <select id="file"></select></label>
      ${controlsHtml}
      <div class="lbl">Delivery
        <span class="seg">
          <label><input type="radio" name="fmt" value="mp4" checked><span>Video · fMP4</span></label>
          <label><input type="radio" name="fmt" value="mjpeg"><span>Frames · MJPEG</span></label>
        </span>
      </div>
      <div class="buttons"><button class="primary" id="start">Start</button> <button id="stop">Stop</button></div>
    </div>
    <div class="stage" id="stage">Press Start</div>
    <div class="note" id="note"></div>
  </div>
  <div class="panel">
    <table><thead><tr><th>#</th><th>file</th><th>settings</th><th>delivery</th><th>time</th><th>read from disk</th><th>sent</th><th>disk reads paused</th><th>status</th><th>info</th></tr></thead>
    <tbody id="stats"></tbody></table>
    <div class="note">"Disk reads paused" = backpressure: the browser (or ffmpeg) was full, so reading the file waited.</div>
  </div>
</main>
<script>
const $ = (s) => document.querySelector(s);
const stage = $('#stage'), note = $('#note');
let t0 = 0;

fetch('/api/sources').then((r) => r.json()).then(({ sources }) => {
  const groups = {};
  for (const s of sources) (groups[s.path.split('/').slice(0, -1).join('/')] ??= []).push(s);
  for (const [g, list] of Object.entries(groups)) {
    const og = document.createElement('optgroup'); og.label = g;
    for (const s of list) {
      const o = new Option(s.path.split('/').pop() + ' · ' + s.codec + (s.streamable ? '' : '  (not streamable)'), s.path);
      o.disabled = !s.streamable; o.title = s.reason || '';
      og.append(o);
    }
    $('#file').append(og);
  }
  $('#file').value = sources.find((s) => s.path.endsWith('mkv_h264_aac.mkv'))?.path ?? sources.find((s) => s.streamable)?.path;
  // other file pickers (e.g. the picture-in-picture video) get the same list
  document.querySelectorAll('select[data-sources]').forEach((sel) => {
    sel.append(...[...$('#file').children].map((og) => og.cloneNode(true)));
    sel.value = sources.some((s) => s.path === sel.dataset.sources) ? sel.dataset.sources : $('#file').value;
  });
});

/** file + every [data-param] control (checkbox → 1/0) */
function query() {
  const q = new URLSearchParams({ file: $('#file').value });
  document.querySelectorAll('[data-param]').forEach((el) => q.set(el.dataset.param, el.type === 'checkbox' ? (el.checked ? '1' : '0') : el.value));
  return q;
}
function stop() {
  stage.querySelectorAll('video, img').forEach((el) => { el.removeAttribute('src'); if (el.load) el.load(); el.remove(); });
  stage.textContent = 'Stopped';
}
function start() {
  stop();
  const fmt = document.querySelector('input[name=fmt]:checked').value;
  t0 = performance.now();
  stage.textContent = '';
  const el = document.createElement(fmt === 'mp4' ? 'video' : 'img');
  if (fmt === 'mp4') { el.controls = true; el.autoplay = true; el.playsInline = true; }
  el.addEventListener(fmt === 'mp4' ? 'playing' : 'load', () => {
    note.textContent = 'First frame after ' + Math.round(performance.now() - t0) + ' ms' +
      (fmt === 'mp4' ? ' · no seeking: a live stream has no Range support and no known length' : ' · each JPEG replaces the previous one as it arrives');
  }, { once: true });
  el.addEventListener('error', () => { note.textContent = 'The browser could not play this stream' + (fmt === 'mp4' ? ' — Safari needs Range requests; try Frames · MJPEG.' : '.'); });
  el.src = '/stream.' + fmt + '?' + query();
  stage.append(el);
  note.textContent = 'Connecting…';
}
$('#start').onclick = start;
$('#stop').onclick = stop;
document.querySelectorAll('[data-param]').forEach((el) => el.addEventListener('change', () => { if (stage.querySelector('video, img')) start(); }));

const mb = (n) => n > 1048576 ? (n / 1048576).toFixed(2) + ' MB' : (n / 1024).toFixed(0) + ' KB';
const cell = (v, cls) => { const td = document.createElement('td'); td.textContent = v; if (cls) td.className = cls; return td; };
async function poll() {
  try {
    const { now, active, recent } = await (await fetch('/api/stats')).json();
    $('#stats').replaceChildren(...[...active, ...recent].map((s) => {
      const tr = document.createElement('tr');
      tr.append(cell(s.id), cell(s.file.split('/').pop()), cell(s.params), cell(s.format),
        cell((((s.endedAt ?? now) - s.startedAt) / 1000).toFixed(1) + ' s', 'num'), cell(mb(s.bytesIn), 'num'),
        cell(mb(s.bytesOut), 'num'), cell(s.pauses + '×', 'num'), cell(s.end ?? 'streaming', s.end ? '' : 'live'), cell(s.info ?? ''));
      return tr;
    }));
  } catch {}
  setTimeout(poll, 1000);
}
poll();
</script>
</body></html>`;
}
