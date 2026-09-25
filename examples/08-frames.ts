/**
 * 08 — Frames: split the simplest kind of video, Motion JPEG, into individual pictures.
 *
 *   npm run frames
 *   npm run frames -- samples/generated/master_h264_720p.mp4
 *
 * In MJPEG every frame is a complete JPEG (all I-frames, nothing refers to other frames),
 * so frames can be cut out of the stream with `-c:v copy`: no decoding, no quality loss —
 * the files are byte-for-byte the packets stored in the video. Any other codec (H.264,
 * VP9, …) keeps most frames as differences (P/B), so it has to be decoded and every frame
 * encoded as a new JPEG.
 */
import { execa } from 'execa';
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { FFPROBE_BIN, OUTPUT_DIR, sample } from '../src/lib/config.js';
import { consoleProgress, runFfmpeg } from '../src/lib/ffmpeg.js';
import { probeSummary } from '../src/lib/ffprobe.js';
import { humanBytes } from '../src/lib/format.js';

const SECONDS = 2;   // how much of the video to split: 2 s × 30 fps = 60 frames

const input = process.argv[2] ?? sample('generated/avi_mjpeg_pcm.avi');
const src = await probeSummary(input);
if (!src.video) throw new Error(`${input} has no video stream`);
const { codec, width, height, fps } = src.video;
console.log(`Input: ${path.basename(input)} — ${codec} ${width}x${height} @ ${fps} fps, ${src.duration.toFixed(1)} s\n`);

// 1. What kind of frames are there? I = a whole picture, P/B = only the difference to other frames.
const types = await ffprobe(['-read_intervals', `%+${SECONDS}`, '-show_entries', 'frame=pict_type', input]);
const counts = types.reduce<Record<string, number>>((acc, t) => ({ ...acc, [t]: (acc[t] ?? 0) + 1 }), {});
console.log(`Frame types in the first ${SECONDS} s: ${Object.entries(counts).map(([t, n]) => `${t}=${n}`).join('  ')}`);

const lossless = codec === 'mjpeg';
console.log(lossless
  ? 'Every frame is an I-frame (a JPEG) → cut them out of the stream as they are.\n'
  : `${codec} stores most frames as differences → decode and encode each frame as a JPEG.\n`);

// 2. Split: one file per frame
const dir = path.join(OUTPUT_DIR, 'frames', path.parse(input).name);
rmSync(dir, { recursive: true, force: true });   // no stale frames from a longer earlier run
mkdirSync(dir, { recursive: true });

const t0 = performance.now();
await runFfmpeg([
  '-i', input,
  '-map', '0:v:0',
  '-t', String(SECONDS),
  ...(lossless ? ['-c:v', 'copy'] : ['-q:v', '2']),   // copy the JPEG packets | re-encode (2 = best quality)
  '-f', 'image2',
  path.join(dir, 'frame_%04d.jpg'),
], { totalDurationSec: SECONDS, onProgress: consoleProgress('Splitting ') });
const sec = ((performance.now() - t0) / 1000).toFixed(2);

const files = readdirSync(dir).filter((f) => f.endsWith('.jpg')).sort();
const total = files.reduce((sum, f) => sum + statSync(path.join(dir, f)).size, 0);
console.log(`\n${files.length} frames → ${dir}`);
console.log(`${humanBytes(total)} total, ${humanBytes(total / files.length)} per frame, ${sec} s`);

// 3. For MJPEG, prove it was lossless: the files hold exactly the bytes of the first N packets.
if (lossless) {
  const packets = await ffprobe(['-read_intervals', `%+#${files.length}`, '-show_entries', 'packet=size', input]);
  const streamBytes = packets.reduce((sum, s) => sum + Number(s), 0);
  console.log(`Bytes of the first ${packets.length} video packets: ${streamBytes} — files: ${total} → ${streamBytes === total ? 'identical, nothing was re-encoded' : 'DIFFERENT'}`);
}

console.log(`\nBack to a video:  ffmpeg -framerate ${fps} -i ${path.join(dir, 'frame_%04d.jpg')} -c:v copy rebuilt.avi`);

/** Run ffprobe on the first video stream and return one CSV value per line. */
async function ffprobe(args: string[]): Promise<string[]> {
  const { stdout } = await execa(FFPROBE_BIN, ['-v', 'error', '-select_streams', 'v:0', ...args.slice(0, -1), '-of', 'csv=p=0', args.at(-1)!]);
  return stdout.split('\n').map((l) => l.split(',')[0].trim()).filter(Boolean);
}
