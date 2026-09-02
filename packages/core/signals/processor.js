import { claimNewSignals, markSignal } from './store.js';

/**
 * Turns raw signals into scored, classified ones.
 *
 * Deterministic by contract. Interpretation that needs judgement belongs in a
 * transform with a schema; this stage exists so that a model is never the thing
 * deciding what is worth acting on. The rules come from the drone's own config,
 * so adding a source does not mean editing this file.
 */

const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));

export function scoreSignal(signal, rules = {}) {
  const haystack = [signal.title, signal.url, JSON.stringify(signal.payload ?? {})]
    .filter(Boolean).join(' ').toLowerCase();

  const excluded = (rules.exclude || []).find(term => haystack.includes(String(term).toLowerCase()));
  if (excluded) {
    return { score: 0, passed: false, reason: `excluded term: ${excluded}` };
  }

  const include = rules.include || [];
  const hits = include.filter(term => haystack.includes(String(term).toLowerCase()));
  if (include.length && !hits.length) {
    return { score: 0, passed: false, reason: 'no required term matched' };
  }

  let value = null;
  if (rules.valueField) {
    value = Number(String(signal.payload?.[rules.valueField] ?? '').replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(value)) value = null;
    if (rules.minValue != null && (value == null || value < Number(rules.minValue))) {
      return { score: 0, passed: false, reason: `value below minimum ${rules.minValue}` };
    }
  }

  // Freshness matters more than keyword density for a signal that triggers action.
  const ageHours = signal.observedAt ? (Date.now() - new Date(signal.observedAt)) / 3_600_000 : 0;
  const freshness = clamp01(1 - ageHours / Number(rules.staleAfterHours || 72));
  const relevance = include.length ? clamp01(hits.length / include.length) : 0.5;
  const magnitude = value != null && rules.valueCeiling ? clamp01(value / Number(rules.valueCeiling)) : 0.5;

  const score = Number((0.45 * freshness + 0.35 * relevance + 0.20 * magnitude).toFixed(4));
  const threshold = Number(rules.threshold ?? 0.4);

  return {
    score,
    passed: score >= threshold,
    reason: score >= threshold ? null : `score ${score} below threshold ${threshold}`,
    matched: hits,
    value
  };
}

/**
 * @param {Function} [promote] receives each passing signal. Injected rather than
 *   imported so this package never depends on whatever consumes its output.
 */
export async function processSignals({ limit = 100, rulesFor = () => ({}), promote = null } = {}) {
  const signals = await claimNewSignals({ limit });
  const processed = [];
  const rejected = [];
  const promoted = [];

  for (const signal of signals) {
    const rules = (await rulesFor(signal)) || {};
    const verdict = scoreSignal(signal, rules);

    if (!verdict.passed) {
      await markSignal(signal.id, { status: 'REJECTED', score: verdict.score, rejectReason: verdict.reason });
      rejected.push({ id: signal.id, title: signal.title, reason: verdict.reason });
      continue;
    }

    await markSignal(signal.id, { status: 'PROCESSED', score: verdict.score });
    processed.push({ id: signal.id, title: signal.title, score: verdict.score });

    if (promote) {
      try {
        const result = await promote(signal, verdict);
        if (result) promoted.push(result);
      } catch (error) {
        // A failed handoff must not lose the scoring work already committed.
        rejected.push({ id: signal.id, reason: `promotion failed: ${error.message}` });
      }
    }
  }

  return {
    claimed: signals.length,
    processedCount: processed.length,
    rejectedCount: rejected.length,
    promotedCount: promoted.length,
    processed, rejected, promoted
  };
}
