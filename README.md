<p align="center">
  <img src="docs/banner.svg" alt="node-video-playground" width="100%">
</p>

<p align="center">
  <a href="#examples"><img alt="examples" src="https://img.shields.io/badge/examples-12-2563eb?style=flat-square"></a>
  <img alt="node" src="https://img.shields.io/badge/node-%E2%89%A5%2020-2563eb?style=flat-square&logo=node.js&logoColor=white">
  <img alt="typescript" src="https://img.shields.io/badge/TypeScript-5.x-2563eb?style=flat-square&logo=typescript&logoColor=white">
  <img alt="ffmpeg" src="https://img.shields.io/badge/ffmpeg-9.x-2563eb?style=flat-square&logo=ffmpeg&logoColor=white">
  <a href="LICENSE"><img alt="license" src="https://img.shields.io/badge/license-MIT-6b7280?style=flat-square"></a>
</p>

<p align="center">
  <b>Small, readable Node.js recipes for the video and audio operations a telecom / OTT backend runs every day.</b><br>
  Probe a file, transcode it, package it for streaming, cut thumbnails, measure quality, normalise loudness — each one a single script you can lift into a real service.
</p>

---

## Why

Video tooling tends to come as either a giant SDK or a wall of ffmpeg flags copied from Stack Overflow. This repo sits in between: a ~230-line typed wrapper around `ffmpeg` / `ffprobe` (`src/lib/`) and one self-contained, commented example per topic. No build step, no framework, nothing to configure — `npm install` and run.

<p align="center">
  <img src="docs/pipeline.svg" alt="source → probe → transcode → package → measure" width="90%">
</p>

## Quick start

```bash
git clone https://github.com/vovadoma/node-video-playground.git && cd node-video-playground
npm install                      # execa + tsx + typescript, that's it
npm run probe                    # ffprobe → typed JSON
npm run hls                      # ABR ladder → HLS/CMAF in one pass
npm run audio                    # EBU R128 loudness + loudnorm on a real voice recording
npm run web                      # browse & play every sample at http://127.0.0.1:3000
```

**Requirements:** Node ≥ 20 and `ffmpeg` / `ffprobe` on `PATH` (`brew install ffmpeg`) with libx264, libx265, libvpx, libaom. `libvmaf` is optional.

## Test media

The repo ships its own test set in [`samples/`](samples/README.md) — 179 files, ~195 MB, every common video and audio container × codec combination plus HLS/DASH packages. All of it is either generated from test patterns or openly licensed (CC BY / Public Domain), and every file has been validated with `ffprobe`:

| Folder | What | Files |
|---|---|---|
| `samples/real-world/` | Real files from [projectivetech/media-samples](https://github.com/projectivetech/media-samples): MP4, MOV, MKV, WebM, AVI, FLV, WMV, MPG, MXF (incl. Avid OP-Atom DNxHD) | 11 |
| `samples/generated/` | One 10 s 720p test pattern encoded as H.264 / H.265 / AV1 / VP8 / VP9 / MPEG-2 / MJPEG / Xvid / Sorenson / WMV2 into MP4, fMP4, MOV, MKV, WebM, TS, PS, MXF, AVI, FLV, ASF — with AAC, Opus, Vorbis, MP2, MP3, AC-3, E-AC-3, PCM audio | 23 |
| `samples/streaming/` | HLS with TS segments + 3-rendition ABR ladder, HLS fMP4/CMAF, MPEG-DASH | 31 |
| [`samples/audio/`](samples/audio/README.md) | Three openly licensed masters — the **same spoken sentence** (LibriSpeech), a jazz track (Kevin MacLeod) and an orchestral excerpt (Brahms) — each encoded into the same 31 variants: PCM / FLAC / ALAC / WavPack, AAC / MP3 / Opus / Vorbis, AC-3 / E-AC-3 (2.0 + 5.1) / DTS / MP2, G.711 / G.722 / G.726 / Speex, WMA. Plus 15 real-world files | 111 |

Two video outputs are too big for GitHub and are git-ignored (ProRes 422 HQ `.mov` ~64 MB, DNxHR HQ `.mxf` ~123 MB). `npm run samples` regenerates the whole `generated/`, `streaming/` and `audio/generated/` set, including those two, from the same ffmpeg recipes — so the matrix is reproducible, not just checked in. Point `SAMPLES_DIR` elsewhere to use your own media.

## Examples

| # | Run | What it shows |
|:-:|---|---|
| 01 | `npm run probe -- [file]` | `ffprobe` → typed `ProbeResult`: container, codecs, resolution, fps, bitrate |
| 02 | `npm run thumb -- [file]` | Poster frame, 4×3 contact sheet, sprite strip for scrub-bar previews |
| 03 | `npm run transcode -- [file]` | H.264 → H.265 / 480p H.264 / VP9 with a live progress bar and size deltas |
| 04 | `npm run hls -- [file]` | One-pass 720/480/360p ABR ladder into HLS with fMP4 (CMAF) segments + master playlist |
| 05 | `npm run quality` | PSNR / SSIM of the `generated/` sample encodes (MP4 · MKV · WebM) against `master_h264_720p.mp4`, as a table |
| 06 | `npm run batch -- [dir]` | Walk a folder, probe every media file in parallel, print a table |
| 07 | `npm run audio -- [file]` | Extract the audio track without re-encoding, convert to Opus / MP3 / AC-3 / WAV, measure EBU R128 loudness (`ebur128`), normalise to −16 LUFS with `loudnorm` — on a real voice recording by default |
| 08 | `npm run frames -- [file]` | Split video into one JPEG per frame. Motion JPEG (all I-frames) is cut with `-c:v copy` — byte-identical to the packets, no decoding; any other codec shows its I/P/B mix and is decoded + re-encoded |
| 09 | `npm run live` → <http://127.0.0.1:3009> | Process video **on the fly**: file stream → ffmpeg stdin → filter (grayscale, negative, edges, mirror, blur, before/after split) → ffmpeg stdout → HTTP response. Delivered as fragmented MP4 to `<video>` or as MJPEG (`multipart/x-mixed-replace`) to `<img>`; nothing touches the disk, backpressure is end to end. Shows which files can't be streamed (MP4 with `moov` at the end → needs `+faststart`) |
| 10 | `npm run watermark` → <http://127.0.0.1:3010> | Same live pipeline as 09, plus a logo **burned into every frame on the fly**: a transparent PNG (`examples/assets/watermark.png`) as a second, looped input → `scale` + `colorchannelmixer` (opacity) → `overlay` with x/y expressions — corner, center, or floating (bounces off the edges with `t`). Effects from 09 still apply |
| 11 | `npm run pip` → <http://127.0.0.1:3011> | **Picture-in-picture on the fly**: two files streamed from disk into one ffmpeg process — the second one through an extra file descriptor (`pipe:3`). `setpts` aligns both at t = 0, the inset is scaled and framed with `pad`, then `overlay`; when it ends it hides or freezes (`eof_action`). Sound from the main video, the inset, or both (`amix`) |
| 12 | `npm run track-analyze -- [file]` | **Find a small, fast-moving object offline**, in three passes over raw frames (plain TypeScript, no OpenCV): 1) per-pixel flicker map → mask; 2) three-frame difference on Y+U+V → blobs → α-β tracks (bouncing off frame edges) → rank by small × fast × long-lived × alone, re-joining pieces of one object; 3) render `output/tracker/analysis.mp4`, `trajectories.png`, `motion-heatmap.png` and write `profile.json` |

Any script also runs directly: `npx tsx examples/03-transcode.ts input.mov`. Results land in `./output/` (git-ignored).

**Adding an example.** Drop `examples/08-something.ts` in — the web UI picks it up without a restart. It reads the header comment: first line `NN — Title: what it shows.`, then usage lines (`npm run …`). If the script reads `process.argv[2] ?? sample('…')` the UI offers a file picker; `process.argv[2] ?? SAMPLES_DIR` gives a folder picker. Write results with `out('…')` so they land in `output/` and show up under *Results*. Add an npm script to `package.json` if you want a short command.

### What it looks like

<table>
<tr>
<td width="50%" valign="top">

**02 — contact sheet** (`output/thumbs/contact-sheet.jpg`)

<img src="docs/contact-sheet.jpg" alt="4x3 contact sheet" width="100%">

</td>
<td width="50%" valign="top">

**03 — transcode with progress**

```
Input: h264 1280x720, 5.09 MB
H.265 720p       [####################] 100% 2.9x
  -> h265_720p.mp4  2.84 MB  (44% smaller, 10.3s)
H.264 480p web   [####################] 100% 12.8x
  -> h264_480p.mp4  992 KB   (81% smaller, 0.8s)
VP9 WebM         [####################] 100% 3.1x
  -> vp9.webm       1.34 MB  (74% smaller, 3.2s)
```

**05 — quality vs. master**

```
file                    size    PSNR    SSIM
mkv_av1_opus.mkv     2.31 MB   43.58  0.9942
mp4_h264_aac.mp4     2.79 MB   42.75  0.9939
mp4_h265_aac.mp4     2.80 MB   42.47  0.9929
webm_vp9_opus.webm   1.59 MB   37.12  0.9792
```

</td>
</tr>
</table>

**04 — HLS master playlist** produced by a single ffmpeg invocation (three video + three audio renditions, aligned 2-second GOPs, 4-second CMAF segments):

```m3u8
#EXTM3U
#EXT-X-VERSION:7
#EXT-X-STREAM-INF:BANDWIDTH=2890800,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2"
720p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1425600,RESOLUTION=854x480,CODECS="avc1.64001f,mp4a.40.2"
480p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=730400,RESOLUTION=640x360,CODECS="avc1.64001e,mp4a.40.2"
360p/index.m3u8
```

**07 — loudness on the LibriSpeech sentence** (`samples/audio/masters/speech_librispeech_16k_mono.wav`):

```
Input audio: pcm_s16le 16000 Hz, 1 ch

Extracted (copy):  output/audio/extracted.mka   436.6 KB
Converted:         output/audio/opus_64k.opus    118.9 KB
Converted:         output/audio/mp3_128k.mp3     219.4 KB
Converted:         output/audio/ac3_192k.ac3     327.4 KB
Converted:         output/audio/pcm16_48k.wav     1.28 MB

Loudness (EBU R128): integrated -27.9 LUFS, range 3.1 LU, true peak -7.4 dBTP
Normalised to -16 LUFS → measured -16.5 LUFS
```

## Web player

`npm run web` starts a zero-dependency server (`node:http`, no build step) at <http://127.0.0.1:3000> (`PORT` to change) that lists everything under `SAMPLES_DIR` and plays what the browser can:

- **Library** — every file is probed once at startup and shown as a card (preview, codecs, resolution, duration, size) under three tabs: **Video**, **Audio**, **Streaming**, grouped by folder, with search. Only browser-playable files are listed; `Rescan` re-probes. Clicking a card opens the player with the ffprobe details.
- **Playability** is decided from the real codecs, not the extension: **yes** (H.264 / VP8 / VP9 / AV1-in-WebM, AAC / MP3 / Opus / Vorbis / FLAC / PCM), **maybe** (H.265, ALAC, AC-3/E-AC-3, Matroska, AV1-in-MP4 — refined with `canPlayType()` in your browser), **no** (AVI, FLV, WMV, MXF, MPEG-PS/TS, ProRes, DNxHR, DTS, WMA, G.72x, AMR…). The last group is hidden; *maybe* cards carry a *Limited* badge.
- **Streaming** — HLS playlists play via [hls.js](https://github.com/video-dev/hls.js) (natively in Safari), DASH via [dash.js](https://github.com/Dash-Industry-Forum/dash.js), both from the jsDelivr CDN; segments are hidden from the list.
- **Seeking** works because `/media/*` honours HTTP `Range` (206 / 416). The server binds to `127.0.0.1` and refuses paths outside `SAMPLES_DIR`.
- **Examples tab** — every `examples/NN-name.ts` shows up as a card; open one to pick an input from `samples/`, press **Run** and watch the console live (progress bars included). When it finishes, the files it wrote to `output/` appear as playable cards. One run at a time; *Stop* kills the whole process group (ffmpeg included). The last run of each example is kept in `output/.runs/`.
- **ffmpeg check** — on start (and on *Rescan*) the server checks that `ffmpeg` / `ffprobe` can run (`/api/health`). If not, a banner shows the install command and *Run* is disabled; install it and press *Check again* — no restart needed.
- **Extending** — cards are an HTML `<template>` filled from a plain model object: a new file tab is one entry in `TABS`, a new kind of card is one function in `CARD_MODELS` (`web/public/app.js`), a tab with its own UI is `registerTab({…})` (see `web/public/examples.js`); styles live in `web/public/styles.css`.

## How it's put together

```
src/lib/
  config.ts    SAMPLES_DIR / OUTPUT_DIR / binary paths · sample() & out() helpers · tiny .env loader
  ffprobe.ts   probe() → typed ProbeResult · probeSummary() for the common fields
  ffmpeg.ts    runFfmpeg() with -progress parsing & callbacks · runFfmpegCapture() for filter stats · ffmpegStream() stream(s) → ffmpeg → stream (extra inputs as pipe:3, pipe:4…)
  format.ts    humanBytes / humanDuration / kbps
  live.ts      live server for 09–11: streamability check (moov first?), fMP4 / MJPEG delivery, backpressure stats, page
  effects.ts   picture effects as ffmpeg filters + the before/after split graph
  rawframes.ts decodeFrames() / encodeFrames(): video ⇄ raw yuv420p frames as Node Buffers
  motion.ts    motion detection & tracking: three-frame difference, blobs, α-β tracker, scoring
  draw.ts      drawing into yuv420p: lines, circles, crosshair, brackets, a 3×5 pixel font
examples/      01…12, one topic per file, numbered in learning order
scripts/       make-samples.ts — regenerates the sample matrix with ffmpeg
web/           server.ts entry · engine/ (router, Range files, SSE) · system/ (ffmpeg check) · catalog/ (ffprobe scan, playability rules) · examples/ (discover & run examples) · routes.ts · public/ (UI, no build)
samples/       test media — video (samples/README.md) and audio (samples/audio/README.md) catalogs
docs/          images for this README
```

The wrapper is deliberately thin. `runFfmpeg(args, { onProgress })` spawns the binary with `-progress pipe:1`, parses the `key=value` stream and hands you `{ frame, fps, timeSec, speed, percent }` — the same thing you'd feed into a job queue or a WebSocket. Everything else is plain ffmpeg arguments, so any recipe from the ffmpeg docs drops in unchanged.

## Configuration

Copy `.env.example` to `.env` or export variables; shell always wins.

| Variable | Default | Purpose |
|---|---|---|
| `SAMPLES_DIR` | `./samples` | where `sample('…')` looks for inputs |
| `OUTPUT_DIR` | `./output` | where `out('…')` writes results |
| `FFMPEG_BIN` / `FFPROBE_BIN` | `ffmpeg` / `ffprobe` | override binaries |

## Roadmap

- [ ] MPEG-DASH packaging sharing CMAF segments with HLS
- [ ] Server-side ad insertion: splice a bumper into a TS stream with `concat`
- [ ] Live: SRT/RTMP input → HLS folder with a sliding window
- [ ] Scene detection (`select='gt(scene,0.4)'`) for automatic chapters and thumbnails
- [ ] VMAF via `libvmaf` and a per-title encoding ladder
- [ ] Job queue on BullMQ + Redis with progress over WebSocket

## License

[MIT](LICENSE). Generated video test patterns come from ffmpeg's `testsrc2`; real-world samples from [projectivetech/media-samples](https://github.com/projectivetech/media-samples); audio masters are CC BY / Public Domain recordings via [librosa/data](https://github.com/librosa/data) — see [`samples/audio/masters/LICENSES.md`](samples/audio/masters/LICENSES.md).
