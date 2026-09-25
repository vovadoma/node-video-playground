/**
 * 12 — Track analyze: find a small, fast-moving object in a video offline, in three passes, and show what was found.
 *
 *   npm run track-analyze
 *   npm run track-analyze -- samples/generated/webm_vp9_opus.webm
 *
 * Every pass decodes the file into raw frames (src/lib/rawframes.ts) and looks at a small grayscale
 * copy of each (1280×720 → 320×180) with plain TypeScript (src/lib/motion.ts):
 *
 *   pass 1  what flickers in place?   per-pixel change frequency → mask for noise / running timecodes
 *   pass 2  what moves?               three-frame difference → blobs → tracks (α-β filter) → rank tracks
 *                                     by small × fast × long-lived × alone; pieces of the same object
 *                                     (lost behind something, found again) are joined into one candidate
 *   pass 3  show it                   the winner's colour; analysis.mp4 with every candidate marked and a
 *                                     crosshair on the target; trajectories.png; motion-heatmap.png
 *
 * The result, output/tracker/profile.json, describes the target (size, speed, colour) and is what
 * example 13 uses to find and follow it live.
 */
import { createReadStream, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { OUTPUT_DIR, SAMPLES_DIR, sample } from '../src/lib/config.js';
import { Canvas, COLORS } from '../src/lib/draw.js';
import { probeSummary } from '../src/lib/ffprobe.js';
import { colorAt, FlickerMap, motionFrame, MotionDetector, scoreTrack, Tracker, trackStats, type Track, type TrackStats } from '../src/lib/motion.js';
import { decodeFrames, encodeToFile, frameBytes, processingSize } from '../src/lib/rawframes.js';

const FACTOR = 4;               // analysis image = frame / 4 in each direction
const THRESHOLD = 20;           // grey levels a pixel must change by to count as motion
const MAX_CANDIDATES = 6;

const input = process.argv[2] ?? sample('generated/mkv_h264_aac.mkv');
const src = await probeSummary(input);
if (!src.video?.width || !src.video.height) throw new Error(`${input} has no video stream`);
const { width: W, height: H } = processingSize(src.video.width, src.video.height);
const fps = src.video.fps || 30;
const sw = Math.floor(W / FACTOR), sh = Math.floor(H / FACTOR);
const outDir = path.join(OUTPUT_DIR, 'tracker');
mkdirSync(outDir, { recursive: true });
console.log(`Input: ${path.basename(input)} — ${src.video.codec} ${src.video.width}x${src.video.height} @ ${fps} fps`);
console.log(`Analysing at ${W}x${H}, motion image ${sw}x${sh}\n`);

/** One pass over the file: raw yuv420p frames. */
const frames = () => decodeFrames(createReadStream(input), { width: W, height: H }) as AsyncIterable<Buffer>;

// ---------------------------------------------------------------- pass 1: flicker

let t0 = performance.now();
const flicker = new FlickerMap(sw, sh, THRESHOLD);
for await (const f of frames()) flicker.add(motionFrame(f, W, H, FACTOR));
const mask = flicker.mask(0.35);
const masked = mask.reduce((a, b) => a + b, 0);
console.log(`Pass 1 — flicker: ${flicker.frames + 1} frames, ${masked} of ${mask.length} pixels change in >35% of frames → masked (${ms(t0)})`);

// ---------------------------------------------------------------- pass 2: detect, track, rank

t0 = performance.now();
const detector = new MotionDetector(sw, sh, { threshold: THRESHOLD, mask });
const tracker = new Tracker({ gate: 4, maxMissed: 3, isolationRadius: 8, bounds: { w: sw, h: sh } });
const heat = new Uint32Array(sw * sh);
let index = 0, blobTotal = 0;
for await (const f of frames()) {
  const blobs = detector.push(motionFrame(f, W, H, FACTOR));
  if (blobs) {
    tracker.update(index - 1, blobs);                 // blobs belong to the previous frame
    blobTotal += blobs.length;
    for (const b of blobs) for (let y = b.minY; y <= b.maxY; y++) for (let x = b.minX; x <= b.maxX; x++) heat[y * sw + x]++;
  }
  index++;
}
const frameCount = index;

const rules = { minFrames: Math.round(fps / 2), maxSize: W * 0.05, fastSpeed: W * 0.3 };
const tracks = new Map(tracker.all().map((t) => [t.id, t]));
const ranked = [...tracks.values()]
  .map((t) => trackStats(t, fps, FACTOR))
  .filter((s) => s.frames >= 5)
  .map((s) => ({ s, ...scoreTrack(s, rules) }))
  .filter((r) => r.score > 0)
  .sort((a, b) => b.score - a.score);

/** A candidate = one object; may consist of several tracks when it was lost and found again. */
interface Candidate { rank: number; parts: TrackStats[]; score: number; factors: Record<string, number> }
const candidates: Candidate[] = [];
const overlaps = (a: TrackStats, b: TrackStats) => a.firstFrame <= b.lastFrame && b.firstFrame <= a.lastFrame;
const similar = (a: TrackStats, b: TrackStats) =>
  b.size / a.size > 0.5 && b.size / a.size < 2 && b.speed / a.speed > 0.6 && b.speed / a.speed < 1.7 && b.isolation >= 0.7;
for (const r of ranked) {
  const same = candidates.find((c) => similar(c.parts[0], r.s) && !c.parts.some((p) => overlaps(p, r.s)));
  if (same) same.parts.push(r.s);
  else if (candidates.length < MAX_CANDIDATES) candidates.push({ rank: candidates.length + 1, parts: [r.s], score: r.score, factors: r.factors });
}
for (const c of candidates) c.parts.sort((a, b) => a.firstFrame - b.firstFrame);
console.log(`Pass 2 — motion: ${blobTotal} blobs, ${tracks.size} tracks, ${ranked.length} could be "small and fast" (${ms(t0)})\n`);
if (!candidates.length) {
  console.log('Nothing small and fast moves in this video.');
  process.exit(0);
}

console.log('rank  score  small  fast  long  alone   size   speed      visible (frames)');
for (const c of candidates) {
  const s = c.parts[0], f = c.factors;
  const visible = c.parts.map((p) => `${p.firstFrame}–${p.lastFrame}`).join(', ');
  console.log(`#${c.rank}    ${c.score.toFixed(2)}   ${f.small.toFixed(2)}  ${f.fast.toFixed(2)}  ${f.long.toFixed(2)}  ${f.alone.toFixed(2)}   ${s.size.toFixed(0).padStart(3)}px ${s.speed.toFixed(0).padStart(5)}px/s   ${visible}`);
}
const target = candidates[0];
console.log(`\nTarget = #1: ~${target.parts[0].size.toFixed(0)} px, ${target.parts[0].speed.toFixed(0)} px/s, visible in ${target.parts.reduce((n, p) => n + p.frames, 0)} of ${frameCount} frames`);

// ---------------------------------------------------------------- pass 3: colour + pictures

t0 = performance.now();
/** frame → where each candidate is (filtered track position, full-res px) */
const at = new Map<number, { c: Candidate; x: number; y: number; size: number; coasted?: boolean }[]>();
for (const c of candidates) {
  for (const part of c.parts) {
    for (const p of (tracks.get(part.id) as Track).points) {
      const list = at.get(p.f) ?? [];
      list.push({ c, x: (p.x + 0.5) * FACTOR, y: (p.y + 0.5) * FACTOR, size: Math.max(part.size, 12), coasted: p.coasted });
      at.set(p.f, list);
    }
  }
}
const colours: { u: number; v: number }[] = [];
const trail: { x: number; y: number; f: number }[] = [];
let background: Buffer | undefined;
const midTarget = Math.round((target.parts[0].firstFrame + target.parts[0].lastFrame) / 2);

async function* annotated() {
  let f = 0;
  for await (const frame of frames()) {
    if (f === midTarget) background = Buffer.from(frame);
    const here = at.get(f) ?? [];
    const cv = new Canvas(frame, W, H);
    for (const h of here) {
      if (h.c === target) {
        if (!h.coasted) colours.push(colorAt(frame, W, H, h.x, h.y, Math.max(2, h.size / 4)));
        trail.push({ x: h.x, y: h.y, f });
      } else {
        const col = COLORS.palette[(h.c.rank - 2) % COLORS.palette.length];
        const r = h.size;
        cv.brackets(h.x - r, h.y - r, h.x + r, h.y + r, col, 2);
        cv.text(h.x + r + 4, h.y - r, `${h.c.rank}`, col, 2);
      }
    }
    const recent = trail.filter((p) => f - p.f < 20);
    for (let i = 1; i < recent.length; i++) cv.line(recent[i - 1].x, recent[i - 1].y, recent[i].x, recent[i].y, COLORS.lock, 2);
    const t = here.find((h) => h.c === target);
    if (t) {
      cv.crosshair(t.x, t.y, Math.max(14, t.size), t.coasted ? COLORS.lost : COLORS.lock);
      cv.text(t.x + t.size * 1.7, t.y + t.size * 1.2, 'TARGET', COLORS.lock, 3);
    }
    cv.text(16, H - 40, `ANALYSIS  FRAME ${f}/${frameCount}  ${here.length} CANDIDATES`, COLORS.white, 3);
    yield frame;
    f++;
  }
}
await encodeToFile(annotated(), { width: W, height: H, fps }, [
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(outDir, 'analysis.mp4'),
]);
const color = colours.length
  ? { u: Math.round(colours.reduce((s, c) => s + c.u, 0) / colours.length), v: Math.round(colours.reduce((s, c) => s + c.v, 0) / colours.length) }
  : undefined;

// trajectories.png — every candidate's path over a dimmed frame
{
  const frame = background ?? Buffer.alloc(frameBytes(W, H), 128);
  const cv = new Canvas(frame, W, H);
  cv.dim(0.35);
  for (const c of [...candidates].reverse()) {
    const col = c === target ? COLORS.lock : COLORS.palette[(c.rank - 2) % COLORS.palette.length];
    for (const part of c.parts) {
      const pts = (tracks.get(part.id) as Track).points.map((p) => ({ x: (p.x + 0.5) * FACTOR, y: (p.y + 0.5) * FACTOR }));
      for (let i = 1; i < pts.length; i++) cv.line(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y, col, c === target ? 3 : 2);
      cv.circle(pts[0].x, pts[0].y, 6, col, 2);
      cv.text(pts[0].x + 8, pts[0].y - 8, `${c.rank}`, col, 2);
    }
  }
  candidates.forEach((c, i) => {
    const s = c.parts[0];
    const col = c === target ? COLORS.lock : COLORS.palette[(c.rank - 2) % COLORS.palette.length];
    cv.text(16, 16 + i * 22, `${c.rank}${c === target ? ' TARGET' : ''}  SCORE ${c.score.toFixed(2)}  ${s.size.toFixed(0)}PX  ${s.speed.toFixed(0)}PX/S`, col, 3);
  });
  await encodeToFile([frame], { width: W, height: H, fps: 1 }, ['-frames:v', '1', '-update', '1', path.join(outDir, 'trajectories.png')]);
}

// motion-heatmap.png — where motion happened (bright), masked flicker in red
{
  const frame = Buffer.alloc(frameBytes(sw, sh));
  const cv = new Canvas(frame, sw, sh);
  const max = Math.log1p(heat.reduce((m, v) => Math.max(m, v), 1));
  for (let i = 0; i < heat.length; i++) {
    const x = i % sw, y = (i / sw) | 0;
    const v = Math.round(255 * Math.log1p(heat[i]) / max);
    cv.px(x, y, mask[i] ? COLORS.search : { y: 16 + (v * 219) / 255, u: 128, v: 128 });
  }
  await encodeToFile([frame], { width: sw, height: sh, fps: 1 }, ['-frames:v', '1', '-update', '1', '-vf', `scale=${W}:-2:flags=neighbor`, path.join(outDir, 'motion-heatmap.png')]);
}
console.log(`Pass 3 — colour U=${color?.u ?? '?'} V=${color?.v ?? '?'}, analysis.mp4, trajectories.png, motion-heatmap.png (${ms(t0)})`);

// ---------------------------------------------------------------- profile for example 13

const profile = {
  createdAt: new Date().toISOString(),
  source: path.relative(SAMPLES_DIR, input).split(path.sep).join('/'),
  processing: { width: W, height: H, factor: FACTOR, fps },
  threshold: THRESHOLD,
  mask: Buffer.from(mask).toString('base64'),
  rules,
  candidates: candidates.map((c) => {
    const s = c.parts[0];
    return {
      rank: c.rank,
      score: +c.score.toFixed(3),
      factors: Object.fromEntries(Object.entries(c.factors).map(([k, v]) => [k, +v.toFixed(3)])),
      size: Math.round(s.size), speed: Math.round(s.speed), isolation: +s.isolation.toFixed(2),
      visible: c.parts.map((p) => [p.firstFrame, p.lastFrame]),
      profile: { size: s.size / W, speed: s.speed / W, ...(c === target && color ? { color } : {}) },
    };
  }),
};
writeFileSync(path.join(outDir, 'profile.json'), JSON.stringify(profile, null, 2));
console.log(`\nProfile for live tracking → ${path.join(outDir, 'profile.json')}  (npm run track-live)`);

function ms(start: number) {
  return `${Math.round(performance.now() - start)} ms`;
}
