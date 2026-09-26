/**
 * Capture a screenshot (and for moving examples a short clip) of every example for the docs site.
 *
 *   npm run capture                # everything → docs/examples/NN.webp, NN.mp4, ui-*.webp
 *   npm run capture -- 09 13       # only these
 *
 * Runs each example for real: console examples through the web UI's Examples tab, live examples by
 * opening their page (screenshot) and recording their own stream (clip), WebRTC examples in a headless
 * Chrome with a fake camera and their server-side recorder (clip). Needs ffmpeg and Chrome
 * (CHROME=/path/to/chrome to override); Node needs WebSocket (the npm script passes --experimental-websocket).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FFMPEG_BIN, OUTPUT_DIR } from '../src/lib/config.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'examples');
const TSX = path.join(ROOT, 'node_modules', '.bin', 'tsx');
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const WEB_PORT = 3990, CDP_PORT = 9335;
const only = process.argv.slice(2);
const want = (id: string) => !only.length || only.some((o) => id.startsWith(o));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- processes

const children: ChildProcess[] = [];
function run(args: string[], env: Record<string, string> = {}): ChildProcess {
  const c = spawn(TSX, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: 'ignore' });
  children.push(c);
  return c;
}
function stop(c: ChildProcess) {
  c.kill('SIGTERM');
}
process.on('exit', () => children.forEach((c) => c.kill('SIGKILL')));

async function waitHttp(url: string, ms = 30_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { if ((await fetch(url)).ok) return; } catch { /* not yet */ }
    await sleep(300);
  }
  throw new Error(`timeout waiting for ${url}`);
}

function ffmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const c = spawn(FFMPEG_BIN, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'inherit'] });
    c.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`))));
  });
}

/** A short, light, silent loop for the web: 480p H.264, starts playing before it is fully loaded. */
const CLIP = ['-an', '-vf', 'scale=-2:480,fps=25,format=yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-movflags', '+faststart'];
const clipFromUrl = (url: string, seconds: number, file: string) => ffmpeg(['-t', String(seconds), '-i', url, ...CLIP, file]);
const clipFromFile = (src: string, from: number, seconds: number, file: string) => ffmpeg(['-ss', String(from), '-t', String(seconds), '-i', src, ...CLIP, file]);

// ---------------------------------------------------------------- Chrome over the DevTools protocol

class Browser {
  private ws!: WebSocket;
  private id = 0;
  private pending = new Map<number, (r: { result?: any }) => void>();

  static async launch(): Promise<Browser> {
    const profile = path.join(OUTPUT_DIR, '.capture-chrome');
    rmSync(profile, { recursive: true, force: true });
    const c = spawn(CHROME, [
      '--headless=new', '--hide-scrollbars', `--user-data-dir=${profile}`, `--remote-debugging-port=${CDP_PORT}`,
      '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required',
      '--blink-settings=preferredColorScheme=1', '--window-size=1300,1100', 'about:blank',
    ], { stdio: 'ignore' });
    children.push(c);
    await waitHttp(`http://127.0.0.1:${CDP_PORT}/json/version`);
    const b = new Browser();
    const page = ((await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json()) as { type: string; webSocketDebuggerUrl: string }[]).find((t) => t.type === 'page')!;
    b.ws = new WebSocket(page.webSocketDebuggerUrl);
    b.ws.onmessage = (m) => {
      const d = JSON.parse(String(m.data));
      if (d.id && b.pending.has(d.id)) { b.pending.get(d.id)!(d); b.pending.delete(d.id); }
    };
    await new Promise((r) => (b.ws.onopen = r));
    await b.send('Page.enable');
    return b;
  }

  send(method: string, params: object = {}): Promise<{ result?: any }> {
    return new Promise((r) => { const i = ++this.id; this.pending.set(i, r); this.ws.send(JSON.stringify({ id: i, method, params })); });
  }

  async open(url: string, settle = 2000) {
    await this.send('Page.navigate', { url });
    await sleep(settle);
  }

  async eval<T = unknown>(expression: string): Promise<T> {
    return (await this.send('Runtime.evaluate', { expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true })).result?.result?.value as T;
  }

  /** Screenshot of the viewport (from `top`, `height` px) as WebP. */
  async shot(file: string, top = 0, height = 1100) {
    const r = await this.send('Page.captureScreenshot', { format: 'webp', quality: 82, clip: { x: 0, y: top, width: 1300, height, scale: 1 } });
    await import('node:fs').then((fs) => fs.writeFileSync(file, Buffer.from(r.result.data, 'base64')));
    console.log(`  ✓ ${path.relative(ROOT, file)} (${Math.round(statSync(file).size / 1024)} KB)`);
  }
}

/** Set page controls (by CSS selector) and fire change events. */
const setControls = (values: Record<string, string | boolean>) => Object.entries(values).map(([sel, v]) => `{
  const el = document.querySelector(${JSON.stringify(sel)});
  if (el) { if (el.type === 'checkbox') el.checked = ${JSON.stringify(v)}; else el.value = ${JSON.stringify(v)}; el.dispatchEvent(new Event('change')); }
}`).join('\n');

const newest = (dir: string, re: RegExp) => readdirSync(dir).filter((n) => re.test(n)).map((n) => path.join(dir, n)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];

// ---------------------------------------------------------------- what to capture

const FILE = 'generated/mkv_h264_aac.mkv';
const LIVE: Record<string, { script: string; port: number; params: string; pageControls?: Record<string, string | boolean>; clipSeconds?: number; startDelay?: number }> = {
  '09': { script: '09-live-transform', port: 3009, params: 'fx=gray&split=1', pageControls: { '[data-param=fx]': 'gray', '[data-param=split]': true } },
  '10': { script: '10-live-watermark', port: 3010, params: 'wm_pos=float&wm_size=25&wm_opacity=0.7&fx=none&split=0', pageControls: { '[data-param=wm_pos]': 'float' } },
  '11': { script: '11-live-pip', port: 3011, params: 'pip=real-world/sample.mkv&pip_pos=br&pip_size=33&pip_frame=white&pip_end=freeze&audio=main&fx=none&split=0' },
  '13': { script: '13-track-live', port: 3013, params: 'target=1&debug=0' },
  '14': { script: '14-intercept', port: 3014, params: 'bg=still&speed=420&size=medium&ratio=0.6', pageControls: { '[data-param=bg]': 'still' }, clipSeconds: 9, startDelay: 8000 },
};
const RTC: Record<string, { script: string; port: number; source: string; controls: Record<string, string | boolean>; record?: string }> = {
  '15': { script: '15-webrtc-wrtc', port: 3015, source: 'camera:', controls: { '#mode': 'effects', '#effect': 'negate', '#split': true } },
  '16': { script: '16-webrtc-werift', port: 3016, source: 'camera:', controls: { '#mode': 'effects', '#effect': 'edges', '#split': true } },
  '17': { script: '17-camera-record', port: 3017, source: 'camera:', controls: { '#mode': 'watermark' }, record: 'camera' },
  '18': { script: '18-screen-capture', port: 3018, source: 'generated/mp4_h264_aac.mp4', controls: { '#mode': 'changes' }, record: 'screen' },
  '19': { script: '19-screen-and-camera', port: 3019, source: 'generated/mp4_h264_aac.mp4', controls: { '#pipShape': 'circle', '#pipPos': 'br', '#pipSize': '25' }, record: 'screen-camera' },
};

const browser = await Browser.launch();
console.log('Chrome ready');

// console examples (and 12) through the web UI: run, then screenshot its example page
const web = run(['web/server.ts'], { PORT: String(WEB_PORT) });
await waitHttp(`http://127.0.0.1:${WEB_PORT}/api/examples`);
const api = `http://127.0.0.1:${WEB_PORT}/api/examples`;
const examples = ((await (await fetch(api)).json()) as { examples: { id: string; num: string }[] }).examples;

if (want('ui')) {
  await browser.open(`http://127.0.0.1:${WEB_PORT}/#tab=video`, 5000);
  await browser.shot(path.join(OUT, 'ui-library.webp'), 0, 820);
  await browser.open(`http://127.0.0.1:${WEB_PORT}/#tab=examples`, 3000);
  await browser.shot(path.join(OUT, 'ui-examples.webp'), 0, 820);
}

for (const e of examples) {
  if (!want(e.num) || LIVE[e.num] || RTC[e.num]) continue;
  console.log(`${e.id}`);
  await fetch(`${api}/${e.id}/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  for (let i = 0; i < 300; i++) {
    await sleep(500);
    if (((await (await fetch(api)).json()) as { running: string | null }).running === null) break;
  }
  await browser.open(`http://127.0.0.1:${WEB_PORT}/#tab=examples&example=${e.id}`, 3500);
  await browser.shot(path.join(OUT, `${e.num}.webp`), 200, 900);
  if (e.num === '12') await clipFromFile(path.join(OUTPUT_DIR, 'tracker', 'analysis.mp4'), 1, 6, path.join(OUT, '12.mp4')).then(() => console.log('  ✓ docs/examples/12.mp4'));
}
stop(web);

// live examples: page screenshot after Start + a clip of the stream itself
for (const [num, l] of Object.entries(LIVE)) {
  if (!want(num)) continue;
  console.log(l.script);
  const c = run([`examples/${l.script}.ts`]);
  const base = `http://127.0.0.1:${l.port}`;
  await waitHttp(`${base}/`);
  const clip = clipFromUrl(`${base}/stream.mp4?file=${encodeURIComponent(FILE)}&${l.params}`, l.clipSeconds ?? 6, path.join(OUT, `${num}.mp4`));
  await browser.open(`${base}/`, 2000);
  await browser.eval(`${setControls({ '#file': FILE, ...(l.pageControls ?? {}) })}\n document.querySelector('#start').click();`);
  await sleep(l.startDelay ?? 5000);
  await browser.shot(path.join(OUT, `${num}.webp`), 0, 920);
  await browser.eval(`document.querySelector('#stop').click();`);
  await clip.then(() => console.log(`  ✓ docs/examples/${num}.mp4`), (err) => console.error(`  clip failed: ${err.message}`));
  stop(c);
  await sleep(800);
}

// WebRTC examples: fake camera / a sample as the "screen"; 17–19 also record a clip on the server
for (const [num, r] of Object.entries(RTC)) {
  if (!want(num)) continue;
  console.log(r.script);
  const c = run([`examples/${r.script}.ts`]);
  const base = `http://127.0.0.1:${r.port}`;
  await waitHttp(`${base}/`);
  await browser.open(`${base}/`, 2500);
  await browser.eval(`{
    const s = document.querySelector('#source');
    s.value = [...s.options].find((o) => o.value.startsWith(${JSON.stringify(r.source)}))?.value ?? s.value;
    s.dispatchEvent(new Event('change'));
    document.querySelector('#start').click();
  }`);
  await sleep(4500);
  await browser.eval(setControls(r.controls));
  await sleep(2500);
  if (r.record) {
    await browser.eval(`${setControls({ '#recWhat': 'out' })}\n document.querySelector('#recStart').click();`);
    await sleep(5000);
    await browser.eval(`document.querySelector('#recStop').click();`);
    await sleep(2000);
  }
  await browser.shot(path.join(OUT, `${num}.webp`), 150, 820);
  await browser.eval(`document.querySelector('#stop').click();`);
  if (r.record) {
    const rec = newest(path.join(OUTPUT_DIR, r.record), /^rec-.*\.mp4$/);
    if (rec && existsSync(rec)) await clipFromFile(rec, 0.5, 4, path.join(OUT, `${num}.mp4`)).then(() => console.log(`  ✓ docs/examples/${num}.mp4`));
  }
  stop(c);
  await sleep(1500);
}

console.log(`\nDone → ${path.relative(ROOT, OUT)}`);
process.exit(0);
