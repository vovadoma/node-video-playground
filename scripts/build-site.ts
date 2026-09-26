/**
 * Build the static docs site (GitHub Pages) from the examples themselves.
 *
 *   npm run capture   # once in a while: screenshots + clips → docs/examples/
 *   npm run site      # → site/index.html + media (open it, or let the Pages workflow publish it)
 *
 * Titles, descriptions and commands come from each example's header comment — the same parser as the
 * Examples tab (web/examples/registry.ts) — so a new example shows up here with no extra work; add
 * docs/examples/NN.webp (and NN.mp4) to give it a picture.
 *
 * It also rewrites the gallery in README.md between <!-- gallery:start --> and <!-- gallery:end -->:
 * a grid of thumbnails linking to the example's card on the site.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ExampleRegistry, type Example } from '../web/examples/registry.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MEDIA = path.join(ROOT, 'docs', 'examples');
const OUT = path.join(ROOT, 'site');
const SLUG = process.env.GITHUB_REPOSITORY ?? 'vovadoma/node-video-playground';
const REPO = `https://github.com/${SLUG}`;
const SITE = `https://${SLUG.split('/')[0]}.github.io/${SLUG.split('/')[1]}/`;

const GROUPS: { id: string; title: string; text: string; nums: string[] }[] = [
  { id: 'basics', title: 'ffmpeg basics', text: 'Probe, cut, transcode, package and measure — one ffmpeg recipe per file.', nums: ['01', '02', '03', '04', '05', '06', '07', '08'] },
  { id: 'live', title: 'Live processing', text: 'A file read as a stream, piped through ffmpeg and sent to the browser as it is produced — nothing on disk.', nums: ['09', '10', '11'] },
  { id: 'tracking', title: 'Motion & tracking', text: 'Raw frames through Node: find a small fast object, follow it with a crosshair, intercept a target.', nums: ['12', '13', '14'] },
  { id: 'webrtc', title: 'WebRTC', text: 'Camera, screen or a sample from the browser to Node and back — echo, effects, recording, composition.', nums: ['15', '16', '17', '18', '19'] },
];

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
/** The live page's port, from the usage lines of the header ("npm run live  # then open http://127.0.0.1:3009"). */
const livePort = (e: Example) => e.usage.join(' ').match(/127\.0\.0\.1:(\d+)/)?.[1];

rmSync(OUT, { recursive: true, force: true });
mkdirSync(path.join(OUT, 'media'), { recursive: true });
const media = (name: string) => {
  const src = path.join(MEDIA, name);
  if (!existsSync(src)) return undefined;
  copyFileSync(src, path.join(OUT, 'media', name));
  return `media/${name}`;
};
for (const f of ['banner.svg', 'pipeline.svg']) copyFileSync(path.join(ROOT, 'docs', f), path.join(OUT, f));

const examples = new ExampleRegistry(path.join(ROOT, 'examples'), path.join(ROOT, 'package.json')).list();
const byNum = new Map(examples.map((e) => [e.num, e]));

function card(e: Example): string {
  const img = media(`${e.num}.webp`), clip = media(`${e.num}.mp4`);
  const cmd = e.script ? `npm run ${e.script}` : `npx tsx examples/${e.id}.ts`;
  const port = livePort(e);
  const visual = clip
    ? `<video data-src="${clip}" ${img ? `poster="${img}"` : ''} muted loop playsinline preload="none"></video><span class="tag">▶ clip</span>`
    : img ? `<img src="${img}" alt="" loading="lazy">` : `<div class="noimg">${e.num}</div>`;
  return `
    <article class="card" id="ex-${e.num}">
      <button class="media" aria-label="Enlarge" data-img="${img ?? ''}" data-clip="${clip ?? ''}">${visual}</button>
      <div class="body">
        <div class="meta"><span class="num">${e.num}</span>${port ? `<span class="pill">live page · :${port}</span>` : ''}${e.input ? `<span class="pill">takes a ${e.input}</span>` : ''}</div>
        <h3>${esc(e.title)}</h3>
        <p>${esc(e.summary)}</p>
      </div>
      <footer><code>${esc(cmd)}</code><a href="${REPO}/blob/main/examples/${e.id}.ts" target="_blank" rel="noopener">Source ↗</a></footer>
    </article>`;
}

const sections = GROUPS.map((g) => {
  const items = g.nums.map((n) => byNum.get(n)).filter((e): e is Example => Boolean(e));
  return items.length ? `
  <section id="${g.id}">
    <div class="section-head"><h2>${esc(g.title)}</h2><p>${esc(g.text)}</p></div>
    <div class="grid">${items.map(card).join('')}</div>
  </section>` : '';
}).join('');
// examples that no group lists yet (a freshly added NN) still get shown
const grouped = new Set(GROUPS.flatMap((g) => g.nums));
const rest = examples.filter((e) => !grouped.has(e.num));
const more = rest.length ? `<section id="more"><div class="section-head"><h2>More</h2></div><div class="grid">${rest.map(card).join('')}</div></section>` : '';

const uiLibrary = media('ui-library.webp'), uiExamples = media('ui-examples.webp');

const html = /* html */ `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>node-video-playground — video recipes for Node.js</title>
<meta name="description" content="${examples.length} small, readable Node.js examples: ffmpeg recipes, live streaming, motion tracking and WebRTC — each a single script.">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#2563eb"/><rect x="7" y="18" width="5" height="7" rx="1" fill="#fff" opacity=".55"/><rect x="13.5" y="13" width="5" height="12" rx="1" fill="#fff" opacity=".8"/><rect x="20" y="8" width="5" height="17" rx="1" fill="#fff"/></svg>')}">
<style>
  :root { --bg:#f6f7f9; --surface:#fff; --border:#e5e7eb; --text:#111827; --text2:#374151; --muted:#6b7280; --accent:#2563eb; --soft:#eff6ff; --code:#f3f4f6; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0b1120; --surface:#111827; --border:#1f2937; --text:#f3f4f6; --text2:#d1d5db; --muted:#9ca3af; --accent:#3b82f6; --soft:#172554; --code:#1f2937; } }
  * { box-sizing:border-box } html { scroll-behavior:smooth; scroll-padding-top:72px }
  body { margin:0; background:var(--bg); color:var(--text); font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Helvetica,Arial,sans-serif }
  a { color:var(--accent); text-decoration:none } a:hover { text-decoration:underline }
  code, pre { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace }
  .wrap { max-width:1200px; margin:0 auto; padding:0 24px }
  nav.top { position:sticky; top:0; z-index:10; background:var(--surface); border-bottom:1px solid var(--border); border-top:3px solid var(--accent) }
  nav.top .wrap { display:flex; align-items:center; gap:22px; height:56px }
  .brand { display:flex; align-items:center; gap:10px; font-weight:700; color:var(--text); margin-right:auto } .brand:hover { text-decoration:none }
  .brand svg { width:26px; height:26px }
  nav.top a.link { color:var(--text2); font-size:14px; font-weight:500 }
  .btn { display:inline-flex; align-items:center; gap:6px; padding:8px 14px; border-radius:8px; font-weight:600; font-size:14px; border:1px solid var(--border); color:var(--text); background:var(--surface) }
  .btn.primary { background:var(--accent); border-color:var(--accent); color:#fff } .btn:hover { text-decoration:none; filter:brightness(1.05) }
  header.hero { padding:56px 0 40px; border-bottom:1px solid var(--border); background:var(--surface) }
  .hero h1 { font-size:clamp(28px,4.5vw,44px); line-height:1.15; letter-spacing:-.02em; margin:0 0 14px }
  .hero p.lead { font-size:18px; color:var(--text2); max-width:780px; margin:0 0 22px }
  .chips { display:flex; flex-wrap:wrap; gap:8px; margin:0 0 26px; padding:0; list-style:none }
  .chips li { font-size:13px; font-weight:600; padding:4px 10px; border-radius:999px; background:var(--soft); color:var(--accent) }
  .hero .actions { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:30px }
  .hero-grid { display:grid; grid-template-columns:minmax(0,1.1fr) minmax(0,1fr); gap:28px; align-items:start }
  pre.quick { margin:0; background:#0b1220; color:#e5e7eb; border-radius:12px; padding:18px 20px; font-size:13.5px; overflow:auto }
  pre.quick .c { color:#6b7280 }
  .pipeline { width:100%; background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:14px }
  section { padding:48px 0 8px }
  .section-head { display:flex; align-items:baseline; gap:16px; flex-wrap:wrap; margin-bottom:18px }
  .section-head h2 { margin:0; font-size:24px; letter-spacing:-.01em } .section-head p { margin:0; color:var(--muted) }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(340px,1fr)); gap:20px }
  .card { display:flex; flex-direction:column; background:var(--surface); border:1px solid var(--border); border-radius:14px; overflow:hidden; transition:box-shadow .15s, transform .15s }
  .card:hover { box-shadow:0 8px 24px rgba(16,24,40,.10); transform:translateY(-2px) }
  .media { position:relative; display:block; width:100%; aspect-ratio:16/10; padding:0; border:0; border-bottom:1px solid var(--border); background:#0b1220; cursor:zoom-in; overflow:hidden }
  .media img, .media video { width:100%; height:100%; object-fit:cover; object-position:top; display:block }
  .media .tag { position:absolute; right:10px; bottom:10px; font:600 11px/1 inherit; color:#fff; background:rgba(0,0,0,.6); padding:5px 8px; border-radius:6px }
  .noimg { display:grid; place-items:center; height:100%; color:#374151; font:700 48px ui-monospace,monospace }
  .card .body { padding:16px 18px 8px; flex:1 }
  .card .meta { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:8px }
  .num { font:700 12px ui-monospace,monospace; color:var(--accent); background:var(--soft); padding:3px 8px; border-radius:6px }
  .pill { font-size:12px; color:var(--muted); border:1px solid var(--border); padding:2px 8px; border-radius:999px }
  .card h3 { margin:0 0 6px; font-size:17px } .card p { margin:0; color:var(--text2); font-size:14px }
  .card footer { display:flex; justify-content:space-between; align-items:center; gap:10px; padding:12px 18px 16px; font-size:13px }
  .card footer code { background:var(--code); padding:3px 8px; border-radius:6px; font-size:12.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis }
  .ui { display:grid; grid-template-columns:1fr 1fr; gap:20px }
  .ui figure { margin:0; background:var(--surface); border:1px solid var(--border); border-radius:14px; overflow:hidden }
  .ui img { width:100%; display:block; cursor:zoom-in } .ui figcaption { padding:12px 16px; font-size:14px; color:var(--text2) }
  footer.site { margin-top:56px; padding:28px 0 40px; border-top:1px solid var(--border); color:var(--muted); font-size:14px }
  dialog { border:0; padding:0; background:transparent; max-width:min(1300px,94vw) } dialog::backdrop { background:rgba(2,6,23,.8) }
  dialog img, dialog video { display:block; max-width:100%; max-height:90vh; border-radius:10px }
  @media (max-width:820px) { .hero-grid, .ui { grid-template-columns:1fr } nav.top a.link { display:none } .grid { grid-template-columns:1fr } .wrap { padding:0 16px } }
</style></head>
<body>
<nav class="top"><div class="wrap">
  <a class="brand" href="#"><svg viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#2563eb"/><rect x="7" y="18" width="5" height="7" rx="1" fill="#fff" opacity=".55"/><rect x="13.5" y="13" width="5" height="12" rx="1" fill="#fff" opacity=".8"/><rect x="20" y="8" width="5" height="17" rx="1" fill="#fff"/></svg>node-video-playground</a>
  ${GROUPS.map((g) => `<a class="link" href="#${g.id}">${esc(g.title)}</a>`).join('')}
  <a class="btn" href="${REPO}" target="_blank" rel="noopener">GitHub ↗</a>
</div></nav>

<header class="hero"><div class="wrap">
  <h1>Video recipes for Node.js</h1>
  <p class="lead">${examples.length} small, readable examples of what a video backend does every day — probe, transcode, package for streaming, process live, track motion, and talk WebRTC to a browser. Each one is a single script you can lift into a real service.</p>
  <ul class="chips"><li>${examples.length} examples</li><li>Node ≥ 20</li><li>TypeScript, no build step</li><li>ffmpeg</li><li>no framework</li><li>web UI included</li></ul>
  <div class="actions"><a class="btn primary" href="#basics">Browse the examples</a><a class="btn" href="${REPO}#quick-start" target="_blank" rel="noopener">Quick start</a></div>
  <div class="hero-grid">
    <pre class="quick"><span class="c"># clone, install, run</span>
git clone ${REPO}.git
cd node-video-playground && npm install
npm run web      <span class="c"># browse samples & run every example → :3000</span>
npm run live     <span class="c"># a live-processing example → :3009</span></pre>
    <img class="pipeline" src="pipeline.svg" alt="source → probe → transcode → package → measure">
  </div>
</div></header>

<main class="wrap">
${uiLibrary || uiExamples ? `
  <section id="ui">
    <div class="section-head"><h2>Web UI</h2><p><code>npm run web</code> — every sample playable in the browser, every example runnable with its console and results.</p></div>
    <div class="ui">
      ${uiLibrary ? `<figure><img src="${uiLibrary}" alt="Media library" loading="lazy" data-zoom><figcaption>Media library — only what this browser can play, as cards</figcaption></figure>` : ''}
      ${uiExamples ? `<figure><img src="${uiExamples}" alt="Examples tab" loading="lazy" data-zoom><figcaption>Examples tab — run a script, watch its console live, open what it produced</figcaption></figure>` : ''}
    </div>
  </section>` : ''}
${sections}
${more}
</main>

<footer class="site"><div class="wrap">MIT · <a href="${REPO}">${REPO.replace('https://', '')}</a> · built from the examples' own header comments by <code>scripts/build-site.ts</code></div></footer>

<dialog id="zoom"></dialog>
<script>
  // clips play only while visible — a page of 19 videos stays light
  const io = new IntersectionObserver((entries) => entries.forEach((e) => {
    const v = e.target;
    if (e.isIntersecting) { if (!v.src) v.src = v.dataset.src; v.play().catch(() => {}); } else v.pause();
  }), { rootMargin: '100px' });
  document.querySelectorAll('video[data-src]').forEach((v) => io.observe(v));

  const dlg = document.getElementById('zoom');
  const open = (el) => { dlg.replaceChildren(el); dlg.showModal(); };
  document.querySelectorAll('.media').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.clip) open(Object.assign(document.createElement('video'), { src: b.dataset.clip, autoplay: true, loop: true, muted: true, playsInline: true, controls: true }));
    else if (b.dataset.img) open(Object.assign(document.createElement('img'), { src: b.dataset.img }));
  }));
  document.querySelectorAll('[data-zoom]').forEach((img) => img.addEventListener('click', () => open(Object.assign(document.createElement('img'), { src: img.src }))));
  dlg.addEventListener('click', () => dlg.close());
</script>
</body></html>`;

writeFileSync(path.join(OUT, 'index.html'), html);
writeFileSync(path.join(OUT, '.nojekyll'), '');
const withMedia = examples.filter((e) => existsSync(path.join(MEDIA, `${e.num}.webp`))).length;
console.log(`site/index.html — ${examples.length} examples (${withMedia} with pictures)`);

// ---------------------------------------------------------------- README gallery

const README = path.join(ROOT, 'README.md');
const readme = readFileSync(README, 'utf8');
const START = '<!-- gallery:start -->', END = '<!-- gallery:end -->';
if (readme.includes(START) && readme.includes(END)) {
  const COLS = 3;
  const cells = examples.map((e) => {
    const img = existsSync(path.join(MEDIA, `${e.num}.webp`)) ? `<img src="docs/examples/${e.num}.webp" alt="${esc(e.title)}" width="100%">` : '';
    return `<td width="33%" valign="top"><a href="${SITE}#ex-${e.num}">${img}</a><br><b>${e.num} · ${esc(e.title)}</b>${existsSync(path.join(MEDIA, `${e.num}.mp4`)) ? ' <sub>▶ clip</sub>' : ''}</td>`;
  });
  const rows: string[] = [];
  for (let i = 0; i < cells.length; i += COLS) rows.push(`<tr>\n${cells.slice(i, i + COLS).join('\n')}\n</tr>`);
  const block = `${START}\n<!-- generated by scripts/build-site.ts — edit the examples' header comments, then npm run site -->\n<table>\n${rows.join('\n')}\n</table>\n\n**[Open the gallery with clips →](${SITE})**\n${END}`;
  const next = readme.slice(0, readme.indexOf(START)) + block + readme.slice(readme.indexOf(END) + END.length);
  if (next !== readme) { writeFileSync(README, next); console.log('README.md gallery updated'); }
}
