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
