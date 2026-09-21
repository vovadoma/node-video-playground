/**
 * 02 — Thumbnails: one poster frame + a contact sheet (grid of N frames).
 *
 *   npm run thumb
 */
import { out, sample } from '../src/lib/config.js';
import { runFfmpeg } from '../src/lib/ffmpeg.js';
import { probeSummary } from '../src/lib/ffprobe.js';

const input = process.argv[2] ?? sample('generated/master_h264_720p.mp4');
const { duration } = await probeSummary(input);

// 1. Single poster frame at 25% of the duration, scaled to 640px wide
const poster = out('thumbs/poster.jpg');
await runFfmpeg([
  '-ss', String(duration * 0.25),   // seek BEFORE -i = fast keyframe seek
  '-i', input,
  '-frames:v', '1',
  '-vf', 'scale=640:-2',
  '-q:v', '3',                      // JPEG quality (2 = best, 31 = worst)
  poster,
]);
console.log(`Poster:        ${poster}`);

// 2. Contact sheet: 4x3 grid, one frame every duration/12 seconds
const cols = 4, rows = 3;
const every = duration / (cols * rows);
const sheet = out('thumbs/contact-sheet.jpg');
await runFfmpeg([
  '-i', input,
  '-vf', `fps=1/${every},scale=320:-2,tile=${cols}x${rows}:padding=4:margin=4`,
  '-frames:v', '1',
  '-q:v', '4',
  sheet,
]);
console.log(`Contact sheet: ${sheet}`);

// 3. Sprite strip for a player scrub-bar preview (1 frame / 2 s, 160px wide)
const sprite = out('thumbs/sprite.jpg');
await runFfmpeg([
  '-i', input,
  '-vf', `fps=1/2,scale=160:-2,tile=${Math.ceil(duration / 2)}x1`,
  '-frames:v', '1',
  sprite,
]);
console.log(`Sprite strip:  ${sprite}`);
