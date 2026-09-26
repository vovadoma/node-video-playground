/**
 * One WebRTC peer on @roamhq/wrtc (libwebrtc inside Node): the browser's video comes in through an
 * RTCVideoSink as raw I420 frames, goes through FrameModes, and leaves through an RTCVideoSource on the
 * same transceiver. Modes arrive over the DataChannel "control". Used by examples 15 and 17.
 *
 *   browser ══ SRTP ══▶ RTCVideoSink ─ I420 ─▶ [tap 'in'] ─▶ FrameModes ─▶ [tap 'out'] ─▶ RTCVideoSource ══▶ browser
 *
 * Hooks let an example add behaviour without copying this file:
 *   onMessage  extra DataChannel messages (anything besides the mode switch), with a way to answer
 *   tap        sees every frame before ('in') and after ('out') processing — copy it if you keep it
 *   onClose    the peer went away
 */
import wrtc from '@roamhq/wrtc';
import { bufferOf } from './i420.js';
import { FrameModes, RTC_MODES, type RtcMode, type RtcParams } from './rtc-modes.js';
import type { SessionDescription } from './rtc-server.js';

const { RTCPeerConnection, nonstandard: { RTCVideoSink, RTCVideoSource } } = wrtc;

export interface WrtcPeer {
  id: number;
  mode: RtcMode;
  /** Send a JSON message to the page over the DataChannel. */
  send(message: object): void;
}

export interface WrtcHooks {
  onMessage?(message: Record<string, unknown>, peer: WrtcPeer): void;
  tap?(stage: 'in' | 'out', frame: Buffer, width: number, height: number, peer: WrtcPeer): void;
  onClose?(peer: WrtcPeer): void;
}

let peers = 0;

export async function answerWithWrtc(offer: SessionDescription, hooks: WrtcHooks = {}): Promise<SessionDescription> {
  const pc = new RTCPeerConnection();
  const source = new RTCVideoSource();
  const processed = source.createTrack();
  const modes = new FrameModes();
  let params: RtcParams = {};
  let received: InstanceType<typeof wrtc.MediaStreamTrack> | undefined;
  let sink: InstanceType<typeof RTCVideoSink> | undefined;
  let sender: InstanceType<typeof wrtc.RTCRtpSender> | undefined;
  let channel: InstanceType<typeof wrtc.RTCDataChannel> | undefined;
  let timer: NodeJS.Timeout | undefined;
  let closed = false;
  const stats = { in: 0, out: 0, ms: 0, width: 0, height: 0 };

  const peer: WrtcPeer = {
    id: ++peers,
    mode: 'forward',
    send: (m) => { if (channel?.readyState === 'open') channel.send(JSON.stringify(m)); },
  };
  const applyMode = () => sender?.replaceTrack(peer.mode === 'forward' && received ? received : processed).catch(() => {});

  // The browser's offer has one sendrecv video m-line: its track comes in here, and we send back on the same transceiver.
  pc.ontrack = ({ track }) => {
    if (track.kind !== 'video') return;
    received = track;
    sink = new RTCVideoSink(track);
    sink.onframe = ({ frame }: { frame: { width: number; height: number; data: Uint8Array } }) => {
      const { width: w, height: h } = frame;
      stats.in++; stats.width = w; stats.height = h;
      const buf = bufferOf(frame.data);
      hooks.tap?.('in', buf, w, h, peer);
      if (peer.mode === 'forward') { hooks.tap?.('out', buf, w, h, peer); return; }   // libwebrtc forwards the track itself
      const t0 = performance.now();
      const out = modes.process(buf, w, h, peer.mode, params);
      stats.ms = stats.ms * 0.9 + (performance.now() - t0) * 0.1;
      if (!out) return;
      hooks.tap?.('out', out, w, h, peer);
      // the addon wants a Uint8ClampedArray at runtime (its typings say Uint8Array)
      source.onFrame({ width: w, height: h, data: new Uint8ClampedArray(out.buffer, out.byteOffset, out.byteLength) as unknown as Uint8Array });
      stats.out++;
    };
    applyMode();
  };

  pc.ondatachannel = ({ channel: ch }) => {
    channel = ch;
    ch.onmessage = (e) => {
      const m = JSON.parse(String(e.data));
      if (m.mode !== undefined) {
        if (RTC_MODES.includes(m.mode)) peer.mode = m.mode;
        params = m.params ?? {};
        applyMode();
        console.log(`  peer ${peer.id}: mode=${peer.mode}${peer.mode === 'effects' ? ` ${params.effect}${params.split ? '+split' : ''}` : ''}${peer.mode === 'tracker' ? ` ratio=${params.ratio}` : ''}`);
      }
      hooks.onMessage?.(m, peer);
    };
    timer = setInterval(() => {
      const fwd = peer.mode === 'forward';
      peer.send({ stats: true, mode: peer.mode, fpsIn: stats.in, fpsOut: fwd ? stats.in : stats.out, ms: fwd ? 0 : stats.ms, width: stats.width, height: stats.height });
      stats.in = 0; stats.out = 0;
    }, 1000);
    ch.onclose = () => clearInterval(timer);
  };

  pc.onconnectionstatechange = () => {
    console.log(`  peer ${peer.id}: ${pc.connectionState}`);
    if (!closed && ['closed', 'failed', 'disconnected'].includes(pc.connectionState)) {
      closed = true;
      clearInterval(timer);
      sink?.stop();
      processed.stop();
      pc.close();
      hooks.onClose?.(peer);
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
  console.log(`▶ peer ${peer.id} connected`);
  return pc.localDescription as SessionDescription;
}
