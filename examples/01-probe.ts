/**
 * 01 — Probe a file: container, codecs, resolution, fps, bitrate.
 *
 *   npm run probe                       # default sample
 *   npm run probe -- path/to/file.mp4   # any file
 */
import { sample } from '../src/lib/config.js';
import { probeSummary } from '../src/lib/ffprobe.js';
import { humanBytes, humanDuration, kbps } from '../src/lib/format.js';

const file = process.argv[2] ?? sample('generated/mp4_h265_aac.mp4');

const s = await probeSummary(file);

console.log(`File:      ${file}`);
console.log(`Container: ${s.container}`);
console.log(`Duration:  ${humanDuration(s.duration)} (${s.duration.toFixed(3)} s)`);
console.log(`Size:      ${humanBytes(s.sizeBytes)}  @ ${kbps(s.bitrate)}`);
if (s.video) {
  console.log(`Video:     ${s.video.codec} ${s.video.profile ?? ''} ${s.video.width}x${s.video.height} ${s.video.fps ?? '?'}fps ${s.video.pixFmt}`);
}
if (s.audio) {
  console.log(`Audio:     ${s.audio.codec} ${s.audio.sampleRate} Hz, ${s.audio.channels} ch`);
}
console.log(`Streams:   ${s.raw.streams.map((x) => `${x.codec_type}:${x.codec_name}`).join(', ')}`);
