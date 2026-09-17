/**
 * The Rails — typed DAG execution.
 *
 * The existing runner is a fixed linear sequence (detect → qualify → intervene →
 * charge). That cannot express independent branches, parallel validation, or a
 * node that depends on two others. This adds a DAG runtime beside it: nodes
 * declare dependencies, the scheduler proves acyclicity BEFORE any side effect,
 * and independent nodes run in the same wave.
 *
 * Beyond the original spec, one addition that matters more than the rest:
 * IDEMPOTENCY. In a linear pipeline a rerun is wasteful. In a DAG whose nodes
 * move money, a rerun is a DOUBLE CHARGE. Any node may declare an
 * idempotencyKey; a key already recorded as completed means the node is skipped,
 * not re-executed. This is the property that makes retries safe, and retries are
 * the whole reason to want a DAG.
 */

/** Validate structure before running anything: every dep exists, no cycles. */
export function validateDag(nodes = {}) {
  const names = Object.keys(nodes);
  for (const [name, node] of Object.entries(nodes)) {
    for (const dep of node.dependsOn || []) {
      if (!names.includes(dep)) return { ok: false, error: `node "${name}" depends on "${dep}", which is not declared` };
    }
  }
  // cycle detection by colouring
  const state = {};
  const visit = (n, path) => {
    if (state[n] === 'done') return null;
    if (state[n] === 'open') return `dependency cycle: ${[...path, n].join(' -> ')}`;
    state[n] = 'open';
    for (const dep of nodes[n].dependsOn || []) {
      const err = visit(dep, [...path, n]);
      if (err) return err;
    }
    state[n] = 'done';
    return null;
  };
  for (const n of names) {
    const err = visit(n, []);
    if (err) return { ok: false, error: err };
  }
  return { ok: true };
}

/** Group nodes into waves: everything in a wave can run in parallel. */
export function topoSort(nodes = {}) {
  const remaining = new Set(Object.keys(nodes));
  const done = new Set();
  const waves = [];
  while (remaining.size) {
    const wave = [...remaining].filter(n => (nodes[n].dependsOn || []).every(d => done.has(d)));
    if (!wave.length) break;            // validateDag catches this; defensive
    waves.push(wave);
    for (const n of wave) { remaining.delete(n); done.add(n); }
  }
  return waves;
}

/**
 * Execute the DAG. Results flow to dependents via `results`. A failed node halts
 * its dependents but the run reports everything that did complete.
 *
 * @param {Set} completed  idempotency keys already done — nodes matching are skipped
 */
export async function runDag(nodes = {}, { completed = new Set(), context = {} } = {}) {
  const valid = validateDag(nodes);
  if (!valid.ok) return { ok: false, error: valid.error, results: {}, skipped: [] };

  const results = {};
  const skipped = [];
  const failedNodes = new Set();

  for (const wave of topoSort(nodes)) {
    const runnable = wave.filter(n => !(nodes[n].dependsOn || []).some(d => failedNodes.has(d)));
    const settled = await Promise.all(runnable.map(async (name) => {
      const node = nodes[name];
      // Idempotency: a money-moving node must never execute twice for one key.
      if (node.idempotencyKey && completed.has(node.idempotencyKey)) {
        return { name, skipped: true };
      }
      try {
        const value = await node.run({ results, context });
        if (node.idempotencyKey) completed.add(node.idempotencyKey);
        return { name, value };
      } catch (error) {
        return { name, error };
      }
    }));

    for (const s of settled) {
      if (s.skipped) { skipped.push(s.name); continue; }
      if (s.error) { failedNodes.add(s.name); return { ok: false, failed: s.name, error: String(s.error.message), results, skipped }; }
      results[s.name] = s.value;
    }
  }
  return { ok: true, results, skipped };
}
