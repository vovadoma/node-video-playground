/**
 * Raw frames through Node: ffmpeg decodes a stream into uncompressed yuv420p frames, Node gets one
 * Buffer per frame (and may read or change the pixels), another ffmpeg encodes them again.
 *
 *   file stream ─▶ decodeFrames() ─ Buffer per frame ─▶ your code ─▶ encodeFrames() ─▶ fMP4 / MJPEG / file
 *
 * yuv420p layout of one W×H frame (W, H even):
 *   Y  W·H bytes        brightness, one byte per pixel
 *   U  W/2·H/2 bytes    blue-difference chroma, one byte per 2×2 pixels
 *   V  W/2·H/2 bytes    red-difference chroma
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { pipeline, Readable, Transform, type TransformCallback } from 'node:stream';
import { ffmpegStream } from './ffmpeg.js';

export interface FrameFormat {
  width: number;                // even
  height: number;               // even
  fps: number;
}

export const frameBytes = (w: number, h: number) => (w * h * 3) / 2;

/** Pick an even processing size ≤ maxWidth that keeps the aspect ratio. */
export function processingSize(width: number, height: number, maxWidth = 1280): { width: number; height: number } {
  const scale = Math.min(1, maxWidth / width);
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  return { width: even(width * scale), height: even(height * scale) };
}

/** Re-chunks a byte stream into whole frames: every output chunk is exactly `size` bytes. */
export class FrameChunker extends Transform {
  private parts: Buffer[] = [];
  private have = 0;

  constructor(private readonly size: number) {
    super({ readableObjectMode: true });
  }

  _transform(chunk: Buffer, _enc: BufferEncoding, done: TransformCallback) {
    this.parts.push(chunk);
    this.have += chunk.length;
    while (this.have >= this.size) {
      const all = this.parts.length === 1 ? this.parts[0] : Buffer.concat(this.parts, this.have);
      this.push(Buffer.from(all.subarray(0, this.size)));     // a copy: the consumer may keep and edit it
      const rest = all.subarray(this.size);
      this.parts = rest.length ? [rest] : [];
      this.have = rest.length;
    }
    done();
  }
}

/**
 * Decode the first video stream of `input` into yuv420p frames of `size`.
 * `realtime` = read at playback speed (-re), for live output; off for offline analysis.
 */
export function decodeFrames(input: Readable, size: { width: number; height: number }, { realtime = false } = {}): Readable {
  const raw = ffmpegStream(input, [
    ...(realtime ? ['-re'] : []), '-i', 'pipe:0',
    '-map', '0:v:0', '-an',
    '-vf', `scale=${size.width}:${size.height},format=yuv420p`,
    '-f', 'rawvideo', '-pix_fmt', 'yuv420p', 'pipe:1',
  ]);
  // pipeline: if the consumer stops (client gone), the decoder ffmpeg and the file stream go too
  return pipeline(raw, new FrameChunker(frameBytes(size.width, size.height)), () => {});
}

/**
 * Like decodeFrames, but ffmpeg opens the file itself — needed for `loop` (-stream_loop -1 has to seek
 * back to the start, which a pipe can't). Endless when looping; the consumer closing stops it.
 */
export function decodeFramesFromFile(file: string, size: { width: number; height: number }, { realtime = false, loop = false } = {}): Readable {
  const raw = ffmpegStream(Readable.from([]), [
    ...(loop ? ['-stream_loop', '-1'] : []), ...(realtime ? ['-re'] : []), '-i', file,
    '-map', '0:v:0', '-an',
    '-vf', `scale=${size.width}:${size.height},format=yuv420p`,
    '-f', 'rawvideo', '-pix_fmt', 'yuv420p', 'pipe:1',
  ]);
  return pipeline(raw, new FrameChunker(frameBytes(size.width, size.height)), () => {});
}

/**
 * A still background: one frame of `file` (at `atSec`), repeated at `fps` in real time — the only
 * motion in the result is whatever is added later. Endless; the consumer closing stops it.
 */
export function stillFrames(file: string, size: { width: number; height: number }, fps: number, atSec = 0): Readable {
  let frame: Buffer | undefined, timer: NodeJS.Timeout | undefined, next = 0;
  const grab = async () => {
    const one = ffmpegStream(Readable.from([]), [
      '-ss', String(atSec), '-i', file, '-frames:v', '1', '-an',
      '-vf', `scale=${size.width}:${size.height},format=yuv420p`, '-f', 'rawvideo', '-pix_fmt', 'yuv420p', 'pipe:1',
    ]);
    const parts: Buffer[] = [];
    for await (const c of one) parts.push(c as Buffer);
    return Buffer.concat(parts);
  };
  return new Readable({
    objectMode: true,
    read() {
      const push = () => {
        next = Math.max(next + 1000 / fps, performance.now());
        this.push(Buffer.from(frame!));          // a fresh copy: someone will draw on it
      };
      if (frame) { timer = setTimeout(push, Math.max(0, next - performance.now())); return; }
      grab().then((f) => {
        if (f.length !== frameBytes(size.width, size.height)) return this.destroy(new Error(`could not read a frame from ${file}`));
        frame = f; next = performance.now(); push();
      }, (e) => this.destroy(e));
    },
    destroy(err, cb) { clearTimeout(timer); cb(err); },
  });
}

/**
 * Send frames through ANOTHER PROCESS: its stdin gets raw yuv420p frames, its stdout must return
 * frames of the same size. Nothing else is shared — the other side only ever sees pixels.
 * `onLine` receives the child's stderr line by line (logs, or data meant for someone else).
 * Closing the result kills the child.
 */
export function throughProcess(
  frames: Readable, command: string, args: string[], size: { width: number; height: number },
  onLine?: (line: string) => void,
): Readable {
  const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  pipeline(frames, child.stdin, () => {});                   // EPIPE when the child is gone — expected
  if (onLine) createInterface({ input: child.stderr }).on('line', onLine);
  else child.stderr.resume();
  const out = pipeline(child.stdout, new FrameChunker(frameBytes(size.width, size.height)), () => {});
  out.on('close', () => { if (child.exitCode === null) child.kill('SIGKILL'); frames.destroy(); });
  child.on('error', (e) => out.destroy(e));
  return out;
}

/**
 * Encode yuv420p frame Buffers (an object-mode stream) with ffmpeg. `outputArgs` = everything after
 * the input, e.g. DELIVERY.mp4.args('0:v:0', …) for streaming or ['-c:v', 'libx264', 'out.mp4'] for a file.
 */
export function encodeFrames(frames: Readable, fmt: FrameFormat, outputArgs: string[]): Readable {
  return ffmpegStream(frames, [
    '-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-s', `${fmt.width}x${fmt.height}`, '-r', String(fmt.fps),
    '-i', 'pipe:0',
    ...outputArgs,
  ]);
}

/** Encode frames (any iterable of yuv420p Buffers) into a file; resolves when ffmpeg is done. */
export async function encodeToFile(frames: Iterable<Buffer> | AsyncIterable<Buffer>, fmt: FrameFormat, outputArgs: string[]): Promise<void> {
  const out = encodeFrames(Readable.from(frames), fmt, ['-y', ...outputArgs]);
  for await (const _ of out) { /* output goes to the file, stdout stays empty */ }
}
