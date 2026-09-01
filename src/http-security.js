import { getRuntimeConfig } from './config.js';

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'"
].join('; ');

function firstForwardedProtocol(value) {
  return String(value || '').split(',', 1)[0].trim().toLowerCase();
}

function runtimeSecurityEnv() {
  const config = getRuntimeConfig();
  return {
    NODE_ENV: config.profile,
    TASKMAN_TRUST_PROXY: String(config.security.trustProxy),
    TASKMAN_CSP_REPORT_ONLY: String(config.security.cspReportOnly),
    TASKMAN_HSTS_ENABLED: String(config.security.hstsEnabled)
  };
}

export function requestIsTrustedHttps(req, env = runtimeSecurityEnv()) {
  if (req.socket?.encrypted === true) return true;
  return env.TASKMAN_TRUST_PROXY === 'true'
    && firstForwardedProtocol(req.headers?.['x-forwarded-proto']) === 'https';
}

export function securityHeaders(req, env = runtimeSecurityEnv()) {
  const headers = {
    'content-security-policy': CONTENT_SECURITY_POLICY,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()',
    'x-frame-options': 'DENY',
    'x-permitted-cross-domain-policies': 'none'
  };

  if (env.TASKMAN_CSP_REPORT_ONLY === 'true') {
    headers['content-security-policy-report-only'] = headers['content-security-policy'];
    delete headers['content-security-policy'];
  }

  if (
    env.NODE_ENV === 'production'
    && env.TASKMAN_HSTS_ENABLED !== 'false'
    && requestIsTrustedHttps(req, env)
  ) {
    headers['strict-transport-security'] = 'max-age=31536000; includeSubDomains';
  }

  return headers;
}

export function applySecurityHeaders(req, res, env = runtimeSecurityEnv()) {
  for (const [name, value] of Object.entries(securityHeaders(req, env))) {
    res.setHeader(name, value);
  }
}

export { CONTENT_SECURITY_POLICY };
