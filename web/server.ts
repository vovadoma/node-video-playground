/**
 * Web player — browse everything under SAMPLES_DIR, play what the browser can,
 * and run the examples/ scripts with live output.
 *
 *   npm run web                 # http://127.0.0.1:3000
 *   PORT=8080 npm run web
 *
 * No framework. Layout:
 *   engine/    tiny HTTP engine — router, JSON / file responses with Range, SSE (knows nothing about media)
 *   catalog/   media logic — walk + ffprobe + "can a browser play this?" (knows nothing about HTTP)
 *   system/    environment checks — are ffmpeg / ffprobe installed?
 *   examples/  example logic — discover examples/*.ts, run one, collect its outputs (knows nothing about HTTP)
 *   routes.ts  the route table that connects them
 *   public/    static UI (index.html + app.js + styles.css, no build step)
 */
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OUTPUT_DIR, SAMPLES_DIR } from '../src/lib/config.js';
import { Catalog } from './catalog/catalog.js';
import { createRouter } from './engine/router.js';
import { ExampleRegistry } from './examples/registry.js';
import { ExampleRunner } from './examples/runner.js';
import { routes } from './routes.js';
import { Tools } from './system/tools.js';

const PORT = Number(process.env.PORT ?? 3000);
const HOST = '127.0.0.1';
const WEB_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_DIR = path.dirname(WEB_DIR);

const tools = new Tools();
const catalog = new Catalog(path.resolve(SAMPLES_DIR));
const examples = new ExampleRegistry(path.join(REPO_DIR, 'examples'), path.join(REPO_DIR, 'package.json'));
const runner = new ExampleRunner({
  cwd: REPO_DIR,
  tsxBin: path.join(REPO_DIR, 'node_modules', '.bin', 'tsx'),
  samplesDir: catalog.root,
  outputDir: OUTPUT_DIR,
});

const server = createServer(createRouter(routes({
  catalog, examples, runner, tools, outputDir: OUTPUT_DIR, publicDir: path.join(WEB_DIR, 'public'),
})));

server.listen(PORT, HOST, () => {
  console.log(`Web player: http://${HOST}:${PORT}  (samples: ${catalog.root}, output: ${OUTPUT_DIR})`);
});
