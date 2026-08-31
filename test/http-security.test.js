import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { CONTENT_SECURITY_POLICY, requestIsTrustedHttps, securityHeaders } from '../src/http-security.js';

function request({ encrypted = false, forwardedProto } = {}) {
  return {
    socket: { encrypted },
    headers: forwardedProto ? { 'x-forwarded-proto': forwardedProto } : {}
  };
}

test('security policy is strict and self-contained', () => {
  assert.match(CONTENT_SECURITY_POLICY, /default-src 'self'/);
  assert.match(CONTENT_SECURITY_POLICY, /frame-ancestors 'none'/);
  assert.match(CONTENT_SECURITY_POLICY, /object-src 'none'/);
  assert.doesNotMatch(CONTENT_SECURITY_POLICY, /unsafe-inline|unsafe-eval|\*/);

  const headers = securityHeaders(request(), {});
  assert.equal(headers['content-security-policy'], CONTENT_SECURITY_POLICY);
  assert.equal(headers['x-content-type-options'], 'nosniff');
  assert.equal(headers['x-frame-options'], 'DENY');
  assert.equal(headers['referrer-policy'], 'no-referrer');
  assert.match(headers['permissions-policy'], /camera=\(\)/);
  assert.equal(headers['strict-transport-security'], undefined);
});

test('CSP can be staged in report-only mode', () => {
  const headers = securityHeaders(request(), { TASKMAN_CSP_REPORT_ONLY: 'true' });
  assert.equal(headers['content-security-policy'], undefined);
  assert.equal(headers['content-security-policy-report-only'], CONTENT_SECURITY_POLICY);
});

test('forwarded HTTPS is trusted only when proxy trust is explicitly enabled', () => {
  const req = request({ forwardedProto: 'https, http' });
  assert.equal(requestIsTrustedHttps(req, {}), false);
  assert.equal(requestIsTrustedHttps(req, { TASKMAN_TRUST_PROXY: 'true' }), true);
  assert.equal(requestIsTrustedHttps(request({ forwardedProto: 'http' }), { TASKMAN_TRUST_PROXY: 'true' }), false);
  assert.equal(requestIsTrustedHttps(request({ encrypted: true }), {}), true);
});

test('HSTS is emitted only for trusted production HTTPS requests', () => {
  const production = { NODE_ENV: 'production' };
  assert.equal(securityHeaders(request({ encrypted: true }), production)['strict-transport-security'], 'max-age=31536000; includeSubDomains');
  assert.equal(securityHeaders(request(), production)['strict-transport-security'], undefined);
  assert.equal(securityHeaders(request({ encrypted: true }), { ...production, TASKMAN_HSTS_ENABLED: 'false' })['strict-transport-security'], undefined);
  assert.equal(
    securityHeaders(request({ forwardedProto: 'https' }), { ...production, TASKMAN_TRUST_PROXY: 'true' })['strict-transport-security'],
    'max-age=31536000; includeSubDomains'
  );
});

test('browser assets contain no inline style or script', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /<style(?:\s|>)/i);
  assert.doesNotMatch(html, /\sstyle=/i);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i);
  assert.match(html, /<link rel="stylesheet" href="\/styles\.css"/);
});

test('all HTTP response classes receive the centralized policy', async (t) => {
  const port = 32_000 + (process.pid % 10_000);
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_URL: '',
      TASKMAN_INTERNAL_SCHEDULER_ENABLED: 'false',
      TASKMAN_BRAIN_INTERVAL_MINUTES: '0'
    },
    stdio: 'ignore'
  });
  t.after(() => child.kill('SIGTERM'));

  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${base}/api/status`);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.equal(ready, true, 'test server did not become ready');

  const cases = [
    ['/', { method: 'GET' }, 200, 'text/html'],
    ['/app.js', { method: 'GET' }, 200, 'text/javascript'],
    ['/refresh-controller.js', { method: 'GET' }, 200, 'text/javascript'],
    ['/styles.css', { method: 'GET' }, 200, 'text/css'],
    ['/api/status', { method: 'GET' }, 200, 'application/json'],
    ['/missing', { method: 'GET' }, 404, 'application/json'],
    ['/api/tasks', { method: 'POST', body: '{' }, 400, 'application/json']
  ];

  for (const [path, options, status, contentType] of cases) {
    const response = await fetch(`${base}${path}`, options);
    assert.equal(response.status, status, path);
    assert.match(response.headers.get('content-type'), new RegExp(contentType), path);
    assert.equal(response.headers.get('content-security-policy'), CONTENT_SECURITY_POLICY, path);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff', path);
    assert.equal(response.headers.get('x-frame-options'), 'DENY', path);
  }
});
