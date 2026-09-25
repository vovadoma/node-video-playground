import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

// Minimal .env loader (no dependency): KEY=value lines, '#' comments, shell vars win.
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

/**
 * Folder with test media. Resolution order:
 *   1. SAMPLES_DIR env var
 *   2. ./samples (shipped with the repo)
 *   3. ~/Movies/video-samples (legacy location)
 */
export const SAMPLES_DIR =
  process.env.SAMPLES_DIR ??
  (existsSync(path.resolve('samples')) ? path.resolve('samples') : path.join(homedir(), 'Movies', 'video-samples'));

/** Where examples write their results. */
export const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR ?? 'output');

export const FFMPEG_BIN = process.env.FFMPEG_BIN ?? 'ffmpeg';
export const FFPROBE_BIN = process.env.FFPROBE_BIN ?? 'ffprobe';

/** Resolve a path inside the samples folder and make sure it exists. */
export function sample(relative: string): string {
  const p = path.join(SAMPLES_DIR, relative);
  if (!existsSync(p)) {
    throw new Error(`Sample not found: ${p}\nSet SAMPLES_DIR or check ~/Movies/video-samples`);
  }
  return p;
}

/** Resolve a path inside the output folder, creating parent dirs. */
export function out(relative: string): string {
  const p = path.join(OUTPUT_DIR, relative);
  mkdirSync(path.dirname(p), { recursive: true });
  return p;
}
