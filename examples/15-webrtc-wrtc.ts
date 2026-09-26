/**
 * 15 — WebRTC echo (wrtc): the browser sends its camera (or a sample video) to Node over WebRTC and gets it back — as is or processed frame by frame.
 *
 *   npm run webrtc               # then open http://127.0.0.1:3015
 *
 *   browser ══ SRTP (VP8/H.264) ══▶ Node: RTCPeerConnection ─▶ RTCVideoSink ─ I420 frame ─▶ your code
 *   browser ◀═══════════════════════ RTCVideoSource ◀──────────────────────────────────────┘
 *
 * @roamhq/wrtc is Google's libwebrtc as a Node addon: it does ICE, DTLS/SRTP, jitter buffer, decoding and
 * encoding; its non-standard RTCVideoSink / RTCVideoSource hand us raw I420 frames — the same yuv420p the
 * other examples draw on — so the effects, the watermark and the seeker of example 14 just work here.
 *
 * Modes (switched live over the DataChannel "control", no renegotiation):
 *   forward    sender.replaceTrack(the received track) — libwebrtc sends it straight back
 *   frames     sink → Node → source, untouched: the cost of decoding + re-encoding
 *   effects / watermark / tracker   sink → FrameModes (src/lib/rtc-modes.ts) → source
 * The page stamps a timestamp into every frame and reads it back → the real round-trip latency per mode.
 */
import { SAMPLES_DIR } from '../src/lib/config.js';
import { startRtcServer } from '../src/lib/rtc-server.js';
import { answerWithWrtc } from '../src/lib/rtc-wrtc.js';

// The whole peer (sink → FrameModes → source, DataChannel, cleanup) lives in src/lib/rtc-wrtc.ts —
// example 17 re-uses it and adds recording through its hooks.
await startRtcServer({
  title: 'WebRTC echo · @roamhq/wrtc',
  subtitle: 'The browser sends video to Node over WebRTC and receives it back — straight (forward), through Node untouched (frames), or processed per frame: effects, watermark, tracker. libwebrtc runs inside Node.',
  flow: 'browser ══ SRTP ══▶ Node (libwebrtc) ─ RTCVideoSink ─ I420 ─▶ FrameModes ─▶ RTCVideoSource ══ SRTP ══▶ browser',
  port: Number(process.env.RTC_PORT ?? 3015),
  root: SAMPLES_DIR,
  answer: (offer) => answerWithWrtc(offer),
});
