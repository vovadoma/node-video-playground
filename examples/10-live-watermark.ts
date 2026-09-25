/**
 * 10 — Live watermark: like example 09, plus a logo burned into every frame on the fly — nothing is written to disk.
 *
 *   npm run watermark            # then open http://127.0.0.1:3010
 *
 *   disk ─▶ ffmpeg stdin (input 0) ─┐
 *                                   ├─ effect ─ overlay ─▶ ffmpeg stdout ─▶ browser
 *   watermark.png  (input 1, looped)┘
 *
 * The watermark is a second ffmpeg input: a PNG with a transparent background (examples/assets/
 * watermark.png, drawn from watermark.svg), repeated forever with `-loop 1`. For every video frame:
 *   [1:v] scale to N % of the video width → format=rgba → colorchannelmixer=aa=<opacity>  → [wm]
 *   [base][wm] overlay=x=…:y=…   (x/y are expressions: W,H = video size, w,h = logo size, t = time)
 * "Floating" moves the logo with t and bounces it off the edges — the way streaming services make a
 * watermark hard to crop or blur away. Burned in = part of the pixels, not a player overlay.
 *
 * Why a PNG and not text: text needs ffmpeg's drawtext filter (libfreetype), which the Homebrew build
 * doesn't include; overlay + PNG works with any build.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SAMPLES_DIR } from '../src/lib/config.js';
import { effectControls, effectGraph } from '../src/lib/effects.js';
import { startLiveServer, type Source } from '../src/lib/live.js';

const WATERMARK = path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets', 'watermark.png');

/** Where the logo goes: overlay x/y expressions. m = margin in px. */
const POSITIONS: Record<string, { label: string; xy: (m: number) => string }> = {
  br: { label: 'Bottom right', xy: (m) => `x=W-w-${m}:y=H-h-${m}` },
  bl: { label: 'Bottom left', xy: (m) => `x=${m}:y=H-h-${m}` },
  tr: { label: 'Top right', xy: (m) => `x=W-w-${m}:y=${m}` },
  tl: { label: 'Top left', xy: (m) => `x=${m}:y=${m}` },
  center: { label: 'Center', xy: () => 'x=(W-w)/2:y=(H-h)/2' },
  // position = |(t·speed) mod 2·range − range| → goes 0…range…0 — a bounce off both edges
  float: { label: 'Floating (bounces)', xy: () => `x='abs(mod(t*140,2*(W-w))-(W-w))':y='abs(mod(t*90,2*(H-h))-(H-h))'` },
};
const SIZES = [15, 25, 35];                  // % of the video width
const OPACITIES = [0.4, 0.7, 1];

function watermarkGraph(src: Source, p: URLSearchParams): string {
  const pct = SIZES.includes(Number(p.get('wm_size'))) ? Number(p.get('wm_size')) : 25;
  const opacity = OPACITIES.includes(Number(p.get('wm_opacity'))) ? Number(p.get('wm_opacity')) : 0.7;
  const pos = POSITIONS[p.get('wm_pos') ?? ''] ?? POSITIONS.br;
  const videoWidth = src.width || 1280;
  const logoWidth = Math.round((videoWidth * pct) / 100 / 2) * 2;      // even, for 4:2:0
  const margin = Math.round(videoWidth * 0.025);

  return [
    effectGraph(p.get('fx') ?? 'none', p.get('split') === '1', '[base]'),              // 09's effect → [base]
    `[1:v]scale=${logoWidth}:-1,format=rgba,colorchannelmixer=aa=${opacity}[wm]`,      // logo: size + transparency
    `[base][wm]overlay=${pos.xy(margin)}:shortest=1,format=yuv420p[v]`,                // burn it in; end with the video
  ].join(';');
}

const select = (param: string, options: [string, string][], selected: string) =>
  `<select data-param="${param}">${options.map(([v, l]) => `<option value="${v}"${v === selected ? ' selected' : ''}>${l}</option>`).join('')}</select>`;

await startLiveServer({
  title: 'Live watermark',
  subtitle: 'The file is streamed through ffmpeg, which burns a logo into every frame on the fly and sends the result to this page. Nothing is saved.',
  port: Number(process.env.LIVE_PORT ?? 3010),
  root: SAMPLES_DIR,
  controlsHtml: `
    <label>Watermark ${select('wm_pos', Object.entries(POSITIONS).map(([k, v]) => [k, v.label]), 'br')}</label>
    <label>Size ${select('wm_size', SIZES.map((s) => [String(s), `${s}% of width`]), '25')}</label>
    <label>Opacity ${select('wm_opacity', OPACITIES.map((o) => [String(o), `${o * 100}%`]), '0.7')}</label>
    ${effectControls('none', false)}`,
  // input 0 = the piped file, input 1 = the logo, looped so there is a logo frame for every video frame
  buildArgs: (source, params) => ({
    inputs: ['-loop', '1', '-i', WATERMARK],
    filter: watermarkGraph(source, params),
    label: '[v]',
  }),
});
