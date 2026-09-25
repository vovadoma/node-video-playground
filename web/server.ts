/**
 * Web player — browse everything under SAMPLES_DIR and play what the browser can.
 *
 *   npm run web                 # http://127.0.0.1:3000
 *   PORT=8080 npm run web
 *
 * No framework: node:http serves the static UI (web/public), a JSON catalog built with
 * ffprobe, and the media files themselves with Range support (needed for seeking).
 */
import { createReadStream, readdirSync, statSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SAMPLES_DIR } from '../src/lib/config.js';
import { probeSummary } from '../src/lib/ffprobe.js';

const PORT = Number(process.env.PORT ?? 3000);
const HOST = '127.0.0.1';
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const ROOT = path.resolve(SAMPLES_DIR);

const MEDIA = /\.(mp4|m4v|mov|mkv|webm|avi|flv|wmv|mpg|mpeg|ts|m2ts|mxf|3gp|ogv|mp3|m4a|aac|ac3|eac3|dts|flac|wav|aiff?|au|ogg|opus|wma|wv|mka|amr|ra|voc|mp2|g722|m3u8|mpd)$/i;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.md': 'text/markdown; charset=utf-8',
  '.m3u8': 'application/vnd.apple.mpegurl', '.mpd': 'application/dash+xml',
  '.m4s': 'video/iso.segment', '.ts': 'video/mp2t',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.mkv': 'video/x-matroska', '.ogv': 'video/ogg',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac',
  '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.mka': 'audio/x-matroska',
};
const mimeOf = (p: string) => MIME[path.extname(p).toLowerCase()] ?? 'application/octet-stream';

type Playable = 'yes' | 'maybe' | 'no';

interface Entry {
  path: string;                 // relative to ROOT, forward slashes
  group: string;                // top-level folder(s) for the sidebar
  kind: 'video' | 'audio' | 'hls' | 'dash';
  size: number;
  playable: Playable;
  reason?: string;
  mime: string;
  summary?: Omit<Awaited<ReturnType<typeof probeSummary>>, 'raw'>;
  raw?: unknown;
  error?: string;
}

// ---------------------------------------------------------------- catalog

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name.startsWith('.')) return [];
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    if (!MEDIA.test(e.name)) return [];
    return [p];
  });
}

/** Drop HLS/DASH pieces: segments, and per-rendition playlists when a master.m3u8 exists. */
function isStreamingPart(file: string, all: Set<string>, manifestDirs: Set<string>): boolean {
  const dir = path.dirname(file);
  const ext = path.extname(file).toLowerCase();
  if (ext === '.ts' || ext === '.m4s') return manifestDirs.has(dir);
  if (ext === '.mp4' && path.basename(file).startsWith('init')) return manifestDirs.has(dir);
  if (ext === '.m3u8' && path.basename(file) !== 'master.m3u8') {
    // variant playlists: nested (720p/index.m3u8) or flat (stream_0.m3u8 next to master.m3u8)
    return all.has(path.join(path.dirname(dir), 'master.m3u8')) || all.has(path.join(dir, 'master.m3u8'));
  }
  return false;
}

/** Decide from the real codecs (not the extension) whether a <video>/<audio> can take it. */
function classify(ext: string, s?: Entry['summary']): { playable: Playable; reason?: string } {
  if (ext === '.m3u8' || ext === '.mpd') return { playable: 'yes' };
  const byExt: Record<string, Playable> = {
    '.mp4': 'yes', '.m4v': 'yes', '.webm': 'yes', '.mp3': 'yes', '.m4a': 'yes', '.aac': 'yes',
    '.flac': 'yes', '.wav': 'yes', '.ogg': 'yes', '.opus': 'yes', '.mov': 'maybe', '.mkv': 'maybe', '.mka': 'maybe',
  };
  if (!s) return { playable: byExt[ext] ?? 'no', reason: 'not probed — guessed from extension' };

  const c = s.container;
  const v = s.video?.codec;
  const a = s.audio?.codec;
  const container =
    /mp4|mov/.test(c) ? 'mp4' : /webm|matroska/.test(c) ? (ext === '.webm' ? 'webm' : 'mkv')
    : c === 'mp3' ? 'mp3' : c === 'aac' ? 'aac' : c === 'flac' ? 'flac' : c === 'wav' ? 'wav' : c === 'ogg' ? 'ogg' : c;

  const goodAudio = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac', 'pcm_s16le', 'pcm_s24le', 'pcm_u8', 'pcm_f32le']);
  const verdicts: Playable[] = [];
  const why: string[] = [];

  if (!['mp4', 'webm', 'mkv', 'mp3', 'aac', 'flac', 'wav', 'ogg'].includes(container)) {
    return { playable: 'no', reason: `container ${c.split(',')[0]} is not supported by browsers` };
  }
  if (container === 'mkv') { verdicts.push('maybe'); why.push('Matroska: Chromium only'); }

  if (v) {
    if (v === 'h264' || v === 'vp8' || v === 'vp9') verdicts.push('yes');
    else if (v === 'av1') { verdicts.push(container === 'webm' ? 'yes' : 'maybe'); if (container !== 'webm') why.push('AV1 in MP4: recent browsers only'); }
    else if (v === 'hevc') { verdicts.push('maybe'); why.push('H.265: Safari / hardware-dependent'); }
    else return { playable: 'no', reason: `video codec ${v} is not supported by browsers` };
  }
  if (a) {
    if (goodAudio.has(a)) verdicts.push('yes');
    else if (a === 'alac') { verdicts.push('maybe'); why.push('ALAC: Safari only'); }
    else if (a === 'eac3' || a === 'ac3') { verdicts.push('maybe'); why.push(`${a.toUpperCase()}: Safari/Edge only`); }
    else return { playable: 'no', reason: `audio codec ${a} is not supported by browsers` };
  }
  const playable: Playable = verdicts.includes('maybe') ? 'maybe' : verdicts.length ? 'yes' : 'no';
  return { playable, reason: why.join('; ') || undefined };
}

async function buildEntry(file: string): Promise<Entry> {
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  const ext = path.extname(file).toLowerCase();
  const parts = rel.split('/');
  const group = parts.length > 1 ? parts.slice(0, Math.min(parts.length - 1, 2)).join('/') : '.';
  const kindOf = (): Entry['kind'] =>
    ext === '.m3u8' ? 'hls' : ext === '.mpd' ? 'dash' : /\.(mp3|m4a|aac|ac3|eac3|dts|flac|wav|aiff?|au|ogg|opus|wma|wv|mka|amr|ra|voc|mp2|g722)$/.test(ext) ? 'audio' : 'video';

  const entry: Entry = { path: rel, group, kind: kindOf(), size: statSync(file).size, playable: 'no', mime: mimeOf(file) };
  if (ext !== '.m3u8' && ext !== '.mpd') {
    try {
      const { raw, ...summary } = await probeSummary(file);
      entry.summary = summary;
      entry.raw = raw;
      if (!summary.video && summary.audio) entry.kind = 'audio';
    } catch (e) {
      entry.error = String((e as Error).message).split('\n')[0];
      // no ffprobe: .webm / .mka under an audio/ folder are audio-only in practice
      if (parts.includes('audio') && /\.(webm|mka|mp4)$/.test(ext)) entry.kind = 'audio';
    }
  }
  Object.assign(entry, classify(ext, entry.summary));
  return entry;
}

async function scan(): Promise<Entry[]> {
  const t0 = Date.now();
  const files = walk(ROOT).sort();
  const all = new Set(files);
  const manifestDirs = new Set(files.filter((f) => /\.(m3u8|mpd)$/i.test(f)).map((f) => path.dirname(f)));
  const list = files.filter((f) => !isStreamingPart(f, all, manifestDirs));
  const out: Entry[] = [];
  const CONCURRENCY = 8;
  for (let i = 0; i < list.length; i += CONCURRENCY) {
    out.push(...await Promise.all(list.slice(i, i + CONCURRENCY).map(buildEntry)));
  }
  console.log(`Catalog: ${out.length} entries from ${ROOT} in ${Date.now() - t0} ms`);
  const failed = out.filter((e) => e.error).length;
  if (failed) console.warn(`  ffprobe failed for ${failed} file(s) — playability guessed from extension. First error: ${out.find((e) => e.error)?.error}`);
  return out;
}

let catalog: Promise<Entry[]> = scan();

// ---------------------------------------------------------------- http

/** Resolve a URL path inside `base`; null if it escapes (../) or does not exist. */
function safeResolve(base: string, urlPath: string): string | null {
  let decoded: string;
  try { decoded = decodeURIComponent(urlPath); } catch { return null; }   // malformed %-escapes
  const p = path.resolve(base, '.' + path.posix.normalize('/' + decoded));
  if (p !== base && !p.startsWith(base + path.sep)) return null;
  try { return statSync(p).isFile() ? p : null; } catch { return null; }
}

function sendFile(res: ServerResponse, file: string, range?: string) {
  const size = statSync(file).size;
  const headers: Record<string, string | number> = {
    'Content-Type': mimeOf(file), 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache',
  };
  const m = range?.match(/^bytes=(\d*)-(\d*)$/);
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : size - Number(m[2]);   // "bytes=-500" = last 500 bytes
    let end = m[1] && m[2] ? Number(m[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(end, size - 1);
    if (start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end();
      return;
    }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    pipeFile(res, createReadStream(file, { start, end }));
    return;
  }
  res.writeHead(200, { ...headers, 'Content-Length': size });
  pipeFile(res, createReadStream(file));
}

/** The file can vanish between stat and read (e.g. `npm run samples` running) — don't crash. */
function pipeFile(res: ServerResponse, stream: ReturnType<typeof createReadStream>) {
  stream.on('error', (e) => { console.error(`read failed: ${e.message}`); res.destroy(); });
  stream.pipe(res);
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${HOST}`);
  try {
    if (url.pathname === '/api/files') {
      if (url.searchParams.has('refresh')) catalog = scan();
      return sendJson(res, 200, { root: ROOT, files: await catalog });
    }
    if (url.pathname.startsWith('/media/')) {
      const file = safeResolve(ROOT, url.pathname.slice('/media/'.length));
      if (!file) return sendJson(res, 404, { error: 'not found' });
      return sendFile(res, file, req.headers.range);
    }
    const file = safeResolve(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname);
    if (!file) return sendJson(res, 404, { error: 'not found' });
    return sendFile(res, file);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) sendJson(res, 500, { error: (e as Error).message });
    else res.destroy();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Web player: http://${HOST}:${PORT}  (samples: ${ROOT})`);
});
