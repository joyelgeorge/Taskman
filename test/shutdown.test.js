import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import {
  ShutdownInProgressError,
  createExecutionTracker,
  createShutdownCoordinator,
  installShutdownSignals
} from '../src/shutdown.js';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function fakeServer() {
  return {
    listening: true,
    closeCalls: 0,
    idleCalls: 0,
    forceCalls: 0,
    close(callback) {
      this.closeCalls += 1;
      this.listening = false;
      callback();
    },
    closeIdleConnections() { this.idleCalls += 1; },
    closeAllConnections() { this.forceCalls += 1; }
  };
}

const quietLogger = { info() {} };

test('short in-flight work drains before database close', async () => {
  const tracker = createExecutionTracker();
  const work = deferred();
  const events = [];
  const server = fakeServer();
  const running = tracker.run('short-work', async () => {
    await work.promise;
    events.push('work-finished');
  });
  const coordinator = createShutdownCoordinator({
    server,
    tracker,
    graceMs: 500,
    stopScheduling: () => events.push('scheduling-stopped'),
    closeDatabase: async () => events.push('database-closed'),
    logger: quietLogger
  });

  const shutdown = coordinator.begin('SIGTERM');
  assert.equal(coordinator.isDraining(), true);
  await assert.rejects(
    tracker.run('late-work', async () => {}),
    ShutdownInProgressError
  );
  work.resolve();
  await running;
  const result = await shutdown;

  assert.equal(result.forced, false);
  assert.deepEqual(events, ['scheduling-stopped', 'work-finished', 'database-closed']);
  assert.equal(server.closeCalls, 1);
  assert.equal(server.forceCalls, 0);
});

test('deadline aborts cooperative work and force-closes connections boundedly', async () => {
  const tracker = createExecutionTracker();
  const server = fakeServer();
  let aborted = false;
  tracker.run('long-work', signal => new Promise(resolve => {
    signal.addEventListener('abort', () => {
      aborted = true;
      resolve();
    }, { once: true });
  }));
  const coordinator = createShutdownCoordinator({
    server,
    tracker,
    graceMs: 100,
    logger: quietLogger
  });

  const result = await coordinator.begin('SIGTERM');
  assert.equal(result.forced, true);
  assert.equal(aborted, true);
  assert.equal(server.idleCalls, 1);
  assert.equal(server.forceCalls, 1);
  assert.equal(result.remaining, 0);
});

test('repeated shutdown requests are idempotent', async () => {
  const tracker = createExecutionTracker();
  const server = fakeServer();
  let stopCalls = 0;
  let databaseCloseCalls = 0;
  const coordinator = createShutdownCoordinator({
    server,
    tracker,
    graceMs: 100,
    stopScheduling: () => { stopCalls += 1; },
    closeDatabase: async () => { databaseCloseCalls += 1; },
    logger: quietLogger
  });

  const first = coordinator.begin('SIGTERM');
  const second = coordinator.begin('SIGINT');
  assert.equal(await first, await second);
  assert.equal(stopCalls, 1);
  assert.equal(databaseCloseCalls, 1);
  assert.equal(server.closeCalls, 1);
});

test('signal installation handles one signal and can be removed', async () => {
  const processRef = new EventEmitter();
  processRef.exitCode = undefined;
  let calls = 0;
  const coordinator = {
    async begin(signal) {
      calls += 1;
      assert.equal(signal, 'SIGTERM');
    }
  };
  const remove = installShutdownSignals(coordinator, processRef);
  processRef.emit('SIGTERM', 'SIGTERM');
  await new Promise(resolve => setImmediate(resolve));
  remove();

  assert.equal(calls, 1);
  assert.equal(processRef.exitCode, 0);
  assert.equal(processRef.listenerCount('SIGINT'), 0);
});
