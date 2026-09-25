import { spawn } from 'node:child_process';
import { pipeline, type Readable } from 'node:stream';
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

/**
 * Stream → ffmpeg → stream: feed `source` into ffmpeg's stdin and get its stdout back as a Readable.
 * Nothing touches the disk. `args` must read from `pipe:0` and write to `pipe:1`, e.g.
 *
 *   ffmpegStream(createReadStream('in.mkv'), ['-i', 'pipe:0', '-vf', 'hflip', '-f', 'matroska', 'pipe:1'])
 *
 * Backpressure works end to end: if whoever reads the result is slow, ffmpeg blocks on stdout,
 * stops reading stdin, and `source` gets paused. Destroying the returned stream (e.g. the HTTP
 * client went away) kills ffmpeg and destroys `source`. If ffmpeg fails, the stream errors
 * with its stderr.
 */
export function ffmpegStream(source: Readable, args: string[]): Readable {
  const child = spawn(FFMPEG_BIN, ['-hide_banner', '-loglevel', 'error', ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
  const out = child.stdout;
  let stderr = '';
  child.stderr.on('data', (d: Buffer) => { stderr = (stderr + d).slice(-4000); });

  // EPIPE here is normal: ffmpeg stops reading once it has what it needs (-t) or was killed.
  pipeline(source, child.stdin, () => {});

  out.on('close', () => {
    if (child.exitCode === null) child.kill('SIGKILL');
    source.destroy();
  });
  child.on('close', (code, signal) => {
    if (code && !signal && !out.destroyed) out.destroy(new Error(`ffmpeg exited with ${code}:\n${stderr.trim()}`));
  });
  child.on('error', (err) => out.destroy(err));   // e.g. ENOENT: ffmpeg not installed
  return out;
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
