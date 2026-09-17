/**
 * The lane wired to the real world: it clones and audits repositories, and
 * writes drafts to disk. Kept apart from vibe-app-security.js so the job logic
 * stays testable without a network, and so the registry can import a descriptor
 * without pulling a scanner into every module that reads the registry.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { vibeAppSecurityJob } from './vibe-app-security.js';

const run = promisify(execFile);

/**
 * Audit one repository from a shallow clone, then delete it.
 *
 * Read-only by construction: clone, read, remove. Nothing here touches a running
 * product or uses a credential it finds.
 */
export async function scanRepo(repo, { timeoutMs = 300_000 } = {}) {
  const { auditCodebase } = await import('../../../src/codebase-audit.js');
  const dir = await mkdtemp(join(tmpdir(), 'vibe-'));
  try {
    await run('git', ['clone', '--depth', '1', '--quiet', `https://github.com/${repo}.git`, dir],
      { timeout: timeoutMs, maxBuffer: 1 << 26 });
    const result = await auditCodebase(dir);
    const findings = Array.isArray(result) ? result : (result.findings || []);
    // Strip the clone path so nothing local leaks into a draft or the store.
    return { repo, findings: findings.map(f => ({ ...f, file: String(f.file).replace(dir + '/', '') })) };
  } finally {
    // Three uncleaned clones of a large repository fill a disk, and the failure
    // then reads as "the repository is gone" rather than "out of space".
    await rm(dir, { recursive: true, force: true });
  }
}

async function writeDraft(path, text) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}

/** The descriptor the registry carries. */
export const vibeAppSecurityDescriptor = vibeAppSecurityJob({
  scan: async (repos = []) => Promise.all(repos.map(scanRepo)),
  write: writeDraft
});
