import { createReadStream, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { mimeOf } from '../mime.js';

export function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
}

export class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

/**
 * Parse a JSON request body. Requires `Content-Type: application/json`: browsers can't send
 * that cross-origin without a CORS preflight (which we never allow), so a random web page
 * can't trigger state-changing POSTs on this localhost server.
 */
export async function readJson<T = unknown>(req: IncomingMessage, limit = 64 * 1024): Promise<T> {
  if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) {
    throw new HttpError(415, 'Content-Type must be application/json');
  }
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > limit) throw new HttpError(413, 'request body too large');
  }
  try {
    return (body ? JSON.parse(body) : {}) as T;
  } catch {
    throw new HttpError(400, 'invalid JSON');
  }
}

/** Resolve a URL path inside `base`; null if it escapes (../), is malformed or doesn't exist. */
export function safeResolve(base: string, urlPath: string, kind: 'file' | 'dir' | 'any' = 'file'): string | null {
  let decoded: string;
  try { decoded = decodeURIComponent(urlPath); } catch { return null; }   // malformed %-escapes
  const p = path.resolve(base, '.' + path.posix.normalize('/' + decoded));
  if (p !== base && !p.startsWith(base + path.sep)) return null;
  try {
    const st = statSync(p);
    return (kind === 'any' || (kind === 'file' ? st.isFile() : st.isDirectory())) ? p : null;
  } catch {
    return null;
  }
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
