/**
 * Pixel work on I420 frames — what WebRTC hands out (I420 = yuv420p: Y plane, then U, then V at half size).
 * Everything edits the frame in place; no ffmpeg, no canvas.
 */
import { Readable } from 'node:stream';
import { ffmpegStream } from './ffmpeg.js';

/** A Buffer view over a frame's bytes (no copy), so Canvas & co. can edit it. */
export const bufferOf = (data: Uint8Array | Uint8ClampedArray) => Buffer.from(data.buffer, data.byteOffset, data.byteLength);

const planes = (w: number, h: number) => {
  if (w % 2 || h % 2) throw new Error(`I420 needs even width and height, got ${w}x${h}`);
  return { y: 0, u: w * h, v: w * h + (w / 2) * (h / 2), end: (w * h * 3) / 2 };
};

// ---------------------------------------------------------------- effects

export const I420_EFFECTS = ['gray', 'negate', 'mirror', 'edges'] as const;
export type I420Effect = (typeof I420_EFFECTS)[number];

/** Apply an effect; `split` keeps the left half original (before / after). */
export function applyEffect(f: Buffer, w: number, h: number, effect: I420Effect, split = false) {
  const keep = split ? copyLeftHalf(f, w, h) : undefined;
  if (effect === 'gray') gray(f, w, h);
  else if (effect === 'negate') negate(f, w, h);
  else if (effect === 'mirror') mirror(f, w, h);
  else if (effect === 'edges') edges(f, w, h);
  if (keep) keep();
}

/** Colour off: chroma to neutral. */
function gray(f: Buffer, w: number, h: number) {
  const p = planes(w, h);
  f.fill(128, p.u, p.end);
}

/** Photographic negative: every byte mirrored (works for limited and full range; chroma flips around 128). */
function negate(f: Buffer, w: number, h: number) {
  const p = planes(w, h);
  for (let i = 0; i < p.end; i++) f[i] = 255 - f[i];
}

/** Flip every row of every plane. */
function mirror(f: Buffer, w: number, h: number) {
  const p = planes(w, h);
  const flip = (start: number, rowLen: number, rows: number) => {
    for (let r = 0; r < rows; r++) f.subarray(start + r * rowLen, start + (r + 1) * rowLen).reverse();
  };
  flip(p.y, w, h); flip(p.u, w / 2, h / 2); flip(p.v, w / 2, h / 2);
}

/** Sobel edge magnitude on Y, shown white on black. */
function edges(f: Buffer, w: number, h: number) {
  const src = Uint8Array.from(f.subarray(0, w * h));
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = -src[i - w - 1] - 2 * src[i - 1] - src[i + w - 1] + src[i - w + 1] + 2 * src[i + 1] + src[i + w + 1];
      const gy = -src[i - w - 1] - 2 * src[i - w] - src[i - w + 1] + src[i + w - 1] + 2 * src[i + w] + src[i + w + 1];
      f[i] = Math.min(235, 16 + Math.abs(gx) + Math.abs(gy));
    }
  }
  gray(f, w, h);
}

/** Save the left half of every plane; the returned function puts it back. */
function copyLeftHalf(f: Buffer, w: number, h: number) {
  const p = planes(w, h);
  const saved: { at: number; bytes: Buffer }[] = [];
  const keepRows = (start: number, rowLen: number, rows: number) => {
    for (let r = 0; r < rows; r++) saved.push({ at: start + r * rowLen, bytes: Buffer.from(f.subarray(start + r * rowLen, start + r * rowLen + rowLen / 2)) });
  };
  keepRows(p.y, w, h); keepRows(p.u, w / 2, h / 2); keepRows(p.v, w / 2, h / 2);
  return () => { for (const s of saved) s.bytes.copy(f, s.at); };
}

// ---------------------------------------------------------------- overlay (a PNG with alpha)

export interface Overlay { width: number; height: number; y: Uint8Array; u: Uint8Array; v: Uint8Array; a: Uint8Array }

/** Decode a PNG once with ffmpeg into yuva420p at `width` px (height keeps the aspect, both even). */
export async function loadOverlay(png: string, width: number): Promise<Overlay> {
  const probe = ffmpegStream(Readable.from([]), ['-i', png, '-vf', `scale=${width}:-2,format=yuva420p`, '-f', 'rawvideo', '-pix_fmt', 'yuva420p', 'pipe:1']);
  const parts: Buffer[] = [];
  for await (const c of probe) parts.push(c as Buffer);
  const raw = Buffer.concat(parts);
  const w = width, ySize = raw.length / 2.5;                 // yuva420p: Y + U (¼) + V (¼) + A = 2.5 × W·H bytes
  const h = ySize / w;
  const c = (w / 2) * (h / 2);
  return { width: w, height: h, y: raw.subarray(0, ySize), u: raw.subarray(ySize, ySize + c), v: raw.subarray(ySize + c, ySize + 2 * c), a: raw.subarray(ySize + 2 * c) };
}

/** Alpha-blend `o` onto the frame with its top-left corner at (x, y), times `opacity`. */
export function blend(f: Buffer, w: number, h: number, o: Overlay, x: number, y: number, opacity = 0.8) {
  const p = planes(w, h);
  x = Math.max(0, Math.min(w - o.width, Math.round(x / 2) * 2));
  y = Math.max(0, Math.min(h - o.height, Math.round(y / 2) * 2));
  for (let oy = 0; oy < o.height; oy++) {
    for (let ox = 0; ox < o.width; ox++) {
      const a = (o.a[oy * o.width + ox] / 255) * opacity;
      if (!a) continue;
      const i = (y + oy) * w + x + ox;
      f[i] = f[i] + (o.y[oy * o.width + ox] - f[i]) * a;
      if (!(ox & 1) && !(oy & 1)) {
        const ci = ((y + oy) >> 1) * (w >> 1) + ((x + ox) >> 1), oc = (oy >> 1) * (o.width >> 1) + (ox >> 1);
        f[p.u + ci] = f[p.u + ci] + (o.u[oc] - f[p.u + ci]) * a;
        f[p.v + ci] = f[p.v + ci] + (o.v[oc] - f[p.v + ci]) * a;
      }
    }
  }
}

// ---------------------------------------------------------------- latency stamp

/**
 * The page writes a timestamp into every frame it sends: a strip of black/white blocks at the bottom-left
 * (1 white + 1 black pilot block, then 16 bits of `ms mod 65536`, MSB first). When the frame comes back,
 * the page reads the blocks again → round-trip latency. Processing must not destroy the strip, so
 * servers save it before touching the frame and put it back afterwards.
 */
export const STAMP = { block: 16, bits: 16 } as const;
const stampRect = (w: number, h: number) => ({ x1: Math.min(w, (STAMP.bits + 2) * STAMP.block), y0: Math.max(0, h - STAMP.block) });

export function saveStamp(f: Buffer, w: number, h: number): () => void {
  const p = planes(w, h), r = stampRect(w, h);
  const rows: { at: number; bytes: Buffer }[] = [];
  for (let y = r.y0; y < h; y++) rows.push({ at: y * w, bytes: Buffer.from(f.subarray(y * w, y * w + r.x1)) });
  for (let y = r.y0 >> 1; y < h >> 1; y++) {
    for (const base of [p.u, p.v]) rows.push({ at: base + y * (w >> 1), bytes: Buffer.from(f.subarray(base + y * (w >> 1), base + y * (w >> 1) + (r.x1 >> 1))) });
  }
  return () => { for (const s of rows) s.bytes.copy(f, s.at); };
}

// ---------------------------------------------------------------- picture-in-picture

export interface PipOptions {
  mirror?: boolean;             // flip horizontally (a selfie camera looks natural mirrored)
  circle?: boolean;             // round window instead of a rectangle
}

/**
 * Scale the I420 frame `src` (sw×sh) into the rectangle (x, y, w, h) of `dst` (W×H): bilinear on Y,
 * nearest on U/V (half resolution anyway). Cover-fit: the source is cropped to the window's aspect ratio,
 * never stretched. With `circle`, only the pixels inside the inscribed ellipse are written.
 */
export function drawScaled(dst: Buffer, W: number, H: number, src: Buffer, sw: number, sh: number,
  x: number, y: number, w: number, h: number, o: PipOptions = {}) {
  const d = planes(W, H), s = planes(sw, sh);
  x = Math.round(x / 2) * 2; y = Math.round(y / 2) * 2; w = Math.round(w / 2) * 2; h = Math.round(h / 2) * 2;
  // cover-fit crop of the source
  const scale = Math.max(w / sw, h / sh);
  const cw = w / scale, ch = h / scale, cx = (sw - cw) / 2, cy = (sh - ch) / 2;
  const inside = (px: number, py: number) => {
    if (!o.circle) return true;
    const nx = (px + 0.5 - w / 2) / (w / 2), ny = (py + 0.5 - h / 2) / (h / 2);
    return nx * nx + ny * ny <= 1;
  };
  for (let py = 0; py < h; py++) {
    const ty = y + py;
    if (ty < 0 || ty >= H) continue;
    const fy = cy + ((py + 0.5) * ch) / h - 0.5;
    const y0 = Math.max(0, Math.min(sh - 1, Math.floor(fy))), y1 = Math.min(sh - 1, y0 + 1), wy = Math.min(1, Math.max(0, fy - y0));
    for (let px = 0; px < w; px++) {
      const tx = x + px;
      if (tx < 0 || tx >= W || !inside(px, py)) continue;
      const qx = o.mirror ? w - 1 - px : px;
      const fx = cx + ((qx + 0.5) * cw) / w - 0.5;
      const x0 = Math.max(0, Math.min(sw - 1, Math.floor(fx))), x1 = Math.min(sw - 1, x0 + 1), wx = Math.min(1, Math.max(0, fx - x0));
      const a = src[y0 * sw + x0], b = src[y0 * sw + x1], c = src[y1 * sw + x0], e = src[y1 * sw + x1];
      dst[ty * W + tx] = (a * (1 - wx) + b * wx) * (1 - wy) + (c * (1 - wx) + e * wx) * wy;
      if (!(tx & 1) && !(ty & 1)) {
        const sc = (Math.min(sh - 1, Math.round(fy)) >> 1) * (sw >> 1) + (Math.min(sw - 1, Math.round(fx)) >> 1);
        const dc = (ty >> 1) * (W >> 1) + (tx >> 1);
        dst[d.u + dc] = src[s.u + sc];
        dst[d.v + dc] = src[s.v + sc];
      }
    }
  }
}
