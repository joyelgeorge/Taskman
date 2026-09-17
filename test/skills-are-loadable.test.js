import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * A skill with broken front matter does not fail loudly — it is silently never
 * offered, and the procedure it holds is quietly re-derived by the next session.
 * That is the failure this whole directory exists to prevent, so it gets a check
 * rather than a convention.
 */

const ROOT = '.claude/skills';

async function skills() {
  const out = [];
  for (const name of await readdir(ROOT)) {
    const path = join(ROOT, name, 'SKILL.md');
    try {
      if (!(await stat(path)).isFile()) continue;
    } catch { continue; }
    out.push({ name, path, text: await readFile(path, 'utf8') });
  }
  return out;
}

test('every skill has front matter with a name and a description', async () => {
  const broken = [];
  for (const s of await skills()) {
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(s.text);
    if (!fm) { broken.push(`${s.name}: no front matter`); continue; }
    if (!/^name:\s*\S+/m.test(fm[1])) broken.push(`${s.name}: no name field`);
    if (!/^description:\s*\S+/m.test(fm[1])) broken.push(`${s.name}: no description field`);
  }
  assert.deepEqual(broken, [], `skills that will never be offered:\n${broken.join('\n')}`);
});

test("every skill's declared name matches its directory", async () => {
  const wrong = [];
  for (const s of await skills()) {
    const declared = /^name:\s*(\S+)/m.exec(s.text);
    if (declared && declared[1] !== s.name) wrong.push(`${s.name}/ declares "${declared[1]}"`);
  }
  assert.deepEqual(wrong, [], `a name that does not match its directory is a skill nobody can invoke:\n${wrong.join('\n')}`);
});

/**
 * Pull the description out of YAML front matter, including folded scalars
 * (`description: >-`) whose text continues on indented lines. Two earlier
 * regex attempts got this wrong in opposite directions — one read `>-` as the
 * description, the next truncated at the first newline because `$` under the
 * `m` flag ends a line, not the string. Hence a line walker.
 */
function descriptionOf(text) {
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!fm) return null;
  const lines = fm[1].split('\n');
  const i = lines.findIndex(l => /^description:/.test(l));
  if (i === -1) return null;

  const parts = [lines[i].replace(/^description:\s*(>-|>|\|-|\|)?\s*/, '')];
  for (let j = i + 1; j < lines.length; j += 1) {
    if (/^[A-Za-z_-]+:/.test(lines[j])) break;   // next key
    parts.push(lines[j].trim());
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

test('every skill description says when to use it, not only what it does', async () => {
  const vague = [];
  for (const s of await skills()) {
    const d = descriptionOf(s.text);
    if (!d) continue;
    // A description that only summarises the workflow gets followed INSTEAD of
    // the skill being read, and a skill with no trigger is never loaded at the
    // moment it would have helped.
    if (!/\buse\s+(when|whenever|before|the moment|on|it when|this)\b/i.test(d)) {
      vague.push(`${s.name}: "${d.slice(0, 70)}..."`);
    }
  }
  assert.deepEqual(vague, [], `descriptions that never say when to use them:\n${vague.join('\n')}`);
});
test('every skill a skill points at exists', async () => {
  const names = new Set((await skills()).map(s => s.name));
  const broken = [];
  for (const s of await skills()) {
    // `REQUIRED: use x` / "see the `x` skill" — the forms our skills use to chain.
    // Three forms our skills actually use to point at each other. A checker that
    // misses a form silently blesses a broken link, which is worse than no
    // checker — this one missed the pipeline form until a mutation exposed it.
    const forms = [
      /`([a-z][a-z0-9-]{4,})`\s+skill/gi,               // "the `x` skill"
      /REQUIRED:?\s*use\s+`?([a-z][a-z0-9-]{4,})`?/gi, // "REQUIRED: use x"
      /\*\*(?:Before|After) this:\*\*\s*`([a-z][a-z0-9-]{4,})`/gi, // pipeline chain
      /->\s*`([a-z][a-z0-9-]{4,})`/g                    // "a -> `b`"
    ];
    for (const m of forms.flatMap(re => [...s.text.matchAll(re)])) {
      const ref = m[1].toLowerCase();
      if (!names.has(ref) && !ref.startsWith('superpowers')) broken.push(`${s.name} -> ${ref}`);
    }
  }
  assert.deepEqual(broken, [], `skills referencing skills that do not exist:\n${broken.join('\n')}`);
});

test('every supporting file a skill links to exists', async () => {
  const { existsSync } = await import('node:fs');
  const broken = [];
  for (const s of await skills()) {
    for (const m of s.text.matchAll(/\]\((?!https?:)([^)]+\.md)\)/g)) {
      if (!existsSync(join(ROOT, s.name, m[1]))) broken.push(`${s.name} -> ${m[1]}`);
    }
  }
  assert.deepEqual(broken, [], `skills linking to files that do not exist:\n${broken.join('\n')}`);
});
