import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseTaskFile, readTasks, renderTaskTable, TASK_STATUS } from '../src/task-index.js';

async function withTasks(files, fn) {
  const dir = await mkdtemp(join(tmpdir(), 'taskman-tasks-'));
  try {
    for (const [name, body] of Object.entries(files)) await writeFile(join(dir, name), body);
    // await matters: an unawaited call lets finally delete the directory mid-run,
    // which makes a failing case pass for the wrong reason. That has happened here.
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const withFrontMatter = `---
status: open
priority: P1
level: 4
opened: 2026-09-15
---

# A task with front matter

Body prose the human reads.
`;

test('a task file yields its machine-readable fields and its title', () => {
  const task = parseTaskFile('2026-09-15-a-thing.md', withFrontMatter);

  assert.equal(task.id, '2026-09-15-a-thing');
  assert.equal(task.status, TASK_STATUS.OPEN);
  assert.equal(task.priority, 'P1');
  assert.equal(task.level, 4);
  assert.equal(task.title, 'A task with front matter');
});

test('a task file with no front matter is reported as invalid, not silently skipped', () => {
  const task = parseTaskFile('2026-09-15-bare.md', '# Just a heading\n\nprose\n');

  assert.equal(task.valid, false);
  assert.match(task.problem, /front matter/i);
});

test('an unknown status is invalid rather than passed through', () => {
  const task = parseTaskFile('2026-09-15-x.md', '---\nstatus: mostly-done\npriority: P1\nlevel: 4\n---\n# X\n');

  assert.equal(task.valid, false);
  assert.match(task.problem, /status/i);
});

test('reading a directory returns every task file and ignores the index', async () => {
  await withTasks({
    'README.md': '# index\n',
    '2026-09-15-one.md': withFrontMatter,
    '2026-09-15-two.md': withFrontMatter
  }, async (dir) => {
    const tasks = await readTasks(dir);
    assert.equal(tasks.length, 2);
    assert.ok(tasks.every(t => t.valid));
  });
});

test('an invalid task file is surfaced by readTasks rather than dropped', async () => {
  await withTasks({
    '2026-09-15-good.md': withFrontMatter,
    '2026-09-15-bad.md': '# no front matter\n'
  }, async (dir) => {
    const tasks = await readTasks(dir);
    // The bite: dropping the bad file would silently shrink the count, which is
    // how a parked task becomes a task someone does twice.
    assert.equal(tasks.length, 2);
    assert.equal(tasks.filter(t => !t.valid).length, 1);
  });
});

test('the rendered table lists every task, so none can go missing from the index', () => {
  const tasks = [
    { id: 'a', title: 'Alpha', status: 'open', priority: 'P0', level: 1, valid: true },
    { id: 'b', title: 'Beta', status: 'open', priority: 'P2', level: 4, valid: true }
  ];
  const table = renderTaskTable(tasks);

  assert.match(table, /Alpha/);
  assert.match(table, /Beta/);
  assert.match(table, /2 open/);
});

// Guards the real directory, not a fixture. These two are the point of the
// module: without them the index drifts from the files and nobody finds out.

test('every task file in docs/tasks is readable by the index', async () => {
  const tasks = await readTasks('docs/tasks');
  const broken = tasks.filter(t => !t.valid).map(t => `${t.id}: ${t.problem}`);

  assert.deepEqual(broken, [], `unreadable task files:\n${broken.join('\n')}`);
  assert.ok(tasks.length > 0, 'no task files found — the path is probably wrong');
});

test('the generated block in the task index matches the task files', async () => {
  const { readFile } = await import('node:fs/promises');
  const { TASK_TABLE_START, TASK_TABLE_END } = await import('../src/task-index.js');

  const readme = await readFile('docs/tasks/README.md', 'utf8');
  const start = readme.indexOf(TASK_TABLE_START);
  const end = readme.indexOf(TASK_TABLE_END);
  assert.ok(start !== -1 && end !== -1, 'the generated block markers are missing from README.md');

  const inFile = readme.slice(start + TASK_TABLE_START.length, end).trim();
  const fresh = renderTaskTable(await readTasks('docs/tasks')).trim();

  assert.equal(inFile, fresh, 'docs/tasks/README.md is stale — run `npm run tasks`');
});
