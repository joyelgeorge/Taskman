import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('all runtime surfaces enforce the pinned Node 24 policy', async () => {
  const [version, nvmrc, packageText, workflow, render] = await Promise.all([
    read('.node-version'),
    read('.nvmrc'),
    read('package.json'),
    read('.github/workflows/test.yml'),
    read('render.yaml')
  ]);
  const packageJson = JSON.parse(packageText);

  assert.match(version.trim(), /^24\.\d+\.\d+$/);
  // .nvmrc exists because nvm does not read .node-version, so without it `nvm use`
  // in a fresh container silently leaves you on whatever Node it shipped with —
  // which is how a suite that is green on the pinned runtime came to look like it
  // had four permanent failures.
  assert.equal(nvmrc.trim(), version.trim(), '.nvmrc and .node-version must not drift');
  assert.equal(packageJson.engines.node, '>=24 <25');
  assert.match(workflow, /node-version-file:\s*['"]?\.node-version/);
  assert.match(workflow, /run:\s*npm ci/);
  assert.doesNotMatch(workflow, /node-version:\s*['"]?20/);
  assert.match(render, /buildCommand:\s*npm ci --omit=dev/);
});

test('status contract exposes safe runtime compatibility metadata', async () => {
  const serverSource = await read('src/server.js');

  assert.equal(Number(process.versions.node.split('.')[0]), 24);
  assert.match(serverSource, /nodeVersion:\s*process\.versions\.node/);
  assert.match(serverSource, /nodeMajor:\s*Number\(process\.versions\.node\.split\('\.'\)\[0\]\)/);
  assert.match(serverSource, /supportedNodeMajor:\s*24/);
});
