/**
 * 04 — Package a file into HLS with an ABR ladder (3 renditions, fMP4/CMAF segments)
 *      in a single ffmpeg pass, then print the master playlist.
 *
 *   npm run hls
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { out, sample } from '../src/lib/config.js';
import { consoleProgress, runFfmpeg } from '../src/lib/ffmpeg.js';
import { probeSummary } from '../src/lib/ffprobe.js';

const input = process.argv[2] ?? sample('generated/master_h264_720p.mp4');
const src = await probeSummary(input);
const fps = src.video?.fps ?? 30;
const gop = Math.round(fps * 2);        // keyframe every 2 s -> segments can be 2/4/6 s

const ladder = [
  { name: '720p', height: 720, vBitrate: '2500k', aBitrate: '128k' },
  { name: '480p', height: 480, vBitrate: '1200k', aBitrate: '96k' },
  { name: '360p', height: 360, vBitrate: '600k', aBitrate: '64k' },
];

const dir = out('hls/');
const segmentSec = 4;

// Build the filter graph: split once, scale N times
const split = `[0:v]split=${ladder.length}${ladder.map((_, i) => `[v${i}]`).join('')}`;
const scales = ladder.map((r, i) => `[v${i}]scale=-2:${r.height}[v${i}o]`);
const filterComplex = [split, ...scales].join(';');

const args: string[] = ['-i', input, '-filter_complex', filterComplex];

ladder.forEach((r, i) => {
  args.push('-map', `[v${i}o]`, `-c:v:${i}`, 'libx264', '-preset', 'veryfast', `-b:v:${i}`, r.vBitrate,
    `-maxrate:v:${i}`, r.vBitrate, `-bufsize:v:${i}`, `${parseInt(r.vBitrate) * 2}k`);
});
ladder.forEach((r, i) => {
  args.push('-map', '0:a:0', `-c:a:${i}`, 'aac', `-b:a:${i}`, r.aBitrate, `-ac:a:${i}`, '2');
});

args.push(
  '-g', String(gop), '-keyint_min', String(gop), '-sc_threshold', '0',   // fixed GOP, aligned across renditions
  '-f', 'hls',
  '-hls_time', String(segmentSec),
  '-hls_playlist_type', 'vod',
  '-hls_segment_type', 'fmp4',
  '-hls_flags', 'independent_segments',
  '-master_pl_name', 'master.m3u8',
  '-hls_segment_filename', path.join(dir, '%v/seg_%04d.m4s'),
  '-var_stream_map', ladder.map((r, i) => `v:${i},a:${i},name:${r.name}`).join(' '),
  path.join(dir, '%v/index.m3u8'),
);

await runFfmpeg(args, { totalDurationSec: src.duration, onProgress: consoleProgress('HLS'), verbose: true });

console.log(`\n${path.join(dir, 'master.m3u8')}:\n`);
console.log(readFileSync(path.join(dir, 'master.m3u8'), 'utf8'));
console.log('Play with:  ffplay output/hls/master.m3u8');
console.log('Or serve:   npx serve output/hls  (then open in hls.js demo / Safari)');
