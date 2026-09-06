#!/usr/bin/env node
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { databaseEnabled } from '@taskman/db';
import { route } from './routes.js';

const port = Number(process.env.API_PORT || process.env.PORT || 3100);
const allowOrigin = process.env.CORS_ORIGIN || '*';

const CORS = {
  'access-control-allow-origin': allowOrigin,
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type,authorization'
};

/**
 * Every response says which storage it came from.
 *
 * Without DATABASE_URL every store falls back to an in-process Map, and this API
 * will serve those numbers exactly as if they were real — including revenue. A
 * dashboard reading it then shows cleared settlements and a revenue figure that
 * exist in no database, persist nowhere, and vanish when the process restarts.
 * That is the worst failure this system has, because unlike a crash it looks
 * like success: the operator sees money that is not there.
 *
 * The crons already refuse to run this way (packages/crons/cli.js). The API did
 * not, so it says so on every single response instead, where a reader cannot
 * miss it and a UI can surface it.
 */
const STORAGE_MODE = databaseEnabled ? 'postgres' : 'memory';

function send(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'x-taskman-storage': STORAGE_MODE,
    ...CORS
  });
  const envelope = (body && typeof body === 'object' && !Array.isArray(body))
    ? {
        ...body,
        storage: STORAGE_MODE,
        ...(databaseEnabled ? {} : {
          warning: 'DATABASE_URL is not set. These figures come from in-process memory, persist '
            + 'nowhere, and are lost when this process restarts. Any revenue shown here is not '
            + 'money — treat it as a local fixture, never as a settlement.'
        })
      }
    : body;
  res.end(JSON.stringify(envelope));
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
  createServer().listen(port, () => {
    console.log(`Taskman API listening on :${port} (storage: ${STORAGE_MODE})`);
    if (!databaseEnabled) {
      console.warn('[api] DATABASE_URL is not set. Every figure this serves — revenue included — '
        + 'is in-process memory that persists nowhere. Do not read it as money.');
    }
  });
}
