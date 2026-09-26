/**
 * 17 — Camera + recording: pick a real camera and a resolution in the browser, send it to Node over WebRTC, and record on the server — the original or the processed video — or grab snapshots.
 *
 *   npm run camera               # then open http://127.0.0.1:3017 in a normal browser window
 *
 *   camera ─▶ browser ══ WebRTC ══▶ Node (libwebrtc): I420 frames ─┬─▶ FrameModes ══ WebRTC ══▶ browser
 *                                                                  └─▶ FrameRecorder ─▶ ffmpeg ─▶ output/camera/rec-….mp4
 *
 * Same peer as example 15 (src/lib/rtc-wrtc.ts); this file only adds recording through its hooks:
 *   tap('in' | 'out')  every frame before / after processing → the recorder (and the next snapshot)
 *   onMessage          {record: 'start', what: 'in' | 'out'}, {record: 'stop'}, {snapshot: 'in' | 'out'}
 * The recorder stamps frames with the wall clock, so the MP4 plays at the real speed even when the camera
 * delivers an uneven frame rate (src/lib/recorder.ts). Files show up in the list on the page and, after
 * the example stops, under Results in the Examples tab.
 *
 * Camera access needs a secure context: http://127.0.0.1 or localhost counts; any other address needs https.
 */
import path from 'node:path';
import { OUTPUT_DIR, SAMPLES_DIR } from '../src/lib/config.js';
import { recordingHooks } from '../src/lib/recorder.js';
import { startRtcServer } from '../src/lib/rtc-server.js';
import { answerWithWrtc } from '../src/lib/rtc-wrtc.js';

const DIR = path.join(OUTPUT_DIR, 'camera');
await startRtcServer({
  title: 'Camera + recording',
  subtitle: 'Your camera goes to Node over WebRTC and comes back — as is or processed. Record on the server what the camera sent or what the server sends back, or take snapshots.',
  flow: 'camera ─▶ browser ══ WebRTC ══▶ Node: I420 frames ─▶ FrameModes ══▶ browser  ·  frames ─▶ ffmpeg ─▶ output/camera/*.mp4',
  port: Number(process.env.RTC_PORT ?? 3017),
  root: SAMPLES_DIR,
  recordings: DIR,
  answer: (offer) => answerWithWrtc(offer, recordingHooks(DIR)),
});
