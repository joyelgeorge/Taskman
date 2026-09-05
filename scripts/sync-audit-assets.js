#!/usr/bin/env node
/**
 * Copies the audit modules into the static site.
 *
 * The public page runs the audit client-side, which is the whole trust argument:
 * a stranger is being asked to open a bank export, and it never leaves their
 * machine. That requires the same modules the server uses to be served as static
 * files — and a hand-made copy would silently drift from the tested original, so
 * it is generated, and test/audit-assets.test.js fails when it is stale.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const AUDIT_ASSETS = ['fiverr-csv-parser.js', 'instant-audit.js'];
export const targetDir = join(root, 'packages', 'web', 'public', 'audit');

export async function readPair(name) {
  return {
    source: await readFile(join(root, 'src', name), 'utf8'),
    copy: await readFile(join(targetDir, name), 'utf8').catch(() => null)
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await mkdir(targetDir, { recursive: true });
  for (const name of AUDIT_ASSETS) {
    const { source } = await readPair(name);
    await writeFile(join(targetDir, name), source);
  }
  console.log(`Synced ${AUDIT_ASSETS.length} audit module(s) into packages/web/public/audit/`);
}
