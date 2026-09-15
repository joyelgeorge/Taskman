import test from 'node:test';
import assert from 'node:assert/strict';
import { scrubSecrets } from '../src/adapters/coding-agent-adapter.js';

// scrubSecrets guards text that leaves this process: PR titles and bodies sent
// to GitHub, outreach notes, and now research findings about other people's
// exposed keys. Recording such a key verbatim would republish it.

test('an assignment-style secret is redacted but its name is kept', () => {
  const out = scrubSecrets('their config read PASSWORD=hunter2supersecret in the bundle');

  assert.doesNotMatch(out, /hunter2supersecret/);
  assert.match(out, /PASSWORD=/);           // the finding survives
});

test('every common secret name is covered, not just PASSWORD', () => {
  for (const name of ['SECRET', 'TOKEN', 'API_KEY', 'ACCESS_KEY', 'PRIVATE_KEY', 'PASSWD']) {
    const out = scrubSecrets(`${name}=zzzTopSecretValue123`);
    assert.doesNotMatch(out, /zzzTopSecretValue123/, `${name} leaked`);
  }
});

test('a JWT is redacted — this is the shape of a Supabase service_role key', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.abcDEF123-_x';
  const out = scrubSecrets(`fallback key ${jwt} committed at line 70`);

  assert.doesNotMatch(out, /eyJyb2xlIjoic2VydmljZV9yb2xl/);
  assert.match(out, /line 70/);             // the surrounding fact survives
});

test('a password inside a connection string is redacted', () => {
  const out = scrubSecrets('postgres://admin:hunter2supersecret@db.example.com:5432/app');

  assert.doesNotMatch(out, /hunter2supersecret/);
  assert.match(out, /db\.example\.com/);    // the host is the useful part
});

test('a connection-string password is redacted even when the URL carries query parameters', () => {
  // Guards the character class, not the rule order: an earlier version of this
  // test claimed ordering mattered and passed when the order was reversed, which
  // made it a test of nothing. Verified by deleting the rule and watching both
  // connection-string tests go red.
  const out = scrubSecrets('postgres://a:hunter2supersecret@x.io/db?sslmode=require');

  assert.doesNotMatch(out, /hunter2supersecret/);
});

test('the tokens it already caught are still caught', () => {
  assert.doesNotMatch(scrubSecrets('ghp_' + 'a'.repeat(36)), /ghp_a/);
  assert.doesNotMatch(scrubSecrets('sk-' + 'b'.repeat(32)), /sk-b/);
  assert.doesNotMatch(scrubSecrets('Bearer ' + 'c'.repeat(32)), /ccccc/);
});

test('ordinary prose is left alone', () => {
  const prose = 'The retailer uses Tally and files GST returns monthly.';
  assert.equal(scrubSecrets(prose), prose);
});
