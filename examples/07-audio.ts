/**
 * 07 — Audio: extract from a video, convert between codecs, and measure loudness (EBU R128).
 *
 *   npm run audio
 *   npm run audio -- samples/generated/mp4_h264_eac3.mp4
 */
import { statSync } from 'node:fs';
import { out, sample } from '../src/lib/config.js';
import { runFfmpeg, runFfmpegCapture } from '../src/lib/ffmpeg.js';
import { probeSummary } from '../src/lib/ffprobe.js';
import { humanBytes } from '../src/lib/format.js';

const input = process.argv[2] ?? sample('audio/masters/speech_librispeech_16k_mono.wav');
const src = await probeSummary(input);
console.log(`Input audio: ${src.audio?.codec} ${src.audio?.sampleRate} Hz, ${src.audio?.channels} ch\n`);

// 1. Extract the audio track without re-encoding (container change only).
//    Matroska (.mka) accepts any codec — PCM, AAC, AC-3 … — so it's a safe target for stream copy;
//    for AAC you could use .m4a, for AC-3 a raw .ac3, but those refuse PCM.
const extracted = out('audio/extracted.mka');
await runFfmpeg(['-i', input, '-vn', '-c:a', 'copy', extracted]);
console.log(`Extracted (copy):  ${extracted}  ${humanBytes(statSync(extracted).size)}`);

// 2. Convert to a few delivery formats
const targets: Array<[string, string[]]> = [
  ['audio/opus_64k.opus', ['-c:a', 'libopus', '-b:a', '64k']],
  ['audio/mp3_128k.mp3', ['-c:a', 'libmp3lame', '-b:a', '128k']],
  ['audio/ac3_192k.ac3', ['-c:a', 'ac3', '-b:a', '192k']],
  ['audio/pcm16_48k.wav', ['-c:a', 'pcm_s16le', '-ar', '48000']],
];
for (const [file, args] of targets) {
  const dst = out(file);
  await runFfmpeg(['-i', input, '-vn', ...args, dst]);
  console.log(`Converted:         ${dst}  ${humanBytes(statSync(dst).size)}`);
}

// 3. Measure integrated loudness / true peak / range (EBU R128) with the ebur128 filter
const m = await measureLoudness(input);
console.log(`\nLoudness (EBU R128): integrated ${m.integrated} LUFS, range ${m.range} LU, true peak ${m.truePeak} dBTP`);

// 4. Normalise to a streaming target (-16 LUFS; broadcast EBU R128 would be -23) with loudnorm
const normalized = out('audio/normalized_-16lufs.m4a');
// loudnorm works at 192 kHz internally and outputs that rate — set it back explicitly
const rate = String(src.audio?.sampleRate || 48000);
await runFfmpeg(['-i', input, '-vn', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', rate, '-c:a', 'aac', '-b:a', '128k', normalized]);
const after = await measureLoudness(normalized);
console.log(`Normalised to -16 LUFS → measured ${after.integrated} LUFS  (${normalized})`);

/**
 * ebur128 prints a running status line per frame and a "Summary" block at the end;
 * the summary is what we want, so parse the LAST occurrence of each key.
 */
async function measureLoudness(file: string) {
  const stderr = await runFfmpegCapture(['-i', file, '-vn', '-af', 'ebur128=peak=true', '-f', 'null', '-']);
  const last = (re: RegExp) => [...stderr.matchAll(re)].at(-1)?.[1] ?? 'n/a';
  return {
    integrated: last(/I:\s+(-?[\d.]+) LUFS/g),
    range: last(/LRA:\s+(-?[\d.]+) LU/g),
    truePeak: last(/Peak:\s+(-?[\d.]+) dBFS/g),
  };
}
