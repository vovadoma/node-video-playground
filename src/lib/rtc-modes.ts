/**
 * What the WebRTC examples (15, 16) do to a frame on the server, by mode. Frames are I420 Buffers;
 * the page's latency stamp (bottom-left strip, see i420.ts) is saved before and restored after.
 *
 *   forward    the engine sends the received video straight back (not handled here)
 *   frames     through Node untouched — shows what decoding + re-encoding alone costs
 *   effects    grayscale / negative / mirror / edges, optionally before / after
 *   watermark  the project logo blended into the corner
 *   tracker    the Seeker from example 14: capture square + intercepting sight on whatever moves
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Canvas } from './draw.js';
import { applyEffect, blend, I420_EFFECTS, loadOverlay, saveStamp, type I420Effect, type Overlay } from './i420.js';
import { drawSeeker, Seeker } from './intercept.js';

export const RTC_MODES = ['forward', 'frames', 'effects', 'watermark', 'tracker'] as const;
export type RtcMode = (typeof RTC_MODES)[number];

export interface RtcParams {
  effect?: I420Effect;
  split?: boolean;
  ratio?: number;               // tracker: sight speed / target speed
}

const LOGO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'examples', 'assets', 'watermark.png');

export class FrameModes {
  private overlays = new Map<number, Promise<Overlay>>();
  private overlay?: { width: number; o: Overlay };
  private seeker?: { key: string; s: Seeker };

  /** Returns the frame to send (the tracker returns the previous one — it needs t+1 to see motion at t), or null. */
  process(frame: Buffer, w: number, h: number, mode: RtcMode, p: RtcParams, fps = 30): Buffer | null {
    if (mode === 'forward' || mode === 'frames') return frame;
    if (mode === 'tracker') {
      const key = `${w}x${h}:${p.ratio ?? 0.6}`;
      if (this.seeker?.key !== key) this.seeker = { key, s: new Seeker({ width: w, height: h, fps, ratio: p.ratio ?? 0.6 }) };
      const view = this.seeker.s.push(Buffer.from(frame));          // a copy: the engine may reuse its buffer
      if (!view) return null;
      const restore = saveStamp(view.frame, w, h);
      drawSeeker(new Canvas(view.frame, w, h), view, p.ratio ?? 0.6);
      restore();
      return view.frame;
    }
    const restore = saveStamp(frame, w, h);
    if (mode === 'effects') applyEffect(frame, w, h, I420_EFFECTS.includes(p.effect as I420Effect) ? (p.effect as I420Effect) : 'gray', p.split);
    if (mode === 'watermark') {
      const o = this.logo(Math.round(w / 4 / 2) * 2);
      if (o) blend(frame, w, h, o, w - o.width - w / 40, h - o.height - h / 20 - 16, 0.85);
    }
    restore();
    return frame;
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
