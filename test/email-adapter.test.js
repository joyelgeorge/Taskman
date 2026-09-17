import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  isValidEmail,
  isEmailAvailable,
  formatEml,
  stageOutboxEml,
  dispatchOutreachEmail
} from '../src/adapters/email.js';

test('isValidEmail accepts valid email formats and rejects malformed addresses', () => {
  assert.equal(isValidEmail('joyel@example.com'), true);
  assert.equal(isValidEmail('contact.test+dev@agency.co.in'), true);
  assert.equal(isValidEmail('plainaddress'), false);
  assert.equal(isValidEmail('missing@tld'), false);
  assert.equal(isValidEmail(''), false);
  assert.equal(isValidEmail(null), false);
});

test('formatEml creates valid RFC 822 structured text', () => {
  const eml = formatEml({
    to: 'target@example.com',
    from: 'sender@example.com',
    subject: 'Security Notice',
    body: 'Hello, your repo had an exposed key.'
  });

  assert.match(eml, /^From: sender@example\.com/m);
  assert.match(eml, /^To: target@example\.com/m);
  assert.match(eml, /^Subject: Security Notice/m);
  assert.match(eml, /^MIME-Version: 1\.0/m);
  assert.match(eml, /Hello, your repo had an exposed key\./);
});

test('stageOutboxEml writes an EML file to private-outreach/outbox', async () => {
  const { filePath, fileName } = await stageOutboxEml({
    to: 'client@agency.dev',
    from: 'me@example.com',
    subject: 'Audit Report',
    body: 'Details inside.',
    prospect: 'Agency-Dev'
  });

  assert.ok(filePath.includes('private-outreach/outbox'));
  assert.ok(fileName.includes('Agency-Dev.eml'));

  const written = await readFile(filePath, 'utf8');
  assert.match(written, /To: client@agency\.dev/);
  assert.match(written, /Subject: Audit Report/);
});

test('dispatchOutreachEmail dryRun scrubs body and validates recipient without sending', async () => {
  const dry = await dispatchOutreachEmail({
    to: 'prospect@startup.io',
    subject: 'Vibe App Audit',
    body: 'Scanned your public repo and found 2 findings.',
    dryRun: true
  });

  assert.equal(dry.dryRun, true);
  assert.equal(dry.to, 'prospect@startup.io');
  assert.equal(dry.subject, 'Vibe App Audit');
  assert.match(dry.body, /Scanned your public repo/);
});

test('dispatchOutreachEmail refuses to send invalid email or empty subject', async () => {
  await assert.rejects(
    () => dispatchOutreachEmail({ to: 'bad-email', subject: 'Hi', body: 'Test' }),
    /Invalid recipient email address/
  );

  await assert.rejects(
    () => dispatchOutreachEmail({ to: 'valid@example.com', subject: '', body: 'Test' }),
    /Email subject is required/
  );
});
