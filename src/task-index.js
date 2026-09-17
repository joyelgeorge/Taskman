import { readdir, readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';

/**
 * Tasks, counted.
 *
 * docs/tasks/README.md warns about its own failure mode: "a parked task that is
 * silently done is a task someone will do twice." Hand-maintaining an index
 * alongside the files it indexes guarantees that eventually happens.
 *
 * So each task file carries a small block of machine-readable fields, and the
 * prose body stays exactly as it is — the prose is the part that makes these
 * files worth having, and generating it would ruin them.
 *
 * An unreadable task is reported as invalid rather than skipped. A parser that
 * quietly drops what it cannot understand makes the count shrink without saying
 * so, which is the same class of bug as a store that returns zero when it means
 * "I could not answer" (see src/store-state.js).
 */

/** Markers around the generated block in docs/tasks/README.md. */
export const TASK_TABLE_START = '<!-- generated:tasks -->';
export const TASK_TABLE_END = '<!-- /generated:tasks -->';

export const TASK_STATUS = Object.freeze({
  OPEN: 'open',
  BLOCKED: 'blocked',
  DONE: 'done'
});

const STATUSES = new Set(Object.values(TASK_STATUS));
const PRIORITIES = new Set(['P0', 'P1', 'P2', 'P3']);

function invalid(id, problem) {
  return { id, valid: false, problem };
}

/** Parse one task file. Never throws: an unparseable task is a finding. */
export function parseTaskFile(filename, text) {
  const id = basename(filename, '.md');
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!match) return invalid(id, 'no front matter: the task cannot be counted or indexed');

  const fields = {};
  for (const line of match[1].split('\n')) {
    const kv = /^([a-z]+):\s*(.*)$/.exec(line.trim());
    if (kv) fields[kv[1]] = kv[2].trim();
  }

  if (!STATUSES.has(fields.status)) {
    return invalid(id, `status "${fields.status ?? ''}" is not one of ${[...STATUSES].join(', ')}`);
  }
  if (!PRIORITIES.has(fields.priority)) {
    return invalid(id, `priority "${fields.priority ?? ''}" is not one of ${[...PRIORITIES].join(', ')}`);
  }
  const level = Number(fields.level);
  if (![1, 2, 3, 4].includes(level)) {
    return invalid(id, `level "${fields.level ?? ''}" is not a READ-FIRST progress level (1-4)`);
  }

  const heading = /^#\s+(.+)$/m.exec(text.slice(match[0].length));

  return {
    id,
    valid: true,
    status: fields.status,
    priority: fields.priority,
    level,
    opened: fields.opened || null,
    closed: fields.closed || null,
    title: heading ? heading[1].trim() : id
  };
}

/** Every task file in a directory, valid or not. README.md is the index, not a task. */
export async function readTasks(dir = 'docs/tasks') {
  const names = (await readdir(dir))
    .filter(f => f.endsWith('.md') && f !== 'README.md')
    .sort();
  const tasks = [];
  for (const name of names) {
    tasks.push(parseTaskFile(name, await readFile(join(dir, name), 'utf8')));
  }
  return tasks;
}

/**
 * The generated block. Deliberately a flat table of everything rather than a
 * curated narrative: the curation lives in the prose above it, and this exists
 * so nothing can quietly fall out of the list.
 */
export function renderTaskTable(tasks = []) {
  const valid = tasks.filter(t => t.valid);
  const broken = tasks.filter(t => !t.valid);
  const open = valid.filter(t => t.status !== TASK_STATUS.DONE);

  const lines = [
    `_${open.length} open, ${valid.length - open.length} done, ${tasks.length} task files._`,
    '',
    '| Task | Status | Priority | Level |',
    '| --- | --- | --- | --- |'
  ];
  for (const t of valid) {
    lines.push(`| [${t.title}](${t.id}.md) | ${t.status} | ${t.priority} | ${t.level} |`);
  }
  if (broken.length) {
    lines.push('', '**Unreadable task files — these are not counted above:**', '');
    for (const t of broken) lines.push(`- \`${t.id}.md\` — ${t.problem}`);
  }
  return lines.join('\n');
}

/** Replace the generated block in an index, leaving the curated prose alone. */
export function writeTaskTable(readme, tasks) {
  const block = `${TASK_TABLE_START}\n${renderTaskTable(tasks)}\n${TASK_TABLE_END}`;
  const start = readme.indexOf(TASK_TABLE_START);
  const end = readme.indexOf(TASK_TABLE_END);
  if (start === -1 || end === -1) throw new Error('generated:tasks markers not found in the index');
  return readme.slice(0, start) + block + readme.slice(end + TASK_TABLE_END.length);
}
