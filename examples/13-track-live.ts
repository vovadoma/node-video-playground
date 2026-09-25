/**
 * 13 — Track live: find the target that example 12 picked in a live stream and keep a crosshair on it.
 *
 *   npm run track-analyze        # first: writes output/tracker/profile.json
 *   npm run track-live           # then open http://127.0.0.1:3013
 *
 *   disk ─▶ ffmpeg (decode) ─ raw frame ─▶ Node: detect → track → match profile → draw crosshair ─▶ ffmpeg (encode) ─▶ browser
 *
 * Every frame goes through Node (src/lib/live.ts, "frames" mode). TargetTracker (src/lib/motion.ts):
 *   SEARCH  no target: every track with ≥ 5 detections is compared with the profile — size, speed, no
 *           neighbours, colour as a hint — and the best match above 0.6 is locked. Red frame corners.
 *   LOCK    follow that track: α-β filter predicts the next position (mirrored at the frame edges — the
 *           object bounces), only blobs near the prediction count. Green crosshair + trail. A lock that
 *           keeps matching badly on clean frames is dropped and not retaken for ~3 s.
 *   LOST    no detection (e.g. crossing a bigger object): the crosshair keeps flying on the predicted
 *           velocity for up to 8 frames (yellow), then back to SEARCH.
 * The crosshair is drawn into the pixels (src/lib/draw.ts), so it is exactly on the frame it belongs to;
 * three-frame differencing means the video is one frame (~33 ms) behind the input.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { OUTPUT_DIR, SAMPLES_DIR } from '../src/lib/config.js';
import { Canvas, COLORS } from '../src/lib/draw.js';
import { startLiveServer } from '../src/lib/live.js';
import { TargetTracker, type TargetFix, type TargetProfile } from '../src/lib/motion.js';

interface Candidate { rank: number; score: number; size: number; speed: number; profile: TargetProfile }
interface Profile {
  source: string;
  processing: { width: number; height: number; factor: number };
  threshold: number;
  mask: string;
  candidates: Candidate[];
}

const PROFILE = path.join(OUTPUT_DIR, 'tracker', 'profile.json');
const analysed = existsSync(PROFILE) ? (JSON.parse(readFileSync(PROFILE, 'utf8')) as Profile) : undefined;
// Without an analysis: look for "about 16 px, about a third of the width per second" — the testsrc2 dot.
const profile: Profile = analysed ?? {
  source: '', processing: { width: 1280, height: 720, factor: 4 }, threshold: 20, mask: '',
  candidates: [{ rank: 1, score: 0, size: 16, speed: 400, profile: { size: 16 / 1280, speed: 400 / 1280 } }],
};
const mask = profile.mask ? new Uint8Array(Buffer.from(profile.mask, 'base64')) : undefined;
console.log(analysed
  ? `Profile from ${PROFILE}: ${profile.candidates.length} candidates from ${profile.source}`
  : 'No output/tracker/profile.json yet — run `npm run track-analyze` first; using a default "small and fast" profile.');

const targetOptions = profile.candidates.map((c) =>
  `<option value="${c.rank}">${c.rank}${c.rank === 1 ? ' (best)' : ''} · ${c.size} px · ${c.speed} px/s${analysed ? ` · score ${c.score}` : ' · default'}</option>`).join('');

function draw(fix: TargetFix, tracker: TargetTracker, size: { width: number; height: number }, factor: number, debug: boolean) {
  const cv = new Canvas(fix.frame, size.width, size.height);
  if (debug) {
    for (const b of tracker.blobs) {
      cv.brackets(b.minX * factor - 3, b.minY * factor - 3, (b.maxX + 1) * factor + 3, (b.maxY + 1) * factor + 3, COLORS.white, 1, 0.35);
    }
  }
  const { width: W, height: H } = size;
  if (fix.state === 'SEARCH') {
    cv.brackets(12, 12, W - 12, H - 12, COLORS.search, 4, 0.08);
    cv.text(W / 2 - 60, 24, 'SEARCHING', COLORS.search, 4);
  } else if (fix.x !== undefined && fix.y !== undefined) {
    const color = fix.state === 'LOCK' ? COLORS.lock : COLORS.lost;
    for (let i = 1; i < fix.trail.length; i++) cv.line(fix.trail[i - 1].x, fix.trail[i - 1].y, fix.trail[i].x, fix.trail[i].y, color, 2);
    cv.crosshair(fix.x, fix.y, 18, color);
    const label = fix.state === 'LOCK' ? `LOCK ${Math.round(fix.speed ?? 0)} PX/S` : 'LOST - PREDICTING';
    const lx = fix.x + 40 + 190 > W ? fix.x - 40 - label.length * 12 : fix.x + 40;
    cv.text(lx, fix.y - 34, label, color, 3);
  }
  cv.text(16, H - 36, `LIVE TRACK  FRAME ${fix.index}  ${fix.state}  ${tracker.blobs.length} DETECTIONS`, COLORS.white, 3);
}

await startLiveServer({
  title: 'Live target tracking',
  subtitle: 'Every frame goes through Node: motion is detected, tracked and matched with the profile from the offline analysis, and a crosshair is drawn onto the target. Nothing is saved.',
  flow: 'disk ─▶ ffmpeg (decode) ─ raw frame ─▶ Node: detect → track → match → draw crosshair ─▶ ffmpeg (encode) ─▶ <video> / <img>',
  port: Number(process.env.LIVE_PORT ?? 3013),
  root: SAMPLES_DIR,
  controlsHtml: `
    <label>Target <select data-param="target">${targetOptions}</select></label>
    <label>&nbsp;<span class="check"><input type="checkbox" data-param="debug"> show every detection</span></label>`,
  frames: (source, params, size) => {
    const candidate = profile.candidates.find((c) => String(c.rank) === params.get('target')) ?? profile.candidates[0];
    const factor = profile.processing.factor;
    // the flicker mask only fits the analysed file at the analysed size
    const sameVideo = source.path === profile.source && size.width === profile.processing.width && size.height === profile.processing.height;
    const tracker = new TargetTracker(size.width, size.height, factor, source.fps, candidate.profile, {
      threshold: profile.threshold, mask: sameVideo ? mask : undefined,
    });
    const debug = params.get('debug') === '1';
    let fix: TargetFix | null = null, cost = 0, locked = 0, seen = 0;
    return {
      push(frame) {
        const t0 = performance.now();
        fix = tracker.push(frame);
        if (!fix) return null;
        draw(fix, tracker, size, factor, debug);
        cost = cost * 0.9 + (performance.now() - t0) * 0.1;          // smoothed ms per frame
        seen++;
        if (fix.state === 'LOCK') locked++;
        return fix.frame;
      },
      info() {
        if (!fix) return 'starting';
        const where = fix.x !== undefined ? ` at ${Math.round(fix.x)},${Math.round(fix.y ?? 0)}` : '';
        const speed = fix.speed !== undefined ? ` ${Math.round(fix.speed)} px/s` : '';
        return `target ${candidate.rank}: ${fix.state}${where}${speed} · locked ${Math.round((100 * locked) / Math.max(1, seen))}% · ${cost.toFixed(1)} ms/frame`;
      },
    };
  },
});
