#!/usr/bin/env node
import { loadConfig } from '../src/config.js';

try {
  const config = loadConfig(process.env);
  console.log(JSON.stringify({ ok: true, configuration: config.safeSummary }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    code: error.code || 'TASKMAN_CONFIG_INVALID',
    problems: error.problems || ['configuration validation failed']
  }, null, 2));
  process.exitCode = 1;
}
