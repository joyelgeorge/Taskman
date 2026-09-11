import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createBountyScraperRail, BOUNTY_SCRAPER_RAIL_NAME } from '../src/rails/bounty-scraper-rail.js';
import { initializeRails } from '../src/rails/index.js';
import { getRail } from '../src/rails/registry.js';

describe('Bounty Scraper Rail with Custom AI', () => {
  it('normalizes incoming raw opportunity listings properly', () => {
    const rail = createBountyScraperRail();
    const normalized = rail.normalizeListing({
      repo: 'owner/project',
      issueNumber: '99',
      title: 'Bug in payment webhook',
      rewardUsd: '75',
      hasEscrow: 1
    });

    assert.equal(normalized.repo, 'owner/project');
    assert.equal(normalized.issueNumber, 99);
    assert.equal(normalized.title, 'Bug in payment webhook');
    assert.equal(normalized.rewardUsd, 75);
    assert.equal(normalized.hasEscrow, true);
  });

  it('runs discovery on feed items and attaches AI triage results', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      return {
        ok: true,
        json: async () => ({
          model: 'taskman-ai:latest',
          message: {
            role: 'assistant',
            content: JSON.stringify({
              decision: 'ENTER',
              feasibilityScore: 0.9,
              estimatedPayoutUsd: 150,
              trapDetected: false,
              reasons: ['Escrow funded', 'Clear unit test requirement']
            })
          },
          prompt_eval_count: 50,
          eval_count: 30,
          total_duration: 50000000
        })
      };
    };

    try {
      const rail = createBountyScraperRail({ model: 'taskman-ai:latest' });
      const sampleFeed = [
        {
          repo: 'facebook/react',
          issueNumber: 101,
          title: 'Fix hydration mismatch with suspense boundary',
          rewardUsd: 150,
          hasEscrow: true
        }
      ];

      const res = await rail.discover(sampleFeed);
      assert.equal(res.ok, true);
      assert.equal(res.count, 1);
      assert.equal(res.opportunities[0].triage.ok, true);
      assert.equal(res.opportunities[0].triage.evaluation.decision, 'ENTER');
      assert.equal(res.opportunities[0].triage.evaluation.estimatedPayoutUsd, 150);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('verifies candidate before execution approval', async () => {
    const rail = createBountyScraperRail();
    const verification = await rail.verify({ id: 'opp-candidate-1' });
    assert.equal(verification.ok, true);
    assert.equal(verification.candidateId, 'opp-candidate-1');
  });
});
