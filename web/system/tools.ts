/**
 * Checks that the external binaries everything depends on (ffmpeg, ffprobe) can be started.
 * No HTTP here. Result is cached; recheck() is called on "Rescan" so installing ffmpeg
 * while the server runs is picked up without a restart.
 */
import { execa } from 'execa';
import { FFMPEG_BIN, FFPROBE_BIN } from '../../src/lib/config.js';

export interface ToolStatus {
  bin: string;
  ok: boolean;
  version?: string;             // "7.1.1"
  error?: string;
}

export interface ToolsReport {
  ok: boolean;
  ffmpeg: ToolStatus;
  ffprobe: ToolStatus;
  hint?: string;                // how to fix, when !ok
}

async function check(bin: string): Promise<ToolStatus> {
  try {
    const { stdout } = await execa(bin, ['-hide_banner', '-version'], { timeout: 5000 });
    return { bin, ok: true, version: stdout.match(/version\s+(\S+)/)?.[1] };
  } catch (e) {
    const err = e as { code?: string; shortMessage?: string; message: string };
    return { bin, ok: false, error: err.code === 'ENOENT' ? `${bin} not found on PATH` : (err.shortMessage ?? err.message) };
  }
}

export class Tools {
  private report: Promise<ToolsReport>;

  constructor() {
    this.report = this.run();
  }

  get(): Promise<ToolsReport> {
    return this.report;
  }

  recheck(): Promise<ToolsReport> {
    this.report = this.run();
    return this.report;
  }

  private async run(): Promise<ToolsReport> {
    const [ffmpeg, ffprobe] = await Promise.all([check(FFMPEG_BIN), check(FFPROBE_BIN)]);
    const ok = ffmpeg.ok && ffprobe.ok;
    const hint = ok ? undefined
      : process.platform === 'darwin' ? 'brew install ffmpeg'
      : process.platform === 'win32' ? 'winget install ffmpeg'
      : 'sudo apt install ffmpeg';
    if (!ok) console.warn(`  ${[ffmpeg, ffprobe].filter((t) => !t.ok).map((t) => t.error).join('; ')} — install it: ${hint}`);
    return { ok, ffmpeg, ffprobe, hint };
  }
}
