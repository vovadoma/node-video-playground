/**
 * Pure rules, no I/O: what kind of entry a file is and whether a browser <video>/<audio> can play it.
 */
import type { probeSummary } from '../../src/lib/ffprobe.js';

export type Kind = 'video' | 'audio' | 'hls' | 'dash' | 'image';
export type Playable = 'yes' | 'maybe' | 'no';
export type Summary = Omit<Awaited<ReturnType<typeof probeSummary>>, 'raw'>;

const IMAGE_EXT = /\.(jpe?g|png|webp|gif)$/;
const AUDIO_EXT = /\.(mp3|m4a|aac|ac3|eac3|dts|flac|wav|aiff?|au|ogg|opus|wma|wv|mka|amr|ra|voc|mp2|g722)$/;

/**
 * @param relPath  path relative to the samples root, forward slashes
 * @param summary  ffprobe summary; without it the kind is guessed from extension and folder
 */
export function kindOf(relPath: string, summary?: Summary): Kind {
  const ext = extOf(relPath);
  if (ext === '.m3u8') return 'hls';
  if (ext === '.mpd') return 'dash';
  if (IMAGE_EXT.test(ext)) return 'image';
  // audio extensions stay audio even if ffprobe reports a "video" stream (embedded cover art)
  if (AUDIO_EXT.test(ext)) return 'audio';
  if (summary) return !summary.video && summary.audio ? 'audio' : 'video';
  // no ffprobe: .webm / .mka / .mp4 under an audio/ folder are audio-only in practice
  if (relPath.split('/').includes('audio') && /\.(webm|mka|mp4)$/.test(ext)) return 'audio';
  return 'video';
}

/** Decide from the real codecs (not the extension) whether a <video>/<audio> can take it. */
export function classify(relPath: string, s?: Summary): { playable: Playable; reason?: string } {
  const ext = extOf(relPath);
  if (ext === '.m3u8' || ext === '.mpd' || IMAGE_EXT.test(ext)) return { playable: 'yes' };
  const byExt: Record<string, Playable> = {
    '.mp4': 'yes', '.m4v': 'yes', '.webm': 'yes', '.mp3': 'yes', '.m4a': 'yes', '.aac': 'yes',
    '.flac': 'yes', '.wav': 'yes', '.ogg': 'yes', '.opus': 'yes', '.mov': 'maybe', '.mkv': 'maybe', '.mka': 'maybe',
  };
  if (!s) return { playable: byExt[ext] ?? 'no', reason: 'not probed — guessed from extension' };

  const c = s.container;
  const v = AUDIO_EXT.test(ext) ? undefined : s.video?.codec;   // ignore cover art in audio files
  const a = s.audio?.codec;
  const container =
    /mp4|mov/.test(c) ? 'mp4' : /webm|matroska/.test(c) ? (ext === '.webm' ? 'webm' : 'mkv')
    : c === 'mp3' ? 'mp3' : c === 'aac' ? 'aac' : c === 'flac' ? 'flac' : c === 'wav' ? 'wav' : c === 'ogg' ? 'ogg' : c;

  const goodAudio = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac', 'pcm_s16le', 'pcm_s24le', 'pcm_u8', 'pcm_f32le']);
  const verdicts: Playable[] = [];
  const why: string[] = [];

  if (!['mp4', 'webm', 'mkv', 'mp3', 'aac', 'flac', 'wav', 'ogg'].includes(container)) {
    return { playable: 'no', reason: `container ${c.split(',')[0]} is not supported by browsers` };
  }
  if (container === 'mkv') { verdicts.push('maybe'); why.push('Matroska: Chromium only'); }

  if (v) {
    if (v === 'h264' || v === 'vp8' || v === 'vp9') verdicts.push('yes');
    else if (v === 'av1') { verdicts.push(container === 'webm' ? 'yes' : 'maybe'); if (container !== 'webm') why.push('AV1 in MP4: recent browsers only'); }
    else if (v === 'hevc') { verdicts.push('maybe'); why.push('H.265: Safari / hardware-dependent'); }
    else return { playable: 'no', reason: `video codec ${v} is not supported by browsers` };
  }
  if (a) {
    if (goodAudio.has(a)) verdicts.push('yes');
    else if (a === 'alac') { verdicts.push('maybe'); why.push('ALAC: Safari only'); }
    else if (a === 'eac3' || a === 'ac3') { verdicts.push('maybe'); why.push(`${a.toUpperCase()}: Safari/Edge only`); }
    else return { playable: 'no', reason: `audio codec ${a} is not supported by browsers` };
  }
  const playable: Playable = verdicts.includes('maybe') ? 'maybe' : verdicts.length ? 'yes' : 'no';
  return { playable, reason: why.join('; ') || undefined };
}

function extOf(p: string): string {
  const i = p.lastIndexOf('.');
  return i < 0 ? '' : p.slice(i).toLowerCase();
}
