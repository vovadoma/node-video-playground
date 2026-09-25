/**
 * Minimal router on top of node:http — exact paths and path prefixes, first match wins.
 * Knows nothing about media: handlers get a context and write the response themselves.
 */
import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import { sendJson } from './respond.js';

export interface Context {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  /** For prefix routes: the part of the pathname after the prefix, e.g. "a/b.mp4" for "/media/" */
  rest: string;
}

export type Handler = (ctx: Context) => unknown | Promise<unknown>;

export interface Route {
  method?: string;              // default GET (HEAD is accepted too)
  path?: string;                // exact match
  prefix?: string;              // "/media/" matches "/media/…"
  handler: Handler;
}

export function createRouter(routes: Route[]): RequestListener {
  return async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const method = req.method === 'HEAD' ? 'GET' : req.method ?? 'GET';
    const route = routes.find((r) =>
      (r.method ?? 'GET') === method &&
      (r.path !== undefined ? url.pathname === r.path : r.prefix !== undefined && url.pathname.startsWith(r.prefix)));

    try {
      if (!route) return sendJson(res, 404, { error: 'not found' });
      await route.handler({ req, res, url, rest: route.prefix ? url.pathname.slice(route.prefix.length) : '' });
    } catch (e) {
      console.error(e);
      if (!res.headersSent) sendJson(res, 500, { error: (e as Error).message });
      else res.destroy();
    }
  };
}
