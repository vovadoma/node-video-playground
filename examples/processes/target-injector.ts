/**
 * Process A of example 14 — a separate OS process that paints a moving target into video frames.
 *
 *   stdin   raw yuv420p frames (width × height)
 *   stdout  the same frames with a ball drawn in
 *   stderr  one JSON line per frame: {"f":…, "x":…, "y":…, "r":…} — the TRUE position. The server reads
 *           it only to score the seeker; the seeker itself never sees it.
 *
 * The ball starts at a random point with a random direction and bounces off the frame edges like a
 * billiard ball. Run by examples/14-intercept.ts:
 *
 *   tsx examples/processes/target-injector.ts --width 1280 --height 720 --fps 30 --speed 420 --radius 12
 */
import { pipeline, Transform } from 'node:stream';
import { parseArgs } from 'node:util';
import { Canvas, rgb, COLORS } from '../../src/lib/draw.js';
import { frameBytes, FrameChunker } from '../../src/lib/rawframes.js';

const { values } = parseArgs({
  options: {
    width: { type: 'string' }, height: { type: 'string' }, fps: { type: 'string', default: '30' },
    speed: { type: 'string', default: '420' },            // px per second
    radius: { type: 'string', default: '12' },
    seed: { type: 'string' },                             // optional: repeatable runs
  },
});
const W = Number(values.width), H = Number(values.height), fps = Number(values.fps);
const speed = Number(values.speed), r = Number(values.radius);
if (!W || !H) throw new Error('--width and --height are required');

// small seeded PRNG (mulberry32) so a --seed gives the same start every time
let state = values.seed ? Number(values.seed) >>> 0 : (Math.random() * 2 ** 32) >>> 0;
const random = () => {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
};

// random start inside the frame, random direction that is neither too flat nor too steep
let x = r + random() * (W - 2 * r);
let y = r + random() * (H - 2 * r);
const angle = (20 + random() * 50) * (Math.PI / 180) + Math.floor(random() * 4) * (Math.PI / 2);
let vx = (Math.cos(angle) * speed) / fps, vy = (Math.sin(angle) * speed) / fps;
process.stderr.write(JSON.stringify({ start: { x: Math.round(x), y: Math.round(y), angle: Math.round((angle * 180) / Math.PI), speed } }) + '\n');

const ball = rgb(249, 115, 22);           // orange
let f = 0;
const paint = new Transform({
  objectMode: true,
  transform(frame: Buffer, _enc, done) {
    const cv = new Canvas(frame, W, H);
    cv.disc(x, y, r + 2, COLORS.black);   // dark rim: visible on any background
    cv.disc(x, y, r, ball);
    cv.disc(x - r / 3, y - r / 3, r / 3, rgb(254, 215, 170));   // highlight
    process.stderr.write(`{"f":${f},"x":${x.toFixed(1)},"y":${y.toFixed(1)},"r":${r}}\n`);
    f++;
    // move, then bounce off the edges (the ball's rim touches the wall)
    x += vx; y += vy;
    if (x < r) { x = 2 * r - x; vx = -vx; } else if (x > W - r) { x = 2 * (W - r) - x; vx = -vx; }
    if (y < r) { y = 2 * r - y; vy = -vy; } else if (y > H - r) { y = 2 * (H - r) - y; vy = -vy; }
    done(null, frame);
  },
});

pipeline(process.stdin, new FrameChunker(frameBytes(W, H)), paint, process.stdout, () => process.exit(0));
