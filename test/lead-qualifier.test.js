import test from 'node:test';
import assert from 'node:assert/strict';
import { qualifyLead } from '../packages/core/targets/lead-qualifier.js';

test('rejects templates, tutorials, clones and forks — a vuln there is unsellable', () => {
  assert.equal(qualifyLead({ name: 'next-supabase-starter', description: 'A boilerplate' }).genuine, false);
  assert.equal(qualifyLead({ name: 'todo-tutorial', description: 'learning project' }).genuine, false);
  assert.equal(qualifyLead({ name: 'app', description: 'real', fork: true, homepage: 'https://x.com' }).genuine, false);
  assert.equal(qualifyLead({ name: 'app', description: 'real', archived: true, homepage: 'https://x.com' }).genuine, false);
});

test('accepts a deployed product', () => {
  const r = qualifyLead({ name: 'menerio', description: 'AI reconciliation for agencies', homepage: 'https://menerio.com', created_at: '2026-03-01', pushed_at: '2026-08-01' });
  assert.equal(r.genuine, true);
  assert.ok(r.score >= 0.45);
});

test('accepts a repo with payments in code even without stars or homepage', () => {
  const r = qualifyLead({ name: 'creatorbridge', description: 'Creator marketplace' }, { hasPayments: true, hasAuth: true });
  assert.equal(r.genuine, true);
});

test('a bare hobby repo with no traction, deployment or payments is not genuine', () => {
  const r = qualifyLead({ name: 'thing', description: '', stargazers_count: 0, forks_count: 0 });
  assert.equal(r.genuine, false);
});
