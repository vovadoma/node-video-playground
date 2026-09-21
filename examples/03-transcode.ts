/**
 * 03 — Transcode with progress: H.264 -> H.265, plus a 480p H.264 "web" rendition.
 *
 *   npm run transcode
 *   npm run transcode -- input.mov
 */
import { performance } from 'node:perf_hooks';
import { statSync } from 'node:fs';
import { out, sample } from '../src/lib/config.js';
import { consoleProgress, runFfmpeg } from '../src/lib/ffmpeg.js';
import { probeSummary } from '../src/lib/ffprobe.js';
import { humanBytes } from '../src/lib/format.js';

const input = process.argv[2] ?? sample('generated/master_h264_720p.mp4');
const src = await probeSummary(input);
console.log(`Input: ${src.video?.codec} ${src.video?.width}x${src.video?.height}, ${humanBytes(src.sizeBytes)}`);

interface Job { name: string; output: string; args: string[] }

const jobs: Job[] = [
  {
    name: 'H.265 720p',
    output: out('transcode/h265_720p.mp4'),
    args: [
      '-c:v', 'libx265', '-preset', 'fast', '-crf', '26',
      '-tag:v', 'hvc1',                 // so Safari/QuickTime recognise it
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
    ],
  },
  {
    name: 'H.264 480p web',
    output: out('transcode/h264_480p.mp4'),
    args: [
      '-vf', 'scale=-2:480',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-profile:v', 'main',
      '-pix_fmt', 'yuv420p',             // max compatibility
      '-c:a', 'aac', '-b:a', '96k', '-ac', '2',
      '-movflags', '+faststart',
    ],
  },
  {
    name: 'VP9 WebM',
    output: out('transcode/vp9.webm'),
    args: [
      '-c:v', 'libvpx-vp9', '-b:v', '1200k', '-deadline', 'good', '-cpu-used', '4', '-row-mt', '1',
      '-c:a', 'libopus', '-b:a', '96k',
    ],
  },
];

for (const job of jobs) {
  const t0 = performance.now();
  await runFfmpeg(['-i', input, ...job.args, job.output], {
    totalDurationSec: src.duration,
    onProgress: consoleProgress(job.name.padEnd(16)),
  });
  const sec = ((performance.now() - t0) / 1000).toFixed(1);
  const size = statSync(job.output).size;
  const ratio = ((1 - size / src.sizeBytes) * 100).toFixed(0);
  console.log(`  -> ${job.output}  ${humanBytes(size)}  (${ratio}% smaller, ${sec}s)`);
}
