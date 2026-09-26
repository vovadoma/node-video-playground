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
import wrtc from '@roamhq/wrtc';
import { SAMPLES_DIR } from '../src/lib/config.js';
import { bufferOf } from '../src/lib/i420.js';
import { FrameModes, RTC_MODES, type RtcMode, type RtcParams } from '../src/lib/rtc-modes.js';
import { startRtcServer, type SessionDescription } from '../src/lib/rtc-server.js';

const { RTCPeerConnection, nonstandard: { RTCVideoSink, RTCVideoSource } } = wrtc;
let peers = 0;

async function answer(offer: SessionDescription): Promise<SessionDescription> {
  const id = ++peers;
  const pc = new RTCPeerConnection();
  const source = new RTCVideoSource();
  const processed = source.createTrack();
  const modes = new FrameModes();
  let mode: RtcMode = 'forward', params: RtcParams = {};
  let received: InstanceType<typeof wrtc.MediaStreamTrack> | undefined;
  let sink: InstanceType<typeof RTCVideoSink> | undefined;
  const stats = { in: 0, out: 0, ms: 0, width: 0, height: 0 };
  let timer: NodeJS.Timeout | undefined;

  // The browser's offer has one sendrecv video m-line: its track comes in via ontrack, and addTrack
  // below re-uses the same transceiver for what we send back.
  pc.ontrack = ({ track }) => {
    if (track.kind !== 'video') return;
    received = track;
    sink = new RTCVideoSink(track);
    sink.onframe = ({ frame }: { frame: { width: number; height: number; data: Uint8Array } }) => {
      stats.in++;
      stats.width = frame.width; stats.height = frame.height;
      if (mode === 'forward') return;                       // libwebrtc forwards the track itself
      const t0 = performance.now();
      const out = modes.process(bufferOf(frame.data), frame.width, frame.height, mode, params);
      stats.ms = stats.ms * 0.9 + (performance.now() - t0) * 0.1;
      if (!out) return;
      // the addon wants a Uint8ClampedArray at runtime (its typings say Uint8Array)
      source.onFrame({ width: frame.width, height: frame.height, data: new Uint8ClampedArray(out.buffer, out.byteOffset, out.byteLength) as unknown as Uint8Array });
      stats.out++;
    };
    applyMode();
  };

  let sender: InstanceType<typeof wrtc.RTCRtpSender> | undefined;
  const applyMode = () => sender?.replaceTrack(mode === 'forward' && received ? received : processed).catch(() => {});

  pc.ondatachannel = ({ channel }) => {
    channel.onmessage = (e) => {
      const m = JSON.parse(String(e.data));
      if (RTC_MODES.includes(m.mode)) mode = m.mode;
      params = m.params ?? {};
      applyMode();
      console.log(`  peer ${id}: mode=${mode}${mode === 'effects' ? ` ${params.effect}${params.split ? '+split' : ''}` : ''}${mode === 'tracker' ? ` ratio=${params.ratio}` : ''}`);
    };
    timer = setInterval(() => {
      if (channel.readyState !== 'open') return;
      channel.send(JSON.stringify({ mode, fpsIn: stats.in, fpsOut: mode === 'forward' ? stats.in : stats.out, ms: mode === 'forward' ? 0 : stats.ms, width: stats.width, height: stats.height }));
      stats.in = 0; stats.out = 0;
    }, 1000);
    channel.onclose = () => clearInterval(timer);
  };

  pc.onconnectionstatechange = () => {
    console.log(`  peer ${id}: ${pc.connectionState}`);
    if (['closed', 'failed', 'disconnected'].includes(pc.connectionState)) {
      clearInterval(timer);
      sink?.stop();
      processed.stop();
      pc.close();
    }
  };

  await pc.setRemoteDescription(offer);
  // the transceiver the offer created carries both directions: what the browser sends and what we send back
  const transceiver = pc.getTransceivers().find((t) => t.receiver.track.kind === 'video');
  if (!transceiver) throw new Error('the offer has no video');
  transceiver.direction = 'sendrecv';
  sender = transceiver.sender;
  await applyMode();
  await pc.setLocalDescription(await pc.createAnswer());
  // non-trickle: wait until all local ICE candidates are in the SDP (localhost → only host candidates, fast)
  await new Promise<void>((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    pc.onicegatheringstatechange = () => pc.iceGatheringState === 'complete' && resolve();
    setTimeout(resolve, 2000);
  });
  console.log(`▶ peer ${id} connected`);
  return pc.localDescription as SessionDescription;
}

await startRtcServer({
  title: 'WebRTC echo · @roamhq/wrtc',
  subtitle: 'The browser sends video to Node over WebRTC and receives it back — straight (forward), through Node untouched (frames), or processed per frame: effects, watermark, tracker. libwebrtc runs inside Node.',
  flow: 'browser ══ SRTP ══▶ Node (libwebrtc) ─ RTCVideoSink ─ I420 ─▶ FrameModes ─▶ RTCVideoSource ══ SRTP ══▶ browser',
  port: Number(process.env.RTC_PORT ?? 3015),
  root: SAMPLES_DIR,
  answer,
});
