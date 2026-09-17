import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PERSPECTIVE, generateCandidates, pruneRefuted, scoreByAgreement, promote, VERDICT_STATE
} from '../packages/core/creative/hypothesis.js';

/**
 * The Creative Engine: contrasting perspectives instead of one median heuristic,
 * with symbolic pruning before anything reaches a human.
 *
 * Motivating failure (2026-09-15): a naive "is there an auth word in this file"
 * heuristic reported 6 of 6 admin routes unauthenticated. All six called
 * requireSuperAdmin() via an imported helper. One perspective cannot see its own
 * blind spot; a contrasting one can.
 */

const adversarial = { perspective: PERSPECTIVE.ADVERSARIAL, claim: 'unauthenticated-admin-route', target: 'routes/admin.ts', confidence: 0.8 };
const defensive   = { perspective: PERSPECTIVE.DEFENSIVE,   claim: 'guarded-by-helper',          target: 'routes/admin.ts', confidence: 0.9 };

test('candidates carry the perspective that produced them', () => {
  const out = generateCandidates('routes/admin.ts', {
    pipelines: { [PERSPECTIVE.ADVERSARIAL]: () => [adversarial] }
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].perspective, PERSPECTIVE.ADVERSARIAL);
});

test('a candidate refuted by symbolic evidence is pruned before any human sees it', () => {
  // The AST says a guard helper is called — that REFUTES the unauthenticated claim.
  const kept = pruneRefuted([adversarial], { 'routes/admin.ts': { callsGuardHelper: true } });
  assert.deepEqual(kept, [], 'symbolic evidence must kill the false positive at the source');
});

test('a candidate the evidence does not refute survives', () => {
  const kept = pruneRefuted([adversarial], { 'routes/admin.ts': { callsGuardHelper: false } });
  assert.equal(kept.length, 1);
});

test('agreement across perspectives raises confidence', () => {
  const second = { ...adversarial, perspective: PERSPECTIVE.REACHABILITY, claim: 'unauthenticated-admin-route' };
  const scored = scoreByAgreement([adversarial, second]);
  assert.equal(scored[0].state, VERDICT_STATE.CORROBORATED);
  assert.ok(scored[0].agreement >= 2);
});

test('DISAGREEMENT is surfaced, not averaged away — this is the whole point', () => {
  const scored = scoreByAgreement([adversarial, defensive]);
  const contested = scored.find(s => s.state === VERDICT_STATE.CONTESTED);
  assert.ok(contested, 'two perspectives making opposing claims about one target must be flagged CONTESTED');
  assert.equal(contested.target, 'routes/admin.ts');
});

test('a contested candidate is never auto-promoted — it goes to a human', () => {
  const scored = scoreByAgreement([adversarial, defensive]);
  const promoted = promote(scored);
  assert.equal(promoted.length, 0, 'contested findings must not reach outreach automatically');
});

test('a corroborated, unrefuted candidate is promoted', () => {
  const second = { ...adversarial, perspective: PERSPECTIVE.REACHABILITY };
  const promoted = promote(scoreByAgreement([adversarial, second]));
  assert.equal(promoted.length, 1);
  assert.equal(promoted[0].state, VERDICT_STATE.CORROBORATED);
});

test('a lone unopposed candidate is promoted but marked single-source', () => {
  const scored = scoreByAgreement([adversarial]);
  assert.equal(scored[0].state, VERDICT_STATE.SINGLE_SOURCE);
  assert.equal(promote(scored).length, 1);
});
