/**
 * Drawing straight into yuv420p frames (see src/lib/rawframes.ts for the layout) — enough for a
 * crosshair, boxes, trails and short labels. No canvas, no fonts: a pixel is Y at (x, y) plus the
 * shared U/V of its 2×2 block.
 */

export interface Yuv { y: number; u: number; v: number }

/** sRGB 0…255 → BT.601 limited-range YUV (what yuv420p video uses). */
export function rgb(r: number, g: number, b: number): Yuv {
  return {
    y: Math.round(16 + 0.257 * r + 0.504 * g + 0.098 * b),
    u: Math.round(128 - 0.148 * r - 0.291 * g + 0.439 * b),
    v: Math.round(128 + 0.439 * r - 0.368 * g - 0.071 * b),
  };
}

export const COLORS = {
  lock: rgb(34, 197, 94),       // green
  search: rgb(239, 68, 68),     // red
  lost: rgb(250, 204, 21),      // yellow
  white: rgb(255, 255, 255),
  black: rgb(0, 0, 0),
  accent: rgb(37, 99, 235),     // the project's blue
  palette: [rgb(250, 204, 21), rgb(56, 189, 248), rgb(244, 114, 182), rgb(163, 230, 53), rgb(251, 146, 60), rgb(167, 139, 250)],
};

export class Canvas {
  private readonly u0: number;
  private readonly v0: number;

  constructor(readonly frame: Buffer, readonly width: number, readonly height: number) {
    this.u0 = width * height;
    this.v0 = this.u0 + (width / 2) * (height / 2);
  }

  px(x: number, y: number, c: Yuv) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.frame[y * this.width + x] = c.y;
    const ci = (y >> 1) * (this.width >> 1) + (x >> 1);
    this.frame[this.u0 + ci] = c.u;
    this.frame[this.v0 + ci] = c.v;
  }

  /** A t×t square brush centred on (x, y). */
  dot(x: number, y: number, c: Yuv, t = 1) {
    const r = (t - 1) / 2;
    for (let dy = -Math.floor(r); dy <= Math.ceil(r); dy++) for (let dx = -Math.floor(r); dx <= Math.ceil(r); dx++) this.px(x + dx, y + dy, c);
  }

  line(x0: number, y0: number, x1: number, y1: number, c: Yuv, t = 1) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) this.dot(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, c, t);
  }

  circle(cx: number, cy: number, r: number, c: Yuv, t = 1) {
    const steps = Math.max(16, Math.ceil(2 * Math.PI * r));
    for (let i = 0; i < steps; i++) {
      const a = (2 * Math.PI * i) / steps;
      this.dot(cx + r * Math.cos(a), cy + r * Math.sin(a), c, t);
    }
  }

  rect(x0: number, y0: number, x1: number, y1: number, c: Yuv, t = 1) {
    this.line(x0, y0, x1, y0, c, t); this.line(x1, y0, x1, y1, c, t);
    this.line(x1, y1, x0, y1, c, t); this.line(x0, y1, x0, y0, c, t);
  }

  /** Only the corners of a box — reads as "detected" without hiding what's inside. */
  brackets(x0: number, y0: number, x1: number, y1: number, c: Yuv, t = 2, len = 0.3) {
    const lx = (x1 - x0) * len, ly = (y1 - y0) * len;
    for (const [x, y, sx, sy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) {
      this.line(x, y, x + sx * lx, y, c, t);
      this.line(x, y, x, y + sy * ly, c, t);
    }
  }

  /** Gun-sight: ring + four ticks with a gap in the middle + a centre dot, with a dark outline for contrast. */
  crosshair(x: number, y: number, r: number, c: Yuv) {
    for (const [col, t] of [[COLORS.black, 5], [c, 2]] as const) {
      this.circle(x, y, r, col, t);
      this.line(x - r * 1.6, y, x - r * 0.45, y, col, t); this.line(x + r * 0.45, y, x + r * 1.6, y, col, t);
      this.line(x, y - r * 1.6, x, y - r * 0.45, col, t); this.line(x, y + r * 0.45, x, y + r * 1.6, col, t);
    }
    this.dot(x, y, c, 3);
  }

  /** Darken and desaturate the whole frame (a background for drawings). */
  dim(amount = 0.45) {
    for (let i = 0; i < this.u0; i++) this.frame[i] = 16 + (this.frame[i] - 16) * amount;
    for (let i = this.u0; i < this.frame.length; i++) this.frame[i] = 128 + (this.frame[i] - 128) * amount;
  }

  /** Text in a 3×5 pixel font, each font pixel = `scale`×`scale`. Digits, A–Z and a few symbols. */
  text(x: number, y: number, s: string, c: Yuv, scale = 3, shadow = true) {
    if (shadow) this.text(x + scale, y + scale, s, COLORS.black, scale, false);
    let cx = x;
    for (const ch of s.toUpperCase()) {
      const g = FONT[ch];
      if (g) {
        for (let row = 0; row < 5; row++) {
          for (let col = 0; col < 3; col++) {
            if (!(g[row] & (4 >> col))) continue;
            for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) this.px(cx + col * scale + dx, y + row * scale + dy, c);
          }
        }
      }
      cx += 4 * scale;
    }
  }
}

/** 3×5 glyphs, one number per row, bit 4 = left column. */
const FONT: Record<string, number[]> = {
  '0': [7, 5, 5, 5, 7], '1': [2, 6, 2, 2, 7], '2': [7, 1, 7, 4, 7], '3': [7, 1, 3, 1, 7], '4': [5, 5, 7, 1, 1],
  '5': [7, 4, 7, 1, 7], '6': [7, 4, 7, 5, 7], '7': [7, 1, 2, 2, 2], '8': [7, 5, 7, 5, 7], '9': [7, 5, 7, 1, 7],
  A: [2, 5, 7, 5, 5], B: [6, 5, 6, 5, 6], C: [3, 4, 4, 4, 3], D: [6, 5, 5, 5, 6], E: [7, 4, 6, 4, 7], F: [7, 4, 6, 4, 4],
  G: [3, 4, 5, 5, 3], H: [5, 5, 7, 5, 5], I: [7, 2, 2, 2, 7], J: [1, 1, 1, 5, 2], K: [5, 5, 6, 5, 5], L: [4, 4, 4, 4, 7],
  M: [5, 7, 7, 5, 5], N: [6, 5, 5, 5, 5], O: [2, 5, 5, 5, 2], P: [6, 5, 6, 4, 4], Q: [2, 5, 5, 6, 3], R: [6, 5, 6, 5, 5],
  S: [3, 4, 2, 1, 6], T: [7, 2, 2, 2, 2], U: [5, 5, 5, 5, 7], V: [5, 5, 5, 5, 2], W: [5, 5, 7, 7, 5], X: [5, 5, 2, 5, 5],
  Y: [5, 5, 2, 2, 2], Z: [7, 1, 2, 4, 7],
  '#': [5, 7, 5, 7, 5], '.': [0, 0, 0, 0, 2], ':': [0, 2, 0, 2, 0], '/': [1, 1, 2, 4, 4], '-': [0, 0, 7, 0, 0], '%': [5, 1, 2, 4, 5],
  '(': [1, 2, 2, 2, 1], ')': [4, 2, 2, 2, 4], ',': [0, 0, 0, 2, 4], ' ': [0, 0, 0, 0, 0],
};
