import test from 'node:test';
import assert from 'node:assert/strict';
import {
  recordAttempt, recordSettlement, setRailEnabled, setRailState, getRailState, railEconomics,
  isRailEnabled, resetLedgerMemory, SETTLEMENT_STATUS
} from '../src/money-ledger.js';
import {
  evaluateRailGovernor, enforceRailGovernor, globalBudgetStatus, setGlobalMonthlyBudget, resetGovernorMemory,
  sequentialMinAttempts, breakEvenRateFor, MIN_SEQUENTIAL_ATTEMPTS
} from '../src/rail-governor.js';

async function reset() { await resetLedgerMemory(); await resetGovernorMemory(); }

test('a freshly registered rail starts in PROBATION', async () => {
  await reset();
  const verdict = await evaluateRailGovernor({ rail: 'fresh' });
  assert.equal(verdict.state, 'PROBATION');
  assert.equal(verdict.nextState, 'PROBATION');
});

test('PROBATION promotes to PROVEN on the first cleared settlement', async () => {
  await reset();
  await recordAttempt({ rail: 'r', costCents: 500 });
  await recordSettlement({ rail: 'r', source: 'stripe', externalRef: 'txn_1', grossCents: 5000, status: SETTLEMENT_STATUS.CLEARED });

  const verdict = await enforceRailGovernor({ rail: 'r' });
  assert.equal(verdict.nextState, 'PROVEN');
  assert.equal((await getRailState('r')).state, 'PROVEN');
});

test('PROBATION disables on budget exhaustion with zero settlements', async () => {
  await reset();
  for (let i = 0; i < 6; i += 1) await recordAttempt({ rail: 'r', costCents: 1000 });

  const verdict = await enforceRailGovernor({ rail: 'r', probationBudgetCents: 5000, minAttempts: 100 });
  assert.equal(verdict.nextState, 'DISABLED');
  assert.match(verdict.reason, /probation budget/);
  assert.equal((await getRailState('r')).state, 'DISABLED');
});

test('DISABLED never leaves on its own', async () => {
  await reset();
  await setRailState('r', 'DISABLED', 'spent the budget');
  const verdict = await enforceRailGovernor({ rail: 'r' });
  assert.equal(verdict.nextState, 'DISABLED');
  assert.match(verdict.reason, /manual re-enable/);
});

test('a manual re-enable gives a genuine fresh probation window', async () => {
  await reset();
  // Spend past the budget and let the governor disable it.
  for (let i = 0; i < 6; i += 1) await recordAttempt({ rail: 'r', costCents: 1000 });
  await enforceRailGovernor({ rail: 'r', probationBudgetCents: 5000, minAttempts: 100 });
  assert.equal((await getRailState('r')).state, 'DISABLED');

  // A human re-enables it.
  await setRailEnabled('r', true);
  assert.equal((await getRailState('r')).state, 'PROBATION');

  // The lifetime spend is still $60, well past a $50 budget — but the window
  // resets at re-enable, so the rail must not instantly re-disable.
  const verdict = await evaluateRailGovernor({ rail: 'r', probationBudgetCents: 5000, minAttempts: 100 });
  assert.equal(verdict.nextState, 'PROBATION', 'a fresh probation window must not count pre-reenable spend');
});

test('PROVEN demotes to PROBATION when trailing ROI collapses', async () => {
  await reset();
  await recordAttempt({ rail: 'r', costCents: 100 });
  await recordSettlement({ rail: 'r', source: 'stripe', externalRef: 'txn_old', grossCents: 200, status: SETTLEMENT_STATUS.CLEARED });
  await setRailState('r', 'PROVEN');

  // Heavy new spend with nothing new settling drags the trailing-30-day ROI down.
  for (let i = 0; i < 10; i += 1) await recordAttempt({ rail: 'r', costCents: 5000 });

  const verdict = await enforceRailGovernor({ rail: 'r', demoteRoiThreshold: 1 });
  assert.equal(verdict.nextState, 'PROBATION');
  assert.match(verdict.reason, /trailing 30d ROI/);
});

test('PROVEN promotes to SCALED once lifetime ROI and volume both clear the bar', async () => {
  await reset();
  await setRailState('r', 'PROVEN');
  await recordAttempt({ rail: 'r', costCents: 1000 });
  for (let i = 0; i < 10; i += 1) {
    await recordSettlement({ rail: 'r', source: 'stripe', externalRef: `txn_${i}`, grossCents: 1000, status: SETTLEMENT_STATUS.CLEARED });
  }

  const verdict = await enforceRailGovernor({ rail: 'r', scaleMinSettlements: 10, scaleRoiThreshold: 3 });
  assert.equal(verdict.nextState, 'SCALED');
  assert.equal((await getRailState('r')).state, 'SCALED');
});

test('PROVEN does not promote below the settlement-count floor even at high ROI', async () => {
  await reset();
  await setRailState('r', 'PROVEN');
  await recordAttempt({ rail: 'r', costCents: 100 });
  await recordSettlement({ rail: 'r', source: 'stripe', externalRef: 'txn_1', grossCents: 100000, status: SETTLEMENT_STATUS.CLEARED });

  const verdict = await enforceRailGovernor({ rail: 'r', scaleMinSettlements: 10, scaleRoiThreshold: 3 });
  assert.equal(verdict.nextState, 'PROVEN', 'one huge settlement is not the same as a proven pattern');
});

test('SCALED descales to PROVEN when lifetime ROI falls through the floor', async () => {
  await reset();
  await setRailState('r', 'SCALED');
  await recordAttempt({ rail: 'r', costCents: 10000 });
  await recordSettlement({ rail: 'r', source: 'stripe', externalRef: 'txn_1', grossCents: 1000, status: SETTLEMENT_STATUS.CLEARED });

  const verdict = await enforceRailGovernor({ rail: 'r', descaleRoiThreshold: 2 });
  assert.equal(verdict.nextState, 'PROVEN');
});

test('SCALED stays scaled with no per-rail budget cap', async () => {
  await reset();
  await setRailState('r', 'SCALED');
  for (let i = 0; i < 5; i += 1) {
    await recordSettlement({ rail: 'r', source: 'stripe', externalRef: `txn_${i}`, grossCents: 100000, status: SETTLEMENT_STATUS.CLEARED });
  }
  const verdict = await enforceRailGovernor({ rail: 'r' });
  assert.equal(verdict.nextState, 'SCALED');
  assert.equal(verdict.budgetCents, null, 'scaled rails are bounded by the global cap, not a per-rail figure');
});

test('railEconomics reports the governed state alongside the numbers', async () => {
  await reset();
  await setRailState('proven-rail', 'PROVEN');
  await setRailState('dead-rail', 'DISABLED', 'no settlements');

  const rows = await railEconomics();
  assert.equal(rows.find(r => r.rail === 'proven-rail').state, 'PROVEN');
  const dead = rows.find(r => r.rail === 'dead-rail');
  assert.equal(dead.state, 'DISABLED');
  assert.equal(dead.disabledReason, 'no settlements');
});

test('the global monthly budget aggregates spend across every rail', async () => {
  await reset();
  await setGlobalMonthlyBudget(10000);
  await recordAttempt({ rail: 'a', costCents: 4000 });
  await recordAttempt({ rail: 'b', costCents: 4000 });

  const under = await globalBudgetStatus();
  assert.equal(under.spentCents, 8000);
  assert.equal(under.exceeded, false);

  await recordAttempt({ rail: 'c', costCents: 3000 });
  const over = await globalBudgetStatus();
  assert.equal(over.exceeded, true);
  assert.equal(over.remainingCents, 0);
});

test('a rail that has no state row yet is treated as available, not blocked', async () => {
  await reset();
  assert.equal(await isRailEnabled('never-registered'), true);
});

test('re-enabling increments the probation epoch, and old attempts keep the old one', async () => {
  await reset();
  const { recordAttempt } = await import('../src/money-ledger.js');
  const before = await recordAttempt({ rail: 'r', costCents: 100 });
  assert.equal(before.probationEpoch, 0);

  await setRailState('r', 'DISABLED', 'test');
  await setRailEnabled('r', true);
  assert.equal((await getRailState('r')).probation_epoch, 1);

  const after = await recordAttempt({ rail: 'r', costCents: 100 });
  assert.equal(after.probationEpoch, 1, 'a new attempt is stamped with the rail\'s current epoch');
});

test('two writes landing in the same instant still land in different probation windows', async () => {
  // Regression: a timestamp-boundary implementation can misclassify writes that
  // share a millisecond. Nothing here waits on real time, by design.
  await reset();
  const { recordAttempt, railProbationWindow } = await import('../src/money-ledger.js');
  for (let i = 0; i < 6; i += 1) await recordAttempt({ rail: 'r', costCents: 1000 });
  await enforceRailGovernor({ rail: 'r', probationBudgetCents: 5000, minAttempts: 100 });
  await setRailEnabled('r', true);
  await recordAttempt({ rail: 'r', costCents: 10 });

  const windowed = await railProbationWindow('r');
  assert.equal(windowed.spendCents, 10, 'only the post-reenable attempt counts toward the new window');
  assert.equal(windowed.attempts, 1);

  const verdict = await evaluateRailGovernor({ rail: 'r', probationBudgetCents: 5000, minAttempts: 100 });
  assert.equal(verdict.nextState, 'PROBATION');
});

// ---- settlement lag ----------------------------------------------------------

test('a rail is not disabled for attempts too young to have settled', async () => {
  await reset();
  // The failure this prevents: a seller delivers 30 Fiverr orders in week one.
  // Fiverr clears funds 14 days after completion, so on day seven nothing has
  // arrived — not because the rail is dead, but because it is not due. The
  // governor used to count all 30 as failures, disable the lane, and require a
  // manual re-enable, precisely one week before the first payment.
  const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString();
  for (let i = 0; i < 30; i += 1) {
    await recordAttempt({ rail: 'fiverr', costCents: 1, startedAt: twoDaysAgo });
  }
  const verdict = await evaluateRailGovernor({ rail: 'fiverr', probationBudgetCents: 100_000 });
  assert.notEqual(verdict.nextState, 'DISABLED', 'young attempts are pending, not failed');
  assert.match(verdict.reason, /clearing period/);
});

test('a rail is still disabled once the attempts are genuinely overdue (explicit limit)', async () => {
  await reset();
  // Older than Fiverr's 14-day clearing period, so the money really is absent.
  // We use an explicit minAttempts override here because with no cleared-settlement
  // history the sequential rule correctly cannot derive a break-even rate and falls
  // back to Infinity (unknown reward → can't conclude). The minAttempts override
  // represents operator policy when economics are not yet measurable.
  const longAgo = new Date(Date.now() - 40 * 86_400_000).toISOString();
  for (let i = 0; i < 30; i += 1) {
    await recordAttempt({ rail: 'fiverr', costCents: 1, startedAt: longAgo });
  }
  const verdict = await evaluateRailGovernor({ rail: 'fiverr', probationBudgetCents: 100_000, minAttempts: 25 });
  assert.equal(verdict.nextState, 'DISABLED');
  assert.match(verdict.reason, /zero verified settlements/);
});

test('an unknown rail waits the slowest common term rather than the fastest', async () => {
  await reset();
  const twentyDaysAgo = new Date(Date.now() - 20 * 86_400_000).toISOString();
  for (let i = 0; i < 30; i += 1) {
    await recordAttempt({ rail: 'some-new-rail', costCents: 1, startedAt: twentyDaysAgo });
  }
  // 20 days is past Fiverr's 14 but inside net-30, and being slow to disable
  // costs a little budget where being quick costs the lane.
  const verdict = await evaluateRailGovernor({ rail: 'some-new-rail', probationBudgetCents: 100_000 });
  assert.notEqual(verdict.nextState, 'DISABLED');
});

// ── Sequential stopping rule tests ──────────────────────────────────────────

test('sequentialMinAttempts: zero or negative break-even rate means no attempt limit', () => {
  assert.equal(sequentialMinAttempts(0), Infinity);
  assert.equal(sequentialMinAttempts(-0.1), Infinity);
  assert.equal(sequentialMinAttempts(NaN), Infinity);
});

test('sequentialMinAttempts: break-even >= 1 means structurally unprofitable → floor', () => {
  assert.equal(sequentialMinAttempts(1), MIN_SEQUENTIAL_ATTEMPTS);
  assert.equal(sequentialMinAttempts(2), MIN_SEQUENTIAL_ATTEMPTS);
});

test('sequentialMinAttempts: cheap rail needs far more attempts than expensive one', () => {
  // $0.05 cost, $20 reward → break-even = 0.0025 → needs ~1192 attempts
  const cheap = sequentialMinAttempts(0.0025);
  // $5 cost, $10 reward → break-even = 0.5 → needs only ~5 attempts
  const expensive = sequentialMinAttempts(0.5);
  assert.ok(cheap > expensive, `cheap (${cheap}) should need more attempts than expensive (${expensive})`);
  assert.ok(cheap > 100, `cheap rail (break-even 0.25%) should need >> 100 attempts, got ${cheap}`);
  assert.ok(expensive <= 10, `expensive rail (break-even 50%) should need <= 10 attempts, got ${expensive}`);
});

test('sequentialMinAttempts: enforces the minimum floor regardless of economics', () => {
  // Even an astronomically high break-even rate cannot produce a threshold below the floor
  assert.ok(sequentialMinAttempts(0.99) >= MIN_SEQUENTIAL_ATTEMPTS);
  assert.ok(sequentialMinAttempts(0.9999) >= MIN_SEQUENTIAL_ATTEMPTS);
});

test('sequentialMinAttempts: mathematical property — UCB at threshold is just below break-even', () => {
  const ber = 0.05; // 5% break-even rate
  const n = sequentialMinAttempts(ber);
  const alpha = 0.05;
  // UCB(n) = 1 - alpha^(1/n) should be < ber (we've passed the threshold)
  const ucbAtN = 1 - Math.pow(alpha, 1 / n);
  // UCB(n-1) should be >= ber (we haven't yet passed)
  const ucbAtNMinus1 = n > 1 ? 1 - Math.pow(alpha, 1 / (n - 1)) : 1;
  assert.ok(ucbAtN < ber, `UCB at n=${n} (${ucbAtN.toFixed(4)}) should be < break-even ${ber}`);
  assert.ok(ucbAtNMinus1 >= ber || n === MIN_SEQUENTIAL_ATTEMPTS,
    `UCB at n-1 (${ucbAtNMinus1.toFixed(4)}) should be >= break-even, or n is at floor`);
});

test('breakEvenRateFor: returns null when no attempts have been made', () => {
  assert.equal(breakEvenRateFor({ attempts: 0, spendCents: 0 }), null);
  assert.equal(breakEvenRateFor(null), null);
  assert.equal(breakEvenRateFor({}), null);
});

test('breakEvenRateFor: computes correctly from cleared settlement data', () => {
  // $0.05/attempt cost, 1 win in 100 attempts paying $20 → BER = 0.05/20 = 0.0025
  const ber = breakEvenRateFor({
    attempts: 100,
    spendCents: 500,         // $0.05 × 100
    clearedCount: 1,
    clearedCents: 2000,      // $20 per win
    valuePerAttemptCents: 20
  });
  assert.ok(Number.isFinite(ber), 'should return a finite number');
  assert.ok(Math.abs(ber - 0.0025) < 0.0001, `expected ~0.0025, got ${ber}`);
});

test('breakEvenRateFor: clamps result to [0, 1]', () => {
  // cost > reward → break-even > 1 → clamped to 1
  const ber = breakEvenRateFor({ attempts: 10, spendCents: 1000, clearedCount: 1, clearedCents: 50 });
  assert.ok(ber !== null && ber <= 1, `expected <= 1, got ${ber}`);
});

test('governor: sequential rule without history keeps rail on probation (economics unknown → Infinity threshold)', async () => {
  await reset();
  // No attempts at all — breakEvenRateFor returns null → effectiveMin = Infinity
  const verdict = await evaluateRailGovernor({ rail: 'brand-new', probationBudgetCents: 100_000 });
  assert.equal(verdict.nextState, 'PROBATION');
  assert.ok(verdict.sequentialTest.effectiveMinAttempts === Infinity,
    'no economic history → infinite threshold');
});

test('governor: explicit minAttempts override still works (backward compat)', async () => {
  await reset();
  const longAgo = new Date(Date.now() - 40 * 86_400_000).toISOString();
  for (let i = 0; i < 30; i++) {
    await recordAttempt({ rail: 'old-style', costCents: 1, startedAt: longAgo });
  }
  const verdict = await evaluateRailGovernor({
    rail: 'old-style', probationBudgetCents: 100_000, minAttempts: 100
  });
  // 30 < 100 → stays on probation with explicit override
  assert.equal(verdict.nextState, 'PROBATION');
});
