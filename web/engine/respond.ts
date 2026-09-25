import { createReadStream, statSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import path from 'node:path';
import { mimeOf } from '../mime.js';

export function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
}

/** Resolve a URL path inside `base`; null if it escapes (../), is malformed or is not a file. */
export function safeResolve(base: string, urlPath: string): string | null {
  let decoded: string;
  try { decoded = decodeURIComponent(urlPath); } catch { return null; }   // malformed %-escapes
  const p = path.resolve(base, '.' + path.posix.normalize('/' + decoded));
  if (p !== base && !p.startsWith(base + path.sep)) return null;
  try { return statSync(p).isFile() ? p : null; } catch { return null; }
}

/** Stream a file, honouring a `Range: bytes=…` header (206 / 416) so media elements can seek. */
export function sendFile(res: ServerResponse, file: string, range?: string) {
  const size = statSync(file).size;
  const headers: Record<string, string | number> = {
    'Content-Type': mimeOf(file), 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache',
  };
  const m = range?.match(/^bytes=(\d*)-(\d*)$/);
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : size - Number(m[2]);   // "bytes=-500" = last 500 bytes
    let end = m[1] && m[2] ? Number(m[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(end, size - 1);
    if (start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end();
      return;
    }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    pipeFile(res, createReadStream(file, { start, end }));
    return;
  }
  res.writeHead(200, { ...headers, 'Content-Length': size });
  pipeFile(res, createReadStream(file));
}

/** The file can vanish between stat and read (e.g. `npm run samples` running) — don't crash. */
function pipeFile(res: ServerResponse, stream: ReturnType<typeof createReadStream>) {
  stream.on('error', (e) => { console.error(`read failed: ${e.message}`); res.destroy(); });
  stream.pipe(res);
}
