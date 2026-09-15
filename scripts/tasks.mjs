#!/usr/bin/env node
/**
 * `npm run tasks` — regenerate the counted block in docs/tasks/README.md.
 *
 * The curated prose above the block is written by hand and stays that way; this
 * only rewrites the table, so a task can no longer quietly fall out of the index.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { readTasks, writeTaskTable, renderTaskTable } from '../src/task-index.js';

const INDEX = 'docs/tasks/README.md';
const tasks = await readTasks('docs/tasks');
const broken = tasks.filter(t => !t.valid);

await writeFile(INDEX, writeTaskTable(await readFile(INDEX, 'utf8'), tasks));
console.log(renderTaskTable(tasks).split('\n')[0]);

if (broken.length) {
  console.error(`\n${broken.length} task file(s) could not be read:`);
  for (const t of broken) console.error(`  ${t.id}.md — ${t.problem}`);
  process.exit(1);
}
