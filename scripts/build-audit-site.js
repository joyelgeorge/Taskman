#!/usr/bin/env node
/**
 * Builds the publishable audit site into dist/audit-site/.
 *
 * The page is static and runs entirely client-side, so "deploying" it is copying
 * three files anywhere that serves them. This exists because the obvious host was
 * not available: GitHub Pages is refused on this private repository by the
 * account's plan, verified against the API rather than assumed.
 *
 * The output is deliberately self-contained and host-agnostic — a public repo
 * with Pages, a Render static site, a Netlify drop, or a directory on any box.
 * Nothing in it refers back to this repository.
 */
import { mkdir, copyFile, writeFile, rm, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUDIT_ASSETS } from './sync-audit-assets.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = join(root, 'packages', 'web', 'public', 'audit');
export const outDir = join(root, 'dist', 'audit-site');

export async function buildAuditSite() {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const files = ['index.html', ...AUDIT_ASSETS];
  for (const name of files) await copyFile(join(sourceDir, name), join(outDir, name));

  // Static host, no build step, no framework — say so where the next person looks.
  await writeFile(join(outDir, '.nojekyll'), '');

  // Verify the copy rather than assume it. A build that silently produced a stale
  // or partial page is how a deploy went out with no payment link in it: the
  // source had been wired up, dist/ had not, and nothing said so.
  for (const name of files) {
    const [source, copy] = await Promise.all([
      readFile(join(sourceDir, name), 'utf8'),
      readFile(join(outDir, name), 'utf8')
    ]);
    if (source !== copy) throw new Error(`${name} did not copy faithfully into dist/audit-site/`);
  }

  const html = await readFile(join(outDir, 'index.html'), 'utf8');
  const contactSet = !/contact:\s*''/.test(html);

  return { outDir, files: [...files, '.nojekyll'], contactSet };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await buildAuditSite();
  console.log(`Built ${result.files.length} file(s) into dist/audit-site/`);
  console.log(result.contactSet
    ? 'OFFER.contact is set.'
    : 'OFFER.contact is NOT set — the page will run the free audit but the offer has no reply path.');
}
