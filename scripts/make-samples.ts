/**
 * Regenerate the full container × codec sample matrix with ffmpeg.
 *
 *   npm run samples             # writes to ./samples (generated/ + streaming/)
 *   npm run samples -- /path    # custom output root
 *
 * Everything is derived from one 10 s, 1280x720 testsrc2 master, so all files share
 * identical content and can be compared by size / speed / PSNR / SSIM / VMAF.
 * Two outputs (ProRes HQ ~64 MB, DNxHR HQ ~123 MB) exceed GitHub's file limits and are
 * git-ignored — this script is how you get them back after a clone.
 */
import { existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { runFfmpeg } from '../src/lib/ffmpeg.js';
import { humanBytes } from '../src/lib/format.js';

const root = path.resolve(process.argv[2] ?? 'samples');
const gen = path.join(root, 'generated');
const str = path.join(root, 'streaming');
mkdirSync(gen, { recursive: true });
mkdirSync(str, { recursive: true });

const master = path.join(gen, 'master_h264_720p.mp4');

if (!existsSync(master)) {
  await step('master_h264_720p.mp4', [
    '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=10',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=10',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', master,
  ]);
}

type Recipe = [file: string, args: string[]];

const recipes: Recipe[] = [
  // MP4 / MOV
  ['mp4_h264_aac.mp4', ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart']],
  ['mp4_h265_aac.mp4', ['-c:v', 'libx265', '-preset', 'veryfast', '-crf', '26', '-tag:v', 'hvc1', '-c:a', 'aac', '-b:a', '128k']],
  ['mp4_av1_opus.mp4', ['-c:v', 'libaom-av1', '-cpu-used', '8', '-row-mt', '1', '-crf', '35', '-b:v', '0', '-c:a', 'libopus', '-b:a', '96k']],
  ['mp4_h264_eac3.mp4', ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'eac3', '-b:a', '192k']],
  ['fmp4_h264_fragmented.mp4', ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-movflags', '+frag_keyframe+empty_moov+default_base_moof']],
  ['mov_h264_aac.mov', ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac']],
  ['mov_prores_hq_pcm.mov', ['-c:v', 'prores_ks', '-profile:v', '3', '-c:a', 'pcm_s16le']],
  // MKV / WebM
  ['mkv_h264_aac.mkv', ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac']],
  ['mkv_h265_opus.mkv', ['-c:v', 'libx265', '-preset', 'veryfast', '-crf', '26', '-c:a', 'libopus', '-b:a', '96k']],
  ['webm_vp8_vorbis.webm', ['-c:v', 'libvpx', '-b:v', '1500k', '-c:a', 'libvorbis']],
  ['webm_vp9_opus.webm', ['-c:v', 'libvpx-vp9', '-b:v', '1200k', '-deadline', 'realtime', '-cpu-used', '5', '-c:a', 'libopus', '-b:a', '96k']],
  // MPEG-TS / PS
  ['mpegts_mpeg2_mp2.ts', ['-c:v', 'mpeg2video', '-b:v', '4M', '-c:a', 'mp2', '-b:a', '192k']],
  ['mpegts_h264_aac.ts', ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-f', 'mpegts']],
  ['mpegts_mpeg2_ac3_dvb.ts', ['-c:v', 'mpeg2video', '-b:v', '4M', '-c:a', 'ac3', '-b:a', '192k']],
  ['mpeg2_ps_dvd.mpg', ['-c:v', 'mpeg2video', '-b:v', '4M', '-c:a', 'mp2', '-f', 'vob']],
  // MXF
  ['mxf_dnxhr_hq_pcm.mxf', ['-c:v', 'dnxhd', '-profile:v', 'dnxhr_hq', '-pix_fmt', 'yuv422p', '-c:a', 'pcm_s16le']],
  ['mxf_mpeg2_pcm.mxf', ['-c:v', 'mpeg2video', '-b:v', '8M', '-pix_fmt', 'yuv422p', '-c:a', 'pcm_s16le']],
  // Legacy
  ['avi_mjpeg_pcm.avi', ['-c:v', 'mjpeg', '-q:v', '5', '-c:a', 'pcm_s16le']],
  ['avi_xvid_mp3.avi', ['-c:v', 'mpeg4', '-vtag', 'xvid', '-q:v', '4', '-c:a', 'libmp3lame', '-b:a', '128k']],
  ['flv_sorenson_mp3.flv', ['-c:v', 'flv', '-q:v', '5', '-c:a', 'libmp3lame', '-ar', '44100', '-b:a', '128k']],
  ['flv_h264_aac.flv', ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-f', 'flv']],
  ['wmv_wmv2_wma.wmv', ['-c:v', 'wmv2', '-b:v', '2M', '-c:a', 'wmav2', '-b:a', '128k']],
];

for (const [file, args] of recipes) {
  const outFile = path.join(gen, file);
  if (existsSync(outFile)) { console.log(`skip  ${file} (exists)`); continue; }
  await step(file, ['-i', master, ...args, outFile]);
}

// AV1 remuxes share the same bitstream
for (const [file, ext] of [['webm_av1_opus.webm', 'webm'], ['mkv_av1_opus.mkv', 'matroska']] as const) {
  const outFile = path.join(gen, file);
  if (existsSync(outFile)) continue;
  await step(file, ['-i', path.join(gen, 'mp4_av1_opus.mp4'), '-c', 'copy', '-f', ext, outFile]);
}

// Streaming packages
const hlsTs = path.join(str, 'hls_ts_abr');
if (!existsSync(path.join(hlsTs, 'master.m3u8'))) {
  mkdirSync(hlsTs, { recursive: true });
  await step('streaming/hls_ts_abr', [
    '-i', master,
    '-filter_complex', '[0:v]split=3[v1][v2][v3];[v1]scale=w=1280:h=720[v1o];[v2]scale=w=854:h=480[v2o];[v3]scale=w=640:h=360[v3o]',
    '-map', '[v1o]', '-c:v:0', 'libx264', '-preset', 'veryfast', '-b:v:0', '2500k',
    '-map', '[v2o]', '-c:v:1', 'libx264', '-preset', 'veryfast', '-b:v:1', '1200k',
    '-map', '[v3o]', '-c:v:2', 'libx264', '-preset', 'veryfast', '-b:v:2', '600k',
    '-map', '0:a', '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
    '-map', '0:a', '-c:a', 'aac', '-b:a', '96k', '-ac', '2',
    '-map', '0:a', '-c:a', 'aac', '-b:a', '64k', '-ac', '2',
    '-g', '60', '-keyint_min', '60', '-sc_threshold', '0',
    '-f', 'hls', '-hls_time', '4', '-hls_playlist_type', 'vod', '-hls_segment_type', 'mpegts',
    '-hls_segment_filename', path.join(hlsTs, 'v%v/seg_%03d.ts'), '-master_pl_name', 'master.m3u8',
    '-var_stream_map', 'v:0,a:0,name:720p v:1,a:1,name:480p v:2,a:2,name:360p',
    path.join(hlsTs, 'v%v/index.m3u8'),
  ]);
}

const hlsCmaf = path.join(str, 'hls_fmp4_cmaf');
if (!existsSync(path.join(hlsCmaf, 'index.m3u8'))) {
  mkdirSync(hlsCmaf, { recursive: true });
  await step('streaming/hls_fmp4_cmaf', [
    '-i', master, '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', '2000k', '-g', '60', '-keyint_min', '60', '-sc_threshold', '0',
    '-c:a', 'aac', '-b:a', '128k',
    '-f', 'hls', '-hls_time', '4', '-hls_playlist_type', 'vod', '-hls_segment_type', 'fmp4', '-hls_fmp4_init_filename', 'init.mp4',
    '-hls_segment_filename', path.join(hlsCmaf, 'seg_%03d.m4s'), path.join(hlsCmaf, 'index.m3u8'),
  ]);
}

const dash = path.join(str, 'dash');
if (!existsSync(path.join(dash, 'manifest.mpd'))) {
  mkdirSync(dash, { recursive: true });
  await step('streaming/dash', [
    '-i', master, '-map', '0:v', '-map', '0:v', '-map', '0:a',
    '-c:v', 'libx264', '-preset', 'veryfast', '-g', '60', '-keyint_min', '60', '-sc_threshold', '0',
    '-b:v:0', '2000k', '-s:v:0', '1280x720', '-b:v:1', '700k', '-s:v:1', '640x360', '-c:a', 'aac', '-b:a', '128k',
    '-f', 'dash', '-seg_duration', '4', '-use_template', '1', '-use_timeline', '1',
    '-adaptation_sets', 'id=0,streams=v id=1,streams=a', path.join(dash, 'manifest.mpd'),
  ]);
}

console.log(`\nDone → ${root}`);

async function step(label: string, args: string[]) {
  const t0 = performance.now();
  process.stdout.write(`make  ${label.padEnd(28)}`);
  await runFfmpeg(args);
  const sec = ((performance.now() - t0) / 1000).toFixed(1);
  const target = args[args.length - 1];
  const size = existsSync(target) && statSync(target).isFile() ? humanBytes(statSync(target).size) : '';
  console.log(`${size.padStart(9)}  ${sec}s`);
}
