// Media Library UI — plain browser JS, no build step. hls.js / dash.js come from the CDN in index.html.
//
// Extending:
//   • a new file tab       → add an entry to TABS (match + section)
//   • a tab with its own UI → registerTab({ id, label, icon, hint, load, count, stats, render, onRoute })
//                            from a separate script (see examples.js)
//   • a new kind of card   → add a model function to CARD_MODELS; markup lives in <template id="tpl-card">

const $ = (sel, root = document) => root.querySelector(sel);
const ICONS = {
  video: '<svg viewBox="0 0 20 20"><path d="M3 5.5A1.5 1.5 0 0 1 4.5 4h8A1.5 1.5 0 0 1 14 5.5v1.3l3.2-1.9a.5.5 0 0 1 .8.43v9.34a.5.5 0 0 1-.8.43L14 13.2v1.3a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 3 14.5v-9Z"/></svg>',
  audio: '<svg viewBox="0 0 20 20"><path d="M16 3.5v9.75A2.75 2.75 0 1 1 14.5 10.8V6.1L8 7.6v7.65A2.75 2.75 0 1 1 6.5 12.8V5.4a.75.75 0 0 1 .58-.73l8-1.84A.75.75 0 0 1 16 3.5Z"/></svg>',
  stream: '<svg viewBox="0 0 20 20"><path d="M10 11.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM6.46 6.46l-1.06-1.06a6.5 6.5 0 0 0 0 9.2l1.06-1.06a5 5 0 0 1 0-7.08Zm7.08 0a5 5 0 0 1 0 7.08l1.06 1.06a6.5 6.5 0 0 0 0-9.2l-1.06 1.06ZM4.34 4.34 3.28 3.28a9.5 9.5 0 0 0 0 13.44l1.06-1.06a8 8 0 0 1 0-11.32Zm11.32 0a8 8 0 0 1 0 11.32l1.06 1.06a9.5 9.5 0 0 0 0-13.44l-1.06 1.06Z"/></svg>',
  code: '<svg viewBox="0 0 20 20"><path d="M7.3 5.2 2.5 10l4.8 4.8 1.06-1.06L4.62 10l3.74-3.74L7.3 5.2Zm5.4 0-1.06 1.06L15.38 10l-3.74 3.74 1.06 1.06L17.5 10l-4.8-4.8Z"/></svg>',
  wave: '<svg viewBox="0 0 64 32"><g><rect x="1" y="13" width="3" height="6" rx="1.5"/><rect x="7" y="9" width="3" height="14" rx="1.5"/><rect x="13" y="4" width="3" height="24" rx="1.5"/><rect x="19" y="10" width="3" height="12" rx="1.5"/><rect x="25" y="1" width="3" height="30" rx="1.5"/><rect x="31" y="7" width="3" height="18" rx="1.5"/><rect x="37" y="11" width="3" height="10" rx="1.5"/><rect x="43" y="5" width="3" height="22" rx="1.5"/><rect x="49" y="9" width="3" height="14" rx="1.5"/><rect x="55" y="12" width="3" height="8" rx="1.5"/><rect x="61" y="14" width="2" height="4" rx="1"/></g></svg>',
};

// ---------------------------------------------------------------- configuration

const TABS = [
  {
    id: 'video', label: 'Video', icon: ICONS.video,
    hint: 'Single-file video that plays in this browser, grouped by folder.',
    match: (f) => f.kind === 'video',
    section: (f) => dirname(f.path),
  },
  {
    id: 'audio', label: 'Audio', icon: ICONS.audio,
    hint: 'Audio-only files that play in this browser — the same master in every codec, per folder.',
    match: (f) => f.kind === 'audio',
    section: (f) => dirname(f.path),
  },
  {
    id: 'streaming', label: 'Streaming', icon: ICONS.stream,
    hint: 'Adaptive streaming packages — HLS via hls.js (native in Safari), DASH via dash.js.',
    match: (f) => f.kind === 'hls' || f.kind === 'dash',
    section: () => 'streaming',
  },
];

/** Card models: entry → { title, subtitle, duration, chips[], meta, badges[], media() }. */
const CARD_MODELS = {
  video(f) {
    const s = f.summary;
    return {
      ...baseModel(f),
      chips: s ? compact([codecName(s.video?.codec), s.video && `${s.video.width}×${s.video.height}`, s.video?.fps && `${round(s.video.fps)} fps`, codecName(s.audio?.codec)]) : [],
      media: () => videoPreview(f),
    };
  },
  audio(f) {
    const s = f.summary;
    return {
      ...baseModel(f),
      chips: s ? compact([codecName(s.audio?.codec), s.audio?.sampleRate && `${s.audio.sampleRate / 1000} kHz`, channelsLabel(s.audio?.channels), s.bitrate && kbps(s.bitrate)]) : [],
      media: () => art(`art art-audio tone-${hash(dirname(f.path)) % 4}`, ICONS.wave),
    };
  },
  hls(f) {
    return { ...baseModel(f), title: dirname(f.path).split('/').pop(), subtitle: basename(f.path), chips: ['HLS', f.path.includes('fmp4') ? 'fMP4 / CMAF' : 'MPEG-TS'], media: () => art('art art-stream', ICONS.stream, 'HLS') };
  },
  dash(f) {
    return { ...baseModel(f), title: dirname(f.path).split('/').pop(), subtitle: basename(f.path), chips: ['DASH', 'fMP4'], media: () => art('art art-stream', ICONS.stream, 'DASH') };
  },
  image(f) {
    return { ...baseModel(f), chips: [], media: () => Object.assign(document.createElement('img'), { src: mediaUrl(f), alt: '', loading: 'lazy' }) };
  },
};

/** Tabs with their own UI (not a filtered file list) register here from other scripts. */
function registerTab(tab) {
  TABS.push(tab);
}

function baseModel(f) {
  const s = f.summary;
  return {
    title: basename(f.path),
    subtitle: s ? containerLabel(f) : ext(f.path),
    duration: s?.duration ? clock(s.duration) : '',
    meta: humanBytes(f.size),
    badges: f.effective === 'maybe' ? [{ text: 'Limited', tone: 'warn', title: f.reason || 'May not play in every browser' }]
      : f.effective === 'no' ? [{ text: 'Not playable', tone: 'error', title: f.reason || 'Browsers can’t play this format' }]
      : [],
  };
}

// ---------------------------------------------------------------- helpers

const basename = (p) => p.split('/').pop();
const dirname = (p) => p.split('/').slice(0, -1).join('/') || '.';
const ext = (p) => (p.match(/\.([^.]+)$/)?.[1] ?? '').toUpperCase();
/** ffprobe names a family ("mov,mp4,m4a,3gp,3g2,mj2", "matroska,webm") — prefer the member matching the extension. */
const containerLabel = (f) => {
  const names = f.summary.container.split(',');
  const e = ext(f.path).toLowerCase();
  return (names.includes(e) ? e : names[0]).toUpperCase();
};
const compact = (xs) => xs.filter(Boolean);
const round = (n) => Math.round(n * 100) / 100;
const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const kbps = (bps) => (bps ? `${Math.round(bps / 1000)} kb/s` : '—');
const channelsLabel = (n) => (n === 1 ? 'mono' : n === 2 ? 'stereo' : n === 6 ? '5.1' : n ? `${n} ch` : '');
const CODEC_NAMES = { h264: 'H.264', hevc: 'H.265', av1: 'AV1', vp8: 'VP8', vp9: 'VP9', aac: 'AAC', mp3: 'MP3', opus: 'Opus', vorbis: 'Vorbis', flac: 'FLAC', alac: 'ALAC', ac3: 'AC-3', eac3: 'E-AC-3' };
const codecName = (c) => (c ? CODEC_NAMES[c] ?? (c.startsWith('pcm_') ? `PCM ${c.slice(4)}` : c) : '');

function humanBytes(n) {
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i && n < 10 ? 2 : i ? 1 : 0)} ${u[i]}`;
}
function clock(sec) {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
const prettySection = (dir) => dir.split('/').map((p) => p.replace(/[-_]/g, ' ')).join(' / ');
/** Server gives every entry its URL (/media/… for samples, /output/… for example results). */
const mediaUrl = (f) => f.url ?? `/media/${f.path.split('/').map(encodeURIComponent).join('/')}`;

function art(className, svg, label) {
  const el = document.createElement('div');
  el.className = className;
  el.innerHTML = svg + (label ? `<span class="art-label">${label}</span>` : '');
  return el;
}

// Video previews: load a frame only when the card scrolls into view.
const lazy = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    lazy.unobserve(e.target);
    e.target.src = e.target.dataset.src;
  }
}, { rootMargin: '200px' });

function videoPreview(f) {
  const wrap = document.createDocumentFragment();
  const fallback = art('art art-video', ICONS.video);
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.preload = 'metadata';
  v.dataset.src = `${mediaUrl(f)}#t=1`;
  // keep the placeholder unless a real frame was decoded (e.g. ProRes "loads" but stays black)
  v.addEventListener('loadeddata', () => (v.videoWidth ? fallback.remove() : v.remove()));
  v.addEventListener('error', () => v.remove());
  lazy.observe(v);
  wrap.append(fallback, v);
  return wrap;
}

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

// ---------------------------------------------------------------- rendering

const tplCard = $('#tpl-card');
const tplSection = $('#tpl-section');

/** Fill a template clone from a model: [data-field] and [data-slot] (see index.html). */
function fill(root, model) {
  for (const el of root.querySelectorAll('[data-field]')) {
    const value = model[el.dataset.field];
    if (el.dataset.field === 'chips') {
      el.replaceChildren(...(value ?? []).map((t) => Object.assign(document.createElement('li'), { textContent: t })));
    } else if (el.dataset.field === 'badges') {
      el.replaceChildren(...(value ?? []).map((b) => Object.assign(document.createElement('span'), { className: `badge badge-${b.tone}`, textContent: b.text, title: b.title ?? '' })));
    } else {
      el.textContent = value ?? '';
    }
  }
  for (const el of root.querySelectorAll('[data-slot]')) {
    const make = model[el.dataset.slot];
    if (typeof make === 'function') el.prepend(make());
  }
  return root;
}

/** @param onOpen what a click does; default: open the player via the URL (#…&file=path) */
function renderCard(f, onOpen) {
  const node = tplCard.content.firstElementChild.cloneNode(true);
  fill(node, CARD_MODELS[f.kind](f));
  node.title = f.path;
  const open = onOpen ?? (() => setRoute({ tab: state.tab, file: f.path }));
  node.addEventListener('click', open);
  node.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  return node;
}

function renderSection(title, items) {
  const node = tplSection.content.firstElementChild.cloneNode(true);
  fill(node, { title: prettySection(title), count: String(items.length) });
  $('.grid', node).append(...items.map((f) => renderCard(f)));
  return node;
}

const state = { files: [], tab: TABS[0].id, q: '', tools: null };

function visibleFiles() {
  const q = state.q.trim().toLowerCase();
  return state.files.filter((f) => f.effective !== 'no' && (!q || f.searchText.includes(q)));
}

function renderTabs() {
  const files = visibleFiles();
  $('#tabs').replaceChildren(...TABS.map((t) => {
    const b = document.createElement('button');
    b.className = 'tab';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(t.id === state.tab));
    b.innerHTML = `${t.icon}<span>${t.label}</span><span class="count">${t.count ? t.count() : files.filter(t.match).length}</span>`;
    b.onclick = () => setRoute({ tab: t.id });
    return b;
  }));
}

function renderContent() {
  const tab = TABS.find((t) => t.id === state.tab);
  $('#tabTitle').textContent = tab.label;
  $('#tabHint').textContent = tab.hint;
  if (tab.render) {
    $('#stats').textContent = tab.stats?.() ?? '';
    tab.render($('#content'));
    return;
  }

  const items = visibleFiles().filter(tab.match);

  const all = state.files.filter(tab.match);
  const hidden = all.filter((f) => f.effective === 'no').length;
  $('#stats').textContent = `${items.length} shown · ${hidden} of ${all.length} hidden as not browser-playable`;

  const content = $('#content');
  if (!items.length) {
    content.innerHTML = `<p class="empty">${state.q ? 'Nothing matches your search.' : 'No playable files here.'}</p>`;
    return;
  }
  const sections = new Map();
  for (const f of items) {
    const key = tab.section(f);
    if (!sections.has(key)) sections.set(key, []);
    sections.get(key).push(f);
  }
  content.replaceChildren(...[...sections].map(([title, list]) => renderSection(title, list)));
}

function render() {
  renderBanner();
  renderTabs();
  renderContent();
}

/** Warn when ffmpeg / ffprobe are missing: nothing can be probed or run without them. */
function renderBanner() {
  const el = $('#envBanner');
  const t = state.tools;
  el.hidden = !t || t.ok;
  if (el.hidden) return;
  const missing = [t.ffmpeg, t.ffprobe].filter((x) => !x.ok).map((x) => x.bin).join(' and ');
  const inner = document.createElement('div');
  inner.className = 'env-banner-inner';
  inner.append(
    Object.assign(document.createElement('strong'), { textContent: `${missing} not found.` }),
    document.createTextNode(' Codecs aren’t probed and examples can’t run. Install it:'),
    Object.assign(document.createElement('code'), { textContent: t.hint }),
  );
  const btn = Object.assign(document.createElement('button'), { className: 'btn', textContent: 'Check again' });
  btn.onclick = () => load(true);
  inner.append(btn);
  el.replaceChildren(inner);
}

// ---------------------------------------------------------------- player dialog

const dialog = $('#player');
let player = null;   // { hls?, dash? } to tear down on close

function teardown() {
  player?.hls?.destroy();
  player?.dash?.reset();
  player = null;
  $('#playerStage').replaceChildren();
}

function facts(f) {
  const s = f.summary;
  const rows = [['File size', humanBytes(f.size)]];
  if (s) {
    rows.push(['Container', containerLabel(f)], ['Duration', `${s.duration.toFixed(2)} s`], ['Bitrate', kbps(s.bitrate)]);
    if (s.video) rows.push(['Video', `${codecName(s.video.codec)}${s.video.profile ? ` · ${s.video.profile}` : ''}`],
      ['Resolution', `${s.video.width}×${s.video.height}`], ['Frame rate', s.video.fps ? `${round(s.video.fps)} fps` : '—'], ['Pixel format', s.video.pixFmt ?? '—']);
    if (s.audio) rows.push(['Audio', codecName(s.audio.codec)], ['Sample rate', `${s.audio.sampleRate} Hz`], ['Channels', channelsLabel(s.audio.channels) || '—']);
  } else if (f.kind === 'hls' || f.kind === 'dash') {
    rows.push(['Format', f.kind.toUpperCase()], ['Player', f.kind === 'hls' ? 'hls.js / native' : 'dash.js']);
  } else {
    rows.push(['Format', ext(f.path)], ['Metadata', 'ffprobe unavailable']);
  }
  return rows.map(([k, v]) => {
    const d = document.createElement('div');
    d.append(Object.assign(document.createElement('dt'), { textContent: k }), Object.assign(document.createElement('dd'), { textContent: v }));
    return d;
  });
}

const note = (text, tone) => Object.assign(document.createElement('div'), { className: `note note-${tone}`, textContent: text });

function openPlayer(f) {
  teardown();
  const src = mediaUrl(f);
  $('#playerTitle').textContent = CARD_MODELS[f.kind](f).title;
  $('#playerPath').textContent = f.path;
  $('#playerDownload').href = src;
  $('#playerFacts').replaceChildren(...facts(f));
  $('#playerNote').replaceChildren(...(f.effective === 'maybe' ? [note(`Limited browser support — ${f.reason || 'may not play everywhere'}.`, 'warn')] : []));
  $('#playerRaw').hidden = !f.raw;
  $('pre', $('#playerRaw')).textContent = f.raw ? JSON.stringify(f.raw, null, 2) : '';

  const stage = $('#playerStage');
  stage.className = `player-stage${f.kind === 'audio' || f.kind === 'image' ? ` ${f.kind}` : ''}`;
  if (f.kind === 'image') {
    stage.append(Object.assign(document.createElement('img'), { src, alt: f.path }));
    if (!dialog.open) dialog.showModal();
    return;
  }
  if (f.effective === 'no') {   // only example results get here — the library tabs hide these
    $('#playerNote').replaceChildren(note(`Browsers can’t play this file (${f.reason || 'unsupported format'}). Use Download to open it in a desktop player.`, 'warn'));
    if (!dialog.open) dialog.showModal();
    return;
  }
  const media = document.createElement(f.kind === 'audio' ? 'audio' : 'video');
  media.controls = true;
  media.autoplay = true;
  media.playsInline = true;
  media.addEventListener('error', () => $('#playerNote').append(note(`Playback failed: ${media.error?.message || 'the browser rejected this file'}.`, 'error')));
  stage.append(media);

  if (f.kind === 'hls' && !media.canPlayType('application/vnd.apple.mpegurl') && window.Hls?.isSupported()) {
    const hls = new Hls();
    hls.loadSource(src);
    hls.attachMedia(media);
    player = { hls };
  } else if (f.kind === 'dash' && window.dashjs) {
    const dash = dashjs.MediaPlayer().create();
    dash.initialize(media, src, true);
    player = { dash };
  } else {
    media.src = src;
  }
  if (!dialog.open) dialog.showModal();
}

dialog.addEventListener('close', () => {
  teardown();
  const r = route();
  if (r.file) setRoute({ tab: r.tab, example: r.example });
});
dialog.addEventListener('click', (e) => {
  if (e.target === dialog || e.target.closest('[data-close]')) dialog.close();
});

// ---------------------------------------------------------------- routing: #tab=audio&file=path, #tab=examples&example=03-transcode

function route() {
  const p = new URLSearchParams(location.hash.slice(1));
  return {
    tab: TABS.some((t) => t.id === p.get('tab')) ? p.get('tab') : TABS[0].id,
    file: p.get('file'),
    example: p.get('example'),
  };
}
function setRoute({ tab, file, example }) {
  const p = new URLSearchParams({ tab });
  if (example) p.set('example', example);
  if (file) p.set('file', file);
  location.hash = p.toString();
}
let lastRoute = {};
function applyRoute() {
  const r = route();
  const tab = TABS.find((t) => t.id === r.tab);
  if (r.tab !== state.tab) { state.tab = r.tab; render(); window.scrollTo(0, 0); }
  else if (tab.onRoute && r.example !== lastRoute.example) render();
  tab.onRoute?.(r, lastRoute);
  lastRoute = r;
  const f = r.file && state.files.find((x) => x.path === r.file);
  if (f) openPlayer(f);
  else if (dialog.open) dialog.close();
}

// ---------------------------------------------------------------- boot

async function load(refresh = false) {
  $('#content').innerHTML = `<p class="empty">${refresh ? 'Re-scanning samples…' : 'Loading library…'}</p>`;
  const q = refresh ? '?refresh=1' : '';
  // tools first: a rescan right after installing ffmpeg should probe with it
  state.tools = (await fetch(`/api/health${q}`).then((r) => r.json())).tools;
  const data = await fetch(`/api/files${q}`).then((r) => r.json());
  state.files = data.files.map((f) => {
    const entry = { ...f, effective: refine(f) };
    const m = CARD_MODELS[f.kind](entry);
    entry.searchText = [f.path, m.subtitle, ...m.chips].join(' ').toLowerCase();
    return entry;
  });
  await Promise.all(TABS.map((t) => t.load?.(refresh)));
  state.tab = route().tab;
  lastRoute = {};
  render();
  applyRoute();
}

$('#q').addEventListener('input', (e) => { state.q = e.target.value; render(); });
$('#refresh').addEventListener('click', () => load(true));
window.addEventListener('hashchange', applyRoute);

// Boot after every script (e.g. examples.js) has registered its tabs.
window.addEventListener('DOMContentLoaded', () => {
  load().catch((e) => $('#content').replaceChildren(note(`Failed to load the library: ${e.message}`, 'error')));
});
