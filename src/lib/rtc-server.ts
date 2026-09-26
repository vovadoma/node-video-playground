/**
 * Server + page shared by the WebRTC examples (15 = @roamhq/wrtc, 16 = werift, 17 = camera + recording).
 * The example supplies `answer()`: take the browser's SDP offer, set up its own peer, return the answer.
 * With `recordings` set, the page also gets Record / Snapshot controls and a list of saved files.
 *
 *   browser: camera or a sample video ─▶ canvas (+ latency stamp) ─▶ RTCPeerConnection ══▶ server
 *            ◀══ processed video ══ server           DataChannel "control": mode ▶ / ◀ server stats
 *
 * Signalling is one HTTP round trip (non-trickle ICE: the server answers once its ICE gathering is done).
 * localhost only — for other machines you'd need HTTPS (getUserMedia), STUN and maybe TURN.
 */
import { createReadStream, mkdirSync, readdirSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { probeSummary } from './ffprobe.js';
import { STAMP } from './i420.js';
import { LIVE_CSS } from './live.js';
import { RTC_MODES } from './rtc-modes.js';

export interface SessionDescription { type: 'offer' | 'answer'; sdp: string }

export interface RtcServerOptions {
  title: string;
  subtitle: string;
  flow: string;
  port: number;
  root: string;                                   // samples folder (for the "sample video" source)
  answer: (offer: SessionDescription) => Promise<SessionDescription>;
  /** A folder with recordings: served at /recordings/, listed at /api/recordings, recording UI on the page. */
  recordings?: string;
  /** What the page starts with (defaults: the camera, mode forward). */
  defaults?: { source?: 'camera' | 'screen'; mode?: (typeof RTC_MODES)[number] };
}

export async function startRtcServer(o: RtcServerOptions) {
  const HOST = '127.0.0.1';
  const root = path.resolve(o.root);
  const sources = await browserPlayable(root);
  const page = renderPage(o);
  const recDir = o.recordings && path.resolve(o.recordings);
  if (recDir) mkdirSync(recDir, { recursive: true });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${HOST}`);
    try {
      if (url.pathname === '/') return send(res, 200, 'text/html; charset=utf-8', page);
      if (url.pathname === '/api/sources') return send(res, 200, 'application/json', JSON.stringify(sources));
      if (url.pathname.startsWith('/media/')) return sendMedia(req, res, root, decodeURIComponent(url.pathname.slice(7)));
      if (recDir && url.pathname === '/api/recordings') return send(res, 200, 'application/json', JSON.stringify(listRecordings(recDir)));
      if (recDir && url.pathname.startsWith('/recordings/')) return sendMedia(req, res, recDir, decodeURIComponent(url.pathname.slice(12)));
      if (url.pathname === '/offer' && req.method === 'POST') {
        const offer = JSON.parse(await body(req)) as SessionDescription;
        const answer = await o.answer(offer);
        if (process.env.RTC_DEBUG) {                      // RTC_DEBUG=1: show the ICE candidates of both sides
          const cands = (sdp: string) => sdp.split(/\r?\n/).filter((l) => l.startsWith('a=candidate')).map((l) => '    ' + l).join('\n');
          console.log(`  offer candidates:\n${cands(offer.sdp)}\n  answer candidates:\n${cands(answer.sdp)}`);
          if (process.env.RTC_DEBUG === 'sdp') console.log(`  --- offer\n${offer.sdp}\n  --- answer\n${answer.sdp}`);
        }
        return send(res, 200, 'application/json', JSON.stringify(answer));
      }
      send(res, 404, 'text/plain', 'not found');
    } catch (e) {
      console.error(e);
      if (!res.headersSent) send(res, 500, 'text/plain', (e as Error).message);
    }
  });
  server.on('error', (e: NodeJS.ErrnoException) => {
    console.error(e.code === 'EADDRINUSE' ? `Port ${o.port} is busy — stop the other example or set RTC_PORT=…` : e.message);
    process.exit(1);
  });
  server.listen(o.port, HOST, () => console.log(`\nLive page: http://${HOST}:${o.port}\n(stop the example to shut the server down)\n`));
  return server;
}

function send(res: ServerResponse, status: number, type: string, body: string) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' }).end(body);
}

async function body(req: IncomingMessage): Promise<string> {
  let s = '';
  for await (const c of req) { s += c; if (s.length > 1e6) throw new Error('offer too large'); }
  return s;
}

/** A sample file with Range support (so the <video> used as a source can loop), confined to `root`. */
function sendMedia(req: IncomingMessage, res: ServerResponse, root: string, rel: string) {
  const file = path.resolve(root, '.' + path.posix.normalize('/' + rel));
  if (!file.startsWith(root + path.sep)) return send(res, 404, 'text/plain', 'not found');
  let size: number;
  try { size = statSync(file).size; } catch { return send(res, 404, 'text/plain', 'not found'); }
  const type = file.endsWith('.webm') ? 'video/webm' : /\.jpe?g$/.test(file) ? 'image/jpeg' : 'video/mp4';
  const m = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
  if (m && (m[1] || m[2])) {
    const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    res.writeHead(206, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    return createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res);
  }
  res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': size });
  createReadStream(file).on('error', () => res.destroy()).pipe(res);
}

/** Newest first: name, size, time. */
function listRecordings(dir: string) {
  return readdirSync(dir)
    .filter((n) => /\.(mp4|jpe?g)$/i.test(n))
    .map((n) => { const st = statSync(path.join(dir, n)); return { name: n, size: st.size, time: st.mtimeMs }; })
    .sort((a, b) => b.time - a.time);
}

/** Sample videos a browser <video> can play: MP4 with H.264, WebM with VP8 / VP9 / AV1. */
async function browserPlayable(root: string): Promise<string[]> {
  const out: string[] = [];
  for (const dir of ['generated', 'real-world']) {
    let names: string[] = [];
    try { names = readdirSync(path.join(root, dir)).sort(); } catch { continue; }
    for (const n of names) {
      if (!/\.(mp4|webm)$/i.test(n)) continue;
      const s = await probeSummary(path.join(root, dir, n)).catch(() => null);
      const c = s?.video?.codec;
      if ((n.endsWith('.mp4') && c === 'h264') || (n.endsWith('.webm') && (c === 'vp8' || c === 'vp9' || c === 'av1'))) out.push(`${dir}/${n}`);
    }
  }
  return out;
}

// ---------------------------------------------------------------- the page

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);


function renderPage({ title, subtitle, flow, recordings, defaults = {} }: RtcServerOptions): string {
  const rec = Boolean(recordings);
  return /* html */ `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
${LIVE_CSS}
  .pair { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:16px }
  .pair figure { margin:0 } .pair figcaption { font-size:12px; color:var(--muted); margin-bottom:4px; font-weight:600; text-transform:uppercase; letter-spacing:.04em }
  .pair video { width:100%; aspect-ratio:16/9; background:#000; border-radius:10px; display:block; object-fit:contain }
  .mirrored { transform:scaleX(-1) }
  .kpis { display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); border:1px solid var(--border); border-radius:8px; overflow:hidden; margin-top:16px }
  .kpis div { padding:10px 12px; border-right:1px solid var(--border); border-bottom:1px solid var(--border); margin:0 -1px -1px 0 } .kpis b { display:block; font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:.04em }
  .kpis span { font-size:18px; font-weight:600; font-variant-numeric:tabular-nums }
  .hidden { display:none !important }
  .rec { color:#dc2626; font-weight:700 } .rec::before { content:"● " }
  .files { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1.3fr); gap:16px; margin-top:12px }
  .files ul { list-style:none; margin:0; padding:0; max-height:360px; overflow:auto; border:1px solid var(--border); border-radius:8px }
  .files li { padding:8px 12px; border-bottom:1px solid var(--border); cursor:pointer; display:flex; justify-content:space-between; gap:8px; font-size:13px }
  .files li:hover, .files li.on { background:var(--soft) } .files li span { color:var(--muted); white-space:nowrap }
  .viewer video, .viewer img { width:100%; border-radius:10px; background:#000; display:block }
  @media (max-width:720px) { .pair, .files { grid-template-columns:1fr } }
</style></head>
<body>
<header><div>
  <h1>${esc(title)}</h1>
  <p>${esc(subtitle)}</p>
  <div class="flow">${esc(flow)}</div>
</div></header>
<main>
  <div class="panel">
    <div class="controls">
      <label>Source <select id="source"><option value="camera:">Camera (default)</option><option value="screen:"${defaults.source === 'screen' ? ' selected' : ''}>Screen / window / tab</option></select></label>
      <label class="cam">Resolution <select id="res"><option value="640x480">480p · 640×480</option><option value="1280x720" selected>720p · 1280×720</option><option value="1920x1080">1080p · 1920×1080</option></select></label>
      <label class="live">FPS <select id="fps"><option>5</option><option>15</option><option selected>30</option></select></label>
      <label class="cam">&nbsp;<span class="check"><input type="checkbox" id="mirror" checked> mirror preview</span></label>
      <label>Mode <select id="mode">${RTC_MODES.map((m) => `<option value="${m}"${m === defaults.mode ? ' selected' : ''}>${m}</option>`).join('')}</select></label>
      <label id="effectBox" class="hidden">Effect <select id="effect"><option>gray</option><option>negate</option><option>mirror</option><option>edges</option></select></label>
      <label id="splitBox" class="hidden">&nbsp;<span class="check"><input type="checkbox" id="split"> before / after</span></label>
      <label id="ratioBox" class="hidden">Sight / target speed <select id="ratio"><option>0.4</option><option selected>0.6</option><option>0.8</option><option>1</option></select></label>
      <div class="buttons"><button class="primary" id="start">Start</button> <button id="stop">Stop</button></div>
    </div>
    <div class="pair">
      <figure><figcaption>Sent to the server (with latency stamp)</figcaption><video id="local" autoplay muted playsinline></video></figure>
      <figure><figcaption>Came back from the server</figcaption><video id="remote" autoplay muted playsinline></video></figure>
    </div>
    <div class="note" id="note">Press Start. The browser asks for camera access the first time. Modes switch live over the DataChannel.</div>
    <div class="kpis">
      <div><b>Round trip (stamp)</b><span id="lat">—</span></div>
      <div><b>Latency min / p95</b><span id="latmm">—</span></div>
      <div><b>Network RTT</b><span id="rtt">—</span></div>
      <div><b>Sent</b><span id="out">—</span></div>
      <div><b>Received</b><span id="in">—</span></div>
      <div><b>Codec</b><span id="codec">—</span></div>
      <div><b>Server</b><span id="srv">—</span></div>
    </div>
  </div>
  <div class="panel${rec ? '' : ' hidden'}" id="recPanel">
    <div class="controls">
      <label>Record <select id="recWhat"><option value="in">what the camera sent (original)</option><option value="out">what the server sends back (processed)</option></select></label>
      <div class="buttons"><button class="primary" id="recStart" disabled>● Record</button> <button id="recStop" disabled>■ Stop recording</button> <button id="snap" disabled>Snapshot</button></div>
      <span id="recState" class="note"></span>
    </div>
    <div class="files">
      <ul id="files"></ul>
      <div class="viewer" id="viewer"><p class="note">Recordings and snapshots are saved on the server; pick one to play it here.</p></div>
    </div>
  </div>
</main>
<script>
const $ = (s) => document.querySelector(s);
const BLOCK = ${STAMP.block}, BITS = ${STAMP.bits}, REC = ${rec};
let W = 640, pc, dc, srcVideo, srcStream, drawing = false, lats = [], lastStats = {}, size = null;

// ---- sources: cameras (labels appear after the first permission grant) + sample videos
async function listCameras() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  const sel = $('#source'), keep = sel.value;
  sel.querySelectorAll('option[value^="camera:"]').forEach((o) => o.remove());
  const opts = cams.length ? cams.map((c, i) => new Option('Camera: ' + (c.label || 'camera ' + (i + 1)), 'camera:' + c.deviceId)) : [new Option('Camera (default)', 'camera:')];
  sel.prepend(...opts);
  sel.value = [...sel.options].some((o) => o.value === keep) ? keep : keep.startsWith('camera:') ? opts[0].value : keep;
  showParams();
}
fetch('/api/sources').then((r) => r.json()).then((list) => {
  for (const p of list) $('#source').append(new Option('sample: ' + p, p));
  listCameras();
});
navigator.mediaDevices?.addEventListener?.('devicechange', listCameras);

/** DataChannel message — silently skipped when the channel isn't open (never throws). */
function send(m) { if (dc?.readyState === 'open') dc.send(JSON.stringify(m)); }

function showParams() {
  const m = $('#mode').value, cam = $('#source').value.startsWith('camera:'), screen = $('#source').value === 'screen:';
  $('#effectBox').classList.toggle('hidden', m !== 'effects');
  $('#splitBox').classList.toggle('hidden', m !== 'effects');
  $('#ratioBox').classList.toggle('hidden', m !== 'tracker');
  document.querySelectorAll('.cam').forEach((el) => el.classList.toggle('hidden', !cam));
  document.querySelectorAll('.live').forEach((el) => el.classList.toggle('hidden', !cam && !screen));
  $('#local').classList.toggle('mirrored', cam && $('#mirror').checked);
}
function control() {
  showParams();
  // size = what we send: an engine that decodes with ffmpeg must know it to keep the frame (and the stamp) intact
  const live = $('#source').value.startsWith('camera:') || $('#source').value === 'screen:';
  send({ mode: $('#mode').value, size, params: { effect: $('#effect').value, split: $('#split').checked, ratio: Number($('#ratio').value), fps: live ? Number($('#fps').value) : 30 } });
  lats = [];
}
['#mode', '#effect', '#split', '#ratio'].forEach((s) => $(s).addEventListener('change', control));
['#source', '#mirror'].forEach((s) => $(s).addEventListener('change', showParams));
showParams();

const CAMERA_ERRORS = {
  NotAllowedError: 'Camera access was denied — allow it via the camera icon in the address bar, then press Start again.',
  NotFoundError: 'No camera found.',
  NotReadableError: 'The camera is busy — another app (Zoom, FaceTime, …) is using it.',
  OverconstrainedError: 'This camera can’t do the chosen resolution — try a lower one.',
  SecurityError: 'Camera access needs https:// or http://localhost / 127.0.0.1.',
};

/** Source → canvas (its own size, ≤ 1920 wide) with the stamp in the bottom-left strip → captureStream. */
async function makeSource() {
  srcVideo = document.createElement('video');
  srcVideo.muted = true; srcVideo.playsInline = true; srcVideo.loop = true;
  const src = $('#source').value;
  const fps = Number($('#fps').value);
  if (src.startsWith('camera:')) {
    const [w, h] = $('#res').value.split('x').map(Number);
    const deviceId = src.slice(7);
    try {
      srcStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { width: { ideal: w }, height: { ideal: h }, frameRate: { ideal: fps }, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) } });
    } catch (e) {
      throw new Error(CAMERA_ERRORS[e.name] ?? e.message);
    }
    srcVideo.srcObject = srcStream;
    listCameras();                                   // now the labels are known
  } else if (src === 'screen:') {
    if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('This browser can’t share the screen.');
    try {
      // the browser shows its own picker: entire screen, a window or a tab
      srcStream = await navigator.mediaDevices.getDisplayMedia({ audio: false, video: { frameRate: { ideal: fps, max: fps }, width: { max: 1920 }, height: { max: 1080 } } });
    } catch (e) {
      throw new Error(e.name === 'NotAllowedError' ? 'Screen sharing was cancelled (or blocked by the system — on macOS allow the browser in Privacy & Security → Screen Recording).' : e.message);
    }
    const track = srcStream.getVideoTracks()[0];
    track.contentHint = 'detail';                    // screen content: keep text sharp rather than motion smooth
    track.addEventListener('ended', () => { stop(); $('#note').textContent = 'Screen sharing stopped.'; });   // "Stop sharing" in the browser bar
    srcVideo.srcObject = srcStream;
  } else {
    srcVideo.src = '/media/' + src.split('/').map(encodeURIComponent).join('/');
  }
  await srcVideo.play();
  await new Promise((r) => (srcVideo.videoWidth ? r() : srcVideo.addEventListener('loadedmetadata', r, { once: true })));
  W = Math.min(1920, Math.round(srcVideo.videoWidth / 2) * 2);
  const H = Math.round((W * srcVideo.videoHeight) / srcVideo.videoWidth / 2) * 2;
  size = { width: W, height: H };
  const canvas = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = canvas.getContext('2d');
  drawing = true;
  const frame = () => {
    if (!drawing) return;
    ctx.drawImage(srcVideo, 0, 0, W, H);
    const t = Math.round(performance.now()) & 0xffff;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, H - BLOCK, BLOCK, BLOCK);                 // pilot: white, black
    ctx.fillStyle = '#000'; ctx.fillRect(BLOCK, H - BLOCK, BLOCK, BLOCK);
    for (let i = 0; i < BITS; i++) {
      ctx.fillStyle = (t >> (BITS - 1 - i)) & 1 ? '#fff' : '#000';
      ctx.fillRect((i + 2) * BLOCK, H - BLOCK, BLOCK, BLOCK);
    }
    srcVideo.requestVideoFrameCallback ? srcVideo.requestVideoFrameCallback(frame) : setTimeout(frame, 1000 / fps);
  };
  frame();
  return canvas.captureStream(fps);
}

/** Read the stamp back from every returned frame → round-trip latency. */
function watchLatency(video) {
  const c = document.createElement('canvas'), ctx = c.getContext('2d', { willReadFrequently: true });
  const onFrame = () => {
    if (!pc) return;
    const w = video.videoWidth, h = video.videoHeight;
    if (w && h) {
      const sx = w / W, bh = Math.max(4, Math.round(BLOCK * sx));
      c.width = w; c.height = bh;
      ctx.drawImage(video, 0, h - bh, w, bh, 0, 0, w, bh);
      const lum = (i) => { const d = ctx.getImageData(Math.round((i + 0.5) * BLOCK * sx), bh >> 1, 1, 1).data; return (d[0] + d[1] + d[2]) / 3; };
      if (lum(0) > 150 && lum(1) < 100) {                                   // pilot ok → a stamp is there
        let v = 0;
        for (let i = 0; i < BITS; i++) v = (v << 1) | (lum(i + 2) > 128 ? 1 : 0);
        const ms = ((Math.round(performance.now()) & 0xffff) - v + 65536) % 65536;
        if (ms < 5000) { lats.push(ms); if (lats.length > 90) lats.shift(); }
      }
    }
    video.requestVideoFrameCallback(onFrame);
  };
  video.requestVideoFrameCallback(onFrame);
}

async function start() {
  stop();
  $('#note').textContent = 'Connecting…';
  const stream = await makeSource();
  $('#local').srcObject = stream;
  // max-bundle: one ICE/DTLS transport for video + DataChannel from the start (werift needs it; wrtc doesn't mind)
  pc = new RTCPeerConnection({ bundlePolicy: 'max-bundle' });
  const outTrack = stream.getVideoTracks()[0];
  if ($('#source').value === 'screen:') outTrack.contentHint = 'detail';   // the encoder favours sharp text over frame rate
  const tx = pc.addTransceiver(outTrack, { direction: 'sendrecv' });
  // keep the resolution (drop frames instead of scaling down) and allow enough bitrate for it
  const params = tx.sender.getParameters();
  params.degradationPreference = 'maintain-resolution';
  params.encodings = [{ ...(params.encodings?.[0] ?? {}), maxBitrate: Math.round(size.width * size.height * 4) }];
  tx.sender.setParameters(params).catch((e) => console.warn('setParameters:', e));
  dc = pc.createDataChannel('control');
  dc.onopen = () => { control(); setRecButtons(true); };
  dc.onmessage = (e) => onServer(JSON.parse(e.data));
  pc.ontrack = (e) => { $('#remote').srcObject = new MediaStream([e.track]); watchLatency($('#remote')); };
  pc.onconnectionstatechange = () => {
    const st = pc?.connectionState;
    if (!st) return;
    $('#note').textContent = 'Connection: ' + st + ' · sending ' + size.width + '×' + size.height;
    if (st === 'failed' || st === 'disconnected' || st === 'closed') { stop(); $('#note').textContent = 'Connection ' + st + ' — press Start to reconnect (a recording in progress was saved by the server).'; loadFiles(); }
  };
  await pc.setLocalDescription(await pc.createOffer());
  await new Promise((r) => { if (pc.iceGatheringState === 'complete') r(); pc.onicegatheringstatechange = () => pc.iceGatheringState === 'complete' && r(); setTimeout(r, 2000); });
  const res = await fetch('/offer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pc.localDescription) });
  if (!res.ok) { $('#note').textContent = 'Server: ' + await res.text(); return; }
  await pc.setRemoteDescription(await res.json());
}

function stop() {
  drawing = false;
  srcStream?.getTracks().forEach((t) => t.stop());
  srcVideo?.pause();
  pc?.close(); pc = undefined; dc = undefined;
  $('#local').srcObject = null; $('#remote').srcObject = null;
  lats = []; lastStats = {};
  setRecButtons(false);
  $('#recState').textContent = '';
}
$('#start').onclick = () => start().catch((e) => { $('#note').textContent = e.message; stop(); });
$('#stop').onclick = () => { stop(); $('#note').textContent = 'Stopped'; };

// ---- messages from the server: stats every second, recording state, new files
function onServer(m) {
  if ('fpsIn' in m) {
    $('#srv').textContent = m.mode + ' · ' + m.fpsIn + '→' + m.fpsOut + ' fps · ' + m.ms.toFixed(1) + ' ms/f';
    $('#srv').title = m.width + 'x' + m.height;
  }
  if (m.recording) {
    const r = m.recording;
    $('#recState').className = r.active ? 'rec' : 'note';
    $('#recState').textContent = r.active ? 'REC ' + r.seconds.toFixed(0) + ' s · ' + r.frames + ' frames' + (r.dropped ? ' · ' + r.dropped + ' dropped' : '') + ' · ' + r.what : r.message ?? '';
    $('#recStart').disabled = r.active; $('#recStop').disabled = !r.active;
  }
  if (m.saved) loadFiles(m.saved);
}

// ---- recording UI (only when the server keeps recordings)
function setRecButtons(on) {
  if (!REC) return;
  $('#recStart').disabled = !on; $('#snap').disabled = !on; $('#recStop').disabled = true;
}
$('#recStart').onclick = () => send({ record: 'start', what: $('#recWhat').value });
$('#recStop').onclick = () => send({ record: 'stop' });
$('#snap').onclick = () => send({ snapshot: $('#recWhat').value });

const kb = (n) => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB';
async function loadFiles(select) {
  if (!REC) return;
  const list = await (await fetch('/api/recordings')).json();
  $('#files').replaceChildren(...list.map((f) => {
    const li = document.createElement('li');
    li.dataset.name = f.name;
    li.append(Object.assign(document.createElement('b'), { textContent: f.name }), Object.assign(document.createElement('span'), { textContent: kb(f.size) }));
    li.onclick = () => view(f.name);
    return li;
  }));
  if (select) view(select);
}
function view(name) {
  document.querySelectorAll('#files li').forEach((li) => li.classList.toggle('on', li.dataset.name === name));
  const url = '/recordings/' + encodeURIComponent(name);
  const el = /\\.jpe?g$/i.test(name) ? Object.assign(document.createElement('img'), { src: url }) : Object.assign(document.createElement('video'), { src: url, controls: true, autoplay: true, muted: true });
  const link = Object.assign(document.createElement('a'), { href: url, download: name, textContent: 'Download ' + name, className: 'note' });
  $('#viewer').replaceChildren(el, link);
}
loadFiles();

setInterval(async () => {
  if (lats.length) {
    const s = [...lats].sort((a, b) => a - b);
    $('#lat').textContent = Math.round(s.reduce((a, b) => a + b, 0) / s.length) + ' ms';
    $('#latmm').textContent = s[0] + ' / ' + s[Math.floor(s.length * 0.95)] + ' ms';
  }
  if (!pc) return;
  const r = await pc.getStats();
  let out, inb, pair, codecs = {};
  r.forEach((s) => {
    if (s.type === 'outbound-rtp' && s.kind === 'video') out = s;
    if (s.type === 'inbound-rtp' && s.kind === 'video') inb = s;
    if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') pair = s;
    if (s.type === 'codec') codecs[s.id] = s.mimeType;
  });
  const kbps = (now, key) => lastStats[key] ? Math.round(((now.bytes - lastStats[key].bytes) * 8) / (now.t - lastStats[key].t)) : 0;
  if (out) { const n = { bytes: out.bytesSent, t: out.timestamp }; $('#out').textContent = (out.framesPerSecond ?? 0) + ' fps · ' + kbps(n, 'out') + ' kb/s'; lastStats.out = n; $('#codec').textContent = codecs[out.codecId] ?? '—'; }
  if (inb) { const n = { bytes: inb.bytesReceived, t: inb.timestamp }; $('#in').textContent = (inb.framesPerSecond ?? 0) + ' fps · ' + kbps(n, 'in') + ' kb/s'; lastStats.in = n; }
  if (pair?.currentRoundTripTime !== undefined) $('#rtt').textContent = (pair.currentRoundTripTime * 1000).toFixed(1) + ' ms';
}, 1000);
</script>
</body></html>`;
}
