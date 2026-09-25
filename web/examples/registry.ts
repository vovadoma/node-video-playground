/**
 * Example registry: discovers examples/*.ts and reads their metadata from the header comment.
 * No HTTP here. A new example appears automatically as long as it follows the header convention:
 *
 *   /**
 *    * 08 — Short title: one-line summary of what it shows.
 *    *      (optional continuation lines)
 *    *
 *    *   npm run <script>
 *    *   npm run <script> -- <arg>
 *    *\/
 *
 * The input argument is detected from the code: `process.argv[2] ?? sample(…)` → a file,
 * `process.argv[2] ?? SAMPLES_DIR` → a folder, no process.argv[2] → no input.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export interface Example {
  id: string;                   // file name without .ts, e.g. "03-transcode"
  file: string;                 // absolute path
  num: string;                  // "03"
  title: string;                // "Transcode with progress"
  summary: string;              // the whole first paragraph of the header
  usage: string[];              // "npm run transcode", "npm run transcode -- input.mov"
  script?: string;              // npm script name, if package.json has one
  input: 'file' | 'dir' | null; // what process.argv[2] means
}

const ACRONYMS: Record<string, string> = { hls: 'HLS', dash: 'DASH', psnr: 'PSNR', ssim: 'SSIM', vmaf: 'VMAF', abr: 'ABR' };

export class ExampleRegistry {
  constructor(readonly dir: string, private readonly packageJson: string) {}

  /** Re-read on every call — cheap, and new/edited examples show up without a restart. */
  list(): Example[] {
    const scripts = this.scripts();
    return readdirSync(this.dir)
      .filter((f) => /^\d+[-_].+\.ts$/.test(f))
      .sort()
      .map((f) => parse(path.join(this.dir, f), scripts));
  }

  get(id: string): Example | undefined {
    return this.list().find((e) => e.id === id);
  }

  source(example: Example): string {
    return readFileSync(example.file, 'utf8');
  }

  private scripts(): Record<string, string> {
    try {
      return JSON.parse(readFileSync(this.packageJson, 'utf8')).scripts ?? {};
    } catch {
      return {};
    }
  }
}

function parse(file: string, scripts: Record<string, string>): Example {
  const id = path.basename(file, '.ts');
  const src = readFileSync(file, 'utf8');
  const header = src.match(/^\s*\/\*\*([\s\S]*?)\*\//)?.[1] ?? '';
  const lines = header.split('\n').map((l) => l.replace(/^\s*\*\s?/, '').trimEnd());

  const usage = lines.map((l) => l.trim()).filter((l) => l.startsWith('npm run '));
  const firstParagraph: string[] = [];
  for (const l of lines) {
    if (!l.trim()) { if (firstParagraph.length) break; else continue; }
    if (l.trim().startsWith('npm run ')) break;
    firstParagraph.push(l.trim());
  }
  const summaryRaw = firstParagraph.join(' ').replace(/\s+/g, ' ');
  const m = summaryRaw.match(/^(\d+)\s*[—–-]\s*(.*)$/);
  const num = m?.[1] ?? id.match(/^\d+/)?.[0] ?? '';
  const summary = (m?.[2] ?? summaryRaw).trim();

  // "Title: what it does" → title + summary without the repeated title
  const colon = summary.indexOf(':');
  const hasTitle = colon > 0 && colon <= 40;
  const title = hasTitle ? summary.slice(0, colon) : titleFromId(id);
  const rest = hasTitle ? summary.slice(colon + 1).trim() : summary;

  const script = Object.entries(scripts).find(([, cmd]) => cmd.trim() === `tsx examples/${id}.ts`)?.[0];
  const argDefault = src.match(/process\.argv\[2\]\s*\?\?\s*([A-Za-z_]+)/)?.[1];
  const input = !argDefault ? null : argDefault === 'sample' ? 'file' : 'dir';

  return { id, file, num, title, summary: rest.charAt(0).toUpperCase() + rest.slice(1), usage, script, input };
}

function titleFromId(id: string): string {
  const words = id.replace(/^\d+[-_]/, '').split(/[-_]/);
  return words.map((w, i) => ACRONYMS[w] ?? (i === 0 ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
}
