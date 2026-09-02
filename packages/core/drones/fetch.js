const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_BYTES = 2_000_000;

export const USER_AGENT = 'TaskmanDrone/1.0 (+autonomous signal collector)';

/**
 * One guarded outbound request. Drones are the only part of the system that
 * touch the open internet, so the limits live here rather than in each collector:
 * a hard timeout, a response size cap, and no redirect off the original scheme.
 */
export async function droneFetch(url, { timeoutMs = DEFAULT_TIMEOUT_MS, headers = {}, fetchImpl = fetch } = {}) {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`unsupported protocol: ${parsed.protocol}`);
  }

  const started = Date.now();
  const response = await fetchImpl(url, {
    method: 'GET',
    redirect: 'follow',
    headers: { 'user-agent': USER_AGENT, accept: '*/*', ...headers },
    signal: AbortSignal.timeout(timeoutMs)
  });

  const text = await response.text();
  if (text.length > MAX_BYTES) {
    throw new Error(`response exceeded ${MAX_BYTES} bytes`);
  }
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status} from ${parsed.host}`);
    error.status = response.status;
    throw error;
  }

  return { text, status: response.status, latencyMs: Date.now() - started };
}

/** Read a dotted path out of a nested object without throwing. */
export function readPath(source, path) {
  if (!path) return source;
  return String(path).split('.').reduce((value, key) => (value == null ? undefined : value[key]), source);
}
