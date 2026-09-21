import { execa } from 'execa';
import { FFPROBE_BIN } from './config.js';

export interface ProbeStream {
  index: number;
  codec_type: 'video' | 'audio' | 'subtitle' | 'data' | 'attachment';
  codec_name?: string;
  codec_long_name?: string;
  profile?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  bit_rate?: string;
  sample_rate?: string;
  channels?: number;
  channel_layout?: string;
  duration?: string;
  nb_frames?: string;
  tags?: Record<string, string>;
}

export interface ProbeFormat {
  filename: string;
  format_name: string;
  format_long_name?: string;
  duration?: string;
  size?: string;
  bit_rate?: string;
  nb_streams: number;
  tags?: Record<string, string>;
}

export interface ProbeResult {
  streams: ProbeStream[];
  format: ProbeFormat;
}

/** Run ffprobe and return parsed JSON with streams + format. */
export async function probe(file: string): Promise<ProbeResult> {
  const { stdout } = await execa(FFPROBE_BIN, [
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    file,
  ]);
  return JSON.parse(stdout) as ProbeResult;
}

/** Convenience: first video stream, first audio stream, duration in seconds. */
export async function probeSummary(file: string) {
  const info = await probe(file);
  const video = info.streams.find((s) => s.codec_type === 'video');
  const audio = info.streams.find((s) => s.codec_type === 'audio');
  const duration = Number(info.format.duration ?? video?.duration ?? 0);
  return {
    container: info.format.format_name,
    duration,
    sizeBytes: Number(info.format.size ?? 0),
    bitrate: Number(info.format.bit_rate ?? 0),
    video: video && {
      codec: video.codec_name,
      profile: video.profile,
      width: video.width,
      height: video.height,
      pixFmt: video.pix_fmt,
      fps: parseFrameRate(video.avg_frame_rate ?? video.r_frame_rate),
    },
    audio: audio && {
      codec: audio.codec_name,
      sampleRate: Number(audio.sample_rate ?? 0),
      channels: audio.channels,
    },
    raw: info,
  };
}

/** "30000/1001" -> 29.97 */
export function parseFrameRate(rate?: string): number | undefined {
  if (!rate) return undefined;
  const [num, den] = rate.split('/').map(Number);
  if (!num) return undefined;
  return den ? Math.round((num / den) * 1000) / 1000 : num;
}
