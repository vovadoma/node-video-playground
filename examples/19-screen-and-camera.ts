/**
 * 19 — Screen + camera: the browser sends two tracks — the screen and a camera — and Node composes them into one picture, the screen with a camera window in the corner, streamed back and recordable.
 *
 *   npm run screen-camera        # then open http://127.0.0.1:3019 in a normal browser window
 *
 *   screen ─▶ browser ══ track 1 (sendrecv) ══▶ Node ─ I420 ─┐
 *   camera ─▶ browser ══ track 2 (sendonly) ══▶ Node ─ latest frame ─┴─▶ compose ─▶ FrameModes ══▶ browser
 *                                                                              └─▶ FrameRecorder ─▶ output/screen-camera/*.mp4
 *
 * One peer connection, two video m-lines. src/lib/rtc-wrtc.ts treats the first as the main picture (and
 * sends the result back on it) and keeps the latest frame of the second in peer.extras. For every screen
 * frame the compose hook below scales that camera frame into a window (src/lib/i420.ts drawScaled:
 * bilinear, cover-fit, optional mirror, rectangle or circle) and draws a frame around it. The two tracks
 * are not synchronised — the window simply shows the camera's newest frame, as streaming tools do.
 *
 * Page controls: camera for the window (or none), corner, size, shape, mirror. Any mode still applies on
 * top (e.g. effects → the whole composition in grayscale), and Record saves what goes back.
 */
import path from 'node:path';
import { OUTPUT_DIR, SAMPLES_DIR } from '../src/lib/config.js';
import { Canvas, COLORS } from '../src/lib/draw.js';
import { drawScaled } from '../src/lib/i420.js';
import { recordingHooks } from '../src/lib/recorder.js';
import { startRtcServer } from '../src/lib/rtc-server.js';
import { answerWithWrtc, type WrtcPeer } from '../src/lib/rtc-wrtc.js';

const DIR = path.join(OUTPUT_DIR, 'screen-camera');
const SIZES = [15, 20, 25, 33];               // window width, % of the screen width
const STAMP_H = 16;                            // the page's latency strip at the bottom-left — keep clear of it

/** Paste the newest camera frame into the screen frame. */
function compose(frame: Buffer, W: number, H: number, peer: WrtcPeer) {
  const p = peer.params as { pipOn?: boolean; pipPos?: string; pipSize?: number; pipShape?: string; pipMirror?: boolean };
  const cam = peer.extras[0];
  if (!p.pipOn || !cam || Date.now() - cam.at > 2000) return;         // no camera, or it stalled

  const circle = p.pipShape === 'circle';
  const pct = SIZES.includes(Number(p.pipSize)) ? Number(p.pipSize) : 25;
  const w = Math.round((W * pct) / 100 / 2) * 2;
  const h = circle ? w : Math.round((w * cam.height) / cam.width / 2) * 2;
  const m = Math.round(W * 0.02);
  const right = p.pipPos === 'br' || p.pipPos === 'tr' || !p.pipPos;
  const bottom = p.pipPos === 'br' || p.pipPos === 'bl' || !p.pipPos;
  const x = right ? W - w - m : m;
  const y = bottom ? H - h - m - (right ? 0 : STAMP_H) : m;

  drawScaled(frame, W, H, cam.data, cam.width, cam.height, x, y, w, h, { mirror: p.pipMirror !== false, circle });
  const cv = new Canvas(frame, W, H);
  if (circle) cv.circle(x + w / 2, y + h / 2, w / 2, COLORS.white, 3);
  else cv.rect(x - 1, y - 1, x + w, y + h, COLORS.white, 3);
}

const recording = recordingHooks(DIR);

await startRtcServer({
  title: 'Screen + camera',
  subtitle: 'Share a screen and a camera at once: Node puts the camera into a window on top of the screen and sends one picture back — the way streaming tools compose a scene. Record it on the server.',
  flow: 'screen ══ track 1 ══▶ Node ┐  camera ══ track 2 ══▶ Node ┴─▶ compose (camera window) ─▶ FrameModes ══▶ browser  ·  ─▶ output/screen-camera/*.mp4',
  port: Number(process.env.RTC_PORT ?? 3019),
  root: SAMPLES_DIR,
  recordings: DIR,
  pip: true,
  defaults: { source: 'screen', mode: 'frames' },
  answer: (offer) => answerWithWrtc(offer, { ...recording, compose }),
});
