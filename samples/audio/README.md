# Test Audio Sample Catalog

114 files, ~62 MB. Every file validated with `ffprobe`. Regenerate `generated/` with `npm run samples`.

- `masters/` — three real, openly licensed recordings (see [`masters/LICENSES.md`](masters/LICENSES.md)):
  - **speech** — one English sentence from an audiobook (LibriSpeech, 16 kHz mono, 13.9 s, CC BY 4.0)
  - **music-jazz** — Kevin MacLeod, *Vibe Ace* (44.1 kHz stereo, 12 s, CC BY 3.0)
  - **music-orchestral** — Brahms, *Hungarian Dance No. 5*, US Army Strings (44.1 kHz stereo, 12 s, Public Domain)
- `generated/<master>/` — each master encoded into the same 31 codec/container variants, so you can compare how a codec treats speech vs. dense music, and how the *same sentence* survives G.711 vs. Opus vs. AAC.
- `real-world/` — 15 files from [projectivetech/media-samples](https://github.com/projectivetech/media-samples): low-quality, odd sample rates, the kind of input a transcoder actually meets.

## generated/{speech, music-jazz, music-orchestral}/

Sizes below are for `music-jazz` (12 s stereo); `speech` files are roughly ⅓–½ of that (mono, 16 kHz source).

### Lossless / PCM

| File | Codec | Notes | Size |
|---|---|---|---|
| wav_pcm16.wav | PCM s16le | native rate | 2.0 MB |
| wav_pcm24.wav | PCM s24le | native rate | 3.0 MB |
| wav_pcm16_48k.wav | PCM s16le | resampled to 48 kHz (broadcast standard) | 2.2 MB |
| wav_adpcm_ima.wav | IMA ADPCM 4-bit | old games / telephony | 521 KB |
| aiff_pcm16.aiff | PCM s16be (Apple AIFF) | | 2.0 MB |
| au_pcm16.au | PCM s16be (Sun AU) | | 2.0 MB |
| flac_lossless.flac | FLAC level 8 | | 1.5 MB |
| m4a_alac_lossless.m4a | Apple Lossless | | 1.7 MB |
| wv_wavpack.wv | WavPack | | 1.8 MB |

### Lossy — streaming / OTT / web

| File | Codec | Bitrate | Size | Use |
|---|---|---|---|---|
| m4a_aac_lc_128k.m4a | AAC-LC in MP4 | 128k | 194 KB | HLS/DASH default |
| m4a_aac_lc_64k.m4a | AAC-LC | 64k | 98 KB | Low-bitrate rendition |
| aac_adts_128k.aac | AAC-LC in ADTS (raw stream) | 128k | 195 KB | MPEG-TS / broadcast |
| mp3_cbr_192k.mp3 | MP3 CBR | 192k | 283 KB | Legacy compatibility |
| mp3_vbr_q2.mp3 | MP3 VBR (LAME -q2) | ~170k | 230 KB | Podcasts |
| opus_96k.opus | Opus in Ogg | 96k | 164 KB | WebRTC, modern web |
| opus_voip_24k.opus | Opus, VoIP mode | 24k | 41 KB | Calls |
| webm_opus_96k.webm | Opus in WebM | 96k | 167 KB | Browser playback |
| ogg_vorbis_q5.ogg | Vorbis q5 | ~160k | 180 KB | Games, older web |

### Broadcast / TV

| File | Codec | Channels | Bitrate | Size |
|---|---|---|---|---|
| ac3_192k.ac3 | AC-3 (Dolby Digital) | 2.0 | 192k | 282 KB |
| ac3_5.1_448k.ac3 | AC-3 | 5.1 (upmixed) | 448k | 657 KB |
| eac3_128k.eac3 | E-AC-3 (Dolby Digital Plus) | 2.0 | 128k | 188 KB |
| eac3_5.1_384k.eac3 | E-AC-3 | 5.1 (upmixed) | 384k | 563 KB |
| dts_768k.dts | DTS core | 2.0 | 768k | 1.1 MB |
| mp2_192k.mp2 | MPEG-1 Layer II (ffmpeg), 48 kHz | 2.0 | 192k | 282 KB |
| mp2_twolame_192k.mp2 | MPEG-1 Layer II (TwoLAME), 48 kHz | 2.0 | 192k | 281 KB |

The 5.1 files are derived from the stereo master by a `pan` filter (FC = mix, LFE = −14 dB, rears = half) — useful for testing downmix and channel-layout handling, not a real surround mix.

### Telephony / voice

| File | Codec | Rate / ch | Bitrate | Size |
|---|---|---|---|---|
| g722_16k_mono.g722 | G.722 (wideband) | 16k / 1 | 64k | 94 KB |
| g726_32k_mono.wav | G.726 ADPCM | 8k / 1 | 32k | 47 KB |
| wav_alaw_8k_mono.wav | G.711 A-law | 8k / 1 | 64k | 94 KB |
| wav_mulaw_8k_mono.wav | G.711 µ-law | 8k / 1 | 64k | 94 KB |
| ogg_speex_16k_mono.ogg | Speex wideband | 16k / 1 | ~28k | 42 KB |

Listen to `speech/wav_mulaw_8k_mono.wav` next to `speech/opus_voip_24k.opus` — same sentence, 8 kHz landline vs. modern VoIP.

### Legacy

| File | Codec | Bitrate | Size |
|---|---|---|---|
| wma_wmav2_128k.wma | Windows Media Audio v2 | 128k | 204 KB |

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

## Not included

- **HE-AAC / HE-AAC v2 / xHE-AAC** — need `libfdk_aac`, absent from stock ffmpeg builds (licence). Build with `--enable-libfdk-aac`, then `-c:a libfdk_aac -profile:a aac_he_v2`.
- **Dolby Atmos / TrueHD / DTS:X** — ffmpeg's `truehd`/`mlp` encoders are experimental; real samples: [Dolby test signals](https://ott.dolby.com/OnDelKits/DDP/Dolby_Digital_Plus_Online_Delivery_Kit_v1.4.1/Test_Signals/muxed_streams/MPEG2TS/MPEG2TS_Muxed_Streams.html).
- **AMR-NB / AMR-WB encode** — needs `libopencore-amr` / `libvo-amrwbenc`; a real AMR-WB file is in `real-world/`.
