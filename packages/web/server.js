#!/usr/bin/env node
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Static server for local development. In production the UI is a static bundle on
 * a CDN (Vercel) and this file is not deployed — it exists so `npm run web` works
 * without a build step or a global install.
 *
 * GET /__proxy/* forwards to the API base in x-taskman-base so the operator
 * console can talk to a local packages/api or src/server.js without CORS.
 */
const publicDir = join(dirname(fileURLToPath(import.meta.url)), 'public');
const port = Number(process.env.WEB_PORT || 3200);
const host = process.env.WEB_HOST || '127.0.0.1';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'cache-control': 'no-store', ...headers, 'content-length': Buffer.byteLength(payload) });
  res.end(payload);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

async function proxy(req, res, suffix) {
  const base = String(req.headers['x-taskman-base'] || '').trim().replace(/\/+$/, '');
  if (!base) return send(res, 400, { error: 'missing_x_taskman_base' }, { 'content-type': 'application/json' });
  let dest;
  try {
    dest = new URL(suffix || '/', base.endsWith('/') ? base : `${base}/`);
  } catch {
    return send(res, 400, { error: 'bad_target' }, { 'content-type': 'application/json' });
  }
  if (!/^https?:$/.test(dest.protocol)) {
    return send(res, 400, { error: 'unsupported_protocol' }, { 'content-type': 'application/json' });
  }
  dest.search = new URL(req.url, 'http://local').search;
  const headers = { 'user-agent': 'taskman-web-proxy/1.1' };
  if (req.headers.authorization) headers.authorization = req.headers.authorization;
  if (req.headers.accept) headers.accept = req.headers.accept;
  if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
  const method = req.method || 'GET';
  const body = ['GET', 'HEAD'].includes(method) ? undefined : await readBody(req);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const upstream = await fetch(dest, { method, headers, body, signal: ctrl.signal });
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(upstream.status, {
      'content-type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
      'x-taskman-upstream-url': dest.toString()
    });
    res.end(buf);
  } catch (err) {
    send(res, 502, {
      error: 'proxy_failed',
      message: err?.name === 'AbortError' ? 'upstream timeout' : String(err?.message || err)
    }, { 'content-type': 'application/json' });
  } finally {
    clearTimeout(timer);
  }
}

http.createServer(async (req, res) => {
  const requested = new URL(req.url, 'http://localhost').pathname;

  if (requested === '/__proxy' || requested.startsWith('/__proxy/')) {
    return proxy(req, res, requested.replace(/^\/__proxy\/?/, ''));
  }

  const relative = normalize(requested === '/' ? '/index.html' : requested).replace(/^(\.\.[/\\])+/, '');
  const file = join(publicDir, relative);

  if (!file.startsWith(publicDir)) {
    res.writeHead(403); return res.end('forbidden');
  }

  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    if (!extname(requested)) {
      try {
        const html = await readFile(join(publicDir, 'index.html'));
        res.writeHead(200, { 'content-type': TYPES['.html'] });
        return res.end(html);
      } catch { /* fall through */ }
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
}).listen(port, host, () => console.log(`Taskman UI on http://${host}:${port}`));
