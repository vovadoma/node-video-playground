/**
 * 18 — Screen capture: share your screen, a window or a tab from the browser, stream it to Node over WebRTC, see which areas change and record it on the server.
 *
 *   npm run screen               # then open http://127.0.0.1:3018 in a normal browser window
 *
 *   getDisplayMedia ─▶ browser ══ WebRTC ══▶ Node: I420 frames ─┬─▶ "changes": dirty rectangles ══▶ browser
 *                                                               └─▶ FrameRecorder ─▶ output/screen/rec-….mp4
 *
 * The same page and peer as examples 15 and 17, started with the screen as the source and the "changes"
 * mode: the server compares every frame with the previous one on 8×8 blocks, outlines the regions that
 * changed and shows the share of the picture that did — a screen at rest changes ~0 %, which is why
 * screen-sharing codecs send so little. The track carries contentHint = 'detail', so the encoder keeps
 * text sharp and lowers the frame rate rather than the resolution when bandwidth is short.
 *
 * Notes:
 *   • the browser shows its own picker (entire screen / window / tab); "Stop sharing" ends the session
 *   • macOS: the browser needs Privacy & Security → Screen Recording, or the picker stays empty
 *   • sharing the page itself shows the famous infinite mirror — pick another window or tab
 */
import path from 'node:path';
import { OUTPUT_DIR, SAMPLES_DIR } from '../src/lib/config.js';
import { recordingHooks } from '../src/lib/recorder.js';
import { startRtcServer } from '../src/lib/rtc-server.js';
import { answerWithWrtc } from '../src/lib/rtc-wrtc.js';

const DIR = path.join(OUTPUT_DIR, 'screen');

await startRtcServer({
  title: 'Screen capture',
  subtitle: 'Share a screen, a window or a tab: it goes to Node over WebRTC, the server outlines what changed since the previous frame, and you can record it on the server.',
  flow: 'getDisplayMedia ─▶ browser ══ WebRTC ══▶ Node: I420 frames ─▶ changed regions ══▶ browser  ·  frames ─▶ ffmpeg ─▶ output/screen/*.mp4',
  port: Number(process.env.RTC_PORT ?? 3018),
  root: SAMPLES_DIR,
  recordings: DIR,
  defaults: { source: 'screen', mode: 'changes' },
  answer: (offer) => answerWithWrtc(offer, recordingHooks(DIR)),
});
