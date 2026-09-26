/**
 * What the WebRTC examples (15–18) do to a frame on the server, by mode. Frames are I420 Buffers;
 * the page's latency stamp (bottom-left strip, see i420.ts) is saved before and restored after.
 *
 *   forward    the engine sends the received video straight back (not handled here)
 *   frames     through Node untouched — shows what decoding + re-encoding alone costs
 *   effects    grayscale / negative / mirror / edges, optionally before / after
 *   watermark  the project logo blended into the corner
 *   tracker    the Seeker from example 14: capture square + intercepting sight on whatever moves
 *   changes    boxes around the areas that changed since the previous frame (what a screen-sharing codec
 *              calls dirty rectangles) + the share of the picture that changed
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Canvas, COLORS } from './draw.js';
import { applyEffect, blend, I420_EFFECTS, loadOverlay, saveStamp, type I420Effect, type Overlay } from './i420.js';
import { drawSeeker, Seeker } from './intercept.js';
import { components, dilate, lumaDown, type Gray } from './motion.js';

export const RTC_MODES = ['forward', 'frames', 'effects', 'watermark', 'tracker', 'changes'] as const;
export type RtcMode = (typeof RTC_MODES)[number];

export interface RtcParams {
  effect?: I420Effect;
  split?: boolean;
  ratio?: number;               // tracker: sight speed / target speed
  fps?: number;                 // what the page sends — the tracker converts px/frame to px/s with it
}

const LOGO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'examples', 'assets', 'watermark.png');

export class FrameModes {
  private overlays = new Map<number, Promise<Overlay>>();
  private overlay?: { width: number; o: Overlay };
  private seeker?: { key: string; s: Seeker };
  private previous?: Gray;
  private changed = 0;                          // smoothed share of the picture that changed

  /** Returns the frame to send (the tracker returns the previous one — it needs t+1 to see motion at t), or null. */
  process(frame: Buffer, w: number, h: number, mode: RtcMode, p: RtcParams, fps = p.fps || 30): Buffer | null {
    if (mode === 'forward' || mode === 'frames') return frame;
    if (mode === 'tracker') {
      const key = `${w}x${h}:${p.ratio ?? 0.6}:${fps}`;
      if (this.seeker?.key !== key) this.seeker = { key, s: new Seeker({ width: w, height: h, fps, ratio: p.ratio ?? 0.6 }) };
      const view = this.seeker.s.push(Buffer.from(frame));          // a copy: the engine may reuse its buffer
      if (!view) return null;
      const restore = saveStamp(view.frame, w, h);
      drawSeeker(new Canvas(view.frame, w, h), view, p.ratio ?? 0.6);
      restore();
      return view.frame;
    }
    const restore = saveStamp(frame, w, h);
    if (mode === 'changes') this.drawChanges(frame, w, h);
    if (mode === 'effects') applyEffect(frame, w, h, I420_EFFECTS.includes(p.effect as I420Effect) ? (p.effect as I420Effect) : 'gray', p.split);
    if (mode === 'watermark') {
      const o = this.logo(Math.round(w / 4 / 2) * 2);
      if (o) blend(frame, w, h, o, w - o.width - w / 40, h - o.height - h / 20 - 16, 0.85);
    }
    restore();
    return frame;
  }

  /**
   * Dirty rectangles: compare a small grey copy (8×8 blocks) with the previous frame, join changed blocks
   * into regions and outline each one. The latency stamp changes every frame — it is left out.
   */
  private drawChanges(frame: Buffer, w: number, h: number) {
    const f = 8;
    const g = lumaDown(frame, w, h, f);
    const prev = this.previous?.width === g.width && this.previous.height === g.height ? this.previous : undefined;
    this.previous = g;
    if (!prev) return;
    const bin = new Uint8Array(g.data.length);
    const stampRows = Math.ceil(16 / f), stampCols = Math.ceil((18 * 16) / f);
    let n = 0;
    for (let i = 0; i < bin.length; i++) {
      const x = i % g.width, y = (i / g.width) | 0;
      if (y >= g.height - stampRows && x < stampCols) continue;       // the page's timestamp strip
      if (Math.abs(g.data[i] - prev.data[i]) > 6) { bin[i] = 1; n++; }
    }
    this.changed = this.changed * 0.8 + (n / bin.length) * 0.2;
    const cv = new Canvas(frame, w, h);
    for (const b of components(dilate(bin, g.width, g.height), g.width, g.height, 1)) {
      cv.rect(b.minX * f, b.minY * f, (b.maxX + 1) * f - 1, (b.maxY + 1) * f - 1, COLORS.search, 2);
    }
    cv.text(16, 16, `CHANGED ${(this.changed * 100).toFixed(1)}%`, n ? COLORS.search : COLORS.lock, 3);
  }

  /** The logo at `width` px — decoded once in the background; until it is ready frames go out without it. */
  private logo(width: number): Overlay | undefined {
    if (this.overlay?.width === width) return this.overlay.o;
    if (!this.overlays.has(width)) {
      const load = loadOverlay(LOGO, width);
      this.overlays.set(width, load);
      load.then((o) => { this.overlay = { width, o }; }, (e) => console.error(`watermark: ${e.message}`));
    }
    return undefined;
  }
}
