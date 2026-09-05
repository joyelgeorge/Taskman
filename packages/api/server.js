#!/usr/bin/env node
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { route } from './routes.js';
import { routeTransactions } from './routes-transactions.js';

const port = Number(process.env.API_PORT || process.env.PORT || 3100);
const allowOrigin = process.env.CORS_ORIGIN || '*';
const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');

const CORS = {
  'access-control-allow-origin': allowOrigin,
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type,authorization'
};

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...CORS });
  res.end(JSON.stringify(body));
}

async function servePublic(req, res) {
  const requested = new URL(req.url, 'http://local').pathname;
  const relative = normalize(requested === '/' ? '/index.html' : requested).replace(/^(\.\.[/\\])+/, '');
  const file = join(publicDir, relative);
  if (!file.startsWith(publicDir)) {
    res.writeHead(403); return res.end('forbidden');
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
    return true;
  } catch {
    if (requested.startsWith('/audit')) {
      try {
        const body = await readFile(join(publicDir, 'audit', 'index.html'));
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(body);
        return true;
      } catch { /* fall through */ }
    }
    return false;
  }
}

export function createServer() {
  return http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'GET' && !url.pathname.startsWith('/api')) {
      if (await servePublic(req, res)) return;
    }

    const readBody = async () => {
      let raw = '';
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 1_000_000) throw new Error('request body too large');
      }
      return raw ? JSON.parse(raw) : {};
    };

    try {
      const extra = await routeTransactions(req, url);
      const result = extra || await route(req, url, readBody);
      send(res, result.status, result.body);
    } catch (error) {
      send(res, 500, { error: String(error.message || error) });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer().listen(port, () => console.log(`Taskman API+UI on :${port} (Neon via DATABASE_URL)`));
}
