import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VENUES, PAYOUT_COST, netOf, isReachable, venueOptions, minimumViableTicket, CONFIDENCE
} from '../income/venues.js';

test('algora is closed by its terms, not by its border', () => {
  // This assertion previously claimed the opposite, and the claim was wrong. It
  // read "Stripe is invite-only in India" and concluded the payout could not
  // arrive — conflating standalone Stripe, where you are your own merchant, with
  // Stripe Connect Express, where a platform pays you. They are different
  // products with different availability, and the second one reaches India.
  //
  // The conclusion happened to survive: Algora is still closed to this system,
  // because its terms prohibit robotic access. But it was being held up by a
  // reason that was not true, which made it look better established than it was.
  const algora = VENUES.find(v => v.key === 'algora');
  assert.ok(algora.paysTo.includes('IN'), 'the money can reach India over Connect Express');
  assert.equal(algora.requiresBusinessEntity, false, 'an individual can be paid');

  const { reachable, blockers } = isReachable(algora, { country: 'IN' });
  assert.equal(reachable, false, 'still closed — on the terms');
  assert.ok(blockers.some(b => /robotic access/.test(b)));
  assert.equal(blockers.some(b => /does not pay out to IN/.test(b)), false,
    'must not still claim the border blocks it');
});

test('the same venue can be open somewhere else', () => {
  const algora = VENUES.find(v => v.key === 'algora');
  // Reachability is a property of the pair, not of the venue. Recording it that
  // way is what makes moving country a data change rather than a rewrite.
  assert.equal(isReachable({ ...algora, rejected: undefined, paysTo: ['US'],
    requiresBusinessEntity: false, agentPolicy: 'unrestricted' }, { country: 'US' }).reachable, true);
});

test('fixed fees, not percentages, are what make small tickets unviable', () => {
  // "Do many small jobs" is sound about effort and wrong about payments: the
  // percentage is constant, the fixed component is not, and below a floor the
  // rail eats the ticket. A machine doing a thousand of them loses faster.
  const small = netOf(200, 'paypal:IN');
  const large = netOf(10_000, 'paypal:IN');
  assert.ok(small.takeRatePct > 20, `a $2 ticket loses ${small.takeRatePct}%`);
  assert.ok(large.takeRatePct < 9);
  assert.ok(small.takeRatePct > large.takeRatePct * 2);
});

test('the minimum viable ticket is derived from the rail, not chosen', () => {
  const floor = minimumViableTicket('paypal:IN', { maxTakeRatePct: 10 });
  assert.ok(floor > 1000 && floor < 2000, `expected roughly $14, got ${floor}`);
  assert.ok(netOf(floor, 'paypal:IN').takeRatePct <= 10);
});

test('a ceiling below the rail percentage is impossible at any size, and says so', () => {
  // PayPal India charges 4.4% plus a 3-4% conversion markup, so nothing reaches
  // a 5% take rate however large it is. Returning null rather than a number
  // stops a caller quietly rendering "$0.00" as an achievable floor.
  assert.equal(minimumViableTicket('paypal:IN', { maxTakeRatePct: 5 }), null);
});

test('an unknown rail returns null rather than guessing a fee', () => {
  assert.equal(netOf(2000, 'crypto:XX'), null);
  assert.equal(minimumViableTicket('crypto:XX'), null);
});

test('every venue records how its claim was established', () => {
  // The HN ranking moat was asserted as verified, was not, and was false. Each
  // claim here carries its provenance so the same mistake is visible.
  for (const venue of VENUES) {
    assert.ok(Object.values(CONFIDENCE).includes(venue.confidence), venue.key);
    assert.ok(venue.evidence && venue.evidence.length > 20, `${venue.key} needs real evidence`);
  }
});

test('the report leads with what can pay, not with the biggest market', () => {
  const options = venueOptions({ country: 'IN' });
  assert.ok(options.open.length >= 1);
  assert.ok(options.open.every(v => v.reachable));
  assert.ok(options.closed.every(v => !v.reachable));
  assert.match(options.summary, /open to an individual in IN/);
});

// ---- rejected on merits is not the same as unreachable ----------------------

test('a lane that passes every reachability test can still be rejected', async () => {
  const { venueOptions, isReachable, VENUES } = await import('../income/venues.js');
  // DeFi arbitrage pays to India, needs no company, and welcomes agents — every
  // reachability test passes. It is still a bad lane: the spread closes before a
  // public RPC answers, and it is the only lane here that loses money on a failed
  // attempt rather than earning none. A model that only asks "can the money
  // arrive" would rank it open.
  const defi = VENUES.find(v => v.key === 'defi-arbitrage');
  assert.ok(defi.paysTo.includes('IN'));
  assert.equal(defi.requiresBusinessEntity, false);
  assert.notEqual(defi.agentPolicy, 'prohibited');
  assert.equal(isReachable(defi, { country: 'IN' }).reachable, false, 'rejection must close it');

  const options = venueOptions({ country: 'IN' });
  assert.ok(options.rejected.some(v => v.key === 'defi-arbitrage'));
  // Every declared venue can now reach India, so unreachability is asserted on a
  // constructed case rather than pretending one of these still cannot be paid.
  assert.equal(isReachable({ paysTo: ['US'], requiresBusinessEntity: false, agentPolicy: 'unrestricted' },
    { country: 'IN' }).reachable, false);
  assert.equal(options.open.some(v => v.key === 'defi-arbitrage'), false);
});

test('the two reasons a lane is unavailable are reported separately', async () => {
  const { venueOptions } = await import('../income/venues.js');
  const options = venueOptions({ country: 'IN' });
  // "Cannot pay you" and "not worth doing" call for different responses: one may
  // change if you move or incorporate, the other will not.
  // Only the halves that apply are printed, so assert on what the data supports.
  assert.match(options.summary, /rejected on merits/);
  assert.match(options.summary, /open to an individual/);
});

test('the crypto rail carries the tax that lands before the money is spendable', async () => {
  const { netOf } = await import('../income/venues.js');
  // India taxes virtual digital asset gains at a flat 30% with 1% TDS and no
  // loss set-off. Modelling it as a rail cost is what makes a $30/month compute
  // lane show as $20.70, which is the number worth comparing against electricity.
  const net = netOf(3000, 'crypto:IN');
  assert.equal(net.takeRatePct, 31);
  assert.ok(net.netCents < 2100);
});
