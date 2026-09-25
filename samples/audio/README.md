# Test Audio Sample Catalog

47 files, ~23 MB. Every file validated with `ffprobe`. Regenerate `generated/` with `npm run samples`.

- `real-world/` — real files from [projectivetech/media-samples](https://github.com/projectivetech/media-samples): low-quality, odd sample rates (11 025 Hz mono), the kind of input a transcoder actually meets.
- `generated/` — one 10 s stereo master (48 kHz / 24-bit PCM, 440 Hz left + 220 Hz right) encoded into every audio codec the local ffmpeg build ships. Same content everywhere, so sizes and quality are directly comparable.

## real-world/ (from GitHub)

| File | Container | Codec | Rate / ch |
|---|---|---|---|
| sample.mp3 | MP3 | MP3 128k | 44.1k / 2 |
| sample.aac | ADTS | AAC-LC | 44.1k / 2 |
| sample.m4a | MP4 | AAC-LC | 44.1k / 2 |
| sample.ac3 | AC-3 | Dolby Digital 128k | 48k / 2 |
| sample.flac | FLAC | FLAC 16-bit | 11k / 1 |
| sample.ogg | Ogg | FLAC (Ogg-wrapped, not Vorbis) | 44.1k / 2 |
| sample.wav | WAV | PCM unsigned 8-bit | 11k / 1 |
| sample.aif / sample.aiff | AIFF | PCM 16-bit BE | 11k / 1 |
| sample.au | Sun AU | PCM 16-bit BE | 11k / 1 |
| sample.mka | Matroska | MP2 | 44.1k / 2 |
| sample.amr | AMR | AMR-WB | 16k / 1 |
| sample.wma | ASF | MP3 (yes, inside WMA) | 11k / 1 |
| sample.ra | RealMedia | AC-3 | 11k / 1 |
| sample.voc | Creative VOC | PCM u8 | 11k / 1 |

## generated/ (ffmpeg, 10 s stereo)

### Lossless / PCM

| File | Codec | Rate / bits | Size |
|---|---|---|---|
| master_pcm24_48k_stereo.wav | PCM s24le | 48k / 24 | 2.9 MB |
| wav_pcm16_48k.wav | PCM s16le | 48k / 16 | 1.9 MB |
| wav_pcm16_44k1.wav | PCM s16le | 44.1k / 16 | 1.8 MB |
| wav_pcm24_96k.wav | PCM s24le | 96k / 24 | 5.8 MB |
| wav_adpcm_ima.wav | IMA ADPCM (4-bit) | 48k | 483 KB |
| aiff_pcm16.aiff | PCM s16be (Apple AIFF) | 48k / 16 | 1.9 MB |
| au_pcm16.au | PCM s16be (Sun AU) | 48k / 16 | 1.9 MB |
| flac_lossless.flac | FLAC level 8 | 48k / 24 | 268 KB |
| m4a_alac_lossless.m4a | Apple Lossless | 48k / 24 | 1.3 MB |
| wv_wavpack.wv | WavPack | 48k / 24 | 543 KB |

### Lossy — streaming / OTT / web

| File | Codec | Bitrate | Size | Use |
|---|---|---|---|---|
| m4a_aac_lc_128k.m4a | AAC-LC in MP4 | 128k | 90 KB | HLS/DASH default |
| m4a_aac_lc_64k.m4a | AAC-LC | 64k | 84 KB | Low-bitrate rendition |
| aac_adts_128k.aac | AAC-LC in ADTS (raw stream) | 128k | 91 KB | MPEG-TS / broadcast |
| mp3_cbr_192k.mp3 | MP3 CBR | 192k | 241 KB | Legacy compatibility |
| mp3_vbr_q2.mp3 | MP3 VBR (LAME -q2) | ~190k avg | 62 KB* | Podcasts |
| opus_96k.opus | Opus in Ogg | 96k | 154 KB | WebRTC, modern web |
| opus_voip_24k.opus | Opus, VoIP mode | 24k | 51 KB | Calls |
| webm_opus_96k.webm | Opus in WebM | 96k | 157 KB | Browser playback |
| ogg_vorbis_q5.ogg | Vorbis q5 | ~160k | 63 KB* | Games, older web |

\* Pure sine tones compress extremely well under VBR; real music would be 3–5× larger.

### Broadcast / TV

| File | Codec | Channels | Bitrate | Size |
|---|---|---|---|---|
| ac3_192k.ac3 | AC-3 (Dolby Digital) | 2.0 | 192k | 240 KB |
| ac3_5.1_448k.ac3 | AC-3 | 5.1 | 448k | 561 KB |
| eac3_128k.eac3 | E-AC-3 (Dolby Digital Plus) | 2.0 | 128k | 160 KB |
| eac3_5.1_384k.eac3 | E-AC-3 | 5.1 | 384k | 481 KB |
| dts_768k.dts | DTS core | 2.0 | 768k | 961 KB |
| mp2_192k.mp2 | MPEG-1 Layer II (ffmpeg) | 2.0 | 192k | 240 KB |
| mp2_twolame_192k.mp2 | MPEG-1 Layer II (TwoLAME) | 2.0 | 192k | 240 KB |

The 5.1 files are derived from the stereo master by a `pan` filter (FC = mix, LFE = −14 dB, rears = half) — useful for testing downmix and channel-layout handling, not for listening.

### Telephony / voice

| File | Codec | Rate / ch | Bitrate | Size |
|---|---|---|---|---|
| g722_16k_mono.g722 | G.722 (wideband) | 16k / 1 | 64k | 80 KB |
| g726_32k_mono.wav | G.726 ADPCM | 8k / 1 | 32k | 40 KB |
| wav_alaw_8k_mono.wav | G.711 A-law | 8k / 1 | 64k | 80 KB |
| wav_mulaw_8k_mono.wav | G.711 µ-law | 8k / 1 | 64k | 80 KB |
| ogg_speex_16k_mono.ogg | Speex wideband | 16k / 1 | ~28k | 36 KB |

### Legacy

| File | Codec | Bitrate | Size |
|---|---|---|---|
| wma_wmav2_128k.wma | Windows Media Audio v2 | 128k | 189 KB |

## Not included

- **HE-AAC / HE-AAC v2 / xHE-AAC** — need `libfdk_aac`, which is not in stock ffmpeg builds (licence). Install ffmpeg with `--enable-libfdk-aac` and use `-c:a libfdk_aac -profile:a aac_he_v2`.
- **Dolby Atmos / TrueHD / DTS:X** — ffmpeg's `truehd` and `mlp` encoders are experimental and produce core-only streams; real samples: [Dolby test signals](https://ott.dolby.com/OnDelKits/DDP/Dolby_Digital_Plus_Online_Delivery_Kit_v1.4.1/Test_Signals/muxed_streams/MPEG2TS/MPEG2TS_Muxed_Streams.html).
- **AMR-NB / AMR-WB encode** — needs `libopencore-amr` / `libvo-amrwbenc`; a real AMR-WB file is in `real-world/`.
- **MIDI** — not audio (it's a note sequence); ffmpeg can't read it. Removed.
