# node-video-playground

Node.js (TypeScript, ESM) examples for working with video files — the kind of operations a telecom / OTT backend runs every day: probing, transcoding, packaging for streaming, thumbnails, quality metrics.

Everything shells out to **ffmpeg / ffprobe** through a tiny wrapper (`src/lib/`) — no heavy SDKs, so each example is a readable recipe you can copy into a real service.

## Requirements

- Node.js ≥ 20
- `ffmpeg` and `ffprobe` on `PATH` (`brew install ffmpeg`). Needs libx264, libx265, libvpx; libvmaf optional.
- Test media in `~/Movies/video-samples` (see its `README.md` for the full catalog), or point `SAMPLES_DIR` elsewhere.

## Setup

```bash
npm install
cp .env.example .env   # optional: SAMPLES_DIR, OUTPUT_DIR, FFMPEG_BIN
```

`.env` is loaded by `src/lib/config.ts`; shell variables take precedence (`SAMPLES_DIR=/path npm run probe`).

## Examples

| # | Script | What it shows |
|---|---|---|
| 01 | `npm run probe [file]` | ffprobe → typed JSON: container, codecs, resolution, fps, bitrate |
| 02 | `npm run thumb [file]` | Poster frame, 4×3 contact sheet, sprite strip for scrub-bar previews |
| 03 | `npm run transcode [file]` | H.264 → H.265 / 480p H.264 / VP9 with a live progress bar and size comparison |
| 04 | `npm run hls [file]` | One-pass ABR ladder (720/480/360p) into HLS with fMP4 (CMAF) segments + master playlist |
| 05 | `npm run quality` | PSNR / SSIM of every generated encode against the master |
| 06 | `npm run batch [dir]` | Walk a folder, probe every media file in parallel, print a table |

Run any script directly: `npx tsx examples/03-transcode.ts input.mov`.
Outputs land in `./output/` (git-ignored).

## Project layout

```
src/lib/
  config.ts    SAMPLES_DIR / OUTPUT_DIR / binary paths, sample() & out() helpers
  ffprobe.ts   probe() → typed ProbeResult, probeSummary() convenience
  ffmpeg.ts    runFfmpeg() with -progress parsing, runFfmpegCapture() for filter stats
  format.ts    humanBytes / humanDuration / kbps
examples/      one self-contained script per topic, numbered
output/        results (ignored)
```

## Ideas for next examples

- DASH packaging (`-f dash`) and CMAF shared with HLS
- Server-side ad insertion: splice a bumper into a TS stream with `concat`
- Live: read an SRT/RTMP input and push to an HLS folder with a sliding window
- Scene detection (`select='gt(scene,0.4)'`) for automatic chapter/thumbnail points
- Loudness normalisation to EBU R128 (`loudnorm`) for broadcast compliance
- VMAF with `libvmaf` and a per-title encoding ladder
- Queue the jobs with BullMQ + Redis and expose progress over WebSocket

## License

MIT. Test media: Big Buck Bunny-style test patterns generated with ffmpeg; real-world samples from [projectivetech/media-samples](https://github.com/projectivetech/media-samples).
