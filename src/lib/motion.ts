/**
 * Motion detection and tracking on small grayscale frames — plain TypeScript, no OpenCV.
 *
 *   frame ─▶ motionFrame() (e.g. 1280×720 → 320×180, Y + U + V)
 *         ─▶ MotionDetector: three-frame difference  |f(t)−f(t−1)| AND |f(t+1)−f(t)|  (minus flicker mask)
 *            where |Δ| = max(|ΔY|, |ΔU|, |ΔV|) — colour counts too: a blue dot on a red bar can have
 *            the same brightness as the bar and only differ in chroma
 *         ─▶ components(): connected "blobs" with area, bbox, centroid
 *         ─▶ Tracker: links blobs frame to frame (α-β filter: position + velocity, gated nearest neighbour)
 *         ─▶ trackStats() / scoreTrack(): how small, fast, long-lived and isolated each track is
 *
 * Why three frames: the plain difference of two frames lights up a fast object twice — where it was
 * and where it is. ANDing two consecutive differences keeps only where it is at t (1 frame of delay).
 */

export interface Gray {
  width: number;
  height: number;
  data: Uint8Array;             // Y
  u?: Uint8Array;               // chroma at the same small size (motionFrame only)
  v?: Uint8Array;
}

/** Average f×f blocks of the Y plane of a yuv420p frame → a small grayscale image. */
export function lumaDown(frame: Buffer, width: number, height: number, f: number): Gray {
  const w = Math.floor(width / f), h = Math.floor(height / f);
  const out = new Uint8Array(w * h);
  const n = f * f;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let dy = 0; dy < f; dy++) {
        const row = (y * f + dy) * width + x * f;
        for (let dx = 0; dx < f; dx++) sum += frame[row + dx];
      }
      out[y * w + x] = sum / n;
    }
  }
  return { width: w, height: h, data: out };
}

/** Like lumaDown, plus U and V averaged to the same small size (chroma planes are half-size already). */
export function motionFrame(frame: Buffer, width: number, height: number, f: number): Gray {
  if (f % 2) throw new Error(`motionFrame: factor must be even (chroma is half-size), got ${f}`);
  const g = lumaDown(frame, width, height, f);
  const cw = width / 2, cf = f / 2, n = cf * cf;
  const u0 = width * height, v0 = u0 + cw * (height / 2);
  const u = new Uint8Array(g.width * g.height), v = new Uint8Array(g.width * g.height);
  for (let y = 0; y < g.height; y++) {
    for (let x = 0; x < g.width; x++) {
      let su = 0, sv = 0;
      for (let dy = 0; dy < cf; dy++) {
        const row = (y * cf + dy) * cw + x * cf;
        for (let dx = 0; dx < cf; dx++) { su += frame[u0 + row + dx]; sv += frame[v0 + row + dx]; }
      }
      u[y * g.width + x] = su / n; v[y * g.width + x] = sv / n;
    }
  }
  return { ...g, u, v };
}

/**
 * Per-pixel change between two small frames: the largest of the Y, U and V differences. Chroma counts
 * half — compression smears colour around moving edges, while a real colour change is big.
 */
const CHROMA_WEIGHT = 0.5;
function change(a: Gray, b: Gray, i: number): number {
  let d = Math.abs(a.data[i] - b.data[i]);
  if (a.u && b.u) d = Math.max(d, CHROMA_WEIGHT * Math.abs(a.u[i] - b.u[i]));
  if (a.v && b.v) d = Math.max(d, CHROMA_WEIGHT * Math.abs(a.v[i] - b.v[i]));
  return d;
}

/** Mean Y/U/V of a square of radius r (full-resolution pixels) around (cx, cy) in a yuv420p frame. */
export function colorAt(frame: Buffer, width: number, height: number, cx: number, cy: number, r: number) {
  const yPlane = 0, uPlane = width * height, vPlane = uPlane + (width / 2) * (height / 2);
  let y = 0, u = 0, v = 0, n = 0;
  for (let py = Math.max(0, Math.round(cy - r)); py <= Math.min(height - 1, Math.round(cy + r)); py++) {
    for (let px = Math.max(0, Math.round(cx - r)); px <= Math.min(width - 1, Math.round(cx + r)); px++) {
      const c = (py >> 1) * (width / 2) + (px >> 1);
      y += frame[yPlane + py * width + px]; u += frame[uPlane + c]; v += frame[vPlane + c]; n++;
    }
  }
  return n ? { y: y / n, u: u / n, v: v / n } : { y: 0, u: 128, v: 128 };
}

// ---------------------------------------------------------------- blobs

export interface Blob {
  x: number;                    // centroid, small-image pixels
  y: number;
  area: number;                 // small-image pixels
  minX: number; minY: number; maxX: number; maxY: number;
}

/** 8-connected components of a binary image (1 = motion). Blobs smaller than minArea are dropped. */
export function components(bin: Uint8Array, w: number, h: number, minArea = 1): Blob[] {
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const blobs: Blob[] = [];
  for (let start = 0; start < w * h; start++) {
    if (!bin[start] || seen[start]) continue;
    let top = 0, area = 0, sx = 0, sy = 0;
    let minX = w, minY = h, maxX = 0, maxY = 0;
    stack[top++] = start;
    seen[start] = 1;
    while (top) {
      const i = stack[--top];
      const x = i % w, y = (i / w) | 0;
      area++; sx += x; sy += y;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          const j = ny * w + nx;
          if (bin[j] && !seen[j]) { seen[j] = 1; stack[top++] = j; }
        }
      }
    }
    if (area >= minArea) blobs.push({ x: sx / area, y: sy / area, area, minX, minY, maxX, maxY });
  }
  return blobs;
}

/** 3×3 dilation: joins fragments of one object that thresholding split apart. */
export function dilate(bin: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!bin[y * w + x]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx >= 0 && nx < w) out[ny * w + nx] = 1;
        }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- flicker map (pass 1)

/**
 * Counts, per pixel, in how many frames it changed. Things that MOVE touch a pixel only now and then;
 * things that FLICKER in place (noise, a running timecode) change it almost every frame → mask them.
 */
export class FlickerMap {
  private counts: Uint32Array;
  private prev?: Gray;
  frames = 0;

  constructor(readonly width: number, readonly height: number, private readonly threshold: number) {
    this.counts = new Uint32Array(width * height);
  }

  add(g: Gray) {
    if (this.prev) {
      for (let i = 0; i < g.data.length; i++) if (change(g, this.prev, i) > this.threshold) this.counts[i]++;
      this.frames++;
    }
    this.prev = g;
  }

  /** 0…1 per pixel: share of frames in which it changed. */
  frequency(): Float32Array {
    const f = new Float32Array(this.counts.length);
    for (let i = 0; i < f.length; i++) f[i] = this.frames ? this.counts[i] / this.frames : 0;
    return f;
  }

  /** 1 = ignore this pixel. Pixels changing in more than `share` of frames, grown by one pixel. */
  mask(share = 0.35): Uint8Array {
    const f = this.frequency();
    const bin = new Uint8Array(f.length);
    for (let i = 0; i < f.length; i++) bin[i] = f[i] > share ? 1 : 0;
    return dilate(bin, this.width, this.height);
  }
}

// ---------------------------------------------------------------- detector (pass 2 and live)

/**
 * Feed small gray frames one by one; from the third frame on, returns the blobs of the frame BEFORE
 * the one just pushed (three-frame difference needs t−1, t and t+1).
 */
export class MotionDetector {
  private history: Gray[] = [];

  constructor(readonly width: number, readonly height: number, private readonly opts: { threshold: number; mask?: Uint8Array; minArea?: number }) {}

  push(g: Gray): Blob[] | null {
    this.history.push(g);
    if (this.history.length > 3) this.history.shift();
    if (this.history.length < 3) return null;
    const [a, b, c] = this.history;
    const { threshold: t, mask } = this.opts;
    const bin = new Uint8Array(a.data.length);
    for (let i = 0; i < bin.length; i++) {
      if (mask?.[i]) continue;
      if (change(b, a, i) > t && change(c, b, i) > t) bin[i] = 1;
    }
    return components(dilate(bin, this.width, this.height), this.width, this.height, this.opts.minArea ?? 2);
  }
}

// ---------------------------------------------------------------- tracker

export interface TrackPoint {
  f: number;                    // frame index
  x: number; y: number;         // filtered position (small px)
  area: number;
  w: number; h: number;         // bbox (small px)
  neighbours: number;           // other blobs within the isolation radius at that moment
  coasted?: boolean;            // no measurement — position is the prediction
}

export interface Track {
  id: number;
  x: number; y: number;         // current filtered position
  vx: number; vy: number;       // px / frame
  missed: number;               // frames since the last measurement
  points: TrackPoint[];
  color?: { y: number; u: number; v: number; n: number };
}

export interface TrackerOptions {
  gate: number;                 // base search radius (small px) around the prediction
  maxMissed: number;            // frames a track may coast before it ends
  isolationRadius: number;      // small px
  alpha?: number;               // α-β filter gains: how much to trust the measurement
  beta?: number;
  /** Frame size (small px): predictions that leave the frame are mirrored back — objects bounce off edges. */
  bounds?: { w: number; h: number };
}

/**
 * Multi-object tracker: predict every track (x + v), match blobs to predictions greedily by distance
 * within a gate that widens with speed, correct with an α-β filter, start tracks for unmatched blobs.
 */
export class Tracker {
  active: Track[] = [];
  finished: Track[] = [];
  private nextId = 1;

  constructor(private readonly o: TrackerOptions) {}

  /** Where t should be k frames ahead; with bounds, mirrored at the edges (fx/fy = velocity flipped). */
  private predict(t: Track, k: number) {
    const b = this.o.bounds;
    if (!b) return { px: t.x + t.vx * k, py: t.y + t.vy * k, fx: false, fy: false };
    const [px, fx] = bounce(t.x + t.vx * k, b.w - 1);
    const [py, fy] = bounce(t.y + t.vy * k, b.h - 1);
    return { px, py, fx, fy };
  }

  update(f: number, blobs: Blob[]): Track[] {
    const { alpha = 0.85, beta = 0.5 } = this.o;
    const neighbours = blobs.map((b) => blobs.filter((o) => o !== b && Math.hypot(o.x - b.x, o.y - b.y) < this.o.isolationRadius).length);

    // all (track, blob) pairs inside the gate, nearest first
    const pairs: { t: Track; b: number; d: number }[] = [];
    for (const t of this.active) {
      const k = t.missed + 1;
      const { px, py } = this.predict(t, k);
      const gate = this.o.gate + Math.hypot(t.vx, t.vy) * 1.5 * k;
      blobs.forEach((b, i) => {
        const d = Math.hypot(b.x - px, b.y - py);
        if (d <= gate) pairs.push({ t, b: i, d });
      });
    }
    pairs.sort((p, q) => p.d - q.d);

    const usedTracks = new Set<Track>(), usedBlobs = new Set<number>();
    for (const { t, b: i } of pairs) {
      if (usedTracks.has(t) || usedBlobs.has(i)) continue;
      usedTracks.add(t); usedBlobs.add(i);
      const b = blobs[i], k = t.missed + 1;
      const { px, py, fx, fy } = this.predict(t, k);
      if (fx) t.vx = -t.vx;
      if (fy) t.vy = -t.vy;
      const rx = b.x - px, ry = b.y - py;
      t.x = px + alpha * rx; t.y = py + alpha * ry;
      t.vx += (beta * rx) / k; t.vy += (beta * ry) / k;
      t.missed = 0;
      t.points.push({ f, x: t.x, y: t.y, area: b.area, w: b.maxX - b.minX + 1, h: b.maxY - b.minY + 1, neighbours: neighbours[i] });
    }

    for (const t of this.active) {
      if (usedTracks.has(t)) continue;
      t.missed++;
      const { px, py, fx, fy } = this.predict(t, 1);
      t.x = px; t.y = py;
      if (fx) t.vx = -t.vx;
      if (fy) t.vy = -t.vy;
      t.points.push({ f, x: t.x, y: t.y, area: 0, w: 0, h: 0, neighbours: 0, coasted: true });
    }
    const ended = this.active.filter((t) => t.missed > this.o.maxMissed);
    for (const t of ended) t.points.splice(t.points.length - t.missed);   // drop the trailing guesses
    this.finished.push(...ended);
    this.active = this.active.filter((t) => t.missed <= this.o.maxMissed);

    blobs.forEach((b, i) => {
      if (usedBlobs.has(i)) return;
      this.active.push({
        id: this.nextId++, x: b.x, y: b.y, vx: 0, vy: 0, missed: 0,
        points: [{ f, x: b.x, y: b.y, area: b.area, w: b.maxX - b.minX + 1, h: b.maxY - b.minY + 1, neighbours: neighbours[i] }],
      });
    });
    return this.active;
  }

  all(): Track[] {
    return [...this.finished, ...this.active];
  }
}

/**
 * Fold a coordinate back into [0, max] as if it bounced off both walls any number of times
 * (a triangle wave); `flipped` = an odd number of bounces, i.e. the velocity is reversed.
 */
function bounce(p: number, max: number): [number, boolean] {
  if (max <= 0) return [0, false];
  const period = 2 * max;
  const m = ((p % period) + period) % period;
  const bounces = Math.floor(p / max);
  return [m <= max ? m : period - m, ((bounces % 2) + 2) % 2 === 1];
}

// ---------------------------------------------------------------- scoring

export interface TrackStats {
  id: number;
  frames: number;               // measured frames
  firstFrame: number;
  lastFrame: number;
  size: number;                 // median bbox side, full-res px
  area: number;                 // median area, full-res px²
  speed: number;                // median speed, full-res px / s
  maxSpeed: number;
  path: number;                 // travelled distance, full-res px
  isolation: number;            // 0…1: share of frames with no neighbouring blob
  bbox: { x0: number; y0: number; x1: number; y1: number };   // area it moved in, full-res px
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
};

/** Summarise a track in full-resolution units (`scale` = full px per small px). */
export function trackStats(t: Track, fps: number, scale: number): TrackStats {
  const pts = t.points.filter((p) => !p.coasted);
  const steps: number[] = [];
  let path = 0;
  for (let i = 1; i < t.points.length; i++) {
    const a = t.points[i - 1], b = t.points[i];
    const d = Math.hypot(b.x - a.x, b.y - a.y) * scale;
    path += d;
    steps.push(d * fps / (b.f - a.f || 1));
  }
  const xs = t.points.map((p) => p.x * scale), ys = t.points.map((p) => p.y * scale);
  return {
    id: t.id,
    frames: pts.length,
    firstFrame: t.points[0]?.f ?? 0,
    lastFrame: t.points.at(-1)?.f ?? 0,
    size: median(pts.map((p) => Math.max(p.w, p.h))) * scale,
    area: median(pts.map((p) => p.area)) * scale * scale,
    speed: median(steps),
    maxSpeed: Math.max(0, ...steps),
    path,
    isolation: pts.length ? pts.filter((p) => p.neighbours === 0).length / pts.length : 0,
    bbox: { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) },
  };
}

export interface ScoreRules {
  minFrames: number;            // long enough to be a real object, not noise
  maxSize: number;              // "small": bbox side ≤ this, full-res px
  fastSpeed: number;            // speed (full-res px/s) that counts as fully "fast"
}

/**
 * Small + fast + long-lived + alone = high score (0…1). Each factor is 0…1; a zero anywhere rejects.
 * Returns the factors too, so the report can say WHY a candidate won or lost.
 */
export function scoreTrack(s: TrackStats, r: ScoreRules) {
  const factors = {
    small: s.size <= r.maxSize ? 1 - 0.5 * (s.size / r.maxSize) : 0,
    fast: Math.min(1, s.speed / r.fastSpeed),
    long: s.frames >= r.minFrames ? Math.min(1, s.frames / (r.minFrames * 4)) : 0,
    alone: s.isolation,
  };
  return { score: factors.small * factors.fast * factors.long * factors.alone, factors };
}

// ---------------------------------------------------------------- live: follow one target

/** What we look for, from the offline analysis (relative units, so it survives a different frame size). */
export interface TargetProfile {
  size: number;                 // median bbox side / frame width
  speed: number;                // median speed (px/s) / frame width
  color?: { u: number; v: number };
}

export type TargetState = 'SEARCH' | 'LOCK' | 'LOST';

export interface TargetFix {
  state: TargetState;
  frame: Buffer;                // the frame this fix belongs to (one behind the input)
  index: number;
  x?: number; y?: number;       // full-res px (LOCK / LOST)
  speed?: number;               // full-res px/s
  match?: number;               // 0…1 how well the locked track fits the profile
  trackId?: number;
  trail: { x: number; y: number }[];
  candidates: number;           // tracks considered while searching
}

/**
 * Follows the one object that matches `profile`. SEARCH: among young tracks (≥ 3 measurements) pick the
 * best match by size, speed, colour and isolation → LOCK. LOCK: stay on that track; without a
 * measurement it coasts on its velocity (LOST) for up to `maxMissed` frames, then SEARCH again.
 */
export class TargetTracker {
  state: TargetState = 'SEARCH';
  /** Blobs of the frame the last fix belongs to (small-image px) — for showing what the detector sees. */
  blobs: Blob[] = [];
  private readonly small: { w: number; h: number };
  private readonly detector: MotionDetector;
  private readonly tracker: Tracker;
  private locked?: Track;
  private quality = 0;                          // running match of the locked track (clean measurements only)
  private clean = 0;                            // clean measurements since the lock
  private readonly rejected = new Map<number, number>();   // track id → frame until which it may not be locked again
  private prevFrame?: Buffer;
  private index = -1;

  constructor(
    private readonly width: number,
    private readonly height: number,
    private readonly factor: number,
    private readonly fps: number,
    private readonly profile: TargetProfile,
    opts: { threshold: number; mask?: Uint8Array; maxMissed?: number },
  ) {
    this.small = { w: Math.floor(width / factor), h: Math.floor(height / factor) };
    // (bounds for the tracker are the small image size)
    const mask = opts.mask?.length === this.small.w * this.small.h ? opts.mask : undefined;
    this.detector = new MotionDetector(this.small.w, this.small.h, { threshold: opts.threshold, mask });
    this.tracker = new Tracker({ gate: 4, maxMissed: opts.maxMissed ?? 8, isolationRadius: 8, bounds: this.small });
  }

  /**
   * How well a track fits the profile, 0…1: log-normal closeness of size and speed (both medians of the
   * last measurements — robust to a merged blob or a jerky filter), times "alone". Colour only helps
   * to pick among candidates when acquiring: once locked, the sampled colour often hits the background.
   */
  match(t: Track, frame: Buffer, withColor = true): number {
    const pts = t.points.filter((p) => !p.coasted).slice(-8);
    if (pts.length < 5) return 0;                // too young to judge its size and speed
    const close = (value: number, want: number, sigma: number) =>
      want > 0 && value > 0 ? Math.exp(-(Math.log(value / want) ** 2) / (2 * sigma * sigma)) : 0;
    const size = median(pts.map((p) => Math.max(p.w, p.h))) * this.factor / this.width;
    const steps = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y) / (p.f - pts[i].f || 1));
    const speed = median(steps) * this.factor * this.fps / this.width;
    let m = close(size, this.profile.size, 0.6) * close(speed, this.profile.speed, 0.7);
    m *= pts.filter((p) => p.neighbours === 0).length / pts.length;             // alone
    if (withColor && this.profile.color) {
      const c = colorAt(frame, this.width, this.height, (t.x + 0.5) * this.factor, (t.y + 0.5) * this.factor, this.factor);
      const d = Math.hypot(c.u - this.profile.color.u, c.v - this.profile.color.v);
      m *= 0.5 + 0.5 * Math.exp(-(d * d) / (2 * 40 * 40));                  // a hint, not a veto
    }
    return m;
  }

  /** Push the next decoded frame; returns the fix for the PREVIOUS frame (or null at the very start). */
  push(frame: Buffer): TargetFix | null {
    const g = motionFrame(frame, this.width, this.height, this.factor);
    const blobs = this.detector.push(g);
    const out = this.prevFrame;
    this.prevFrame = frame;
    this.index++;
    if (!out) return null;
    if (!blobs) return { state: this.state, frame: out, index: this.index - 1, trail: [], candidates: 0 };
    this.blobs = blobs;

    const active = this.tracker.update(this.index - 1, blobs);
    if (this.locked && !active.includes(this.locked)) this.locked = undefined;   // coasted too long
    if (this.locked && !this.locked.missed) {
      // Keep checking that we still follow the right thing — but only on clean measurements: when the
      // target crosses something bigger their blobs merge for a few frames, which is an occlusion, not
      // proof of a wrong lock. Drop a lock that keeps failing on clean frames (and don't retake it for ~3 s).
      const last = this.locked.points.at(-1)!;
      const size = Math.max(last.w, last.h) * this.factor / this.width;
      if (size < this.profile.size * 2.5 && size > this.profile.size / 2.5) {
        this.quality = 0.85 * this.quality + 0.15 * this.match(this.locked, out, false);
        this.clean++;
        if (this.clean > 10 && this.quality < 0.2) {
          this.rejected.set(this.locked.id, this.index + 3 * this.fps);
          this.locked = undefined;
        }
      }
    }

    let candidates = 0;
    if (!this.locked) {
      for (const [id, until] of this.rejected) if (until <= this.index) this.rejected.delete(id);
      let best: Track | undefined, bestM = 0.6;                                   // below = not our object
      for (const t of active) {
        if (t.missed || (this.rejected.get(t.id) ?? -1) > this.index) continue;
        candidates++;
        const m = this.match(t, out);
        if (m > bestM) { best = t; bestM = m; }
      }
      this.locked = best;
      this.quality = bestM;
      this.clean = 0;
    }

    const t = this.locked;
    this.state = !t ? 'SEARCH' : t.missed ? 'LOST' : 'LOCK';
    if (!t) return { state: this.state, frame: out, index: this.index - 1, trail: [], candidates };
    const full = (v: number) => (v + 0.5) * this.factor;
    return {
      state: this.state, frame: out, index: this.index - 1, candidates, trackId: t.id,
      x: full(t.x), y: full(t.y),
      speed: Math.hypot(t.vx, t.vy) * this.factor * this.fps,
      match: t.missed ? undefined : this.match(t, out, false),
      trail: t.points.slice(-30).map((p) => ({ x: full(p.x), y: full(p.y) })),
    };
  }
}
