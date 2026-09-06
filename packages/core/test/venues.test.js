import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VENUES, PAYOUT_COST, netOf, isReachable, venueOptions, minimumViableTicket, CONFIDENCE
} from '../income/venues.js';

test('a venue that cannot pay an individual in this country is closed, whatever it lists', () => {
  // Algora carries the largest bounty volume of the three and is the one that
  // cannot pay. Stripe is invite-only in India, skewed to registered businesses
  // rather than individuals, and Algora's terms prohibit robotic access. Either
  // alone is fatal; job volume does not enter into it.
  const algora = VENUES.find(v => v.key === 'algora');
  const { reachable, blockers } = isReachable(algora, { country: 'IN' });
  assert.equal(reachable, false);
  assert.ok(blockers.some(b => /does not pay out to IN/.test(b)));
  assert.ok(blockers.some(b => /business entity/.test(b)));
  assert.ok(blockers.some(b => /prohibit automated/.test(b)));
});

test('the same venue can be open somewhere else', () => {
  const algora = VENUES.find(v => v.key === 'algora');
  // Reachability is a property of the pair, not of the venue. Recording it that
  // way is what makes moving country a data change rather than a rewrite.
  assert.equal(isReachable({ ...algora, paysTo: ['US'], requiresBusinessEntity: false, agentPolicy: 'unrestricted' },
    { country: 'US' }).reachable, true);
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
  assert.ok(options.unreachable.some(v => v.key === 'algora'));
  assert.equal(options.open.some(v => v.key === 'defi-arbitrage'), false);
});

test('the two reasons a lane is unavailable are reported separately', async () => {
  const { venueOptions } = await import('../income/venues.js');
  const options = venueOptions({ country: 'IN' });
  // "Cannot pay you" and "not worth doing" call for different responses: one may
  // change if you move or incorporate, the other will not.
  assert.match(options.summary, /cannot pay/);
  assert.match(options.summary, /rejected on merits/);
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
