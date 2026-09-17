/**
 * Default wired descriptor for tally-smb-leakage-audit in the territory registry.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { tallyLeakageJob } from './tally-leakage.js';

async function writeDraft(path, text) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}

export const tallyLeakageDefaultDescriptor = tallyLeakageJob({
  load: async () => [],
  write: writeDraft
});
