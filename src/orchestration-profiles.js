export const CANONICAL_QUEUES = Object.freeze({
  candidates: 'candidate_queue',
  validation: 'validation_queue',
  execution: 'execution_queue',
  outcomes: 'economic_outcomes',
  inference: 'learning_inference',
  actionable_work: 'actionable_work'
});

export const LEGACY_QUEUE_ALIASES = Object.freeze({
  revenue_exploration_queue: CANONICAL_QUEUES.candidates,
  revenue_opportunity_deepdives: CANONICAL_QUEUES.validation,
  revenue_execution_results: CANONICAL_QUEUES.outcomes,
  revenue_scan_inference: CANONICAL_QUEUES.inference
});

// 'structural_money_flow' (an anchor file the system wrote to itself) and
// 'model_inference' (an LLM asked to originate a candidate) were removed here.
// Both are exactly the closed loop documented in docs/SYSTEM_DESIGN.md §9 and
// the discovery invariant in docs/TARGET_DESIGN.md §1: discovery must be
// deterministic, and a source that reads the system's own prior output is not
// a source. See src/workers/discover.js and packages/core/drones for the
// deterministic collector layer that replaced them.
export const DISCOVERY_SOURCES = Object.freeze({
  recent_events: { profile: 'programmable_money_flow_v1' },
  credible_writers: { profile: 'programmable_money_flow_v1' },
  bounty: { profile: 'bounty_execution_v1' },
  immediate_income: { profile: 'immediate_income_v1' }
});

export const QUALIFICATION_PROFILES = Object.freeze({
  programmable_money_flow_v1: {
    passStatus: 'THRESHOLD_CROSSED',
    evidenceGates: [
      'money_flow_scale',
      'recurring_leakage',
      'independent_trigger',
      'permission_non_invasive',
      'measurable_delta',
      'monetization',
      'no_transaction_ownership',
      'competitive_whitespace'
    ],
    weights: {
      flowScale: 1.2,
      recurrence: 1.0,
      triggerIndependence: 1.25,
      permission: 1.15,
      deltaMeasurability: 1.15,
      monetization: 1.0,
      executionAutonomy: 1.0,
      competitiveWhitespace: 1.2,
      setupBurden: -0.7,
      timeToMoney: 0.5
    },
    threshold: 7.4,
    hardGates: [
      'flowScale','recurrence','triggerIndependence','permission',
      'deltaMeasurability','monetization','executionAutonomy','competitiveWhitespace'
    ]
  },
  bounty_execution_v1: {
    passStatus: 'EXECUTABLE',
    evidenceGates: [
      'payer_reward',
      'funding_credibility',
      'deliverable',
      'acceptance_criteria',
      'eligibility',
      'claim_risk',
      'submission_route',
      'payout_path',
      'fees',
      'setup_requirements',
      'post_setup_autonomy'
    ],
    weights: {
      payoutCertainty: 1.3,
      acceptanceClarity: 1.15,
      executionAutonomy: 1.25,
      reusableRail: 1.0,
      setupBurden: -0.8,
      timeToMoney: 1.1,
      competitionRisk: -0.7
    },
    threshold: 7.0,
    hardGates: ['payoutCertainty','acceptanceClarity','executionAutonomy']
  },
  immediate_income_v1: {
    passStatus: 'EXECUTABLE',
    evidenceGates: [
      'payer_demand',
      'deliverable',
      'payment_certainty',
      'delivery_route',
      'time_to_first_money',
      'post_setup_autonomy',
      'no_recurring_manual_work'
    ],
    weights: {
      payerExists: 1.35,
      payoutCertainty: 1.2,
      submissionPath: 1.3,
      executionAutonomy: 1.25,
      reusableRail: 0.9,
      setupBurden: -0.8,
      timeToMoney: 1.2
    },
    threshold: 7.2,
    hardGates: ['payerExists','payoutCertainty','submissionPath','executionAutonomy']
  }
});

export function resolveQueueName(name) {
  return LEGACY_QUEUE_ALIASES[name] || name;
}

export { getRuntimeCapabilityMap as capabilitySnapshot } from './capability-registry.js';
