# Test Video Sample Catalog

Video part of the repo's test set: `samples/real-world/`, `samples/generated/`, `samples/streaming/` — 65 files, ~130 MB. The audio set has its own catalog in [`audio/README.md`](audio/README.md). Every file has been validated with `ffprobe`.

Two large files (ProRes 422 HQ `.mov` ~64 MB, DNxHR HQ `.mxf` ~123 MB) are git-ignored because of GitHub's file-size limits — run `npm run samples` to regenerate them (and anything else in `generated/` and `streaming/`) with the same ffmpeg recipes.

Three groups:

- `real-world/` — real files from the open GitHub repository [projectivetech/media-samples](https://github.com/projectivetech/media-samples) (legacy/older formats as they appear "in the wild").
- `generated/` — a full container × codec matrix produced with ffmpeg from the `testsrc2` test pattern, 1280×720, 30 fps, 10 s, plus a 440 Hz sine tone. The content is identical across all files, so they are convenient for comparing file sizes, transcoding speed and quality (PSNR/SSIM/VMAF against `master_h264_720p.mp4`).
- `streaming/` — HLS and DASH packages generated from the same master.

## real-world/ (from GitHub)

| File | Container | Video | Audio | Size |
|---|---|---|---|---|
| sample.mp4 | MP4 | H.264 Constrained Baseline 560×320 | AAC | 384 KB |
| sample.mov | MOV | MPEG-4 Part 2 (Simple) 560×320 | AAC | 470 KB |
| sample.mkv | MKV | H.264 Constrained Baseline 560×320 | AAC | 417 KB |
| sample.webm | WebM | VP8 640×360 | Vorbis | 337 KB |
| sample.avi | AVI | MPEG-4 Part 2 (Simple) 320×240 | MP3 | 376 KB |
| sample.flv | FLV | Sorenson Spark (flv1) 320×240 | MP3 | 303 KB |
| sample.wmv | ASF/WMV | WMV2 320×240 | WMA v2 | 554 KB |
| sample.mpg | MPEG-PS | MPEG-1 560×320 | MP2 | 629 KB |
| sample.mxf | MXF | MPEG-2 Main 720×576 (SD PAL) | — | 624 KB |
| domdom.mov.V159CD0127V.mxf | MXF OP-Atom (video) | DNxHD 1280×720 4:2:2 | — | 15 MB |
| domdom.mov.A159CD0127A.mxf | MXF OP-Atom (audio) | — | PCM 24-bit | 410 KB |

OP-Atom is the Avid flavour of MXF: video and each audio track live in separate MXF files.

## generated/ (ffmpeg, 1280×720, 10 s)

### MP4 / MOV (ISO BMFF)

| File | Video codec | Audio | Size | Note |
|---|---|---|---|---|
| master_h264_720p.mp4 | H.264 High, CRF 18 | AAC 128k | 5.3 MB | Reference for comparisons |
| mp4_h264_aac.mp4 | H.264 High, CRF 23 | AAC 128k | 2.9 MB | +faststart (moov at the front) |
| mp4_h265_aac.mp4 | H.265/HEVC Main, CRF 26, tag hvc1 | AAC 128k | 2.9 MB | hvc1 tag required by Apple players |
| mp4_av1_opus.mp4 | AV1 Main (libaom, cpu-used 8, CRF 35) | Opus 96k | 2.4 MB | |
| mp4_h264_eac3.mp4 | H.264 | E-AC-3 (Dolby Digital Plus) 192k | 3.1 MB | Typical TV/OTT audio |
| fmp4_h264_fragmented.mp4 | H.264 | AAC | 2.9 MB | Fragmented MP4 (moof), the basis of CMAF |
| mov_h264_aac.mov | H.264 | AAC | 2.9 MB | QuickTime container |
| mov_prores_hq_pcm.mov | Apple ProRes 422 HQ, 10-bit 4:2:2 | PCM 16-bit | 64 MB | Editing/mezzanine |

### MKV / WebM (Matroska)

| File | Video codec | Audio | Size |
|---|---|---|---|
| mkv_h264_aac.mkv | H.264 | AAC | 2.9 MB |
| mkv_h265_opus.mkv | H.265/HEVC | Opus | 3.0 MB |
| mkv_av1_opus.mkv | AV1 | Opus | 2.4 MB |
| webm_vp8_vorbis.webm | VP8 1500k | Vorbis | 1.9 MB |
| webm_vp9_opus.webm | VP9 Profile 0, 1200k | Opus | 1.7 MB |
| webm_av1_opus.webm | AV1 | Opus | 2.4 MB |

### MPEG-TS / MPEG-PS (broadcast)

| File | Video codec | Audio | Size | Note |
|---|---|---|---|---|
| mpegts_mpeg2_mp2.ts | MPEG-2 Main 4 Mbps | MP2 192k | 5.5 MB | Classic DVB SD/HD |
| mpegts_mpeg2_ac3_dvb.ts | MPEG-2 4 Mbps | AC-3 (Dolby Digital) | 5.5 MB | DVB with Dolby |
| mpegts_h264_aac.ts | H.264 | AAC | 3.1 MB | Modern IPTV / HLS segment |
| mpeg2_ps_dvd.mpg | MPEG-2 (Program Stream, VOB) | MP2 | 5.6 MB | DVD-style |

### MXF (broadcast production)

| File | Video codec | Audio | Size |
|---|---|---|---|
| mxf_dnxhr_hq_pcm.mxf | Avid DNxHR HQ 4:2:2 | PCM 16-bit | 123 MB |
| mxf_mpeg2_pcm.mxf | MPEG-2 4:2:2 Profile 8 Mbps (XDCAM-like) | PCM 16-bit | 11 MB |

### Legacy / special

| File | Video codec | Audio | Size | Note |
|---|---|---|---|---|
| avi_mjpeg_pcm.avi | Motion JPEG q5 | PCM | 15 MB | Surveillance cameras |
| avi_xvid_mp3.avi | MPEG-4 Part 2 (Xvid) | MP3 | 9.1 MB | DivX/Xvid era |
| flv_sorenson_mp3.flv | Sorenson Spark (flv1) | MP3 44.1k | 7.9 MB | Old Flash video |
| flv_h264_aac.flv | H.264 | AAC | 2.9 MB | RTMP-style |
| wmv_wmv2_wma.wmv | WMV2 (WMV8) 2 Mbps | WMA v2 | 2.8 MB | Windows Media |

## streaming/

| Folder | Protocol | Contents |
|---|---|---|
| hls_ts_abr/ | HLS, TS segments | `master.m3u8` + 3 renditions (720p 2.5M / 480p 1.2M / 360p 600k), 4 s segments, GOP 60 |
| hls_fmp4_cmaf/ | HLS, fMP4 (CMAF) | `index.m3u8`, `init.mp4`, `.m4s` segments |
| dash/ | MPEG-DASH | `manifest.mpd` (SegmentTemplate + Timeline), 2 video representations (720p/360p) + 1 audio |

To play locally: `ffplay samples/streaming/hls_ts_abr/master.m3u8`, or run `python3 -m http.server` inside `samples/streaming/` and open it in hls.js / dash.js / Safari. `npm run hls` builds a fresh package into `output/hls/`.

## What's missing and where to get it

- **Real large masters** (ProRes/IMF/Dolby Vision, gigabytes): [Netflix Open Content](https://opencontent.netflix.com/) — `http://download.opencontent.netflix.com/` (Meridian, Sparks, Sol Levante, Nocturne).
- **Raw Y4M sequences for quality metrics**: [Xiph derf collection](https://media.xiph.org/video/derf/).
- **Big Buck Bunny in every codec, 1–30 MB**: [test-videos.co.uk](https://test-videos.co.uk/).
- **Public HLS/DASH streams (Apple BipBop, DASH-IF, Widevine)**: [bengarney/list-of-streams](https://github.com/bengarney/list-of-streams).
- **H.266/VVC** — the ffmpeg build on the Mac has no encoder; samples are available from [Fraunhofer VVC](https://github.com/fraunhoferhhi/vvenc).

## How it was generated

```bash
# master
ffmpeg -f lavfi -i "testsrc2=size=1280x720:rate=30:duration=10" \
       -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=10" \
       -c:v libx264 -preset veryfast -crf 18 -pix_fmt yuv420p -c:a aac -b:a 128k master_h264_720p.mp4
# every other file is `ffmpeg -i master_h264_720p.mp4 -c:v <codec> -c:a <audio> <file>`
```

The exact arguments for every file live in [`scripts/make-samples.ts`](../scripts/make-samples.ts).

