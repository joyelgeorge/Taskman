const HARD_GATES = [
  'payerVerified',
  'taskOpen',
  'acceptanceCriteriaClear',
  'deliveryPathExecutable',
  'noContradictoryInstructions',
  'payoutPathExecutable',
  'noRecurringManualStep',
  'noUpfrontSpend',
  'noUnsupportedSigning'
];

export function evaluateExecutionGate(candidate = {}) {
  const checks = Object.fromEntries(HARD_GATES.map(key => [key, Boolean(candidate[key])]));
  const failed = HARD_GATES.filter(key => !checks[key]);
  const passed = failed.length === 0;

  const payout = Number(candidate.payout || 0);
  const acceptanceProbability = clamp01(candidate.acceptanceProbability ?? 0.5);
  const settlementProbability = clamp01(candidate.settlementProbability ?? 0.5);
  const executionFriction = Math.max(Number(candidate.executionFriction ?? 1), 0.01);
  const expectedValue = (payout * acceptanceProbability * settlementProbability) / executionFriction;

  return {
    passed,
    decision: passed ? 'EXECUTABLE' : 'BLOCKED',
    checks,
    failed,
    expectedValue: Number(expectedValue.toFixed(6)),
    evaluatedAt: new Date().toISOString()
  };
}

export function assertExecutionAllowed(candidate) {
  const result = evaluateExecutionGate(candidate);
  if (!result.passed) {
    throw new Error(`execution gate blocked: ${result.failed.join(', ')}`);
  }
  return result;
}

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export { HARD_GATES };
