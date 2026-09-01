export class DashboardApiError extends Error {
  constructor(message, { code = 'REQUEST_FAILED', status = 0 } = {}) {
    super(message);
    this.name = 'DashboardApiError';
    this.code = code;
    this.status = status;
  }
}

export async function requestJson(path, {
  fetchImpl = globalThis.fetch,
  signal,
  ...options
} = {}) {
  const response = await fetchImpl(path, {
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    ...options,
    signal
  });
  const text = await response.text();
  let value = {};

  if (text) {
    try {
      value = JSON.parse(text);
    } catch {
      throw new DashboardApiError(
        response.ok ? 'Response was not valid JSON' : `Request failed (HTTP ${response.status})`,
        { code: 'INVALID_JSON_RESPONSE', status: response.status }
      );
    }
  }

  if (!response.ok) {
    throw new DashboardApiError(value?.error || `Request failed (HTTP ${response.status})`, {
      code: value?.code || 'HTTP_ERROR',
      status: response.status
    });
  }
  return value;
}

function errorSummary(error) {
  if (error?.name === 'AbortError') return 'Request canceled';
  return String(error?.message || error || 'Request failed');
}

export function pollDelay(documentHidden, {
  visibleMs = 10_000,
  hiddenMs = 60_000
} = {}) {
  return documentHidden ? hiddenMs : visibleMs;
}

export function createDashboardRefreshController({
  panels,
  fetchPanel,
  onPanelState = () => {},
  onGlobalState = () => {},
  now = () => new Date()
}) {
  const states = Object.fromEntries(Object.keys(panels).map(name => [name, {
    name,
    status: 'empty',
    data: undefined,
    lastSuccessAt: null,
    error: null
  }]));
  let generation = 0;
  let active = null;

  function snapshot() {
    return {
      generation,
      panels: Object.fromEntries(
        Object.entries(states).map(([name, state]) => [name, { ...state }])
      )
    };
  }

  function emitGlobal() {
    const values = Object.values(states);
    const failures = values.filter(state => state.status === 'error' || state.status === 'stale');
    const status = failures.length === 0
      ? 'live'
      : failures.length === values.length
        ? 'error'
        : 'degraded';
    const globalState = {
      status,
      failedPanels: failures.map(state => state.name),
      checkedAt: now().toISOString()
    };
    onGlobalState(globalState);
    return globalState;
  }

  function refresh({ supersede = false } = {}) {
    if (active && !supersede) return active.promise;
    if (active && supersede) active.controller.abort();

    const currentGeneration = ++generation;
    const controller = new AbortController();

    for (const state of Object.values(states)) {
      state.status = state.data === undefined ? 'loading' : 'stale';
      state.error = null;
      onPanelState(state.name, { ...state });
    }

    const promise = (async () => {
      const entries = Object.entries(panels);
      const results = await Promise.allSettled(entries.map(([name, path]) =>
        fetchPanel(name, path, { signal: controller.signal })
      ));

      if (currentGeneration !== generation) {
        return { ignored: true, ...snapshot() };
      }

      results.forEach((result, index) => {
        const [name] = entries[index];
        const state = states[name];

        if (result.status === 'fulfilled') {
          state.status = 'live';
          state.data = result.value;
          state.lastSuccessAt = now().toISOString();
          state.error = null;
        } else {
          state.status = state.data === undefined ? 'error' : 'stale';
          state.error = errorSummary(result.reason);
        }
        onPanelState(name, { ...state });
      });

      const global = emitGlobal();
      return { ignored: false, global, ...snapshot() };
    })().finally(() => {
      if (active?.generation === currentGeneration) active = null;
    });

    active = { generation: currentGeneration, controller, promise };
    return promise;
  }

  function dispose() {
    generation += 1;
    active?.controller.abort();
    active = null;
  }

  return { refresh, snapshot, dispose };
}
