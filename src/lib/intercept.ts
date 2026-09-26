/**
 * A seeker that knows nothing about the target: it only looks at pixels.
 *
 *   WATCH     a small square (the gate) sits in the centre, the sight in it. Any small moving blob that
 *             is seen inside the gate for a few frames is captured.
 *   CAPTURED  the gate follows the target (it is re-centred on every detection, so the target stays in
 *             it). The sight is SLOWER than the target (speed = ratio × the target's measured speed) and
 *             flies to an intercept point: the target's future path is predicted — straight lines that
 *             bounce off the frame edges — and the sight aims at the first point it can reach in time.
 *   COAST     no detection for a few frames: the gate and the prediction keep going on the last velocity.
 *   RETURN    target lost: gate and sight glide back to the centre, then WATCH again.
 *
 * Detection = three-frame difference → blobs → α-β tracks (src/lib/motion.ts). "Small" means the blob fits
 * well inside the gate — that is a property of the sensor, not knowledge about what is out there.
 */
import { Canvas, COLORS, rgb } from './draw.js';
import { bounce, motionFrame, MotionDetector, Tracker, type Blob, type Track } from './motion.js';

export type SeekerState = 'WATCH' | 'CAPTURED' | 'COAST' | 'RETURN';

export interface SeekerOptions {
  width: number;
  height: number;
  fps: number;
  ratio: number;                // sight speed / target speed, e.g. 0.6
  gate?: number;                // gate side, px (default: height / 6)
  factor?: number;              // motion image downscale (default 4)
  threshold?: number;           // motion threshold, grey levels (default 20)
}

export interface Point { x: number; y: number }

export interface SeekerView {
  frame: Buffer;                // the frame this view belongs to (one behind the input)
  index: number;
  state: SeekerState;
  gate: Point & { size: number };
  sight: Point;
  sightSpeed: number;           // px/s
  target?: Point & { vx: number; vy: number; speed: number; size: number };   // speed px/s, v px/frame
  aim?: Point & { t: number; reachable: boolean };                            // t = frames to intercept
  path: Point[];                // predicted target path up to the aim point
  hit: boolean;                 // sight on the target this frame
  hits: number;
  blobs: Blob[];                // everything the detector saw (motion-image px)
}

export class Seeker {
  state: SeekerState = 'WATCH';
  private readonly o: Required<SeekerOptions>;
  private readonly detector: MotionDetector;
  private readonly tracker: Tracker;
  private readonly centre: Point;
  private gate: Point;
  private sight: Point;
  private captured?: Track;
  private targetSpeed = 0;      // px/frame, smoothed
  private hitting = false;
  private hits = 0;
  private prevFrame?: Buffer;
  private index = -1;

  constructor(opts: SeekerOptions) {
    this.o = { gate: Math.round(opts.height / 6), factor: 4, threshold: 20, ...opts };
    const f = this.o.factor;
    const sw = Math.floor(opts.width / f), sh = Math.floor(opts.height / f);
    this.detector = new MotionDetector(sw, sh, { threshold: this.o.threshold });
    this.tracker = new Tracker({ gate: 4, speedGate: 0.6, maxMissed: 6, isolationRadius: 8, bounds: { w: sw, h: sh } });
    this.centre = { x: opts.width / 2, y: opts.height / 2 };
    this.gate = { ...this.centre };
    this.sight = { ...this.centre };
  }

  private full(t: Track): Point {
    return { x: (t.x + 0.5) * this.o.factor, y: (t.y + 0.5) * this.o.factor };
  }

  private inGate(p: Point, gate: Point, margin = 0): boolean {
    const h = this.o.gate / 2 + margin;
    return Math.abs(p.x - gate.x) <= h && Math.abs(p.y - gate.y) <= h;
  }

  /** Push the next frame; returns the view for the PREVIOUS frame (three-frame difference). */
  push(frame: Buffer): SeekerView | null {
    const { width: W, height: H, factor: f, fps } = this.o;
    const blobs = this.detector.push(motionFrame(frame, W, H, f));
    const out = this.prevFrame;
    this.prevFrame = frame;
    this.index++;
    if (!out) return null;

    // "small": a blob must fit comfortably inside the gate
    const maxSide = (this.o.gate * 0.6) / f;
    const small = (blobs ?? []).filter((b) => Math.max(b.maxX - b.minX, b.maxY - b.minY) + 1 <= maxSide);
    const active = blobs ? this.tracker.update(this.index - 1, small) : this.tracker.active;

    // ---- capture / keep / lose
    if (this.captured && !active.includes(this.captured)) {
      this.captured = undefined;                // coasted too long → lost
      this.state = 'RETURN';
    }
    if (!this.captured && (this.state === 'WATCH' || this.state === 'RETURN')) {
      const seen = active
        .filter((t) => !t.missed && t.points.filter((p) => !p.coasted).length >= 3 && this.inGate(this.full(t), this.gate))
        .sort((a, b) => dist(this.full(a), this.gate) - dist(this.full(b), this.gate));
      if (seen[0]) { this.captured = seen[0]; this.targetSpeed = Math.hypot(seen[0].vx, seen[0].vy) * f; }
    }

    let target: SeekerView['target'];
    let aim: SeekerView['aim'];
    let path: Point[] = [];
    if (this.captured) {
      const t = this.captured;
      this.state = t.missed ? 'COAST' : 'CAPTURED';
      const pos = this.full(t);
      const vx = t.vx * f, vy = t.vy * f;
      if (!t.missed) this.targetSpeed = 0.8 * this.targetSpeed + 0.2 * Math.hypot(vx, vy);
      const last = t.points.filter((p) => !p.coasted).at(-1);
      target = { ...pos, vx, vy, speed: this.targetSpeed * fps, size: last ? Math.max(last.w, last.h) * f : f * 2 };
      // the gate holds the target: centre it on the target, but keep the whole gate inside the frame
      const h = this.o.gate / 2;
      this.gate = { x: clamp(pos.x, h, W - h), y: clamp(pos.y, h, H - h) };
      ({ aim, path } = this.intercept(pos, vx, vy));
      this.moveSight(aim, this.o.ratio * this.targetSpeed);
    } else {
      // WATCH / RETURN: glide the gate and the sight back to the centre
      this.gate = approach(this.gate, this.centre, 20);
      this.moveSight({ ...this.centre }, 12);
      if (this.state === 'RETURN' && dist(this.gate, this.centre) < 1 && dist(this.sight, this.centre) < 1) this.state = 'WATCH';
    }

    const hit = !!target && dist(this.sight, target) <= Math.max(6, target.size / 2);
    if (hit && !this.hitting) this.hits++;
    this.hitting = hit;

    return {
      frame: out, index: this.index - 1, state: this.state,
      gate: { ...this.gate, size: this.o.gate }, sight: { ...this.sight },
      sightSpeed: (this.captured ? this.o.ratio * this.targetSpeed : 0) * fps,
      target, aim, path, hit, hits: this.hits, blobs: blobs ?? [],
    };
  }

  /**
   * Where to fly: walk the predicted path frame by frame (straight lines folded at the edges = bounces)
   * and take the first point the sight can reach by then: |P(t) − sight| ≤ sightSpeed·t.
   * If nothing is reachable within 3 s, aim at the point that comes closest to being reachable.
   */
  private intercept(p: Point, vx: number, vy: number) {
    const { width: W, height: H, fps } = this.o;
    const s = this.o.ratio * this.targetSpeed;
    const horizon = Math.round(3 * fps);
    const path: Point[] = [];
    let best: (Point & { t: number }) | undefined, bestGap = Infinity;
    for (let t = 1; t <= horizon; t++) {
      const q = { x: bounce(p.x + vx * t, W - 1)[0], y: bounce(p.y + vy * t, H - 1)[0] };
      path.push(q);
      const gap = dist(q, this.sight) - s * t;
      if (gap <= 0) return { aim: { ...q, t, reachable: true }, path };
      if (gap < bestGap) { bestGap = gap; best = { ...q, t }; }
    }
    return { aim: { ...(best ?? p), t: best?.t ?? 0, reachable: false }, path: path.slice(0, best?.t ?? 0) };
  }

  /** Move the sight towards `to` by at most `step` px (its speed limit per frame). */
  private moveSight(to: Point, step: number) {
    this.sight = approach(this.sight, to, step);
  }
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
function approach(from: Point, to: Point, step: number): Point {
  const d = dist(from, to);
  if (d <= step || d === 0) return { ...to };
  return { x: from.x + ((to.x - from.x) * step) / d, y: from.y + ((to.y - from.y) * step) / d };
}

// ---------------------------------------------------------------- drawing

const CYAN = rgb(34, 211, 238), MAGENTA = rgb(217, 70, 239), GREY = rgb(156, 163, 175);
const GATE_COLOR = { WATCH: COLORS.white, CAPTURED: COLORS.lock, COAST: COLORS.lost, RETURN: GREY } as const;

/** Draw the gate, the predicted path, the intercept point and the sight — everything comes from the view, i.e. from pixels. */
export function drawSeeker(cv: Canvas, v: SeekerView, ratio: number, debug = false) {
  const H = cv.height;
  if (debug) for (const b of v.blobs) cv.brackets(b.minX * 4 - 3, b.minY * 4 - 3, (b.maxX + 1) * 4 + 3, (b.maxY + 1) * 4 + 3, COLORS.white, 1, 0.35);

  // the gate: a square with tick marks in the middle of each side
  const g = v.gate, h = g.size / 2, col = GATE_COLOR[v.state];
  cv.rect(g.x - h, g.y - h, g.x + h, g.y + h, COLORS.black, 4);
  cv.rect(g.x - h, g.y - h, g.x + h, g.y + h, col, 2);
  for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) cv.line(g.x + dx * h, g.y + dy * h, g.x + dx * h * 0.75, g.y + dy * h * 0.75, col, 2);
  cv.text(g.x - h, g.y - h - 22, v.state, col, 3);

  // predicted path of the target and the intercept point
  if (v.target && v.aim) {
    v.path.forEach((p, i) => { if (i % 2 === 0) cv.dot(p.x, p.y, COLORS.lock, 3); });
    cv.line(v.sight.x, v.sight.y, v.aim.x, v.aim.y, CYAN, 1);
    cv.line(v.aim.x - 8, v.aim.y - 8, v.aim.x + 8, v.aim.y + 8, MAGENTA, 3);
    cv.line(v.aim.x - 8, v.aim.y + 8, v.aim.x + 8, v.aim.y - 8, MAGENTA, 3);
    cv.text(v.aim.x + 12, v.aim.y + 10, v.aim.reachable ? `T-${(v.aim.t / 30).toFixed(1)}S` : 'CHASE', MAGENTA, 2);
  }

  // the sight
  cv.crosshair(v.sight.x, v.sight.y, 16, v.hit ? COLORS.search : CYAN);
  if (v.hit) { cv.circle(v.sight.x, v.sight.y, 30, COLORS.search, 3); cv.text(v.sight.x + 34, v.sight.y - 30, 'HIT', COLORS.search, 4); }

  const t = v.target ? `TARGET ${Math.round(v.target.speed)} PX/S  SIGHT ${Math.round(v.sightSpeed)} PX/S (${ratio}X)` : 'WATCHING THE CENTRE';
  cv.text(16, H - 36, `SEEKER  ${v.state}  ${t}  HITS ${v.hits}`, COLORS.white, 3);
}
