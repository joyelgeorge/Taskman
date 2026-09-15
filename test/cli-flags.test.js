import test from 'node:test';
import assert from 'node:assert/strict';
import { readFlag } from '../src/cli-flags.js';

test('reads the equals form', () => {
  assert.equal(readFlag(['log', '--lane=vibe-app-security'], 'lane'), 'vibe-app-security');
});

test('reads the space form, which used to be reported as a missing flag', () => {
  assert.equal(readFlag(['log', '--lane', 'vibe-app-security'], 'lane'), 'vibe-app-security');
});

test('a flag with no value is null, not the next flag', () => {
  assert.equal(readFlag(['log', '--lane', '--channel=email'], 'lane'), null);
  assert.equal(readFlag(['log', '--lane'], 'lane'), null);
});

test('an absent flag is null', () => {
  assert.equal(readFlag(['log', '--channel=email'], 'lane'), null);
});

test('a value containing an equals sign survives both forms', () => {
  assert.equal(readFlag(['--prospect=owner/repo?a=b'], 'prospect'), 'owner/repo?a=b');
  assert.equal(readFlag(['--prospect', 'owner/repo?a=b'], 'prospect'), 'owner/repo?a=b');
});

test('one flag name is not confused with another that shares its prefix', () => {
  assert.equal(readFlag(['--lane-note=x', '--lane=real'], 'lane'), 'real');
});
