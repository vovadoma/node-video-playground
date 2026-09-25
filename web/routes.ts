/**
 * Route table: glues the HTTP engine (engine/) to the logic (catalog/, examples/).
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { buildEntries, type Catalog, type Entry } from './catalog/catalog.js';
import { HttpError, readJson, safeResolve, sendFile, sendJson } from './engine/respond.js';
import type { Context, Route } from './engine/router.js';
import { openEventStream } from './engine/sse.js';
import type { Example, ExampleRegistry } from './examples/registry.js';
import { BusyError, type ExampleRunner, type Run } from './examples/runner.js';
import type { Tools } from './system/tools.js';

interface Deps {
  catalog: Catalog;
  examples: ExampleRegistry;
  runner: ExampleRunner;
  tools: Tools;
  outputDir: string;
  publicDir: string;
}

const withUrl = (mount: string, entries: Entry[]) =>
  entries.map((e) => ({ ...e, url: `${mount}${e.path.split('/').map(encodeURIComponent).join('/')}` }));

/** Run without the (possibly large) log — for lists and events. */
const brief = (run?: Run) => run && (({ log, ...rest }) => rest)(run);

const publicExample = ({ file, ...e }: Example) => e;

export function routes({ catalog, examples, runner, tools, outputDir, publicDir }: Deps): Route[] {
  /** "03-transcode/events" → [example, "events"]; 404 if unknown. */
  const target = (rest: string): [Example, string] => {
    const [id, action = ''] = rest.split('/');
    const example = examples.get(decodeURIComponent(id));
    if (!example) throw new HttpError(404, `unknown example "${id}"`);
    return [example, action];
  };

  const detail = async (example: Example) => {
    const run = runner.last(example.id);
    const outputs = run && run.status !== 'running'
      ? await buildEntries(outputDir, run.outputs.map((p) => path.join(outputDir, p)).filter((p) => existsSync(p)))
      : [];
    return { example: publicExample(example), source: examples.source(example), run, outputs: withUrl('/output/', outputs) };
  };

  const events = ({ req, res }: Context, example: Example) => {
    const stream = openEventStream(req, res);
    const run = runner.last(example.id);
    stream.send('state', run ?? null);   // full run incl. log so far, sent atomically with the subscription
    const onLog = (id: string, chunk: string) => { if (id === example.id) stream.send('log', chunk); };
    const onEnd = (r: Run) => { if (r.exampleId === example.id) stream.send('end', brief(r)); };
    runner.on('log', onLog);
    runner.on('end', onEnd);
    stream.onClose(() => { runner.off('log', onLog); runner.off('end', onEnd); });
  };

  return [
    {
      // are ffmpeg / ffprobe available? ?refresh=1 checks again
      path: '/api/health',
      handler: async ({ res, url }) => {
        sendJson(res, 200, { tools: url.searchParams.has('refresh') ? await tools.recheck() : await tools.get() });
      },
    },
    {
      // samples catalog as JSON; ?refresh=1 re-scans the samples folder
      path: '/api/files',
      handler: async ({ res, url }) => {
        const files = url.searchParams.has('refresh') ? await catalog.refresh() : await catalog.list();
        sendJson(res, 200, { root: catalog.root, files: withUrl('/media/', files) });
      },
    },
    {
      // all examples with their last run (no logs)
      path: '/api/examples',
      handler: ({ res }) => {
        sendJson(res, 200, {
          running: runner.running()?.exampleId ?? null,
          examples: examples.list().map((e) => ({ ...publicExample(e), lastRun: brief(runner.last(e.id)) })),
        });
      },
    },
    {
      // GET /api/examples/<id>          → metadata, source, last run with log, output entries
      // GET /api/examples/<id>/events   → SSE: state, log chunks, end
      prefix: '/api/examples/',
      handler: async (ctx) => {
        const [example, action] = target(ctx.rest);
        if (action === 'events') return events(ctx, example);
        if (action) throw new HttpError(404, 'not found');
        sendJson(ctx.res, 200, await detail(example));
      },
    },
    {
      // POST /api/examples/<id>/run  {arg?: "generated/x.mp4"}   POST /api/examples/<id>/stop
      method: 'POST',
      prefix: '/api/examples/',
      handler: async ({ req, res, rest }) => {
        const [example, action] = target(rest);
        const body = await readJson<{ arg?: string }>(req);
        if (action === 'stop') return sendJson(res, 200, { stopped: runner.stop(example.id) });
        if (action !== 'run') throw new HttpError(404, 'not found');

        let argAbs: string | undefined;
        if (body.arg) {
          if (!example.input) throw new HttpError(400, `${example.id} takes no input`);
          // inputs are restricted to the samples folder
          argAbs = safeResolve(catalog.root, body.arg, example.input) ?? undefined;
          if (!argAbs) throw new HttpError(400, `no such ${example.input} in samples: ${body.arg}`);
        }
        try {
          sendJson(res, 202, { run: brief(runner.start(example, argAbs)) });
        } catch (e) {
          if (e instanceof BusyError) throw new HttpError(409, e.message);
          throw e;
        }
      },
    },
    {
      // sample media with Range support; path traversal is rejected by safeResolve
      prefix: '/media/',
      handler: ({ req, res, rest }) => {
        const file = safeResolve(catalog.root, rest);
        if (!file) return sendJson(res, 404, { error: 'not found' });
        sendFile(res, file, req.headers.range);
      },
    },
    {
      // files produced by examples (OUTPUT_DIR), same rules as /media/
      prefix: '/output/',
      handler: ({ req, res, rest }) => {
        const file = safeResolve(outputDir, rest);
        if (!file) return sendJson(res, 404, { error: 'not found' });
        sendFile(res, file, req.headers.range);
      },
    },
    {
      // static UI (web/public)
      prefix: '/',
      handler: ({ res, url }) => {
        const file = safeResolve(publicDir, url.pathname === '/' ? 'index.html' : url.pathname);
        if (!file) return sendJson(res, 404, { error: 'not found' });
        sendFile(res, file);
      },
    },
  ];
}
