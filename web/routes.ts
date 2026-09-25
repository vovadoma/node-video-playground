/**
 * Route table: glues the HTTP engine (engine/) to the media logic (catalog/).
 */
import type { Catalog } from './catalog/catalog.js';
import { safeResolve, sendFile, sendJson } from './engine/respond.js';
import type { Route } from './engine/router.js';

export function routes({ catalog, publicDir }: { catalog: Catalog; publicDir: string }): Route[] {
  return [
    {
      // catalog as JSON; ?refresh=1 re-scans the samples folder
      path: '/api/files',
      handler: async ({ res, url }) => {
        const files = url.searchParams.has('refresh') ? await catalog.refresh() : await catalog.list();
        sendJson(res, 200, { root: catalog.root, files });
      },
    },
    {
      // media files with Range support; path traversal is rejected by safeResolve
      prefix: '/media/',
      handler: ({ req, res, rest }) => {
        const file = safeResolve(catalog.root, rest);
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
