/**
 * 09 — Live transform: read a file as a stream, process it with ffmpeg on the fly and send the result straight to the browser — nothing is written to disk.
 *
 *   npm run live                 # then open http://127.0.0.1:3009
 *
 *   disk ─ createReadStream ─▶ ffmpeg stdin ─ filter ─▶ ffmpeg stdout ─▶ HTTP response ─▶ <video> / <img>
 *
 * Two ways to deliver the processed stream (src/lib/live.ts):
 *   /stream.mp4    fragmented MP4 (H.264 + AAC) for <video>: plays while it is being produced
 *                  (Chrome, Firefox, Edge — Safari insists on Range requests, which a live stream can't do)
 *   /stream.mjpeg  Motion JPEG as multipart/x-mixed-replace for <img>: each frame is shown the moment
 *                  it arrives, works everywhere incl. Safari, no sound (see example 08 for MJPEG)
 *
 * A pipe can't seek backwards, so an MP4/MOV whose index (moov box) sits at the END of the file can't be
 * read as a stream — it needs `-movflags +faststart`. MKV, WebM, MPEG-TS, AVI, FLV… stream fine.
 * Backpressure is end to end: when the browser's buffer is full, ffmpeg blocks and disk reads pause.
 *
 * The only thing this example decides is the filter graph; server, page and stats are in src/lib/live.ts,
 * the effects in src/lib/effects.ts.
 */
import { SAMPLES_DIR } from '../src/lib/config.js';
import { effectControls, effectGraph } from '../src/lib/effects.js';
import { startLiveServer } from '../src/lib/live.js';

await startLiveServer({
  title: 'Live transform',
  subtitle: 'The file is read from disk as a stream, piped through ffmpeg and sent to this page as it is produced. Nothing is saved.',
  port: Number(process.env.LIVE_PORT ?? 3009),
  root: SAMPLES_DIR,
  controlsHtml: effectControls(),
  // input 0 = the piped file → effect → [v]
  buildArgs: (_source, params) => ({
    filter: effectGraph(params.get('fx') ?? 'gray', params.get('split') === '1', '[v]'),
    label: '[v]',
  }),
});
