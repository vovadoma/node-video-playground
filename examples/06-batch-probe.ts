/**
 * 06 — Walk the samples folder and print a table of every media file
 *      (container, video codec, audio codec, resolution, size). Runs probes in parallel.
 *
 *   npm run batch
 *   npm run batch -- /some/other/folder
 */
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { SAMPLES_DIR } from '../src/lib/config.js';
import { probeSummary } from '../src/lib/ffprobe.js';
import { humanBytes } from '../src/lib/format.js';

const root = process.argv[2] ?? SAMPLES_DIR;
const MEDIA = /\.(mp4|m4v|mov|mkv|webm|avi|flv|wmv|mpg|mpeg|ts|m2ts|mxf|3gp|ogv|mp3|m4a|aac|ac3|eac3|dts|flac|wav|aiff?|au|ogg|opus|wma|wv|mka|amr|ra|voc|mp2|g722)$/i;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : MEDIA.test(e.name) ? [p] : [];
  });
}

const files = walk(root).sort();
console.log(`${files.length} media files under ${root}\n`);

const CONCURRENCY = 4;
const rows: string[][] = [];
for (let i = 0; i < files.length; i += CONCURRENCY) {
  const batch = files.slice(i, i + CONCURRENCY);
  const results = await Promise.all(batch.map(async (f) => {
    try {
      const s = await probeSummary(f);
      return [
        path.relative(root, f),
        s.container.split(',')[0],
        s.video ? `${s.video.codec}` : '-',
        s.audio ? `${s.audio.codec}` : '-',
        s.video ? `${s.video.width}x${s.video.height}` : '-',
        s.duration.toFixed(1) + 's',
        humanBytes(statSync(f).size),
      ];
    } catch (e) {
      return [path.relative(root, f), 'ERROR', String((e as Error).message).split('\n')[0]];
    }
  }));
  rows.push(...results);
}

const widths = rows[0].map((_, c) => Math.max(...rows.map((r) => (r[c] ?? '').length)));
for (const r of rows) console.log(r.map((cell, c) => (cell ?? '').padEnd(widths[c])).join('  '));
