#!/usr/bin/env node
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname, extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Static server for local development. In production the UI is a static bundle on
 * a CDN (Vercel) and this file is not deployed — it exists so `npm run web` works
 * without a build step or a global install.
 */
const publicDir = join(dirname(fileURLToPath(import.meta.url)), 'public');
const port = Number(process.env.WEB_PORT || 3200);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

http.createServer(async (req, res) => {
  const requested = new URL(req.url, 'http://localhost').pathname;
  const relative = normalize(requested === '/' ? '/index.html' : requested).replace(/^(\.\.[/\\])+/, '');
  const file = join(publicDir, relative);

  // Anchor the boundary on a separator, or publicDir "/srv/pub" would also
  // accept a sibling "/srv/pub-backup". The URL parse and leading-../ strip
  // above already make an escape unreachable here; this keeps it that way if
  // either of those is ever changed.
  if (file !== publicDir && !file.startsWith(publicDir + sep)) {
    res.writeHead(403); return res.end('forbidden');
  }

  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
}).listen(port, () => console.log(`Taskman UI on http://localhost:${port}`));
