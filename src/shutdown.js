import { TaskmanError } from './limits.js';

function boundedGraceMs(value, fallback = 30_000) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 100 && parsed <= 300_000
    ? parsed
    : fallback;
}

export class ShutdownInProgressError extends TaskmanError {
  constructor() {
    super('Service is draining for shutdown', {
      code: 'SHUTDOWN_IN_PROGRESS',
      statusCode: 503
    });
  }
}

export function createExecutionTracker() {
  const active = new Map();
  let accepting = true;
  let sequence = 0;

  function run(label, operation) {
    if (!accepting) return Promise.reject(new ShutdownInProgressError());
    const id = ++sequence;
    const controller = new AbortController();
    const promise = Promise.resolve().then(() => operation(controller.signal));
    active.set(id, { label, controller, promise });
    promise.catch(() => {}).finally(() => active.delete(id));
    return promise;
  }

  return {
    run,
    beginDrain() {
      accepting = false;
    },
    isAccepting() {
      return accepting;
    },
    snapshot() {
      return {
        accepting,
        active: active.size,
        labels: [...active.values()].map(entry => entry.label).sort()
      };
    },
    async waitForIdle(timeoutMs) {
      if (!active.size) return true;
      let timer;
      const timeout = new Promise(resolve => {
        timer = setTimeout(() => resolve(false), timeoutMs);
        timer.unref?.();
      });
      const settled = Promise.allSettled([...active.values()].map(entry => entry.promise))
        .then(() => true);
      const idle = await Promise.race([settled, timeout]);
      clearTimeout(timer);
      return idle;
    },
    abortAll(reason = new TaskmanError('Shutdown deadline exceeded', {
      code: 'SHUTDOWN_DEADLINE_EXCEEDED'
    })) {
      for (const entry of active.values()) {
        if (!entry.controller.signal.aborted) entry.controller.abort(reason);
      }
    }
  };
}

function beginServerClose(server) {
  if (!server?.listening) return Promise.resolve();
  return new Promise(resolve => {
    server.close(() => resolve());
  });
}

export function createShutdownCoordinator({
  server,
  tracker,
  stopScheduling = () => {},
  closeDatabase = async () => {},
  graceMs = boundedGraceMs(process.env.TASKMAN_SHUTDOWN_GRACE_MS),
  logger = console
}) {
  const configuredGraceMs = boundedGraceMs(graceMs);
  let shutdownPromise = null;
  let state = 'running';

  async function begin(reason = 'shutdown') {
    if (shutdownPromise) return shutdownPromise;
    state = 'draining';
    tracker.beginDrain();
    stopScheduling();
    const serverClosed = beginServerClose(server);

    shutdownPromise = (async () => {
      logger.info?.('[Taskman Shutdown] Draining started', {
        reason,
        graceMs: configuredGraceMs,
        active: tracker.snapshot().active
      });

      let forced = false;
      const idle = await tracker.waitForIdle(configuredGraceMs);
      if (!idle) {
        forced = true;
        tracker.abortAll();
        server?.closeIdleConnections?.();
        server?.closeAllConnections?.();
        await tracker.waitForIdle(Math.min(1_000, configuredGraceMs));
      }

      await Promise.allSettled([serverClosed, closeDatabase()]);
      state = 'stopped';
      logger.info?.('[Taskman Shutdown] Drain completed', {
        reason,
        forced,
        remaining: tracker.snapshot().active
      });
      return { reason, forced, remaining: tracker.snapshot().active };
    })();

    return shutdownPromise;
  }

  return {
    begin,
    isDraining: () => state !== 'running',
    state: () => state,
    graceMs: configuredGraceMs
  };
}

export function installShutdownSignals(coordinator, processRef = process) {
  const handle = signal => {
    coordinator.begin(signal).then(() => {
      processRef.exitCode = 0;
    }).catch(() => {
      processRef.exitCode = 1;
    });
  };
  processRef.once('SIGTERM', handle);
  processRef.once('SIGINT', handle);
  return () => {
    processRef.removeListener('SIGTERM', handle);
    processRef.removeListener('SIGINT', handle);
  };
}
