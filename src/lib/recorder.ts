/**
 * Record raw I420 frames into an MP4 while they stream by, and grab single frames as JPEG.
 *
 * Frames from a camera don't arrive at an exact rate, so each one is stamped with the wall clock when it
 * is written (-use_wallclock_as_timestamps) and kept as is (-fps_mode passthrough): the file plays at the
 * real speed. A frame of another size (the browser may re-scale mid-call) is skipped, and when ffmpeg
 * can't keep up a frame is dropped rather than queued — memory stays flat.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { FFMPEG_BIN } from './config.js';
import { encodeToFile } from './rawframes.js';
import type { WrtcHooks, WrtcPeer } from './rtc-wrtc.js';

export class FrameRecorder {
  private readonly ff: ChildProcess;
  private readonly done: Promise<number | null>;
  private readonly startedAt = Date.now();
  frames = 0;
  dropped = 0;

  constructor(readonly file: string, readonly width: number, readonly height: number) {
    this.ff = spawn(FFMPEG_BIN, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-s', `${width}x${height}`, '-use_wallclock_as_timestamps', '1', '-i', 'pipe:0',
      '-fps_mode', 'passthrough',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      file,
    ], { stdio: ['pipe', 'ignore', 'inherit'] });
    this.ff.stdin!.on('error', () => {});
    this.done = new Promise((resolve) => this.ff.on('close', resolve));
  }

  /** Queue one frame (copied — the caller may reuse its buffer). */
  write(frame: Buffer, width: number, height: number) {
    if (this.ff.exitCode !== null || width !== this.width || height !== this.height || this.ff.stdin!.writableNeedDrain) { this.dropped++; return; }
    this.ff.stdin!.write(Buffer.from(frame));
    this.frames++;
  }

  get seconds() {
    return (Date.now() - this.startedAt) / 1000;
  }

  /** Finish the file; resolves when ffmpeg has written the index (moov). */
  async stop(): Promise<{ file: string; frames: number; dropped: number; seconds: number; ok: boolean }> {
    const seconds = this.seconds;
    this.ff.stdin!.end();
    const code = await this.done;
    return { file: this.file, frames: this.frames, dropped: this.dropped, seconds, ok: code === 0 };
  }
}

/** Save one I420 frame as a JPEG. */
export function snapshot(frame: Buffer, width: number, height: number, file: string): Promise<void> {
  return encodeToFile([Buffer.from(frame)], { width, height, fps: 1 }, ['-frames:v', '1', '-update', '1', '-q:v', '3', file]);
}

// ---------------------------------------------------------------- recording over WebRTC (examples 17, 18)

/**
 * Hooks for answerWithWrtc() (src/lib/rtc-wrtc.ts) that record on the server what a peer sends ('in')
 * or what the server sends back ('out'), and take snapshots — driven by DataChannel messages:
 *   {record: 'start', what: 'in' | 'out'}   {record: 'stop'}   {snapshot: 'in' | 'out'}
 * Files go to `dir` (rec-<time>-<what>.mp4, snap-<time>-<what>.jpg); the page is told about each new one.
 */
export function recordingHooks(dir: string): WrtcHooks {
  const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);   // 20260926-101530

  interface PeerState {
    recorder?: FrameRecorder;
    what?: 'in' | 'out';          // record the original ('in') or the processed ('out') frames
    starting?: boolean;           // start on the next frame of that stage — the recorder needs its size
    snap?: 'in' | 'out';
    ticker?: NodeJS.Timeout;
  }
  const state = new Map<number, PeerState>();
  const of = (p: WrtcPeer) => state.get(p.id) ?? state.set(p.id, {}).get(p.id)!;

  async function stopRecording(peer: WrtcPeer, s: PeerState) {
    const rec = s.recorder;
    if (!rec) return;
    s.recorder = undefined;
    clearInterval(s.ticker);
    const r = await rec.stop();
    const name = path.basename(r.file);
    console.log(`■ peer ${peer.id}: ${name} — ${r.frames} frames, ${r.seconds.toFixed(1)} s${r.dropped ? `, ${r.dropped} dropped` : ''}${r.ok ? '' : ' (ffmpeg failed)'}`);
    peer.send({ recording: { active: false, message: `Saved ${name} · ${r.seconds.toFixed(1)} s · ${r.frames} frames` }, saved: name });
  }

  return {
    tap(stage, frame, w, h, peer) {
      const s = of(peer);
      if (s.recorder && s.what === stage) s.recorder.write(frame, w, h);
      if (s.snap === stage) {
        s.snap = undefined;
        const file = path.join(dir, `snap-${stamp()}-${stage === 'in' ? 'original' : peer.mode}.jpg`);
        snapshot(frame, w, h, file).then(
          () => { console.log(`  peer ${peer.id}: snapshot ${path.basename(file)}`); peer.send({ saved: path.basename(file) }); },
          (e) => console.error(`snapshot failed: ${e.message}`),
        );
      }
      if (s.starting && s.what === stage && !s.recorder) {
        s.starting = false;
        const file = path.join(dir, `rec-${stamp()}-${stage === 'in' ? 'original' : peer.mode}.mp4`);
        s.recorder = new FrameRecorder(file, w, h);
        console.log(`● peer ${peer.id}: recording ${path.basename(file)} (${w}x${h})`);
        s.ticker = setInterval(() => {
          const r = s.recorder;
          if (r) peer.send({ recording: { active: true, seconds: r.seconds, frames: r.frames, dropped: r.dropped, what: stage === 'in' ? 'original' : 'processed', file: path.basename(r.file) } });
        }, 500);
      }
    },
    onMessage(m, peer) {
      const s = of(peer);
      if (m.record === 'start' && !s.recorder) {
        s.what = m.what === 'out' ? 'out' : 'in';
        s.starting = true;
      }
      if (m.record === 'stop') { s.starting = false; stopRecording(peer, s).catch((e) => console.error(e)); }
      if (m.snapshot === 'in' || m.snapshot === 'out') s.snap = m.snapshot;
    },
    onClose(peer) {
      const s = of(peer);
      stopRecording(peer, s).catch((e) => console.error(e)).finally(() => state.delete(peer.id));
    },
  };
}
