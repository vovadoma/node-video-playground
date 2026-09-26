/**
 * 16 — WebRTC echo (werift): the same page as example 15, but the WebRTC stack is werift — pure TypeScript — so we see and handle the RTP packets ourselves.
 *
 *   npm run webrtc-werift        # then open http://127.0.0.1:3016
 *
 *   forward:  browser ══ RTP (VP8) ══▶ Node ── the same packets ──▶ browser            (no decoding at all)
 *   frames…:  browser ══ RTP ══▶ Node ─ UDP ─▶ ffmpeg (decode) ─ I420 ─▶ FrameModes ─▶ ffmpeg (VP8 encode)
 *                                                                          ─ RTP over UDP ─▶ Node ══▶ browser
 *
 * werift does ICE, DTLS/SRTP, RTCP and the DataChannel, but no codecs: it gives and takes RTP packets.
 * Forwarding them back is the cheapest echo there is. To touch pixels we let ffmpeg do what libwebrtc
 * did inside example 15: it reads the VP8 RTP stream from a UDP port (described by an SDP on stdin) and
 * decodes it to raw frames; after FrameModes (src/lib/rtc-modes.ts) a second ffmpeg encodes VP8 and
 * sends RTP to a UDP port Node listens on; Node writes those packets into the outgoing track.
 *
 * Details that example 15 got for free:
 *   keyframes   a decoder can only start at a keyframe → we send PLI to the browser until frames come out;
 *               the browser's PLI to us is forwarded (forward) or answered by the encoder's GOP (-g 30)
 *   rebasing    switching between the browser's packets and ffmpeg's changes sequence numbers and
 *               timestamps → sender.replaceRTP(…, discontinuity) keeps the outgoing stream continuous
 *   pacing      raw frames get wall-clock timestamps, so the RTP timestamps match the real frame rate
 */
import { spawn, type ChildProcess } from 'node:child_process';
import dgram from 'node:dgram';
import { MediaStreamTrack, RTCPeerConnection, RTCRtpCodecParameters, RtpPacket, type RTCRtpTransceiver } from 'werift';
import { FFMPEG_BIN, SAMPLES_DIR } from '../src/lib/config.js';
import { frameBytes, FrameChunker } from '../src/lib/rawframes.js';
import { FrameModes, RTC_MODES, type RtcMode, type RtcParams } from '../src/lib/rtc-modes.js';
import { startRtcServer, type SessionDescription } from '../src/lib/rtc-server.js';

const VP8 = () => new RTCRtpCodecParameters({
  mimeType: 'video/VP8', clockRate: 90000,
  rtcpFeedback: [{ type: 'nack' }, { type: 'nack', parameter: 'pli' }, { type: 'goog-remb' }],
});

/** A free UDP port on localhost (bind to 0, read it, release it). */
async function freePort(): Promise<number> {
  const s = dgram.createSocket('udp4');
  await new Promise<void>((r) => s.bind(0, '127.0.0.1', r));
  const { port } = s.address();
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

/**
 * RTP in ─▶ ffmpeg decode ─▶ process(frame) ─▶ ffmpeg VP8 encode ─▶ RTP out.
 * Frames are dropped (not queued) when the encoder is still busy — latency beats completeness.
 */
class FramePath {
  private decoder?: ChildProcess;
  private encoder?: ChildProcess;
  private toDecoder = dgram.createSocket('udp4');
  private fromEncoder = dgram.createSocket('udp4');
  private decoderPort = 0;
  private kick?: NodeJS.Timeout;
  private stopped = false;
  decoded = 0;
  sent = 0;
  dropped = 0;

  constructor(
    readonly width: number, readonly height: number,
    private readonly payloadType: number,
    private readonly process: (frame: Buffer) => Buffer | null,
    private readonly onRtp: (rtp: RtpPacket) => void,
    private readonly requestKeyframe: () => void,
  ) {}

  async start() {
    const { width: w, height: h } = this;
    this.decoderPort = await freePort();
    await new Promise<void>((r) => this.fromEncoder.bind(0, '127.0.0.1', r));
    await new Promise<void>((r) => this.toDecoder.bind(0, '127.0.0.1', r));
    // a 720p/1080p keyframe leaves the encoder as a burst of dozens of packets — the default socket buffers
    // drop some of them, and a keyframe with holes can't be decoded by the browser at all
    for (const [sock, fn] of [[this.fromEncoder, 'setRecvBufferSize'], [this.toDecoder, 'setSendBufferSize']] as const) {
      try { sock[fn](4 * 1024 * 1024); } catch { /* the OS may cap it — fine */ }
    }
    this.fromEncoder.on('message', (buf) => this.onRtp(RtpPacket.deSerialize(buf)));

    // decoder: the SDP tells ffmpeg "VP8 RTP arrives on this UDP port"
    const sdp = `v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=werift\r\nc=IN IP4 127.0.0.1\r\nt=0 0\r\nm=video ${this.decoderPort} RTP/AVP 96\r\na=rtpmap:96 VP8/90000\r\n`;
    this.decoder = spawn(FFMPEG_BIN, [
      '-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'pipe,udp,rtp',
      '-fflags', 'nobuffer', '-flags', 'low_delay', '-analyzeduration', '0', '-probesize', '32', '-reorder_queue_size', '0',
      '-buffer_size', String(8 * 1024 * 1024),   // UDP receive buffer: a 720p/1080p keyframe arrives as a burst of packets
      '-f', 'sdp', '-i', 'pipe:0',
      '-vf', `scale=${w}:${h},format=yuv420p`, '-fps_mode', 'passthrough',   // one frame out per frame in — no duplicates
      '-f', 'rawvideo', '-pix_fmt', 'yuv420p', 'pipe:1',
    ], { stdio: ['pipe', 'pipe', 'inherit'] });
    this.decoder.stdin!.end(sdp);

    // encoder: raw frames with wall-clock timestamps → VP8 tuned for real time → RTP to our socket
    this.encoder = spawn(FFMPEG_BIN, [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-s', `${w}x${h}`, '-use_wallclock_as_timestamps', '1', '-i', 'pipe:0',
      '-fps_mode', 'passthrough',
      '-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '1M', '-g', '30',
      '-lag-in-frames', '0', '-error-resilient', '1', '-auto-alt-ref', '0',
      '-f', 'rtp', '-payload_type', String(this.payloadType), `rtp://127.0.0.1:${this.fromEncoder.address().port}?pkt_size=1200`,
    ], { stdio: ['pipe', 'ignore', 'inherit'] });
    this.encoder.stdin!.on('error', () => {});

    const frames = this.decoder.stdout!.pipe(new FrameChunker(frameBytes(w, h)));
    frames.on('data', (frame: Buffer) => {
      this.decoded++;
      const out = this.process(frame);
      if (!out) return;
      if (this.encoder?.stdin?.writableNeedDrain) { this.dropped++; return; }
      this.encoder?.stdin?.write(out);
      this.sent++;
    });

    // the decoder needs a keyframe to start: ask the browser until frames come out
    this.kick = setInterval(() => {
      if (this.decoded || this.stopped) clearInterval(this.kick);
      else this.requestKeyframe();
    }, 500);
    this.requestKeyframe();
  }

  /** A packet from the browser → the decoder's UDP port (payload type as in our SDP). */
  feed(rtp: RtpPacket) {
    if (!this.decoderPort) return;
    rtp.header.payloadType = 96;
    this.toDecoder.send(rtp.serialize(), this.decoderPort, '127.0.0.1');
  }

  stop() {
    this.stopped = true;
    clearInterval(this.kick);
    this.decoder?.kill('SIGKILL');
    this.encoder?.kill('SIGKILL');
    for (const s of [this.toDecoder, this.fromEncoder]) { try { s.close(); } catch { /* already closed */ } }
  }
}

let peers = 0;

async function answer(offer: SessionDescription): Promise<SessionDescription> {
  const id = ++peers;
  // max-bundle: video and the DataChannel share one ICE/DTLS transport, as the browser does.
  // Loopback only: sockets bound to 127.0.0.1 and a 127.0.0.1 host candidate. The browser reaches it from
  // its LAN address and our replies come back through lo0 — this also works where the OS blocks Node from
  // sending UDP to LAN addresses (macOS "Local Network" privacy). No STUN needed on localhost.
  const pc = new RTCPeerConnection({
    codecs: { video: [VP8()], audio: [] },
    bundlePolicy: 'max-bundle',
    iceServers: [],
    iceUseIpv6: false,
    iceInterfaceAddresses: { udp4: '127.0.0.1' },
    iceAdditionalHostAddresses: ['127.0.0.1'],
  });
  const outgoing = new MediaStreamTrack({ kind: 'video' });
  const modes = new FrameModes();
  let mode: RtcMode = 'forward', params: RtcParams = {};
  let size: { width: number; height: number } | undefined;
  let path: FramePath | undefined;
  let transceiver: RTCRtpTransceiver | undefined;
  let inSsrc = 0, source: 'browser' | 'ffmpeg' | undefined, rebase = true;
  const stats = { in: 0, out: 0, ms: 0 };
  let lastRtp = Date.now(), closed = false, watchdog: NodeJS.Timeout | undefined;
  const cleanup = (why: string) => {
    if (closed) return;
    closed = true;
    clearInterval(watchdog);
    path?.stop();
    pc.close().catch(() => {});
    console.log(`■ peer ${id} closed (${why})`);
  };

  const keyframe = () => { if (inSsrc && transceiver) transceiver.receiver.sendRtcpPLI(inSsrc).catch(() => {}); };

  /** Send a packet from one of the two sources; re-base seq/timestamp when the source changes. */
  const emit = (rtp: RtpPacket, from: 'browser' | 'ffmpeg') => {
    if ((mode === 'forward') !== (from === 'browser')) return;          // only the active source
    if (from !== source || rebase) {
      transceiver?.sender.replaceRTP({ sequenceNumber: rtp.header.sequenceNumber, timestamp: rtp.header.timestamp }, true);
      source = from; rebase = false;
    }
    outgoing.writeRtp(rtp);
    if (rtp.header.marker) stats.out++;                                   // marker = last packet of a frame
  };

  const ensurePath = async () => {
    if (path || !size || !transceiver?.sender.codec) return;
    const t0 = { v: 0 };
    path = new FramePath(size.width, size.height, transceiver.sender.codec.payloadType, (frame) => {
      t0.v = performance.now();
      const out = modes.process(frame, size!.width, size!.height, mode, params);
      stats.ms = stats.ms * 0.9 + (performance.now() - t0.v) * 0.1;
      return out;
    }, (rtp) => emit(rtp, 'ffmpeg'), keyframe);
    await path.start();
    console.log(`  peer ${id}: ffmpeg decode/encode started (${size.width}x${size.height})`);
  };

  pc.onTrack.subscribe((track) => {
    if (track.kind !== 'video') return;
    track.onReceiveRtp.subscribe((rtp) => {
      lastRtp = Date.now();
      inSsrc = rtp.header.ssrc;
      if (rtp.header.marker) stats.in++;
      emit(rtp.clone(), 'browser');
      path?.feed(rtp.clone());
    });
  });

  pc.onDataChannel.subscribe((channel) => {
    channel.onMessage.subscribe((data) => {
      const m = JSON.parse(String(data));
      const was = mode;
      if (RTC_MODES.includes(m.mode)) mode = m.mode;
      params = m.params ?? {};
      if (m.size?.width && m.size?.height) size = { width: m.size.width, height: m.size.height };
      if (mode !== was) { rebase = true; if (mode === 'forward') keyframe(); }
      if (mode !== 'forward') ensurePath().catch((e) => console.error(e));
      console.log(`  peer ${id}: mode=${mode}${mode === 'effects' ? ` ${params.effect}${params.split ? '+split' : ''}` : ''}${mode === 'tracker' ? ` ratio=${params.ratio}` : ''}`);
    });
    const timer = setInterval(() => {
      if (channel.readyState !== 'open') return;
      const fwd = mode === 'forward';
      channel.send(JSON.stringify({ mode, fpsIn: stats.in, fpsOut: stats.out, ms: fwd ? 0 : stats.ms, width: size?.width ?? 0, height: size?.height ?? 0, dropped: path?.dropped ?? 0 }));
      stats.in = 0; stats.out = 0;
    }, 1000);
    channel.stateChanged.subscribe((s) => { if (s === 'closed') { clearInterval(timer); cleanup('data channel closed'); } });
  });

  pc.connectionStateChange.subscribe((state) => {
    console.log(`  peer ${id}: ${state}`);
    if (state === 'connected' && !watchdog) {
      // werift doesn't always notice a browser that simply went away: no RTP for 5 s = gone
      lastRtp = Date.now();
      watchdog = setInterval(() => { if (Date.now() - lastRtp > 5000) cleanup('no media for 5 s'); }, 1000);
    }
    if (state === 'closed' || state === 'failed' || state === 'disconnected') cleanup(state);
  });

  await pc.setRemoteDescription(offer);
  transceiver = pc.getTransceivers().find((t) => t.kind === 'video');
  if (!transceiver) throw new Error('the offer has no video');
  transceiver.setDirection('sendrecv');
  await transceiver.sender.replaceTrack(outgoing);
  // the browser asks us for a keyframe: pass it on while forwarding (the encoder sends one every 30 frames anyway)
  transceiver.sender.onPictureLossIndication.subscribe(() => { if (mode === 'forward') keyframe(); });

  await pc.setLocalDescription(await pc.createAnswer());
  if (pc.iceGatheringState !== 'complete') {
    await new Promise<void>((resolve) => {
      pc.iceGatheringStateChange.subscribe((s) => s === 'complete' && resolve());
      setTimeout(resolve, 2000);
    });
  }
  console.log(`▶ peer ${id} connected`);
  return { type: 'answer', sdp: pc.localDescription!.sdp };
}

await startRtcServer({
  title: 'WebRTC echo · werift',
  subtitle: 'The same page as example 15 on a pure-TypeScript WebRTC stack: forward mode sends the browser\'s RTP packets straight back; the other modes go RTP → ffmpeg decode → Node → ffmpeg VP8 encode → RTP.',
  flow: 'browser ══ RTP ══▶ werift ─ UDP ─▶ ffmpeg (decode) ─ I420 ─▶ FrameModes ─▶ ffmpeg (VP8) ─ UDP ─▶ werift ══ RTP ══▶ browser',
  port: Number(process.env.RTC_PORT ?? 3016),
  root: SAMPLES_DIR,
  answer,
});
