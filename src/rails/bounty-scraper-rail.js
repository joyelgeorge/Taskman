import { RailAdapter, RAIL_MODE } from './base.js';
import { callOllama } from '../adapters/ollama-adapter.js';
import { MONEY_DOMAINS, buildMoneyPrompt, evaluateMoneyAiOutput } from '../ai-engine/money-making-agent.js';
import { recordDatasetEntry } from '../ai-engine/dataset-collector.js';

export const BOUNTY_SCRAPER_RAIL_NAME = 'bounty_scraper';

export class BountyScraperRail extends RailAdapter {
  constructor({
    name = BOUNTY_SCRAPER_RAIL_NAME,
    mode = RAIL_MODE.READ_ONLY,
    model = 'taskman-ai:latest',
    ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434'
  } = {}) {
    super({ name, mode });
    this.model = model;
    this.ollamaBaseUrl = ollamaBaseUrl;
  }

  /**
   * Scrapes / normalizes incoming raw opportunity listings.
   */
  normalizeListing(raw) {
    return {
      id: raw.id || `opp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      platform: raw.platform || 'GitHub',
      repo: raw.repo || 'unknown/repo',
      issueNumber: Number(raw.issueNumber) || 0,
      title: String(raw.title || '').trim(),
      description: String(raw.description || '').trim(),
      rewardUsd: Number(raw.rewardUsd) || 0,
      hasEscrow: Boolean(raw.hasEscrow),
      createdAt: raw.createdAt || new Date().toISOString()
    };
  }

  /**
   * AI-powered triage and gate evaluation using the local taskman-ai model.
   */
  async triageWithAi(listing, { signal } = {}) {
    const { systemPrompt, userPrompt } = buildMoneyPrompt({
      domain: MONEY_DOMAINS.OPPORTUNITY_TRIAGE,
      objective: `Evaluate feasibility and risk of ${listing.platform} opportunity #${listing.issueNumber}`,
      context: listing
    });

    try {
      const response = await callOllama({
        prompt: userPrompt,
        systemPrompt,
        model: this.model,
        baseUrl: this.ollamaBaseUrl,
        format: 'json',
        temperature: 0.1,
        signal
      });

      const evaluation = evaluateMoneyAiOutput(MONEY_DOMAINS.OPPORTUNITY_TRIAGE, response.text);

      // Record to training dataset
      recordDatasetEntry({
        domain: MONEY_DOMAINS.OPPORTUNITY_TRIAGE,
        systemPrompt,
        prompt: userPrompt,
        response: response.text,
        outcomeScore: evaluation.ok ? 0.9 : 0.4,
        metadata: { model: this.model, listingId: listing.id }
      });

      return {
        ok: true,
        aiEvaluated: true,
        evaluation
      };
    } catch (err) {
      return {
        ok: false,
        aiEvaluated: false,
        error: err.message
      };
    }
  }

  /**
   * Discover and filter opportunities.
   */
  async discover(sampleFeed = []) {
    const results = [];
    for (const raw of sampleFeed) {
      const listing = this.normalizeListing(raw);
      const triage = await this.triageWithAi(listing);
      results.push({
        ...listing,
        triage
      });
    }

    return {
      ok: true,
      rail: this.name,
      mode: this.mode,
      count: results.length,
      opportunities: results
    };
  }

  /**
   * Verify an opportunity before candidate generation.
   */
  async verify(candidate) {
    if (!candidate || !candidate.id) {
      throw new Error('Invalid candidate for verification');
    }
    return {
      ok: true,
      verifiedAt: new Date().toISOString(),
      candidateId: candidate.id
    };
  }
}

export function createBountyScraperRail(opts = {}) {
  return new BountyScraperRail(opts);
}
