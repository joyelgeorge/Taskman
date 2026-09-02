#!/usr/bin/env node
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { route } from './routes.js';

const port = Number(process.env.API_PORT || process.env.PORT || 3100);
const allowOrigin = process.env.CORS_ORIGIN || '*';

const CORS = {
  'access-control-allow-origin': allowOrigin,
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type,authorization'
};

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...CORS });
  res.end(JSON.stringify(body));
}

export function createServer() {
  return http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    const readBody = async () => {
      let raw = '';
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 1_000_000) throw new Error('request body too large');
      }
      return raw ? JSON.parse(raw) : {};
    };

    try {
      const result = await route(req, url, readBody);
      send(res, result.status, result.body);
    } catch (error) {
      send(res, 500, { error: String(error.message || error) });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer().listen(port, () => console.log(`Taskman API listening on :${port}`));
}
