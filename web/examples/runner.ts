/**
 * Example runner: starts an example as a child process, streams its console output,
 * and records which files it created or changed under OUTPUT_DIR. No HTTP here.
 *
 * One run at a time: examples are CPU-heavy (ffmpeg) and the output diff must be
 * attributable to a single run. The last run of each example is saved to
 * OUTPUT_DIR/.runs/<id>.json so results survive a server restart.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Example } from './registry.js';

export type RunStatus = 'running' | 'ok' | 'failed' | 'stopped';

export interface Run {
  exampleId: string;
  status: RunStatus;
  arg?: string;                 // input path relative to the samples root
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  exitCode?: number | null;
  log: string;                  // raw stdout+stderr, \r kept (progress bars)
  outputs: string[];            // files under OUTPUT_DIR (relative) created or changed by the run
}

export interface RunnerOptions {
  cwd: string;                  // repo root — examples resolve paths from here
  tsxBin: string;
  samplesDir: string;
  outputDir: string;
}

const LOG_LIMIT = 256 * 1024;   // keep the tail of very chatty runs

export class BusyError extends Error {}

/**
 * Events: 'log' (exampleId, chunk) and 'end' (run).
 */
export class ExampleRunner extends EventEmitter {
  private current?: { run: Run; child: ChildProcess };
  private readonly runsDir: string;

  constructor(private readonly opts: RunnerOptions) {
    super();
    this.runsDir = path.join(opts.outputDir, '.runs');
  }

  /** The running run of this example, or its last saved run. */
  last(exampleId: string): Run | undefined {
    if (this.current?.run.exampleId === exampleId) return this.current.run;
    try {
      return JSON.parse(readFileSync(path.join(this.runsDir, `${exampleId}.json`), 'utf8')) as Run;
    } catch {
      return undefined;
    }
  }

  running(): Run | undefined {
    return this.current?.run;
  }

  start(example: Example, argAbs?: string): Run {
    if (this.current) throw new BusyError(`"${this.current.run.exampleId}" is still running`);

    const before = snapshot(this.opts.outputDir);
    const t0 = Date.now();
    const run: Run = {
      exampleId: example.id,
      status: 'running',
      arg: argAbs && path.relative(this.opts.samplesDir, argAbs).split(path.sep).join('/'),
      startedAt: new Date(t0).toISOString(),
      log: '',
      outputs: [],
    };

    const child = spawn(this.opts.tsxBin, [example.file, ...(argAbs ? [argAbs] : [])], {
      cwd: this.opts.cwd,
      env: { ...process.env, SAMPLES_DIR: this.opts.samplesDir, OUTPUT_DIR: this.opts.outputDir, FORCE_COLOR: '0', NO_COLOR: '1' },
      detached: true,           // own process group, so stop() also kills ffmpeg children
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.current = { run, child };

    const onData = (buf: Buffer) => {
      const chunk = buf.toString();
      run.log = (run.log + chunk).slice(-LOG_LIMIT);
      this.emit('log', example.id, chunk);
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);

    const finish = (code: number | null, err?: Error) => {
      if (run.finishedAt) return;
      if (err) onData(Buffer.from(`\n${err.message}\n`));
      run.finishedAt = new Date().toISOString();
      run.durationMs = Date.now() - t0;
      run.exitCode = code;
      if (run.status === 'running') run.status = code === 0 ? 'ok' : 'failed';
      run.outputs = changedSince(this.opts.outputDir, before, t0);
      this.current = undefined;
      this.save(run);
      this.emit('end', run);
    };
    child.on('error', (err) => finish(null, err));
    child.on('close', (code) => finish(code));
    return run;
  }

  stop(exampleId: string): boolean {
    const cur = this.current;
    if (!cur || cur.run.exampleId !== exampleId || cur.child.pid === undefined) return false;
    cur.run.status = 'stopped';
    const pid = cur.child.pid;
    const kill = (sig: NodeJS.Signals) => { try { process.kill(-pid, sig); } catch { cur.child.kill(sig); } };
    kill('SIGTERM');
    // escalate if the process group ignores SIGTERM — otherwise the runner would stay busy forever
    setTimeout(() => { if (this.current === cur) kill('SIGKILL'); }, 4000).unref();
    return true;
  }

  private save(run: Run) {
    try {
      mkdirSync(this.runsDir, { recursive: true });
      writeFileSync(path.join(this.runsDir, `${run.exampleId}.json`), JSON.stringify(run, null, 2));
    } catch (e) {
      console.error(`could not save run: ${(e as Error).message}`);
    }
  }
}

/** path → mtimeMs for every file under dir (dot-folders like .runs skipped). */
function snapshot(dir: string): Map<string, number> {
  const out = new Map<string, number>();
  const walk = (d: string) => {
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else { try { out.set(p, statSync(p).mtimeMs); } catch { /* vanished */ } }
    }
  };
  walk(dir);
  return out;
}

function changedSince(dir: string, before: Map<string, number>, t0: number): string[] {
  return [...snapshot(dir)]
    .filter(([p, mtime]) => before.get(p) !== mtime || mtime >= t0)
    .map(([p]) => path.relative(dir, p).split(path.sep).join('/'))
    .sort();
}
