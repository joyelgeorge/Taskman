# Jez Layer 1 — Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a public, single-user HTTP gateway that every AI call routes through, which stores each exchange encrypted in Neon and never fails a call because of its own logic.

**Architecture:** An HTTP server exposing Anthropic- and OpenAI-compatible endpoints. Each request is normalized to a neutral `Exchange`, sized, routed to the cheapest free-tier provider that can serve it, streamed back byte-for-byte, and captured asynchronously after the stream closes. All content columns are AES-256-GCM encrypted in the application; the database never sees plaintext.

**Tech Stack:** Node 24 (ESM), `node:test`, `node:crypto`, `pg`. No other runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-09-10-jez-personal-ai-design.md` (in the Taskman repo; copy it into the new repo at `docs/design.md` in Task 1)

## Global Constraints

- **Node:** `>=24 <25`. ESM only (`"type": "module"`). No TypeScript, no build step.
- **Dependencies:** `pg` only. Everything else uses Node built-ins. No Express, no test framework, no crypto library.
- **Tests:** `node:test` + `node:assert/strict`, run with `npm test` (`node --test`). Every task's tests must pass with `DATABASE_URL` unset (memory mode).
- **Dual storage:** every store works with `DATABASE_URL` set (Postgres) and unset (in-memory array). Both paths must be honest about uniqueness and ordering.
- **Migrations:** numbered SQL files in `src/db/migrations/`, applied in order, recorded in a `jez_migrations` table.
- **Cipher:** AES-256-GCM, 12-byte random IV, 16-byte auth tag, AAD = `"<table>:<id>"`. Never base64 in the database — `bytea` only.
- **Encrypted columns:** `system`, `messages`, `response`, memory `text`, memory `embedding`. Never encrypt: `id`, `created_at`, `source`, `backend`, `model`, `tokens_in`, `tokens_out`, `cost_usd`, `latency_ms`, `status`, `key_version`.
- **Secrets:** the master key is read from `JEZ_MASTER_KEY` (base64, 32 bytes). It must never be logged, committed, written to the database, or included in an error message.
- **Pass-through invariant:** if any Jez-specific step (retrieve, capture, redact, encrypt) throws, the call still completes. Only routing and the backend call may fail a request.
- **Response fidelity:** Jez modifies requests only. Response bytes are relayed unchanged.

**Verified free-tier limits (2026-09-10)** — these exact numbers are used in Task 9:

| Provider | RPM | TPM | RPD | Max input tokens |
|---|---|---|---|---|
| `gemini` | 15 | 250000 | 1000 | 1000000 |
| `groq` | 30 | 6000 | 14400 | 8192 |
| `github` | 10 | null | 50 | 8000 |
| `openrouter` | 20 | null | 50 | 32000 |

---

### Task 1: Repository scaffold

**Files:**
- Create: `package.json`, `.gitignore`, `.env.example`, `README.md`, `docs/design.md`
- Create: `src/config.js`
- Test: `test/config.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `loadConfig(env = process.env) -> { port, databaseUrl, masterKeyB64, providers, spoolDir }` where `providers` is an array of `{ name, apiKey }` for providers whose key env var is set, in chain order `['gemini','groq','github','openrouter']`.

- [ ] **Step 1: Create the repository**

```bash
mkdir -p ~/Documents/anti-grav/jez && cd ~/Documents/anti-grav/jez
git init -b main
mkdir -p src/db/migrations src/crypto src/store src/wire src/backends src/router src/auth test docs
cp ~/Documents/anti-grav/Taskman/docs/superpowers/specs/2026-09-10-jez-personal-ai-design.md docs/design.md
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "jez",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24 <25" },
  "scripts": {
    "start": "node src/server.js",
    "dev": "node --watch src/server.js",
    "test": "node --test",
    "migrate": "node src/db/migrate.js"
  },
  "dependencies": { "pg": "^8.13.1" }
}
```

- [ ] **Step 3: Write `.gitignore` and `.env.example`**

`.gitignore`:
```
node_modules/
.env
spool/
*.log
```

`.env.example`:
```
PORT=11500
DATABASE_URL=
JEZ_MASTER_KEY=
GEMINI_API_KEY=
GROQ_API_KEY=
GITHUB_MODELS_TOKEN=
OPENROUTER_API_KEY=
JEZ_SPOOL_DIR=./spool
```

- [ ] **Step 4: Install dependencies**

```bash
npm install
```

This must happen before Task 4, whose tests import `src/db/index.js`, which
imports `pg`.

- [ ] **Step 5: Write the failing test**

`test/config.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

test('defaults port to 11500', () => {
  const cfg = loadConfig({});
  assert.equal(cfg.port, 11500);
});

test('includes only providers whose key is set, in chain order', () => {
  const cfg = loadConfig({ GROQ_API_KEY: 'g', GEMINI_API_KEY: 'x' });
  assert.deepEqual(cfg.providers.map(p => p.name), ['gemini', 'groq']);
});

test('omits providers with no key', () => {
  const cfg = loadConfig({});
  assert.deepEqual(cfg.providers, []);
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `../src/config.js`

- [ ] **Step 7: Write `src/config.js`**

```js
const PROVIDER_KEYS = [
  ['gemini', 'GEMINI_API_KEY'],
  ['groq', 'GROQ_API_KEY'],
  ['github', 'GITHUB_MODELS_TOKEN'],
  ['openrouter', 'OPENROUTER_API_KEY']
];

export function loadConfig(env = process.env) {
  return {
    port: Number(env.PORT || 11500),
    databaseUrl: env.DATABASE_URL || null,
    masterKeyB64: env.JEZ_MASTER_KEY || null,
    spoolDir: env.JEZ_SPOOL_DIR || './spool',
    providers: PROVIDER_KEYS
      .filter(([, keyVar]) => Boolean(env[keyVar]))
      .map(([name, keyVar]) => ({ name, apiKey: env[keyVar] }))
  };
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm test`
Expected: PASS (3 tests)

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "Scaffold the repo and read configuration from the environment"
```

- [ ] **Step 10: Create the private GitHub repo and push**

```bash
gh repo create jez --private --source=. --remote=origin --push
```

---

### Task 2: Envelope encryption

**Files:**
- Create: `src/crypto/envelope.js`
- Test: `test/envelope.test.js`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `encrypt(key: Buffer, plaintext: string, aad: string) -> Buffer` (layout: `iv[12] || tag[16] || ciphertext`)
  - `decrypt(key: Buffer, blob: Buffer, aad: string) -> string`
  - `aadFor(table: string, id: string) -> string`
  - `generateKey() -> Buffer` (32 bytes)
  - `wrapDek(masterKey: Buffer, dek: Buffer, keyVersion: number) -> Buffer`
  - `unwrapDek(masterKey: Buffer, blob: Buffer, keyVersion: number) -> Buffer`

- [ ] **Step 1: Write the failing test**

`test/envelope.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encrypt, decrypt, aadFor, generateKey, wrapDek, unwrapDek } from '../src/crypto/envelope.js';

test('round-trips plaintext', () => {
  const key = generateKey();
  const aad = aadFor('jez_exchanges', 'abc');
  const blob = encrypt(key, 'hello world', aad);
  assert.equal(decrypt(key, blob, aad), 'hello world');
});

test('ciphertext is not plaintext and carries iv and tag', () => {
  const key = generateKey();
  const blob = encrypt(key, 'hello', aadFor('t', '1'));
  assert.ok(!blob.toString('utf8').includes('hello'));
  assert.equal(blob.length, 12 + 16 + 5);
});

test('same plaintext encrypts differently each time', () => {
  const key = generateKey();
  const aad = aadFor('t', '1');
  assert.notEqual(encrypt(key, 'x', aad).toString('hex'), encrypt(key, 'x', aad).toString('hex'));
});

test('ciphertext moved to another row fails to decrypt', () => {
  const key = generateKey();
  const blob = encrypt(key, 'secret', aadFor('jez_exchanges', 'row-1'));
  assert.throws(() => decrypt(key, blob, aadFor('jez_exchanges', 'row-2')));
});

test('wrong key fails to decrypt', () => {
  const blob = encrypt(generateKey(), 'secret', aadFor('t', '1'));
  assert.throws(() => decrypt(generateKey(), blob, aadFor('t', '1')));
});

test('tampered ciphertext fails to decrypt', () => {
  const key = generateKey();
  const blob = encrypt(key, 'secret', aadFor('t', '1'));
  blob[blob.length - 1] ^= 0xff;
  assert.throws(() => decrypt(key, blob, aadFor('t', '1')));
});

test('wraps and unwraps a data encryption key', () => {
  const master = generateKey();
  const dek = generateKey();
  const wrapped = wrapDek(master, dek, 1);
  assert.deepEqual(unwrapDek(master, wrapped, 1), dek);
});

test('a dek wrapped for one key version does not unwrap as another', () => {
  const master = generateKey();
  const wrapped = wrapDek(master, generateKey(), 1);
  assert.throws(() => unwrapDek(master, wrapped, 2));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/envelope.test.js`
Expected: FAIL — cannot find module `../src/crypto/envelope.js`

- [ ] **Step 3: Write `src/crypto/envelope.js`**

```js
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

export const generateKey = () => randomBytes(32);

export const aadFor = (table, id) => `${table}:${id}`;

export function encrypt(key, plaintext, aad) {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

export function decrypt(key, blob, aad) {
  const iv = blob.subarray(0, IV_LEN);
  const tag = blob.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const body = blob.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}

// A DEK is wrapped with the same construction, bound to its key version so a
// blob cannot be replayed under a different version.
export function wrapDek(masterKey, dek, keyVersion) {
  return encrypt(masterKey, dek.toString('base64'), `dek:v${keyVersion}`);
}

export function unwrapDek(masterKey, blob, keyVersion) {
  return Buffer.from(decrypt(masterKey, blob, `dek:v${keyVersion}`), 'base64');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/envelope.test.js`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/crypto/envelope.js test/envelope.test.js
git commit -m "Encrypt with the row's identity mixed in, so ciphertext cannot move"
```

---

### Task 3: Key management

**Files:**
- Create: `src/crypto/keys.js`
- Test: `test/keys.test.js`

**Interfaces:**
- Consumes: `generateKey`, `wrapDek`, `unwrapDek` from Task 2
- Produces: `createKeyring({ masterKeyB64 }) -> { enabled, keyVersion, encryptField(table, id, plaintext), decryptField(table, id, blob) }`. When `masterKeyB64` is null, `enabled` is `false` and `encryptField` returns a `Buffer` of UTF-8 plaintext (memory-mode only, never used against Postgres).

- [ ] **Step 1: Write the failing test**

`test/keys.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createKeyring } from '../src/crypto/keys.js';
import { generateKey } from '../src/crypto/envelope.js';

const masterKeyB64 = generateKey().toString('base64');

test('encrypts and decrypts a field', () => {
  const ring = createKeyring({ masterKeyB64 });
  const blob = ring.encryptField('jez_exchanges', 'id-1', 'hello');
  assert.ok(!blob.toString('utf8').includes('hello'));
  assert.equal(ring.decryptField('jez_exchanges', 'id-1', blob), 'hello');
});

test('reports enabled and a key version', () => {
  const ring = createKeyring({ masterKeyB64 });
  assert.equal(ring.enabled, true);
  assert.equal(ring.keyVersion, 1);
});

test('without a master key it passes through and reports disabled', () => {
  const ring = createKeyring({ masterKeyB64: null });
  assert.equal(ring.enabled, false);
  const blob = ring.encryptField('t', '1', 'hello');
  assert.equal(ring.decryptField('t', '1', blob), 'hello');
});

test('rejects a master key of the wrong length', () => {
  assert.throws(() => createKeyring({ masterKeyB64: Buffer.alloc(8).toString('base64') }),
    /32 bytes/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/keys.test.js`
Expected: FAIL — cannot find module `../src/crypto/keys.js`

- [ ] **Step 3: Write `src/crypto/keys.js`**

```js
import { generateKey, wrapDek, unwrapDek, encrypt, decrypt, aadFor } from './envelope.js';

const KEY_VERSION = 1;

/**
 * Holds the single decryption key for the process. The master key wraps a DEK
 * so the master can be rotated without rewriting rows; at Layer 1 there is one
 * DEK, derived per boot from the master and held only in memory.
 *
 * With no master key the ring is disabled and passes plaintext through. That
 * path exists so the suite runs without secrets - it is never used against a
 * real database, which is enforced in src/store/exchanges.js.
 */
export function createKeyring({ masterKeyB64 }) {
  if (!masterKeyB64) {
    return {
      enabled: false,
      keyVersion: 0,
      encryptField: (_table, _id, plaintext) => Buffer.from(plaintext ?? '', 'utf8'),
      decryptField: (_table, _id, blob) => Buffer.from(blob).toString('utf8')
    };
  }

  const masterKey = Buffer.from(masterKeyB64, 'base64');
  if (masterKey.length !== 32) throw new Error('JEZ_MASTER_KEY must decode to 32 bytes');

  // Wrap-then-unwrap proves the master key works before any row is written.
  const dek = unwrapDek(masterKey, wrapDek(masterKey, generateKey(), KEY_VERSION), KEY_VERSION);

  return {
    enabled: true,
    keyVersion: KEY_VERSION,
    encryptField: (table, id, plaintext) => encrypt(dek, plaintext ?? '', aadFor(table, id)),
    decryptField: (table, id, blob) => decrypt(dek, Buffer.from(blob), aadFor(table, id))
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/keys.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/crypto/keys.js test/keys.test.js
git commit -m "Hold one key per process, and prove it works before writing a row"
```

---

### Task 4: Database layer and migration

**Files:**
- Create: `src/db/index.js`, `src/db/memory-table.js`, `src/db/migrate.js`, `src/db/migrations/001_jez_corpus.sql`
- Test: `test/memory-table.test.js`, `test/schema-code-agreement.test.js`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `databaseEnabled: boolean`, `query(text, params) -> Promise<Result>`, `healthCheck() -> Promise<{enabled, ok, reason?}>`
  - `class MemoryTable { constructor({unique}) ; insert(row); upsert(row, patch); find(fn); filter(fn); all(); remove(fn); clear() }`
  - `EXCHANGE_COLUMNS: string[]` exported from `src/db/index.js`, the single list both the SQL and the store agree on

- [ ] **Step 1: Write `src/db/migrations/001_jez_corpus.sql`**

```sql
CREATE TABLE IF NOT EXISTS jez_migrations (
  name       text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jez_exchanges (
  id          uuid PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now(),
  source      text        NOT NULL,
  backend     text        NOT NULL,
  model       text        NOT NULL,
  system      bytea,
  messages    bytea       NOT NULL,
  response    bytea,
  tokens_in   integer     NOT NULL DEFAULT 0,
  tokens_out  integer     NOT NULL DEFAULT 0,
  cost_usd    numeric(12,6) NOT NULL DEFAULT 0,
  latency_ms  integer     NOT NULL DEFAULT 0,
  status      text        NOT NULL CHECK (status IN ('ok','error','partial')),
  redacted    boolean     NOT NULL DEFAULT false,
  key_version integer     NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS jez_exchanges_created_at_idx ON jez_exchanges (created_at DESC);
CREATE INDEX IF NOT EXISTS jez_exchanges_backend_idx    ON jez_exchanges (backend);

CREATE TABLE IF NOT EXISTS jez_api_keys (
  id          uuid PRIMARY KEY,
  label       text        NOT NULL,
  prefix      text        NOT NULL UNIQUE,
  hash        text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz
);
```

- [ ] **Step 2: Write the failing tests**

`test/memory-table.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryTable } from '../src/db/memory-table.js';

test('inserts and reads back', () => {
  const t = new MemoryTable();
  t.insert({ id: '1', v: 'a' });
  assert.equal(t.all().length, 1);
});

test('respects a unique constraint', () => {
  const t = new MemoryTable({ unique: ['prefix'] });
  assert.equal(t.insert({ prefix: 'p', n: 1 }).inserted, true);
  const second = t.insert({ prefix: 'p', n: 2 });
  assert.equal(second.inserted, false);
  assert.equal(second.row.n, 1);
});

test('removes by predicate', () => {
  const t = new MemoryTable();
  t.insert({ id: '1' }); t.insert({ id: '2' });
  assert.equal(t.remove(r => r.id === '1'), 1);
  assert.equal(t.all().length, 1);
});
```

`test/schema-code-agreement.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EXCHANGE_COLUMNS } from '../src/db/index.js';

const sql = readFileSync(new URL('../src/db/migrations/001_jez_corpus.sql', import.meta.url), 'utf8');

test('every column the code writes exists in the migration', () => {
  const body = sql.slice(sql.indexOf('CREATE TABLE IF NOT EXISTS jez_exchanges'));
  const table = body.slice(0, body.indexOf(');'));
  for (const column of EXCHANGE_COLUMNS) {
    assert.ok(new RegExp(`^\\s+${column}\\s`, 'm').test(table), `missing column: ${column}`);
  }
});

test('content columns are bytea, so plaintext cannot be written', () => {
  for (const column of ['system', 'messages', 'response']) {
    assert.ok(new RegExp(`${column}\\s+bytea`).test(sql), `${column} must be bytea`);
  }
});

test('status is constrained', () => {
  assert.match(sql, /status\s+text\s+NOT NULL CHECK \(status IN \('ok','error','partial'\)\)/);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test test/memory-table.test.js test/schema-code-agreement.test.js`
Expected: FAIL — cannot find modules `../src/db/memory-table.js` and `../src/db/index.js`

- [ ] **Step 4: Write `src/db/memory-table.js`**

```js
/**
 * Array-backed table used when DATABASE_URL is unset. Every store works in both
 * modes so the suite runs without a database, which makes the memory path the
 * one CI exercises - so it has to stay honest about uniqueness and ordering.
 */
export class MemoryTable {
  constructor({ unique = [] } = {}) {
    this.rows = [];
    this.unique = unique;
  }

  #conflict(row) {
    if (!this.unique.length) return null;
    return this.rows.find(existing => this.unique.every(key => existing[key] === row[key])) || null;
  }

  insert(row) {
    const conflict = this.#conflict(row);
    if (conflict) return { row: conflict, inserted: false };
    this.rows.push(row);
    return { row, inserted: true };
  }

  upsert(row, patch = null) {
    const conflict = this.#conflict(row);
    if (conflict) {
      Object.assign(conflict, patch ?? row, { id: conflict.id });
      return { row: conflict, inserted: false };
    }
    this.rows.push(row);
    return { row, inserted: true };
  }

  find(predicate) { return this.rows.find(predicate) || null; }
  filter(predicate) { return this.rows.filter(predicate); }
  all() { return [...this.rows]; }
  remove(predicate) {
    const kept = this.rows.filter(r => !predicate(r));
    const removed = this.rows.length - kept.length;
    this.rows = kept;
    return removed;
  }
  clear() { this.rows.length = 0; }
}

export const nowIso = () => new Date().toISOString();
```

- [ ] **Step 5: Write `src/db/index.js`**

```js
import pg from 'pg';

const { Pool } = pg;

export const databaseEnabled = Boolean(process.env.DATABASE_URL);

const isLocal = url => /localhost|127\.0\.0\.1/.test(url || '');

export const pool = databaseEnabled
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSL === 'disable' || isLocal(process.env.DATABASE_URL)
        ? false
        : { rejectUnauthorized: false },
      max: Number(process.env.PGPOOL_MAX || 3),
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000
    })
  : null;

export async function query(text, params = []) {
  if (!pool) throw new Error('DATABASE_URL is not configured');
  return pool.query(text, params);
}

export async function healthCheck() {
  if (!pool) return { enabled: false, ok: false, reason: 'DATABASE_URL not set (memory mode)' };
  try {
    await pool.query('SELECT 1');
    return { enabled: true, ok: true };
  } catch (error) {
    return { enabled: true, ok: false, reason: String(error.message || error) };
  }
}

/** The one list the migration and the store must agree on. */
export const EXCHANGE_COLUMNS = [
  'id', 'created_at', 'source', 'backend', 'model',
  'system', 'messages', 'response',
  'tokens_in', 'tokens_out', 'cost_usd', 'latency_ms',
  'status', 'redacted', 'key_version'
];
```

- [ ] **Step 6: Write `src/db/migrate.js`**

```js
import { readdirSync, readFileSync } from 'node:fs';
import { query, databaseEnabled } from './index.js';

const DIR = new URL('./migrations/', import.meta.url);

export async function migrate() {
  if (!databaseEnabled) {
    console.log('memory mode: no migrations to run');
    return [];
  }
  await query(`CREATE TABLE IF NOT EXISTS jez_migrations (
    name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const { rows } = await query('SELECT name FROM jez_migrations');
  const done = new Set(rows.map(r => r.name));
  const applied = [];
  for (const name of readdirSync(DIR).filter(f => f.endsWith('.sql')).sort()) {
    if (done.has(name)) continue;
    await query(readFileSync(new URL(name, DIR), 'utf8'));
    await query('INSERT INTO jez_migrations (name) VALUES ($1)', [name]);
    applied.push(name);
    console.log(`applied ${name}`);
  }
  return applied;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `node --test test/memory-table.test.js test/schema-code-agreement.test.js`
Expected: PASS (6 tests)

- [ ] **Step 8: Commit**

```bash
git add src/db test/memory-table.test.js test/schema-code-agreement.test.js
git commit -m "Store rows in memory or Postgres, and make the schema prove it agrees"
```

---

### Task 5: Redaction policy

**Files:**
- Create: `src/policy.js`
- Test: `test/policy.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `redact(text: string) -> { text: string, redacted: boolean }` and `redactDeep(value: any) -> { value: any, redacted: boolean }` (walks strings inside objects and arrays)

- [ ] **Step 1: Write the failing test**

`test/policy.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact, redactDeep } from '../src/policy.js';

test('leaves ordinary text alone', () => {
  const out = redact('the quick brown fox');
  assert.equal(out.text, 'the quick brown fox');
  assert.equal(out.redacted, false);
});

test('redacts an anthropic key', () => {
  const out = redact('key is sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
  assert.ok(!out.text.includes('AAAAAAAA'));
  assert.equal(out.redacted, true);
});

test('redacts an openai key', () => {
  assert.equal(redact('sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345').redacted, true);
});

test('redacts a github token', () => {
  assert.equal(redact('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789').redacted, true);
});

test('redacts an aws access key id', () => {
  assert.equal(redact('AKIAIOSFODNN7EXAMPLE').redacted, true);
});

test('redacts an assignment to a secret-looking name', () => {
  const out = redact('DATABASE_PASSWORD=hunter2supersecret');
  assert.ok(!out.text.includes('hunter2supersecret'));
  assert.equal(out.redacted, true);
});

test('redacts a bearer token', () => {
  assert.equal(redact('Authorization: Bearer abcdef0123456789abcdef').redacted, true);
});

test('walks nested structures', () => {
  const out = redactDeep({ a: ['ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'], b: 'fine' });
  assert.equal(out.redacted, true);
  assert.equal(out.value.b, 'fine');
  assert.ok(!JSON.stringify(out.value).includes('ghp_ABCDEF'));
});

test('reports nothing redacted for clean structures', () => {
  assert.equal(redactDeep({ a: ['hello'], b: 2 }).redacted, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/policy.test.js`
Expected: FAIL — cannot find module `../src/policy.js`

- [ ] **Step 3: Write `src/policy.js`**

```js
const PLACEHOLDER = '[REDACTED]';

/**
 * The corpus must never hold a live credential. These patterns are deliberately
 * broad: a false positive costs one unreadable string, a false negative writes a
 * working key into permanent storage.
 */
const PATTERNS = [
  /\bsk-ant-[A-Za-z0-9_-]{20,}/g,
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\bgsk_[A-Za-z0-9]{20,}/g,
  /\bBearer\s+[A-Za-z0-9._-]{20,}/gi,
  /\b[A-Z0-9_]*(?:SECRET|PASSWORD|TOKEN|APIKEY|API_KEY|PRIVATE_KEY)[A-Z0-9_]*\s*[=:]\s*\S+/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g
];

export function redact(text) {
  if (typeof text !== 'string') return { text, redacted: false };
  let out = text;
  let redacted = false;
  for (const pattern of PATTERNS) {
    out = out.replace(pattern, match => {
      redacted = true;
      // Keep the assignment's left-hand side so the shape stays readable.
      const eq = match.indexOf('=');
      return eq > 0 && eq < 40 ? `${match.slice(0, eq + 1)}${PLACEHOLDER}` : PLACEHOLDER;
    });
  }
  return { text: out, redacted };
}

export function redactDeep(value) {
  let redacted = false;
  const walk = node => {
    if (typeof node === 'string') {
      const result = redact(node);
      if (result.redacted) redacted = true;
      return result.text;
    }
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v)]));
    }
    return node;
  };
  return { value: walk(value), redacted };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/policy.test.js`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/policy.js test/policy.test.js
git commit -m "Scrub credentials before anything reaches permanent storage"
```

---

### Task 6: The neutral Exchange, and Anthropic wire format

**Files:**
- Create: `src/wire/exchange.js`, `src/wire/anthropic.js`
- Test: `test/wire-anthropic.test.js`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `src/wire/exchange.js`: `makeExchange({ model, system, messages, maxTokens, stream, source }) -> Exchange` where `Exchange = { id, model, system: string|null, messages: Array<{role, content: string}>, maxTokens: number, stream: boolean, source: string }`
  - `src/wire/anthropic.js`: `parseAnthropicRequest(body, source) -> Exchange`, `toAnthropicResponse(exchange, text, usage) -> object`

- [ ] **Step 1: Write the failing test**

`test/wire-anthropic.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAnthropicRequest, toAnthropicResponse } from '../src/wire/anthropic.js';

test('parses a plain request', () => {
  const ex = parseAnthropicRequest({
    model: 'claude-x', max_tokens: 100,
    messages: [{ role: 'user', content: 'hi' }]
  }, 'test');
  assert.equal(ex.model, 'claude-x');
  assert.equal(ex.maxTokens, 100);
  assert.deepEqual(ex.messages, [{ role: 'user', content: 'hi' }]);
  assert.equal(ex.system, null);
  assert.equal(ex.source, 'test');
  assert.ok(ex.id);
});

test('flattens content blocks to text', () => {
  const ex = parseAnthropicRequest({
    model: 'm', max_tokens: 10,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }]
  }, 'test');
  assert.equal(ex.messages[0].content, 'a\nb');
});

test('accepts a system string and a system block array', () => {
  const a = parseAnthropicRequest({ model: 'm', max_tokens: 1, system: 'be brief', messages: [] }, 't');
  assert.equal(a.system, 'be brief');
  const b = parseAnthropicRequest({
    model: 'm', max_tokens: 1, system: [{ type: 'text', text: 'be brief' }], messages: []
  }, 't');
  assert.equal(b.system, 'be brief');
});

test('carries the stream flag', () => {
  assert.equal(parseAnthropicRequest({ model: 'm', max_tokens: 1, messages: [], stream: true }, 't').stream, true);
});

test('rejects a request with no model', () => {
  assert.throws(() => parseAnthropicRequest({ max_tokens: 1, messages: [] }, 't'), /model/);
});

test('builds an anthropic-shaped response', () => {
  const ex = parseAnthropicRequest({ model: 'm', max_tokens: 5, messages: [] }, 't');
  const res = toAnthropicResponse(ex, 'hello', { inputTokens: 3, outputTokens: 2 });
  assert.equal(res.type, 'message');
  assert.equal(res.role, 'assistant');
  assert.deepEqual(res.content, [{ type: 'text', text: 'hello' }]);
  assert.equal(res.usage.input_tokens, 3);
  assert.equal(res.usage.output_tokens, 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/wire-anthropic.test.js`
Expected: FAIL — cannot find module `../src/wire/anthropic.js`

- [ ] **Step 3: Write `src/wire/exchange.js`**

```js
import { randomUUID } from 'node:crypto';

/**
 * The one shape both wire formats normalise into. Backends only ever see this,
 * which is what makes swapping a provider a config change rather than a rewrite.
 */
export function makeExchange({ model, system = null, messages = [], maxTokens = 1024, stream = false, source = 'unknown' }) {
  if (!model) throw new Error('model is required');
  return { id: randomUUID(), model, system, messages, maxTokens, stream, source };
}

/** Content may be a string or an array of blocks; the corpus stores text. */
export function flattenContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(b => b?.type === 'text' && typeof b.text === 'string')
    .map(b => b.text).join('\n');
}
```

- [ ] **Step 4: Write `src/wire/anthropic.js`**

```js
import { makeExchange, flattenContent } from './exchange.js';

export function parseAnthropicRequest(body, source) {
  return makeExchange({
    model: body.model,
    system: body.system === undefined || body.system === null ? null : flattenContent(body.system),
    messages: (body.messages || []).map(m => ({ role: m.role, content: flattenContent(m.content) })),
    maxTokens: body.max_tokens ?? 1024,
    stream: Boolean(body.stream),
    source
  });
}

export function toAnthropicResponse(exchange, text, usage) {
  return {
    id: `msg_${exchange.id}`,
    type: 'message',
    role: 'assistant',
    model: exchange.model,
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: usage.inputTokens ?? 0, output_tokens: usage.outputTokens ?? 0 }
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/wire-anthropic.test.js`
Expected: PASS (6 tests)

- [ ] **Step 6: Commit**

```bash
git add src/wire test/wire-anthropic.test.js
git commit -m "Normalise Anthropic requests into the one shape backends understand"
```

---

### Task 7: OpenAI wire format

**Files:**
- Create: `src/wire/openai.js`
- Test: `test/wire-openai.test.js`

**Interfaces:**
- Consumes: `makeExchange`, `flattenContent` from Task 6
- Produces: `parseOpenAIRequest(body, source) -> Exchange`, `toOpenAIResponse(exchange, text, usage) -> object`

- [ ] **Step 1: Write the failing test**

`test/wire-openai.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOpenAIRequest, toOpenAIResponse } from '../src/wire/openai.js';

test('lifts a system message out of the array', () => {
  const ex = parseOpenAIRequest({
    model: 'gpt-x',
    messages: [{ role: 'system', content: 'be brief' }, { role: 'user', content: 'hi' }]
  }, 'test');
  assert.equal(ex.system, 'be brief');
  assert.deepEqual(ex.messages, [{ role: 'user', content: 'hi' }]);
});

test('joins multiple system messages', () => {
  const ex = parseOpenAIRequest({
    model: 'm', messages: [
      { role: 'system', content: 'a' }, { role: 'system', content: 'b' }, { role: 'user', content: 'x' }
    ]
  }, 't');
  assert.equal(ex.system, 'a\nb');
});

test('defaults max tokens when absent', () => {
  assert.equal(parseOpenAIRequest({ model: 'm', messages: [] }, 't').maxTokens, 1024);
});

test('reads max_completion_tokens as well as max_tokens', () => {
  assert.equal(parseOpenAIRequest({ model: 'm', messages: [], max_completion_tokens: 77 }, 't').maxTokens, 77);
});

test('builds an openai-shaped response', () => {
  const ex = parseOpenAIRequest({ model: 'm', messages: [] }, 't');
  const res = toOpenAIResponse(ex, 'hello', { inputTokens: 1, outputTokens: 2 });
  assert.equal(res.object, 'chat.completion');
  assert.equal(res.choices[0].message.content, 'hello');
  assert.equal(res.choices[0].message.role, 'assistant');
  assert.equal(res.usage.total_tokens, 3);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/wire-openai.test.js`
Expected: FAIL — cannot find module `../src/wire/openai.js`

- [ ] **Step 3: Write `src/wire/openai.js`**

```js
import { makeExchange, flattenContent } from './exchange.js';

export function parseOpenAIRequest(body, source) {
  const all = (body.messages || []).map(m => ({ role: m.role, content: flattenContent(m.content) }));
  const system = all.filter(m => m.role === 'system').map(m => m.content).join('\n');
  return makeExchange({
    model: body.model,
    system: system || null,
    messages: all.filter(m => m.role !== 'system'),
    maxTokens: body.max_completion_tokens ?? body.max_tokens ?? 1024,
    stream: Boolean(body.stream),
    source
  });
}

export function toOpenAIResponse(exchange, text, usage) {
  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  return {
    id: `chatcmpl-${exchange.id}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: exchange.model,
    choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens, total_tokens: inputTokens + outputTokens }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/wire-openai.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/wire/openai.js test/wire-openai.test.js
git commit -m "Speak the OpenAI wire format too, so more tools can point here"
```

---

### Task 8: Budget estimation and provider limits

**Files:**
- Create: `src/router/budget.js`
- Test: `test/budget.test.js`

**Interfaces:**
- Consumes: `Exchange` from Task 6
- Produces:
  - `PROVIDER_LIMITS: Record<string, { rpm, tpm, rpd, maxInputTokens }>`
  - `estimateTokens(exchange) -> number`
  - `canServe(providerName, tokens) -> boolean`

- [ ] **Step 1: Write the failing test**

`test/budget.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateTokens, canServe, PROVIDER_LIMITS } from '../src/router/budget.js';

const exchange = (chars) => ({
  system: null, maxTokens: 100,
  messages: [{ role: 'user', content: 'x'.repeat(chars) }]
});

test('estimates roughly four characters per token', () => {
  const tokens = estimateTokens(exchange(4000));
  assert.ok(tokens >= 1000 && tokens <= 1200, `got ${tokens}`);
});

test('counts the system prompt', () => {
  const withSystem = { ...exchange(400), system: 'y'.repeat(4000) };
  assert.ok(estimateTokens(withSystem) > estimateTokens(exchange(400)) + 900);
});

test('groq cannot serve a request above its tokens-per-minute limit', () => {
  assert.equal(canServe('groq', 5000), true);
  assert.equal(canServe('groq', 7000), false);
});

test('github models refuses anything over its input cap', () => {
  assert.equal(canServe('github', 7000), true);
  assert.equal(canServe('github', 9000), false);
});

test('gemini has room for large requests', () => {
  assert.equal(canServe('gemini', 100000), true);
});

test('an unknown provider cannot serve', () => {
  assert.equal(canServe('nope', 10), false);
});

test('the verified limits are recorded exactly', () => {
  assert.equal(PROVIDER_LIMITS.groq.tpm, 6000);
  assert.equal(PROVIDER_LIMITS.gemini.tpm, 250000);
  assert.equal(PROVIDER_LIMITS.github.maxInputTokens, 8000);
  assert.equal(PROVIDER_LIMITS.openrouter.rpd, 50);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/budget.test.js`
Expected: FAIL — cannot find module `../src/router/budget.js`

- [ ] **Step 3: Write `src/router/budget.js`**

```js
/**
 * Verified 2026-09-10. Free tiers move; re-check quarterly and update here.
 * These differ by two orders of magnitude in tokens-per-minute, which is why
 * the router sizes a request before choosing rather than merely falling back.
 */
export const PROVIDER_LIMITS = {
  gemini:     { rpm: 15, tpm: 250000, rpd: 1000,  maxInputTokens: 1000000 },
  groq:       { rpm: 30, tpm: 6000,   rpd: 14400, maxInputTokens: 8192 },
  github:     { rpm: 10, tpm: null,   rpd: 50,    maxInputTokens: 8000 },
  openrouter: { rpm: 20, tpm: null,   rpd: 50,    maxInputTokens: 32000 }
};

const CHARS_PER_TOKEN = 4;

/** Cheap and deliberately slightly pessimistic: over-estimating costs a fallback, under-estimating costs a 429. */
export function estimateTokens(exchange) {
  const body = (exchange.messages || []).map(m => m.content || '').join('\n');
  const chars = body.length + (exchange.system?.length || 0);
  return Math.ceil(chars / CHARS_PER_TOKEN) + (exchange.maxTokens || 0);
}

export function canServe(providerName, tokens) {
  const limits = PROVIDER_LIMITS[providerName];
  if (!limits) return false;
  if (tokens > limits.maxInputTokens) return false;
  if (limits.tpm !== null && tokens > limits.tpm) return false;
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/budget.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/router/budget.js test/budget.test.js
git commit -m "Size a request before choosing, because the free tiers differ by 40x"
```

---

### Task 9: Backend adapters

**Files:**
- Create: `src/backends/openai-compatible.js`, `src/backends/index.js`
- Test: `test/backends.test.js`

**Interfaces:**
- Consumes: `Exchange` from Task 6
- Produces: `BACKENDS: Record<string, { name, baseUrl, defaultModel, authHeader(apiKey) }>` and
  `send(providerName, exchange, { apiKey, fetchImpl }) -> Promise<{ text, model, usage: { inputTokens, outputTokens } }>`.
  Throws `RateLimitError` (has `.status === 429`) or `BackendError` (has `.status`).

**Note on scope:** all four free providers expose an OpenAI-compatible
`/chat/completions` endpoint, so one client serves all of them. This is why
adding a fifth provider later is a table entry rather than a module.

- [ ] **Step 1: Write the failing test**

`test/backends.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { send, BACKENDS, RateLimitError } from '../src/backends/index.js';

const exchange = {
  model: null, system: 'be brief', maxTokens: 50,
  messages: [{ role: 'user', content: 'hi' }]
};

const fakeFetch = (captured) => async (url, options) => {
  captured.url = url;
  captured.options = options;
  captured.body = JSON.parse(options.body);
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: 'hello there' } }],
      model: 'served-model',
      usage: { prompt_tokens: 7, completion_tokens: 3 }
    })
  };
};

test('all four verified providers are registered', () => {
  assert.deepEqual(Object.keys(BACKENDS).sort(), ['gemini', 'github', 'groq', 'openrouter']);
});

test('sends the system prompt as a system message', async () => {
  const captured = {};
  await send('groq', exchange, { apiKey: 'k', fetchImpl: fakeFetch(captured) });
  assert.deepEqual(captured.body.messages[0], { role: 'system', content: 'be brief' });
  assert.deepEqual(captured.body.messages[1], { role: 'user', content: 'hi' });
});

test('omits the system message when there is none', async () => {
  const captured = {};
  await send('groq', { ...exchange, system: null }, { apiKey: 'k', fetchImpl: fakeFetch(captured) });
  assert.equal(captured.body.messages.length, 1);
});

test('authorises with a bearer token', async () => {
  const captured = {};
  await send('groq', exchange, { apiKey: 'secret', fetchImpl: fakeFetch(captured) });
  assert.equal(captured.options.headers.Authorization, 'Bearer secret');
});

test('falls back to the provider default model', async () => {
  const captured = {};
  await send('gemini', exchange, { apiKey: 'k', fetchImpl: fakeFetch(captured) });
  assert.equal(captured.body.model, BACKENDS.gemini.defaultModel);
});

test('normalises the response', async () => {
  const result = await send('groq', exchange, { apiKey: 'k', fetchImpl: fakeFetch({}) });
  assert.equal(result.text, 'hello there');
  assert.equal(result.model, 'served-model');
  assert.deepEqual(result.usage, { inputTokens: 7, outputTokens: 3 });
});

test('throws RateLimitError on 429', async () => {
  const fetchImpl = async () => ({ ok: false, status: 429, text: async () => 'slow down' });
  await assert.rejects(
    () => send('groq', exchange, { apiKey: 'k', fetchImpl }),
    err => err instanceof RateLimitError && err.status === 429
  );
});

test('throws with the status on other failures', async () => {
  const fetchImpl = async () => ({ ok: false, status: 500, text: async () => 'boom' });
  await assert.rejects(() => send('groq', exchange, { apiKey: 'k', fetchImpl }), /500/);
});

test('rejects an unknown provider', async () => {
  await assert.rejects(() => send('nope', exchange, { apiKey: 'k' }), /unknown backend/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/backends.test.js`
Expected: FAIL — cannot find module `../src/backends/index.js`

- [ ] **Step 3: Write `src/backends/openai-compatible.js`**

```js
export class BackendError extends Error {
  constructor(message, status) { super(message); this.name = 'BackendError'; this.status = status; }
}

export class RateLimitError extends BackendError {
  constructor(message) { super(message, 429); this.name = 'RateLimitError'; }
}

/**
 * Every free provider Jez uses exposes an OpenAI-compatible /chat/completions
 * endpoint, so one client covers all of them and a new provider is a table row.
 */
export async function sendOpenAICompatible(backend, exchange, { apiKey, fetchImpl = fetch }) {
  const messages = [
    ...(exchange.system ? [{ role: 'system', content: exchange.system }] : []),
    ...exchange.messages
  ];

  const response = await fetchImpl(backend.baseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: exchange.model || backend.defaultModel,
      messages,
      max_tokens: exchange.maxTokens,
      stream: false
    })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    if (response.status === 429) throw new RateLimitError(`${backend.name} rate limited: ${detail}`);
    throw new BackendError(`${backend.name} failed with ${response.status}: ${detail}`, response.status);
  }

  const body = await response.json();
  return {
    text: body.choices?.[0]?.message?.content ?? '',
    model: body.model || exchange.model || backend.defaultModel,
    usage: {
      inputTokens: body.usage?.prompt_tokens ?? 0,
      outputTokens: body.usage?.completion_tokens ?? 0
    }
  };
}
```

- [ ] **Step 4: Write `src/backends/index.js`**

```js
import { sendOpenAICompatible, BackendError, RateLimitError } from './openai-compatible.js';

export { BackendError, RateLimitError };

/**
 * Default models are the free-tier workhorses as of 2026-09-10. Verify them
 * against each provider's live model list before first deploy - model ids are
 * retired more often than endpoints are.
 */
export const BACKENDS = {
  gemini: {
    name: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    defaultModel: 'gemini-2.5-flash-lite'
  },
  groq: {
    name: 'groq',
    baseUrl: 'https://api.groq.com/openai/v1/chat/completions',
    defaultModel: 'llama-3.3-70b-versatile'
  },
  github: {
    name: 'github',
    baseUrl: 'https://models.github.ai/inference/chat/completions',
    defaultModel: 'openai/gpt-4o-mini'
  },
  openrouter: {
    name: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
    defaultModel: 'meta-llama/llama-3.3-70b-instruct:free'
  }
};

export function send(providerName, exchange, options) {
  const backend = BACKENDS[providerName];
  if (!backend) return Promise.reject(new Error(`unknown backend: ${providerName}`));
  return sendOpenAICompatible(backend, exchange, options);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/backends.test.js`
Expected: PASS (9 tests)

- [ ] **Step 6: Commit**

```bash
git add src/backends test/backends.test.js
git commit -m "Talk to every free provider through the one compatible endpoint"
```

---

### Task 10: The budget-aware fallback router

**Files:**
- Create: `src/router/chain.js`
- Test: `test/chain.test.js`

**Interfaces:**
- Consumes: `estimateTokens`, `canServe` (Task 8); `send`, `RateLimitError` (Task 9)
- Produces: `createRouter({ providers, sendImpl, now }) -> { route(exchange) -> Promise<{ text, model, usage, backend, attempts }>, eligible(exchange) -> string[] }`

- [ ] **Step 1: Write the failing test**

`test/chain.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouter } from '../src/router/chain.js';
import { RateLimitError } from '../src/backends/index.js';

const providers = [
  { name: 'gemini', apiKey: 'a' },
  { name: 'groq', apiKey: 'b' },
  { name: 'github', apiKey: 'c' }
];

const small = { model: null, system: null, maxTokens: 10, messages: [{ role: 'user', content: 'hi' }] };
const large = { model: null, system: 'x'.repeat(40000), maxTokens: 10, messages: [{ role: 'user', content: 'hi' }] };

const ok = (name) => async (provider) => ({
  text: `from ${provider}`, model: 'm', usage: { inputTokens: 1, outputTokens: 1 }
});

test('uses the first provider when it works', async () => {
  const router = createRouter({ providers, sendImpl: ok() });
  const result = await router.route(small);
  assert.equal(result.backend, 'gemini');
  assert.equal(result.attempts, 1);
});

test('falls through on a rate limit', async () => {
  const sendImpl = async (provider) => {
    if (provider === 'gemini') throw new RateLimitError('429');
    return { text: 'ok', model: 'm', usage: { inputTokens: 1, outputTokens: 1 } };
  };
  const result = await createRouter({ providers, sendImpl }).route(small);
  assert.equal(result.backend, 'groq');
  assert.equal(result.attempts, 2);
});

test('eliminates providers that cannot hold the request before trying them', async () => {
  const router = createRouter({ providers, sendImpl: ok() });
  // ~10k tokens: gemini can hold it, groq (6k tpm) and github (8k cap) cannot.
  assert.deepEqual(router.eligible(large), ['gemini']);
});

test('does not send a large request to a provider that would reject it', async () => {
  const tried = [];
  const sendImpl = async (provider) => {
    tried.push(provider);
    return { text: 'ok', model: 'm', usage: { inputTokens: 1, outputTokens: 1 } };
  };
  await createRouter({ providers, sendImpl }).route(large);
  assert.deepEqual(tried, ['gemini']);
});

test('remembers a rate limit and skips that provider next time', async () => {
  let geminiCalls = 0;
  const sendImpl = async (provider) => {
    if (provider === 'gemini') { geminiCalls++; throw new RateLimitError('429'); }
    return { text: 'ok', model: 'm', usage: { inputTokens: 1, outputTokens: 1 } };
  };
  const router = createRouter({ providers, sendImpl });
  await router.route(small);
  await router.route(small);
  assert.equal(geminiCalls, 1, 'a cooling-off provider should not be retried immediately');
});

test('fails with a clear error when every provider is exhausted', async () => {
  const sendImpl = async () => { throw new RateLimitError('429'); };
  await assert.rejects(
    () => createRouter({ providers, sendImpl }).route(small),
    /all providers failed/
  );
});

test('fails clearly when no provider can hold the request', async () => {
  const router = createRouter({ providers: [{ name: 'groq', apiKey: 'b' }], sendImpl: ok() });
  await assert.rejects(() => router.route(large), /no provider can serve/);
});

test('fails clearly when no providers are configured', async () => {
  await assert.rejects(
    () => createRouter({ providers: [], sendImpl: ok() }).route(small),
    /no provider/
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/chain.test.js`
Expected: FAIL — cannot find module `../src/router/chain.js`

- [ ] **Step 3: Write `src/router/chain.js`**

```js
import { estimateTokens, canServe } from './budget.js';
import { send as defaultSend, RateLimitError } from '../backends/index.js';

const COOLDOWN_MS = 60_000;

/**
 * Ordered fallback, but eligibility is decided before any call is made.
 * The free tiers differ by two orders of magnitude in tokens-per-minute, so
 * sending a memory-rich request down the chain in order would walk it into a
 * guaranteed 429 rather than into a fallback.
 */
export function createRouter({ providers, sendImpl = defaultSend, now = () => Date.now() }) {
  const coolingUntil = new Map();

  const available = () => providers.filter(p => (coolingUntil.get(p.name) ?? 0) <= now());

  const eligible = (exchange) => {
    const tokens = estimateTokens(exchange);
    return available().filter(p => canServe(p.name, tokens)).map(p => p.name);
  };

  async function route(exchange) {
    if (!providers.length) throw new Error('no provider is configured');

    const tokens = estimateTokens(exchange);
    const candidates = available().filter(p => canServe(p.name, tokens));

    if (!candidates.length) {
      const reason = available().length
        ? `no provider can serve ${tokens} tokens`
        : 'no provider available (all cooling off)';
      throw new Error(reason);
    }

    let attempts = 0;
    let lastError = null;

    for (const provider of candidates) {
      attempts++;
      try {
        const result = await sendImpl(provider.name, exchange, { apiKey: provider.apiKey });
        return { ...result, backend: provider.name, attempts };
      } catch (error) {
        lastError = error;
        if (error instanceof RateLimitError) coolingUntil.set(provider.name, now() + COOLDOWN_MS);
      }
    }

    throw new Error(`all providers failed after ${attempts} attempts: ${lastError?.message}`);
  }

  return { route, eligible };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/chain.test.js`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/router/chain.js test/chain.test.js
git commit -m "Rule providers out before calling them, and cool off the ones that refuse"
```

---

### Task 11: The encrypted exchange store

**Files:**
- Create: `src/store/exchanges.js`
- Test: `test/exchanges.test.js`

**Interfaces:**
- Consumes: `createKeyring` (Task 3); `MemoryTable`, `query`, `databaseEnabled`, `EXCHANGE_COLUMNS` (Task 4)
- Produces: `createExchangeStore({ keyring, db }) -> { record(exchange) -> Promise<{id}>, get(id) -> Promise<row|null>, recent(limit) -> Promise<row[]>, clear() }`.
  `db` is `{ enabled, query }`; when `enabled` is false the store uses a `MemoryTable`.
  Rows returned by `get`/`recent` are decrypted.

- [ ] **Step 1: Write the failing test**

`test/exchanges.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createExchangeStore } from '../src/store/exchanges.js';
import { createKeyring } from '../src/crypto/keys.js';
import { generateKey } from '../src/crypto/envelope.js';

const keyring = () => createKeyring({ masterKeyB64: generateKey().toString('base64') });
const store = () => createExchangeStore({ keyring: keyring(), db: { enabled: false } });

const sample = {
  id: '11111111-1111-4111-8111-111111111111',
  source: 'test', backend: 'groq', model: 'm',
  system: 'be brief', messages: [{ role: 'user', content: 'hi' }],
  response: 'hello', tokensIn: 3, tokensOut: 2,
  costUsd: 0, latencyMs: 12, status: 'ok', redacted: false
};

test('records and reads back an exchange', async () => {
  const s = store();
  await s.record(sample);
  const row = await s.get(sample.id);
  assert.equal(row.response, 'hello');
  assert.deepEqual(row.messages, [{ role: 'user', content: 'hi' }]);
  assert.equal(row.system, 'be brief');
});

test('keeps metadata in the clear', async () => {
  const s = store();
  await s.record(sample);
  const row = await s.get(sample.id);
  assert.equal(row.backend, 'groq');
  assert.equal(row.tokens_in, 3);
  assert.equal(row.status, 'ok');
});

test('stores content as ciphertext, not text', async () => {
  const s = store();
  await s.record(sample);
  const raw = s.rawRows()[0];
  assert.ok(Buffer.isBuffer(raw.response));
  assert.ok(!raw.response.toString('utf8').includes('hello'));
  assert.ok(!raw.messages.toString('utf8').includes('hi'));
});

test('returns recent exchanges newest first', async () => {
  const s = store();
  await s.record({ ...sample, id: '11111111-1111-4111-8111-111111111111' });
  await s.record({ ...sample, id: '22222222-2222-4222-8222-222222222222' });
  const rows = await s.recent(10);
  assert.equal(rows[0].id, '22222222-2222-4222-8222-222222222222');
});

test('returns null for an unknown id', async () => {
  assert.equal(await store().get('nope'), null);
});

test('refuses to write plaintext to a real database', () => {
  assert.throws(
    () => createExchangeStore({
      keyring: createKeyring({ masterKeyB64: null }),
      db: { enabled: true, query: async () => ({ rows: [] }) }
    }),
    /JEZ_MASTER_KEY/
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/exchanges.test.js`
Expected: FAIL — cannot find module `../src/store/exchanges.js`

- [ ] **Step 3: Write `src/store/exchanges.js`**

```js
import { MemoryTable, nowIso } from '../db/memory-table.js';

const TABLE = 'jez_exchanges';

export function createExchangeStore({ keyring, db }) {
  // Memory mode may run without a key so the suite needs no secrets. A real
  // database must never receive plaintext, so that combination is refused here
  // rather than discovered later in the corpus.
  if (db.enabled && !keyring.enabled) {
    throw new Error('JEZ_MASTER_KEY is required when DATABASE_URL is set');
  }

  const table = db.enabled ? null : new MemoryTable({ unique: ['id'] });

  const encode = (exchange) => ({
    id: exchange.id,
    created_at: exchange.createdAt || nowIso(),
    source: exchange.source,
    backend: exchange.backend,
    model: exchange.model,
    system: keyring.encryptField(TABLE, exchange.id, exchange.system ?? ''),
    messages: keyring.encryptField(TABLE, exchange.id, JSON.stringify(exchange.messages ?? [])),
    response: keyring.encryptField(TABLE, exchange.id, exchange.response ?? ''),
    tokens_in: exchange.tokensIn ?? 0,
    tokens_out: exchange.tokensOut ?? 0,
    cost_usd: exchange.costUsd ?? 0,
    latency_ms: exchange.latencyMs ?? 0,
    status: exchange.status ?? 'ok',
    redacted: Boolean(exchange.redacted),
    key_version: keyring.keyVersion
  });

  const decode = (row) => {
    if (!row) return null;
    const system = keyring.decryptField(TABLE, row.id, row.system);
    return {
      ...row,
      system: system === '' ? null : system,
      messages: JSON.parse(keyring.decryptField(TABLE, row.id, row.messages) || '[]'),
      response: keyring.decryptField(TABLE, row.id, row.response)
    };
  };

  async function record(exchange) {
    const row = encode(exchange);
    if (!db.enabled) {
      table.insert(row);
      return { id: row.id };
    }
    await db.query(
      `INSERT INTO ${TABLE} (id, created_at, source, backend, model, system, messages, response,
         tokens_in, tokens_out, cost_usd, latency_ms, status, redacted, key_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (id) DO NOTHING`,
      [row.id, row.created_at, row.source, row.backend, row.model, row.system, row.messages,
       row.response, row.tokens_in, row.tokens_out, row.cost_usd, row.latency_ms,
       row.status, row.redacted, row.key_version]
    );
    return { id: row.id };
  }

  async function get(id) {
    if (!db.enabled) return decode(table.find(r => r.id === id));
    const { rows } = await db.query(`SELECT * FROM ${TABLE} WHERE id = $1`, [id]);
    return decode(rows[0] || null);
  }

  async function recent(limit = 20) {
    if (!db.enabled) {
      return table.all().slice(-limit).reverse().map(decode);
    }
    const { rows } = await db.query(
      `SELECT * FROM ${TABLE} ORDER BY created_at DESC LIMIT $1`, [limit]);
    return rows.map(decode);
  }

  return {
    record, get, recent,
    clear: () => table?.clear(),
    /** Test seam: the rows exactly as stored, so encryption can be asserted. */
    rawRows: () => table?.all() ?? []
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/exchanges.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/store/exchanges.js test/exchanges.test.js
git commit -m "Write the corpus as ciphertext, and refuse plaintext against a real database"
```

---

### Task 12: Capture, with a disk spool that survives a database outage

**Files:**
- Create: `src/store/spool.js`, `src/capture.js`
- Test: `test/spool.test.js`, `test/capture.test.js`

**Interfaces:**
- Consumes: `redactDeep`, `redact` (Task 5); exchange store (Task 11)
- Produces:
  - `createSpool({ dir }) -> { push(record), drain(handler) -> Promise<number>, size() }`
  - `createCapture({ store, spool, logger }) -> { capture(record) -> Promise<void>, replay() -> Promise<number> }`

- [ ] **Step 1: Write the failing tests**

`test/spool.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSpool } from '../src/store/spool.js';

const freshDir = () => mkdtempSync(join(tmpdir(), 'jez-spool-'));

test('pushes and drains records', async () => {
  const dir = freshDir();
  const spool = createSpool({ dir });
  spool.push({ id: '1' });
  spool.push({ id: '2' });
  const seen = [];
  const drained = await spool.drain(async r => { seen.push(r.id); });
  assert.equal(drained, 2);
  assert.deepEqual(seen, ['1', '2']);
  assert.equal(spool.size(), 0);
  rmSync(dir, { recursive: true, force: true });
});

test('keeps records when the handler throws', async () => {
  const dir = freshDir();
  const spool = createSpool({ dir });
  spool.push({ id: '1' });
  const drained = await spool.drain(async () => { throw new Error('db down'); });
  assert.equal(drained, 0);
  assert.equal(spool.size(), 1);
  rmSync(dir, { recursive: true, force: true });
});

test('survives a restart', async () => {
  const dir = freshDir();
  createSpool({ dir }).push({ id: 'persisted' });
  const seen = [];
  await createSpool({ dir }).drain(async r => { seen.push(r.id); });
  assert.deepEqual(seen, ['persisted']);
  rmSync(dir, { recursive: true, force: true });
});
```

`test/capture.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCapture } from '../src/capture.js';
import { createSpool } from '../src/store/spool.js';

const record = () => ({
  id: '33333333-3333-4333-8333-333333333333',
  source: 't', backend: 'groq', model: 'm',
  system: null, messages: [{ role: 'user', content: 'my key is ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' }],
  response: 'ok', tokensIn: 1, tokensOut: 1, costUsd: 0, latencyMs: 5, status: 'ok'
});

const freshDir = () => mkdtempSync(join(tmpdir(), 'jez-cap-'));

test('records through to the store', async () => {
  const saved = [];
  const capture = createCapture({
    store: { record: async r => { saved.push(r); } },
    spool: createSpool({ dir: freshDir() })
  });
  await capture.capture(record());
  assert.equal(saved.length, 1);
});

test('redacts credentials before storing and flags the row', async () => {
  const saved = [];
  const capture = createCapture({
    store: { record: async r => { saved.push(r); } },
    spool: createSpool({ dir: freshDir() })
  });
  await capture.capture(record());
  assert.ok(!JSON.stringify(saved[0].messages).includes('ghp_ABCDEF'));
  assert.equal(saved[0].redacted, true);
});

test('spools instead of throwing when the store fails', async () => {
  const spool = createSpool({ dir: freshDir() });
  const capture = createCapture({
    store: { record: async () => { throw new Error('db down'); } },
    spool, logger: { warn: () => {} }
  });
  await capture.capture(record());
  assert.equal(spool.size(), 1);
});

test('never throws, so a capture failure cannot fail a call', async () => {
  const capture = createCapture({
    store: { record: async () => { throw new Error('db down'); } },
    spool: { push: () => { throw new Error('disk full'); }, drain: async () => 0, size: () => 0 },
    logger: { warn: () => {} }
  });
  await assert.doesNotReject(() => capture.capture(record()));
});

test('replays what the spool held once the store recovers', async () => {
  const dir = freshDir();
  const spool = createSpool({ dir });
  const failing = createCapture({
    store: { record: async () => { throw new Error('db down'); } }, spool, logger: { warn: () => {} }
  });
  await failing.capture(record());

  const saved = [];
  const working = createCapture({ store: { record: async r => { saved.push(r); } }, spool });
  assert.equal(await working.replay(), 1);
  assert.equal(saved.length, 1);
  rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/spool.test.js test/capture.test.js`
Expected: FAIL — cannot find modules `../src/store/spool.js` and `../src/capture.js`

- [ ] **Step 3: Write `src/store/spool.js`**

```js
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A newline-delimited JSON file on disk. When the database is unreachable the
 * exchange is not lost and, more importantly, the call it belongs to still
 * succeeds - capture is never allowed to be the reason a request fails.
 */
export function createSpool({ dir }) {
  const file = join(dir, 'capture.jsonl');
  const ensure = () => { if (!existsSync(dir)) mkdirSync(dir, { recursive: true }); };

  const readAll = () => {
    if (!existsSync(file)) return [];
    return readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
  };

  return {
    push(record) {
      ensure();
      appendFileSync(file, `${JSON.stringify(record)}\n`);
    },
    size: () => readAll().length,
    async drain(handler) {
      const records = readAll();
      const remaining = [];
      let drained = 0;
      for (const record of records) {
        try {
          await handler(record);
          drained++;
        } catch {
          remaining.push(record);
        }
      }
      ensure();
      writeFileSync(file, remaining.map(r => `${JSON.stringify(r)}\n`).join(''));
      return drained;
    }
  };
}
```

- [ ] **Step 4: Write `src/capture.js`**

```js
import { redactDeep, redact } from './policy.js';

/**
 * Runs after the response has been delivered. Everything here is best-effort:
 * a failure to record must never surface to the caller.
 */
export function createCapture({ store, spool, logger = console }) {
  const clean = (record) => {
    const messages = redactDeep(record.messages ?? []);
    const response = redact(record.response ?? '');
    const system = redact(record.system ?? '');
    return {
      ...record,
      messages: messages.value,
      response: response.text,
      system: record.system === null ? null : system.text,
      redacted: messages.redacted || response.redacted || system.redacted
    };
  };

  async function capture(record) {
    let prepared;
    try {
      prepared = clean(record);
    } catch (error) {
      logger.warn?.(`capture: redaction failed, dropping record: ${error.message}`);
      return;
    }
    try {
      await store.record(prepared);
    } catch (error) {
      logger.warn?.(`capture: store failed, spooling: ${error.message}`);
      try {
        spool.push(prepared);
      } catch (spoolError) {
        logger.warn?.(`capture: spool failed, record lost: ${spoolError.message}`);
      }
    }
  }

  const replay = () => spool.drain(record => store.record(record));

  return { capture, replay };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/spool.test.js test/capture.test.js`
Expected: PASS (8 tests)

- [ ] **Step 6: Commit**

```bash
git add src/store/spool.js src/capture.js test/spool.test.js test/capture.test.js
git commit -m "Keep the exchange when the database is gone, and never fail the call for it"
```

---

### Task 13: Authentication

**Files:**
- Create: `src/auth/apikey.js`
- Test: `test/auth.test.js`

**Interfaces:**
- Consumes: `MemoryTable` (Task 4)
- Produces: `createAuth({ db, staticKeys }) -> { issue(label) -> Promise<{ token, prefix, id }>, verify(token) -> Promise<{ ok, label? }>, fromRequest(headers) -> string|null }`.
  `staticKeys` is an array of raw tokens from `JEZ_API_KEYS` (comma-separated), for bootstrapping before a database exists.

- [ ] **Step 1: Write the failing test**

`test/auth.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuth } from '../src/auth/apikey.js';

const auth = () => createAuth({ db: { enabled: false } });

test('issues a token that verifies', async () => {
  const a = auth();
  const { token } = await a.issue('laptop');
  assert.equal((await a.verify(token)).ok, true);
});

test('issued tokens are prefixed and long enough to resist guessing', async () => {
  const { token } = await auth().issue('laptop');
  assert.match(token, /^jez_/);
  assert.ok(token.length >= 40, `token too short: ${token.length}`);
});

test('rejects an unknown token', async () => {
  assert.equal((await auth().verify('jez_nope')).ok, false);
});

test('rejects an empty or missing token', async () => {
  const a = auth();
  assert.equal((await a.verify('')).ok, false);
  assert.equal((await a.verify(null)).ok, false);
});

test('never stores the raw token', async () => {
  const a = auth();
  const { token } = await a.issue('laptop');
  assert.ok(!JSON.stringify(a.rawRows()).includes(token));
});

test('accepts a static bootstrap key', async () => {
  const a = createAuth({ db: { enabled: false }, staticKeys: ['boot-key'] });
  assert.equal((await a.verify('boot-key')).ok, true);
  assert.equal((await a.verify('other')).ok, false);
});

test('reads a bearer token from the Authorization header', () => {
  assert.equal(auth().fromRequest({ authorization: 'Bearer abc' }), 'abc');
});

test('reads x-api-key, as Anthropic clients send', () => {
  assert.equal(auth().fromRequest({ 'x-api-key': 'abc' }), 'abc');
});

test('returns null when no credential is present', () => {
  assert.equal(auth().fromRequest({}), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/auth.test.js`
Expected: FAIL — cannot find module `../src/auth/apikey.js`

- [ ] **Step 3: Write `src/auth/apikey.js`**

```js
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { MemoryTable, nowIso } from '../db/memory-table.js';

const hash = (token) => createHash('sha256').update(token).digest('hex');

const safeEqual = (a, b) => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

/**
 * The endpoint is public, so every request is authenticated. Tokens are stored
 * as SHA-256 digests: a leaked database still does not yield a usable key.
 */
export function createAuth({ db, staticKeys = [] }) {
  const table = db.enabled ? null : new MemoryTable({ unique: ['prefix'] });

  async function issue(label) {
    const token = `jez_${randomBytes(32).toString('base64url')}`;
    const row = {
      id: randomUUID(), label, prefix: token.slice(0, 12),
      hash: hash(token), created_at: nowIso(), revoked_at: null
    };
    if (db.enabled) {
      await db.query(
        `INSERT INTO jez_api_keys (id, label, prefix, hash) VALUES ($1,$2,$3,$4)`,
        [row.id, row.label, row.prefix, row.hash]
      );
    } else {
      table.insert(row);
    }
    return { token, prefix: row.prefix, id: row.id };
  }

  async function verify(token) {
    if (!token) return { ok: false };
    if (staticKeys.some(key => safeEqual(key, token))) return { ok: true, label: 'static' };

    const digest = hash(token);
    if (!db.enabled) {
      const row = table.find(r => r.hash === digest && !r.revoked_at);
      return row ? { ok: true, label: row.label } : { ok: false };
    }
    const { rows } = await db.query(
      `SELECT label FROM jez_api_keys WHERE hash = $1 AND revoked_at IS NULL`, [digest]);
    return rows[0] ? { ok: true, label: rows[0].label } : { ok: false };
  }

  const fromRequest = (headers = {}) => {
    const bearer = headers.authorization || headers.Authorization;
    if (bearer?.startsWith('Bearer ')) return bearer.slice(7);
    return headers['x-api-key'] || null;
  };

  return { issue, verify, fromRequest, rawRows: () => table?.all() ?? [] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/auth.test.js`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/auth test/auth.test.js
git commit -m "Authenticate every request, and store only digests of the keys"
```

---

### Task 14: The server

**Files:**
- Create: `src/server.js`, `src/app.js`, `src/sse.js`
- Test: `test/app.test.js`

**Interfaces:**
- Consumes: everything above
- Produces: `createApp({ config, router, capture, auth, store }) -> { handle(req, res), handleRequest({ method, path, headers, body }) -> Promise<{ status, headers, body }> }`.
  `src/server.js` wires real dependencies and calls `http.createServer(app.handle)`.

**Note on streaming.** The spec's byte-exact fidelity invariant holds when Jez
forwards to the same vendor the client addressed. When the router translates to a
*different* provider, byte-exact relay is impossible by definition — the wire
formats differ. Layer 1 therefore requests non-streaming from the backend and, if
the client asked for a stream, synthesises a correctly-shaped SSE response. The
client sees valid protocol; it does not see the upstream's exact bytes. This is a
deliberate, documented narrowing of the invariant, not an oversight.

- [ ] **Step 1: Write the failing test**

`test/app.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

const stubRouter = (impl) => ({
  route: impl || (async () => ({
    text: 'hello', model: 'served', backend: 'groq',
    usage: { inputTokens: 2, outputTokens: 1 }, attempts: 1
  })),
  eligible: () => ['groq']
});

const build = ({ route, captured = [] } = {}) => createApp({
  config: { providers: [{ name: 'groq', apiKey: 'k' }] },
  router: stubRouter(route),
  capture: { capture: async r => { captured.push(r); } },
  auth: { verify: async t => ({ ok: t === 'good' }), fromRequest: h => h['x-api-key'] || null },
  store: { recent: async () => [] }
});

const call = (app, path, body, headers = { 'x-api-key': 'good' }) =>
  app.handleRequest({ method: 'POST', path, headers, body });

test('answers an anthropic-shaped request', async () => {
  const res = await call(build(), '/v1/messages',
    { model: 'm', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(res.status, 200);
  assert.equal(res.body.content[0].text, 'hello');
  assert.equal(res.body.type, 'message');
});

test('answers an openai-shaped request', async () => {
  const res = await call(build(), '/v1/chat/completions',
    { model: 'm', messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(res.status, 200);
  assert.equal(res.body.choices[0].message.content, 'hello');
});

test('rejects a request with no credential', async () => {
  const res = await call(build(), '/v1/messages',
    { model: 'm', max_tokens: 1, messages: [] }, {});
  assert.equal(res.status, 401);
});

test('rejects a bad credential', async () => {
  const res = await call(build(), '/v1/messages',
    { model: 'm', max_tokens: 1, messages: [] }, { 'x-api-key': 'bad' });
  assert.equal(res.status, 401);
});

test('captures the exchange after answering', async () => {
  const captured = [];
  await call(build({ captured }), '/v1/messages',
    { model: 'm', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(captured.length, 1);
  assert.equal(captured[0].backend, 'groq');
  assert.equal(captured[0].response, 'hello');
  assert.equal(captured[0].status, 'ok');
});

test('a capture failure does not fail the call', async () => {
  const app = createApp({
    config: { providers: [] },
    router: stubRouter(),
    capture: { capture: async () => { throw new Error('boom'); } },
    auth: { verify: async () => ({ ok: true }), fromRequest: () => 'good' },
    store: { recent: async () => [] }
  });
  const res = await call(app, '/v1/messages', { model: 'm', max_tokens: 1, messages: [] });
  assert.equal(res.status, 200);
});

test('records a failed call as an error rather than dropping it', async () => {
  const captured = [];
  const res = await call(
    build({ route: async () => { throw new Error('all providers failed'); }, captured }),
    '/v1/messages', { model: 'm', max_tokens: 1, messages: [] });
  assert.equal(res.status, 502);
  assert.equal(captured.length, 1);
  assert.equal(captured[0].status, 'error');
});

test('rejects a malformed request with 400, not 500', async () => {
  const res = await call(build(), '/v1/messages', { messages: [] });
  assert.equal(res.status, 400);
});

test('reports health without a credential', async () => {
  const res = await build().handleRequest({ method: 'GET', path: '/health', headers: {}, body: null });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
});

test('returns 404 for an unknown path', async () => {
  const res = await call(build(), '/nope', {});
  assert.equal(res.status, 404);
});

test('streams an anthropic response as server-sent events when asked', async () => {
  const res = await call(build(), '/v1/messages',
    { model: 'm', max_tokens: 10, stream: true, messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(res.headers['Content-Type'], 'text/event-stream');
  assert.match(res.body, /event: message_start/);
  assert.match(res.body, /content_block_delta/);
  assert.match(res.body, /hello/);
  assert.match(res.body, /event: message_stop/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/app.test.js`
Expected: FAIL — cannot find module `../src/app.js`

- [ ] **Step 3: Write `src/sse.js`**

```js
const event = (name, data) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;

/**
 * The router may translate to a provider whose wire format differs from the
 * client's, so upstream bytes cannot be relayed verbatim. What the client is
 * owed is a valid protocol, which is what these synthesise.
 */
export function anthropicStream(exchange, text, usage) {
  return [
    event('message_start', {
      type: 'message_start',
      message: {
        id: `msg_${exchange.id}`, type: 'message', role: 'assistant', model: exchange.model,
        content: [], usage: { input_tokens: usage.inputTokens ?? 0, output_tokens: 0 }
      }
    }),
    event('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
    event('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }),
    event('content_block_stop', { type: 'content_block_stop', index: 0 }),
    event('message_delta', {
      type: 'message_delta', delta: { stop_reason: 'end_turn' },
      usage: { output_tokens: usage.outputTokens ?? 0 }
    }),
    event('message_stop', { type: 'message_stop' })
  ].join('');
}

export function openaiStream(exchange, text) {
  const base = { id: `chatcmpl-${exchange.id}`, object: 'chat.completion.chunk', model: exchange.model };
  return [
    `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: text } }] })}\n\n`,
    `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`,
    'data: [DONE]\n\n'
  ].join('');
}
```

- [ ] **Step 4: Write `src/app.js`**

```js
import { parseAnthropicRequest, toAnthropicResponse } from './wire/anthropic.js';
import { parseOpenAIRequest, toOpenAIResponse } from './wire/openai.js';
import { anthropicStream, openaiStream } from './sse.js';

const json = (status, body) => ({ status, headers: { 'Content-Type': 'application/json' }, body });
const sse = (body) => ({ status: 200, headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }, body });

const ROUTES = {
  '/v1/messages': { parse: parseAnthropicRequest, respond: toAnthropicResponse, stream: anthropicStream },
  '/v1/chat/completions': { parse: parseOpenAIRequest, respond: toOpenAIResponse, stream: openaiStream }
};

export function createApp({ config, router, capture, auth, store, logger = console }) {
  async function handleRequest({ method, path, headers, body }) {
    if (path === '/health' && method === 'GET') {
      return json(200, { ok: true, providers: config.providers.map(p => p.name) });
    }

    const route = ROUTES[path];
    if (!route) return json(404, { error: { type: 'not_found', message: `no route for ${path}` } });

    if (!(await auth.verify(auth.fromRequest(headers))).ok) {
      return json(401, { error: { type: 'authentication_error', message: 'invalid or missing API key' } });
    }

    let exchange;
    try {
      exchange = route.parse(body || {}, headers['user-agent'] || 'unknown');
    } catch (error) {
      return json(400, { error: { type: 'invalid_request_error', message: error.message } });
    }

    const started = Date.now();
    let result;
    try {
      result = await router.route(exchange);
    } catch (error) {
      // A failed call is still evidence. Record it, then report it honestly.
      await safeCapture({
        ...baseRecord(exchange, started), backend: 'none', response: '',
        status: 'error', model: exchange.model
      });
      return json(502, { error: { type: 'api_error', message: error.message } });
    }

    await safeCapture({
      ...baseRecord(exchange, started),
      backend: result.backend, model: result.model, response: result.text,
      tokensIn: result.usage.inputTokens, tokensOut: result.usage.outputTokens, status: 'ok'
    });

    return exchange.stream
      ? sse(route.stream(exchange, result.text, result.usage))
      : json(200, route.respond(exchange, result.text, result.usage));
  }

  const baseRecord = (exchange, started) => ({
    id: exchange.id, source: exchange.source, model: exchange.model,
    system: exchange.system, messages: exchange.messages,
    tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: Date.now() - started
  });

  // Capture is best-effort at every level, including here.
  async function safeCapture(record) {
    try { await capture.capture(record); }
    catch (error) { logger.warn?.(`capture failed: ${error.message}`); }
  }

  async function handle(req, res) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');

    let parsed = null;
    if (raw) {
      try { parsed = JSON.parse(raw); }
      catch { res.writeHead(400, { 'Content-Type': 'application/json' });
              return res.end(JSON.stringify({ error: { type: 'invalid_request_error', message: 'body is not JSON' } })); }
    }

    const result = await handleRequest({
      method: req.method,
      path: new URL(req.url, 'http://localhost').pathname,
      headers: req.headers,
      body: parsed
    });

    res.writeHead(result.status, result.headers);
    res.end(typeof result.body === 'string' ? result.body : JSON.stringify(result.body));
  }

  return { handle, handleRequest };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/app.test.js`
Expected: PASS (11 tests)

- [ ] **Step 6: Write `src/server.js`**

```js
import { createServer } from 'node:http';
import { loadConfig } from './config.js';
import { createKeyring } from './crypto/keys.js';
import { createExchangeStore } from './store/exchanges.js';
import { createSpool } from './store/spool.js';
import { createCapture } from './capture.js';
import { createAuth } from './auth/apikey.js';
import { createRouter } from './router/chain.js';
import { createApp } from './app.js';
import { databaseEnabled, query, healthCheck } from './db/index.js';

const config = loadConfig();
const db = { enabled: databaseEnabled, query };
const keyring = createKeyring({ masterKeyB64: config.masterKeyB64 });
const store = createExchangeStore({ keyring, db });
const spool = createSpool({ dir: config.spoolDir });
const capture = createCapture({ store, spool });
const auth = createAuth({ db, staticKeys: (process.env.JEZ_API_KEYS || '').split(',').filter(Boolean) });
const router = createRouter({ providers: config.providers });
const app = createApp({ config, router, capture, auth, store });

const health = await healthCheck();
console.log(`database: ${health.enabled ? (health.ok ? 'connected' : `error - ${health.reason}`) : 'memory mode'}`);
console.log(`encryption: ${keyring.enabled ? 'on' : 'OFF (no JEZ_MASTER_KEY)'}`);
console.log(`providers: ${config.providers.map(p => p.name).join(', ') || 'none configured'}`);

// Anything the spool kept during an outage goes in before new traffic arrives.
const replayed = await capture.replay().catch(() => 0);
if (replayed) console.log(`replayed ${replayed} spooled exchanges`);

createServer(app.handle).listen(config.port, () => console.log(`jez listening on :${config.port}`));
```

- [ ] **Step 7: Run the whole suite**

Run: `npm test`
Expected: PASS — all tests from Tasks 1–14

- [ ] **Step 8: Commit**

```bash
git add src/app.js src/server.js src/sse.js test/app.test.js
git commit -m "Serve both wire formats, and record the failures as well as the wins"
```

---

### Task 15: Deploy

**Files:**
- Create: `render.yaml`, `.github/workflows/ci.yml`
- Modify: `README.md`

**Interfaces:**
- Consumes: everything above
- Produces: a running public gateway

- [ ] **Step 1: Write `render.yaml`**

```yaml
services:
  - type: web
    name: jez-gateway
    runtime: node
    plan: free
    buildCommand: npm ci
    startCommand: npm start
    healthCheckPath: /health
    envVars:
      - key: NODE_VERSION
        value: "24"
      - key: DATABASE_URL
        sync: false
      - key: JEZ_MASTER_KEY
        sync: false
      - key: JEZ_API_KEYS
        sync: false
      - key: GEMINI_API_KEY
        sync: false
      - key: GROQ_API_KEY
        sync: false
      - key: GITHUB_MODELS_TOKEN
        sync: false
      - key: OPENROUTER_API_KEY
        sync: false
```

- [ ] **Step 2: Write `.github/workflows/ci.yml`**

```yaml
name: ci
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '24' }
      - run: npm ci
      - run: npm test
      - name: Fail if a secret looks committed
        run: |
          ! grep -rEn 'JEZ_MASTER_KEY\s*=\s*[A-Za-z0-9+/=]{20,}' --include='*.js' --include='*.yml' --include='*.json' .
```

- [ ] **Step 3: Generate a master key and write the README**

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Add to `README.md`, including the two traps found during verification:

```markdown
# Jez

A personal AI gateway. Every AI call routes through it, and every exchange is
stored encrypted in a corpus only you can read.

## Setup

1. Generate a master key:
   `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`
2. Create a Neon project (free plan) and copy its connection string.
3. Set `DATABASE_URL`, `JEZ_MASTER_KEY`, `JEZ_API_KEYS`, and at least one
   provider key.
4. `npm ci && npm run migrate && npm start`

## Pointing tools at it

```bash
export ANTHROPIC_BASE_URL=https://<your-app>.onrender.com
export ANTHROPIC_API_KEY=<one of JEZ_API_KEYS>
```

## Two things that will bite you

- **Do not enable billing on the Google Cloud project** behind `GEMINI_API_KEY`.
  Enabling billing removes the free tier permanently.
- **Do not use Render's free Postgres.** It is deleted 30 days after creation.
  The corpus lives in Neon.

## Losing the master key

There is no recovery. The corpus is unreadable without it. Keep a copy
somewhere you trust, offline.
```

- [ ] **Step 4: Run the migration against Neon and verify**

```bash
DATABASE_URL='<neon url>' npm run migrate
DATABASE_URL='<neon url>' node -e "
  import('./src/db/index.js').then(async db => {
    const { rows } = await db.query(\"SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'jez_%' ORDER BY 1\");
    console.log(rows.map(r => r.table_name));
    process.exit(0);
  })"
```

Expected: `[ 'jez_api_keys', 'jez_exchanges', 'jez_migrations' ]`

- [ ] **Step 5: Deploy and verify end to end**

```bash
curl -s https://<your-app>.onrender.com/health
curl -s https://<your-app>.onrender.com/v1/messages \
  -H "x-api-key: $JEZ_KEY" -H 'content-type: application/json' \
  -d '{"model":"","max_tokens":50,"messages":[{"role":"user","content":"say hello"}]}'
```

Expected: health returns `{"ok":true,...}`; the second returns an Anthropic-shaped
message. Then confirm the corpus actually holds ciphertext:

```bash
psql "$DATABASE_URL" -c "SELECT id, backend, status, length(messages) FROM jez_exchanges;"
psql "$DATABASE_URL" -c "SELECT encode(messages,'escape') FROM jez_exchanges LIMIT 1;"
```

Expected: one row; the second command shows bytes, **not** readable text. If you
can read your prompt, encryption is not on — stop and fix it before sending
anything real through the gateway.

- [ ] **Step 6: Commit**

```bash
git add render.yaml .github/workflows/ci.yml README.md
git commit -m "Ship it, and write down the two traps that would cost a weekend"
git push
```

---

## Deliberately out of scope for Layer 1

Named here so a reviewer does not read them as gaps:

- **Passkey / WebAuthn login** — belongs with the UI in Layer 3. Layer 1
  authenticates with hashed API keys, which is what programmatic clients use.
- **`jez_memories` table, embeddings, retrieval** — Layer 2. Migration `001`
  creates only what Layer 1 writes.
- **`cost_usd` is always `0`** — every Layer 1 provider is a free tier, so the
  column is correct at zero. It becomes meaningful when paid backends or local
  serving are compared against each other.
- **Byte-exact response relay** — narrowed deliberately; see the note in Task 14.

## Verification checklist

Layer 1 is done when all of these hold:

- [ ] `npm test` passes with `DATABASE_URL` unset (memory mode)
- [ ] `npm test` passes with `DATABASE_URL` set to a Neon branch
- [ ] A prompt sent through the gateway is unreadable in `psql`
- [ ] Killing the database mid-call still returns a valid response, and the
      exchange appears in `spool/capture.jsonl`
- [ ] Restarting the gateway replays the spool into Neon
- [ ] A request too large for Groq is not sent to Groq
- [ ] A 429 from one provider transparently produces an answer from the next
- [ ] A request with no API key returns 401
- [ ] `/health` responds within 90s of a cold start

## Open question carried into Layer 2

**Which tools will honour `ANTHROPIC_BASE_URL`?** Spec §14. Test this against
your real tools as soon as Task 15 is deployed. If most refuse, the corpus grows
only from API-key traffic, and the Layer 5 training plan needs revisiting before
it is written.
