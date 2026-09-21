/**
 * 05 — Objective quality: PSNR and SSIM of every generated encode vs. the master.
 *      (VMAF works the same way with `libvmaf` if your ffmpeg build has it.)
 *
 *   npm run quality
 */
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { sample } from '../src/lib/config.js';
import { runFfmpegCapture } from '../src/lib/ffmpeg.js';
import { humanBytes } from '../src/lib/format.js';

const reference = sample('generated/master_h264_720p.mp4');
const dir = path.dirname(reference);

const candidates = readdirSync(dir)
  .filter((f) => /^(mp4|mkv|webm)_/.test(f))     // same 720p content, lossy codecs
  .map((f) => path.join(dir, f));

console.log(`Reference: ${path.basename(reference)}\n`);
console.log('file'.padEnd(28), 'size'.padStart(9), 'PSNR'.padStart(8), 'SSIM'.padStart(8));

for (const file of candidates) {
  const [psnr, ssim] = await Promise.all([measure(file, 'psnr'), measure(file, 'ssim')]);
  console.log(
    path.basename(file).padEnd(28),
    humanBytes(statSync(file).size).padStart(9),
    psnr.toFixed(2).padStart(8),
    ssim.toFixed(4).padStart(8),
  );
}

/** Returns average PSNR (dB) or SSIM (0..1) of `distorted` vs. `reference`. */
async function measure(distorted: string, metric: 'psnr' | 'ssim'): Promise<number> {
  // Both inputs must share resolution & pixel format; scale/format the distorted one to be safe.
  const stderr = await runFfmpegCapture([
    '-i', distorted, '-i', reference,
    '-lavfi', `[0:v]scale=1280:720,format=yuv420p[d];[1:v]format=yuv420p[r];[d][r]${metric}`,
    '-f', 'null', '-',
  ]);
  const m = metric === 'psnr'
    ? stderr.match(/average:([\d.]+|inf)/)
    : stderr.match(/All:([\d.]+)/);
  if (!m) throw new Error(`Could not parse ${metric} output for ${distorted}:\n${stderr}`);
  return m[1] === 'inf' ? Infinity : Number(m[1]);
}
