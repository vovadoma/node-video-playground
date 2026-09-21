import { execa } from 'execa';
import { FFMPEG_BIN } from './config.js';

export interface FfmpegProgress {
  /** Encoded frames so far */
  frame?: number;
  /** Current encoding speed in fps */
  fps?: number;
  /** Current output time in seconds */
  timeSec?: number;
  /** Speed relative to realtime, e.g. 4.2 */
  speed?: number;
  /** 0..1 if totalDurationSec was provided */
  percent?: number;
}

export interface RunOptions {
  /** Total input duration, used to compute percent */
  totalDurationSec?: number;
  onProgress?: (p: FfmpegProgress) => void;
  /** Print the full command before running */
  verbose?: boolean;
}

/**
 * Run ffmpeg with the given args. `-y` and `-hide_banner` are always added.
 * Progress is parsed from `-progress pipe:1` key=value output.
 */
export async function runFfmpeg(args: string[], opts: RunOptions = {}): Promise<void> {
  const fullArgs = ['-hide_banner', '-y', '-loglevel', 'error', '-progress', 'pipe:1', '-nostats', ...args];
  if (opts.verbose) console.log(`$ ${FFMPEG_BIN} ${fullArgs.map(quote).join(' ')}`);

  const child = execa(FFMPEG_BIN, fullArgs, { buffer: { stdout: false } });

  let current: FfmpegProgress = {};
  child.stdout?.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString().split('\n')) {
      const eq = line.indexOf('=');
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim();
      switch (key) {
        case 'frame': current.frame = Number(value); break;
        case 'fps': current.fps = Number(value); break;
        case 'out_time_us': current.timeSec = Number(value) / 1e6; break;
        case 'speed': current.speed = Number(value.replace('x', '')) || undefined; break;
        case 'progress':
          if (opts.totalDurationSec && current.timeSec !== undefined) {
            current.percent = Math.min(1, current.timeSec / opts.totalDurationSec);
          }
          opts.onProgress?.(current);
          if (value === 'end') current = {};
          break;
      }
    }
  });

  try {
    await child;
  } catch (err) {
    const e = err as { stderr?: string; message: string };
    throw new Error(`ffmpeg failed:\n${e.stderr || e.message}`);
  }
}

/** Run ffmpeg and return stderr (useful for filters that print stats, e.g. psnr/ssim). */
export async function runFfmpegCapture(args: string[]): Promise<string> {
  const { stderr } = await execa(FFMPEG_BIN, ['-hide_banner', '-y', '-nostats', ...args], { reject: false });
  return stderr;
}

function quote(a: string): string {
  return /[\s"'|&;<>()$`\\]/.test(a) ? `'${a.replace(/'/g, "'\\''")}'` : a;
}

/** Simple console progress bar. */
export function consoleProgress(label: string) {
  let last = -1;
  return (p: FfmpegProgress) => {
    const pct = p.percent !== undefined ? Math.round(p.percent * 100) : undefined;
    if (pct !== undefined && pct === last) return;
    last = pct ?? last;
    const bar = pct !== undefined ? `[${'#'.repeat(pct / 5 | 0).padEnd(20, '.')}] ${pct}%` : `${p.timeSec?.toFixed(1)}s`;
    process.stdout.write(`\r${label} ${bar} ${p.speed ? `${p.speed}x` : ''}   `);
    if (pct === 100) process.stdout.write('\n');
  };
}
