/**
 * Media catalog: walk a folder, probe every file with ffprobe, classify it, keep the result in memory.
 * No HTTP here — the web layer only calls list() / refresh().
 */
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { probeSummary } from '../../src/lib/ffprobe.js';
import { mimeOf } from '../mime.js';
import { classify, kindOf, type Kind, type Playable, type Summary } from './classify.js';

export interface Entry {
  path: string;                 // relative to root, forward slashes
  group: string;                // top-level folder(s)
  kind: Kind;
  size: number;
  playable: Playable;
  reason?: string;
  mime: string;
  summary?: Summary;
  raw?: unknown;
  error?: string;
}

const MEDIA = /\.(mp4|m4v|mov|mkv|webm|avi|flv|wmv|mpg|mpeg|ts|m2ts|mxf|3gp|ogv|mp3|m4a|aac|ac3|eac3|dts|flac|wav|aiff?|au|ogg|opus|wma|wv|mka|amr|ra|voc|mp2|g722|m3u8|mpd|jpe?g|png|webp|gif)$/i;
const CONCURRENCY = 8;

export class Catalog {
  private entries: Promise<Entry[]>;

  constructor(readonly root: string) {
    this.entries = this.scan();
  }

  list(): Promise<Entry[]> {
    return this.entries;
  }

  refresh(): Promise<Entry[]> {
    this.entries = this.scan();
    return this.entries;
  }

  private async scan(): Promise<Entry[]> {
    const t0 = Date.now();
    const out = await buildEntries(this.root, walk(this.root));
    console.log(`Catalog: ${out.length} entries from ${this.root} in ${Date.now() - t0} ms`);
    const failed = out.filter((e) => e.error);
    if (failed.length) console.warn(`  ffprobe failed for ${failed.length} file(s) — playability guessed from extension. First error: ${failed[0].error}`);
    return out;
  }
}

/**
 * Describe a set of files under `root` (probe + classify). HLS/DASH segments are folded into
 * their manifest. Used for the samples catalog and for the outputs of an example run.
 */
export async function buildEntries(root: string, files: string[]): Promise<Entry[]> {
  const sorted = files.filter((f) => MEDIA.test(f)).sort();
  const all = new Set(sorted);
  const manifestDirs = new Set(sorted.filter((f) => /\.(m3u8|mpd)$/i.test(f)).map((f) => path.dirname(f)));
  const list = sorted.filter((f) => !isStreamingPart(f, all, manifestDirs));

  const out: Entry[] = [];
  for (let i = 0; i < list.length; i += CONCURRENCY) {
    out.push(...await Promise.all(list.slice(i, i + CONCURRENCY).map((f) => buildEntry(root, f))));
  }
  return out;
}

async function buildEntry(root: string, file: string): Promise<Entry> {
  const rel = path.relative(root, file).split(path.sep).join('/');
  const parts = rel.split('/');
  const entry: Entry = {
    path: rel,
    group: parts.length > 1 ? parts.slice(0, Math.min(parts.length - 1, 2)).join('/') : '.',
    kind: kindOf(rel),
    size: statSync(file).size,
    playable: 'no',
    mime: mimeOf(file),
  };
  if (entry.kind !== 'hls' && entry.kind !== 'dash' && entry.kind !== 'image') {
    try {
      const { raw, ...summary } = await probeSummary(file);
      entry.summary = summary;
      entry.raw = raw;
      entry.kind = kindOf(rel, summary);
    } catch (e) {
      entry.error = String((e as Error).message).split('\n')[0];
    }
  }
  return Object.assign(entry, classify(rel, entry.summary));
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name.startsWith('.')) return [];
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return MEDIA.test(e.name) ? [p] : [];
  });
}

/** Drop HLS/DASH pieces: segments, init files, and per-rendition playlists when a master.m3u8 exists. */
function isStreamingPart(file: string, all: Set<string>, manifestDirs: Set<string>): boolean {
  const dir = path.dirname(file);
  const ext = path.extname(file).toLowerCase();
  if (ext === '.ts' || ext === '.m4s') return manifestDirs.has(dir);
  if (ext === '.mp4' && path.basename(file).startsWith('init')) return manifestDirs.has(dir);
  if (ext === '.m3u8' && path.basename(file) !== 'master.m3u8') {
    // variant playlists: nested (720p/index.m3u8) or flat (stream_0.m3u8 next to master.m3u8)
    return all.has(path.join(path.dirname(dir), 'master.m3u8')) || all.has(path.join(dir, 'master.m3u8'));
  }
  return false;
}
