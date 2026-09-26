/**
 * 14 — Intercept: one process paints a bouncing target into the video, another one — knowing nothing about it — spots it in a centre square, holds it there and steers a slower sight to intercept it.
 *
 *   npm run intercept            # then open http://127.0.0.1:3014
 *
 *   background ─▶ ffmpeg (decode) ─ raw ─▶ PROCESS A: target-injector ─ raw ─▶ PROCESS B: seeker ─▶ ffmpeg (encode) ─▶ browser
 *                                        (separate program, paints a ball)       (sees only pixels)
 *
 * Process A — examples/processes/target-injector.ts, a child process: random start, random direction,
 *   bounces off the edges like a billiard ball. It gets raw frames on stdin and returns them on stdout.
 * Process B — src/lib/intercept.ts (Seeker), only ever gets the frames coming out of A:
 *   WATCH → a small moving blob inside the centre square → CAPTURED: the square follows it and keeps it
 *   inside; the sight flies at `ratio` × the target's measured speed towards an intercept point on the
 *   target's predicted path (straight lines folded at the edges = bounces). HIT when it gets there.
 * A also prints the ball's true position on stderr; the SERVER reads that to score B (error, % in the
 * square) — B never sees it.
 *
 * `seed` (optional) makes the ball repeatable: the same seed, the same start and direction.
 * Background: the video itself, looped (default) — B may then just as well capture something that moves
 * in the video, it only knows "small and moving" — or a still frame, where only the ball moves.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SAMPLES_DIR } from '../src/lib/config.js';
import { Canvas } from '../src/lib/draw.js';
import { drawSeeker, Seeker, type SeekerView } from '../src/lib/intercept.js';
import { startLiveServer } from '../src/lib/live.js';
import { throughProcess } from '../src/lib/rawframes.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TSX = path.join(HERE, '..', 'node_modules', '.bin', 'tsx');
const INJECTOR = path.join(HERE, 'processes', 'target-injector.ts');

const SPEEDS = [300, 420, 600];                 // target px/s
const RATIOS = [0.4, 0.6, 0.8, 1, 1.2];         // sight speed / target speed
const SIZES: Record<string, number> = { small: 8, medium: 12, large: 18 };   // ball radius px

const select = (param: string, options: [string, string][], selected: string) =>
  `<select data-param="${param}">${options.map(([v, l]) => `<option value="${v}"${v === selected ? ' selected' : ''}>${l}</option>`).join('')}</select>`;

await startLiveServer({
  title: 'Intercept',
  subtitle: 'Process A paints a bouncing ball into the video; process B sees only the resulting pixels: it spots the ball in the centre square, holds it there and steers a slower sight to intercept it. Each Start = a new random ball, unless you set a seed.',
  flow: 'background ─▶ ffmpeg ─ raw ─▶ process A: target-injector (paints the ball) ─ raw ─▶ process B: seeker (pixels only) ─▶ ffmpeg ─▶ browser',
  port: Number(process.env.LIVE_PORT ?? 3014),
  root: SAMPLES_DIR,
  controlsHtml: `
    <label>Background ${select('bg', [['video', 'The video, looped — with distractors'], ['still', 'Still frame — only the ball moves']], 'video')}</label>
    <label>Ball speed ${select('speed', SPEEDS.map((s) => [String(s), `${s} px/s`]), '420')}</label>
    <label>Ball size ${select('size', Object.keys(SIZES).map((k) => [k, k]), 'medium')}</label>
    <label>Sight / ball speed ${select('ratio', RATIOS.map((r) => [String(r), `${r} ×`]), '0.6')}</label>
    <label>Seed <input data-param="seed" type="number" min="1" placeholder="random" title="The same seed = the same start and direction of the ball" style="height:36px; width:110px; padding:0 8px; border:1px solid var(--border); border-radius:8px; background:var(--surface); color:var(--text); font:13px inherit"></label>
    <label>&nbsp;<span class="check"><input type="checkbox" data-param="debug"> show every detection</span></label>`,
  frames: (source, params, size) => {
    const { width: W, height: H } = size;
    const speed = SPEEDS.includes(Number(params.get('speed'))) ? Number(params.get('speed')) : 420;
    const ratio = RATIOS.includes(Number(params.get('ratio'))) ? Number(params.get('ratio')) : 0.6;
    const radius = SIZES[params.get('size') ?? ''] ?? SIZES.medium;
    const debug = params.get('debug') === '1';
    const seed = Number(params.get('seed'));             // optional: a repeatable ball

    // Truth from process A's stderr — for the stats table only; the seeker never gets it.
    const truth = new Map<number, { x: number; y: number }>();
    const onLine = (line: string) => {
      try {
        const j = JSON.parse(line);
        if (typeof j.f === 'number') { truth.set(j.f, j); truth.delete(j.f - 300); }
      } catch { /* not JSON — ignore */ }
    };

    const seeker = new Seeker({ width: W, height: H, fps: source.fps, ratio });   // ← only its own settings
    let view: SeekerView | null = null, cost = 0, captured = 0, inGate = 0, err = 0, errN = 0;
    return {
      input: params.get('bg') === 'still' ? 'still' : 'loop',
      // process A: a separate program; it gets only the size and ITS settings
      stage: (frames) => throughProcess(frames, TSX, [INJECTOR, '--width', `${W}`, '--height', `${H}`, '--fps', `${source.fps}`, '--speed', `${speed}`, '--radius', `${radius}`, ...(seed > 0 ? ['--seed', String(Math.floor(seed))] : [])], size, onLine),
      push(frame) {
        const t0 = performance.now();
        view = seeker.push(frame);               // process B: pixels in, decisions out
        if (!view) return null;
        drawSeeker(new Canvas(view.frame, W, H), view, ratio, debug);
        cost = cost * 0.9 + (performance.now() - t0) * 0.1;
        const t = truth.get(view.index);
        if (t && (view.state === 'CAPTURED' || view.state === 'COAST')) {
          captured++;
          if (Math.abs(t.x - view.gate.x) <= view.gate.size / 2 && Math.abs(t.y - view.gate.y) <= view.gate.size / 2) inGate++;
          if (view.target) { err += Math.hypot(t.x - view.target.x, t.y - view.target.y); errN++; }
        }
        return view.frame;
      },
      info() {
        if (!view) return 'starting';
        const score = captured ? ` · ball in square ${Math.round((100 * inGate) / captured)}% · estimate error ${(err / Math.max(1, errN)).toFixed(1)} px` : '';
        return `${view.state} · hits ${view.hits}${score} · ${cost.toFixed(1)} ms/frame`;
      },
    };
  },
});
