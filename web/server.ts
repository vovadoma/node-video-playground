/**
 * Web player — browse everything under SAMPLES_DIR and play what the browser can.
 *
 *   npm run web                 # http://127.0.0.1:3000
 *   PORT=8080 npm run web
 *
 * No framework. Layout:
 *   engine/    tiny HTTP engine — router, JSON / file responses with Range (knows nothing about media)
 *   catalog/   media logic — walk + ffprobe + "can a browser play this?" (knows nothing about HTTP)
 *   routes.ts  the route table that connects the two
 *   public/    static UI (index.html + app.js + styles.css, no build step)
 */
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SAMPLES_DIR } from '../src/lib/config.js';
import { Catalog } from './catalog/catalog.js';
import { createRouter } from './engine/router.js';
import { routes } from './routes.js';

const PORT = Number(process.env.PORT ?? 3000);
const HOST = '127.0.0.1';
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');

const catalog = new Catalog(path.resolve(SAMPLES_DIR));
const server = createServer(createRouter(routes({ catalog, publicDir: PUBLIC_DIR })));

server.listen(PORT, HOST, () => {
  console.log(`Web player: http://${HOST}:${PORT}  (samples: ${catalog.root})`);
});
