/**
 * 11 — Live picture-in-picture: like example 10, but instead of a logo a second video is placed over the first, on the fly — nothing is written to disk.
 *
 *   npm run pip                  # then open http://127.0.0.1:3011
 *
 *   main.mkv ─ createReadStream ─▶ ffmpeg pipe:0 (input 0) ─ effect ──────────────┐
 *                                                                                 ├─ overlay ─▶ stdout ─▶ browser
 *   pip.mkv  ─ createReadStream ─▶ ffmpeg pipe:3 (input 1) ─ scale ─ pad (frame) ─┘
 *
 * Both videos are streamed from disk by Node: the second one goes in through an extra file
 * descriptor of the ffmpeg process (`pipe:3`, see ffmpegStream() in src/lib/ffmpeg.ts), so ffmpeg
 * never opens a file itself. Each input gets `-re` (read at playback speed) and `setpts=PTS-STARTPTS`
 * so both start at t = 0 and stay in sync.
 *
 * A pipe can't be rewound, so the inset can't loop: when it is shorter than the main video it either
 * disappears (overlay eof_action=pass) or freezes on its last frame (eof_action=repeat).
 * Sound comes from the main video, the inset, or both mixed (amix).
 */
import { SAMPLES_DIR } from '../src/lib/config.js';
import { effectControls, effectGraph } from '../src/lib/effects.js';
import { startLiveServer, type Source } from '../src/lib/live.js';

const CORNERS: Record<string, { label: string; xy: (m: number) => string }> = {
  br: { label: 'Bottom right', xy: (m) => `x=W-w-${m}:y=H-h-${m}` },
  bl: { label: 'Bottom left', xy: (m) => `x=${m}:y=H-h-${m}` },
  tr: { label: 'Top right', xy: (m) => `x=W-w-${m}:y=${m}` },
  tl: { label: 'Top left', xy: (m) => `x=${m}:y=${m}` },
};
const SIZES = [25, 33, 50];                                     // inset width, % of the main video width
const FRAMES: Record<string, { label: string; color?: string }> = {
  white: { label: 'White frame', color: 'white' },
  blue: { label: 'Blue frame', color: '0x2563eb' },
  none: { label: 'No frame' },
};

function pipGraph(main: Source, pip: Source, p: URLSearchParams): { filter: string; audio: string } {
  const pct = SIZES.includes(Number(p.get('pip_size'))) ? Number(p.get('pip_size')) : 33;
  const corner = CORNERS[p.get('pip_pos') ?? ''] ?? CORNERS.br;
  const frame = FRAMES[p.get('pip_frame') ?? ''] ?? FRAMES.white;
  const mainWidth = main.width || 1280;
  const insetWidth = Math.round((mainWidth * pct) / 100 / 2) * 2;       // even, for 4:2:0
  const border = frame.color ? Math.max(2, Math.round(mainWidth / 320)) : 0;
  const margin = Math.round(mainWidth * 0.025);
  const onEnd = p.get('pip_end') === 'freeze' ? 'repeat' : 'pass';

  const graph = [
    // main video (+ an effect from example 09) → [base], starting at t = 0
    effectGraph(p.get('fx') ?? 'none', p.get('split') === '1', '[fx]'),
    '[fx]setpts=PTS-STARTPTS[base]',
    // inset: start at t = 0, shrink, optional frame around it (pad = bigger canvas in the frame colour)
    `[1:v]setpts=PTS-STARTPTS,scale=${insetWidth}:-2${border ? `,pad=iw+${2 * border}:ih+${2 * border}:${border}:${border}:color=${frame.color}` : ''}[pip]`,
    `[base][pip]overlay=${corner.xy(margin)}:eof_action=${onEnd},format=yuv420p[v]`,
  ];

  // sound: from the main video, the inset, or both — only map what exists
  const want = p.get('audio') ?? 'main';
  let audio = '0:a:0?';
  if (want === 'pip' && pip.hasAudio) audio = '1:a:0';
  if (want === 'mix' && main.hasAudio && pip.hasAudio) {
    graph.push('[0:a]asetpts=PTS-STARTPTS[a0];[1:a]asetpts=PTS-STARTPTS[a1];[a0][a1]amix=inputs=2:duration=first:normalize=0[a]');
    audio = '[a]';
  }
  return { filter: graph.join(';'), audio };
}

const select = (param: string, options: [string, string][], selected: string) =>
  `<select data-param="${param}">${options.map(([v, l]) => `<option value="${v}"${v === selected ? ' selected' : ''}>${l}</option>`).join('')}</select>`;

await startLiveServer({
  title: 'Live picture-in-picture',
  subtitle: 'Two files are streamed from disk into one ffmpeg process, which places the second video over the first on the fly and sends the result to this page. Nothing is saved.',
  port: Number(process.env.LIVE_PORT ?? 3011),
  root: SAMPLES_DIR,
  controlsHtml: `
    <label>Inset video <select id="pip" data-param="pip" data-sources="real-world/sample.mkv"></select></label>
    <label>Corner ${select('pip_pos', Object.entries(CORNERS).map(([k, v]) => [k, v.label]), 'br')}</label>
    <label>Size ${select('pip_size', SIZES.map((s) => [String(s), `${s}% of width`]), '33')}</label>
    <label>Frame ${select('pip_frame', Object.entries(FRAMES).map(([k, v]) => [k, v.label]), 'white')}</label>
    <label>When the inset ends ${select('pip_end', [['hide', 'Hide it'], ['freeze', 'Freeze last frame']], 'hide')}</label>
    <label>Sound ${select('audio', [['main', 'Main video'], ['pip', 'Inset video'], ['mix', 'Mix both']], 'main')}</label>
    ${effectControls('none', false)}`,
  // input 0 = main file (pipe:0), input 1 = inset file (pipe:3)
  buildArgs: (main, params, find) => {
    const pip = find(params.get('pip')) ?? main;
    return { pipes: [pip], ...pipGraph(main, pip, params), label: '[v]' };
  },
});
