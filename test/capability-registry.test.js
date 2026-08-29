import test from 'node:test';
import assert from 'node:assert/strict';
import {
  listRegisteredCapabilities,
  getSafeCapabilitySnapshot,
  getRuntimeCapabilityMap,
  registerCapability,
  CAPABILITY_STATUS
} from '../src/capability-registry.js';

test('Capability Registry: listRegisteredCapabilities surfaces core runtime capabilities', () => {
  const caps = listRegisteredCapabilities();
  assert.ok(caps['web.search']);
  assert.ok(caps['web.fetch']);
  assert.ok(caps['taskman.queue.read']);
  assert.ok(caps['taskman.queue.write']);
  assert.ok(caps['wallet.sign']);
  assert.equal(caps['wallet.sign'].status, CAPABILITY_STATUS.UNAVAILABLE);
});

test('Capability Registry: getSafeCapabilitySnapshot does not expose secrets', () => {
  const snapshot = getSafeCapabilitySnapshot();
  assert.ok(snapshot.summary);
  assert.ok(snapshot.summary.total >= 10);
  assert.ok(snapshot.capabilities);

  const jsonStr = JSON.stringify(snapshot);
  assert.equal(jsonStr.includes('password'), false);
  assert.equal(jsonStr.includes('secret'), false);
  assert.equal(jsonStr.includes('Bearer'), false);
});

test('Capability Registry: getRuntimeCapabilityMap returns boolean flags', () => {
  const map = getRuntimeCapabilityMap();
  assert.equal(typeof map['web.read'], 'boolean');
  assert.equal(typeof map['taskman.queue.read'], 'boolean');
  assert.equal(map['wallet.sign'], false);
});

test('Capability Registry: registerCapability adds custom capabilities', () => {
  registerCapability('custom.adapter.read', {
    id: 'custom.adapter.read',
    status: CAPABILITY_STATUS.AVAILABLE,
    access: 'read',
    description: 'Custom capability test'
  });

  const caps = listRegisteredCapabilities();
  assert.ok(caps['custom.adapter.read']);
  assert.equal(caps['custom.adapter.read'].status, CAPABILITY_STATUS.AVAILABLE);
});
