// Web player UI: sidebar catalog from /api/files, player for the selected entry.
// Plain browser JS, no build step. hls.js / dash.js come from the CDN in index.html.

const $ = (sel) => document.querySelector(sel);
const listEl = $('#list');
const mainEl = $('#main');
const qEl = $('#q');
const onlyPlayableEl = $('#onlyPlayable');

let files = [];
let current = null;   // { hls?, dash? } instances to tear down on switch

// Browser-side refinement for "maybe" entries: ask the media element directly.
const probeEl = document.createElement('video');
const CODEC_TAGS = { h264: 'avc1.42E01E', hevc: 'hvc1.1.6.L93.B0', av1: 'av01.0.05M.08', vp9: 'vp09.00.10.08', vp8: 'vp8',
  aac: 'mp4a.40.2', mp3: 'mp3', opus: 'opus', vorbis: 'vorbis', flac: 'flac', alac: 'alac', ac3: 'ac-3', eac3: 'ec-3' };

function refine(f) {
  if (f.playable !== 'maybe' || !f.summary) return f.playable;
  const codecs = [f.summary.video?.codec, f.summary.audio?.codec].filter(Boolean).map((c) => CODEC_TAGS[c]);
  if (codecs.includes(undefined)) return 'maybe';
  const mime = f.mime.replace('quicktime', 'mp4');
  const answer = probeEl.canPlayType(`${mime}; codecs="${codecs.join(', ')}"`);
  if (answer === 'probably') return 'yes';
  // Browsers often answer "" for Matroska even when <video> plays it — only trust a "no" for MP4/WebM.
  if (answer === '' && /mp4|webm/.test(mime)) return 'no';
  return 'maybe';
}

// ---------------------------------------------------------------- formatting

function humanBytes(n) {
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i && n < 10 ? 2 : i ? 1 : 0)} ${u[i]}`;
}
const kbps = (bps) => (bps ? `${Math.round(bps / 1000)} kb/s` : '—');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function shortMeta(f) {
  const s = f.summary;
  if (f.kind === 'hls') return 'HLS playlist';
  if (f.kind === 'dash') return 'DASH manifest';
  if (!s) return `${humanBytes(f.size)}${f.error ? ' · probe failed' : ''}`;
  const parts = [];
  if (s.video) parts.push(`${s.video.codec} ${s.video.width}×${s.video.height}`);
  if (s.audio) parts.push(`${s.audio.codec} ${s.audio.sampleRate ? s.audio.sampleRate / 1000 + 'k' : ''}${s.audio.channels ? ' ' + s.audio.channels + 'ch' : ''}`);
  parts.push(`${s.duration.toFixed(1)} s`, humanBytes(f.size));
  return parts.join(' · ');
}

// ---------------------------------------------------------------- sidebar

function renderList() {
  const q = qEl.value.trim().toLowerCase();
  const visible = files.filter((f) =>
    (!onlyPlayableEl.checked || f.effective !== 'no') &&
    (!q || `${f.path} ${shortMeta(f)}`.toLowerCase().includes(q)));

  const groups = new Map();
  for (const f of visible) {
    if (!groups.has(f.group)) groups.set(f.group, []);
    groups.get(f.group).push(f);
  }

  listEl.innerHTML = '';
  for (const [group, items] of groups) {
    const d = document.createElement('details');
    d.open = true;
    d.innerHTML = `<summary>${esc(group)} (${items.length})</summary>`;
    for (const f of items) {
      const el = document.createElement('div');
      el.className = 'item' + (f.path === decodeURIComponent(location.hash.slice(1)) ? ' active' : '');
      el.dataset.path = f.path;
      el.title = f.reason || '';
      el.innerHTML = `<span class="dot ${f.effective}"></span>
        <span><div class="name">${esc(f.path.slice(group === '.' ? 0 : group.length + 1))}</div>
        <div class="meta">${esc(shortMeta(f))}</div></span>`;
      el.onclick = () => { location.hash = encodeURIComponent(f.path); };
      d.append(el);
    }
    listEl.append(d);
  }
  const playable = files.filter((f) => f.effective !== 'no').length;
  $('#count').textContent = `${visible.length} shown · ${playable}/${files.length} playable`;
}

// ---------------------------------------------------------------- player

function teardown() {
  current?.hls?.destroy();
  current?.dash?.reset();
  current = null;
}

function suggestion(f) {
  const out = f.path.replace(/\.[^.]+$/, '').split('/').pop();
  return f.kind === 'audio'
    ? `ffmpeg -i "${f.path}" -c:a aac -b:a 128k "${out}.m4a"`
    : `ffmpeg -i "${f.path}" -c:v libx264 -crf 23 -preset veryfast -c:a aac -b:a 128k -movflags +faststart "${out}.mp4"`;
}

function facts(f) {
  const s = f.summary;
  const rows = [['size', humanBytes(f.size)]];
  if (s) {
    rows.push(['container', s.container.split(',')[0]], ['duration', `${s.duration.toFixed(2)} s`], ['bitrate', kbps(s.bitrate)]);
    if (s.video) rows.push(['video', `${s.video.codec}${s.video.profile ? ' ' + s.video.profile : ''}`],
      ['resolution', `${s.video.width}×${s.video.height}`], ['fps', s.video.fps ?? '—'], ['pixel format', s.video.pixFmt ?? '—']);
    if (s.audio) rows.push(['audio', s.audio.codec], ['sample rate', `${s.audio.sampleRate} Hz`], ['channels', s.audio.channels ?? '—']);
  }
  return rows.map(([k, v]) => `<div class="fact"><b>${k}</b>${esc(v)}</div>`).join('');
}

function show(path) {
  teardown();
  const f = files.find((x) => x.path === path);
  document.querySelectorAll('.item').forEach((el) => el.classList.toggle('active', el.dataset.path === path));
  if (!f) {
    mainEl.innerHTML = `<p class="empty">${files.length} files — pick one on the left.</p>`;
    return;
  }

  const src = `/media/${f.path.split('/').map(encodeURIComponent).join('/')}`;
  const label = { yes: 'plays in this browser', maybe: 'may play in this browser', no: 'not playable in a browser' }[f.effective];
  let stage;
  if (f.effective === 'no') {
    stage = `<div class="notice no">
      <p><b>This browser can't play this file.</b> ${esc(f.reason || '')}</p>
      <p>Make a browser-friendly copy:</p><pre>${esc(suggestion(f))}</pre></div>`;
  } else if (f.kind === 'audio') {
    stage = `<div class="stage audio"><audio controls autoplay preload="metadata"></audio></div>`;
  } else {
    stage = `<div class="stage"><video controls autoplay playsinline preload="metadata"></video></div>`;
  }

  mainEl.innerHTML = `
    <h1>${esc(f.path)}</h1>
    <p><span class="badge ${f.effective}">${label}</span> <a href="${src}" download>download</a></p>
    ${stage}
    ${f.effective === 'maybe' && f.reason ? `<div class="notice maybe">${esc(f.reason)}</div>` : ''}
    <div class="facts">${facts(f)}</div>
    ${f.error ? `<div class="notice no"><p><b>ffprobe failed:</b> ${esc(f.error)}</p></div>` : ''}
    ${f.raw ? `<details class="raw"><summary>raw ffprobe JSON</summary><pre>${esc(JSON.stringify(f.raw, null, 2))}</pre></details>` : ''}`;

  const media = mainEl.querySelector('video, audio');
  if (!media) return;
  media.addEventListener('error', () => {
    const err = document.createElement('div');
    err.className = 'notice no';
    err.textContent = `Playback error: ${media.error?.message || 'the browser rejected this file'}`;
    media.closest('.stage').after(err);
  });

  if (f.kind === 'hls' && !media.canPlayType('application/vnd.apple.mpegurl') && window.Hls?.isSupported()) {
    const hls = new Hls();
    hls.loadSource(src);
    hls.attachMedia(media);
    current = { hls };
  } else if (f.kind === 'dash' && window.dashjs) {
    const dash = dashjs.MediaPlayer().create();
    dash.initialize(media, src, true);
    current = { dash };
  } else {
    media.src = src;
  }
}

// ---------------------------------------------------------------- boot

async function load(refresh = false) {
  mainEl.innerHTML = `<p class="empty">${refresh ? 'Re-scanning' : 'Loading catalog'}…</p>`;
  const res = await fetch(`/api/files${refresh ? '?refresh=1' : ''}`);
  const data = await res.json();
  files = data.files.map((f) => ({ ...f, effective: refine(f) }));
  renderList();
  show(decodeURIComponent(location.hash.slice(1)));
}

qEl.addEventListener('input', renderList);
onlyPlayableEl.addEventListener('change', renderList);
$('#refresh').addEventListener('click', () => load(true));
window.addEventListener('hashchange', () => show(decodeURIComponent(location.hash.slice(1))));

load().catch((e) => { mainEl.innerHTML = `<div class="notice no">Failed to load catalog: ${esc(e.message)}</div>`; });
