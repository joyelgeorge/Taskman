import { FIRST_PAYING_CUSTOMER_PROFILE, qualifyProspect } from './customer-profile.js';
import { COMMERCIAL_WEDGE_SPEC } from './commercial-wedge.js';

export const PRIMARY_ACQUISITION_CHANNEL = Object.freeze({
  channelId: 'fiverr_community_and_subreddits_outbound',
  name: 'Fiverr Community & Freelance Agency Hubs (r/Fiverr, Top Rated Forums)',
  channelType: 'targeted_direct_outreach',
  wedgeId: COMMERCIAL_WEDGE_SPEC.id,
  targetProfile: FIRST_PAYING_CUSTOMER_PROFILE.customerType,
  primaryValueProposition: 'Audit unrecorded Fiverr platform fees & resolve month-end bank withdrawal discrepancies in under 3 minutes.',
  outreachAsset: {
    headline: 'Stop guessing why your Fiverr withdrawal didn\'t match your bank deposit.',
    copy: 'Hey! If you\'re managing multiple Fiverr orders a month, you know how confusing month-end bank payouts get with currency conversion variances and unitemized fees. We built an automated reconciliation tool that audits your statements directly against your bank deposits and gives you an instant, tax-ready fee breakdown so you don\'t leave hundreds in tax write-offs on the table. Free 30-day statement audit here: [Link]'
  }
});

export const FUNNEL_STAGES = Object.freeze([
  'PROSPECT_SOURCED',
  'CONTACTED',
  'QUALIFIED',
  'DEMO_TRIAL',
  'VALUE_PROVEN',
  'PAID',
  'RETAINED',
  'REFERRAL'
]);

// In-memory prospect ledger
const prospectStore = new Map(); // prospectId -> prospectRecord
const channelExperiments = new Map(); // experimentId -> experimentRecord

/**
 * Creates or updates a prospect in the acquisition funnel.
 */
export function recordProspect({
  prospectId,
  name,
  channel = PRIMARY_ACQUISITION_CHANNEL.channelId,
  messageVersion = 'v1_direct_outreach',
  platform = 'Fiverr',
  monthlyVolumeCents = 350000,
  manualHoursMonthly = 5,
  sourceUrl = '',
  referredBy = null,
  notes = ''
} = {}) {
  if (!prospectId || typeof prospectId !== 'string') {
    throw new Error('prospectId is required');
  }

  const qualification = qualifyProspect({
    monthlyVolumeCents,
    platform,
    manualHoursMonthly,
    strugglesWithDiscrepancies: true
  });

  const prospect = {
    prospectId,
    name: name || prospectId,
    channel,
    messageVersion,
    platform,
    monthlyVolumeCents,
    manualHoursMonthly,
    sourceUrl,
    referredBy: referredBy || null,
    stage: qualification.qualified ? 'QUALIFIED' : 'PROSPECT_SOURCED',
    qualification,
    objections: [],
    history: [
      {
        stage: qualification.qualified ? 'QUALIFIED' : 'PROSPECT_SOURCED',
        timestamp: new Date().toISOString(),
        note: `Initial intake recorded via ${channel}`
      }
    ],
    timeSpentMinutes: 0,
    acquisitionCostCents: 0,
    trialCompletedAt: null,
    valueProvenAt: null,
    convertedAt: null,
    firstMonthRevenueCents: 0
  };

  prospectStore.set(prospectId, prospect);
  return prospect;
}

/**
 * Advances or transitions a prospect's funnel stage, recording objections or conversion.
 */
export function advanceProspectStage({
  prospectId,
  toStage,
  objection = null,
  timeSpentMinutes = 0,
  acquisitionCostCents = 0,
  revenueCollectedCents = 0,
  note = ''
} = {}) {
  const prospect = prospectStore.get(prospectId);
  if (!prospect) throw new Error(`Prospect '${prospectId}' not found`);

  if (!FUNNEL_STAGES.includes(toStage)) {
    throw new Error(`Invalid stage '${toStage}'. Allowed: ${FUNNEL_STAGES.join(', ')}`);
  }

  prospect.stage = toStage;
  prospect.timeSpentMinutes += Math.max(0, Number(timeSpentMinutes) || 0);
  prospect.acquisitionCostCents += Math.max(0, Number(acquisitionCostCents) || 0);

  if (toStage === 'DEMO_TRIAL') {
    prospect.trialCompletedAt = new Date().toISOString();
  } else if (toStage === 'VALUE_PROVEN') {
    prospect.valueProvenAt = new Date().toISOString();
  } else if (toStage === 'PAID') {
    prospect.convertedAt = new Date().toISOString();
    prospect.firstMonthRevenueCents += Math.max(0, Number(revenueCollectedCents) || 1900);
  }

  if (objection && typeof objection === 'string') {
    prospect.objections.push({
      stage: toStage,
      objection,
      recordedAt: new Date().toISOString()
    });
  }

  prospect.history.push({
    stage: toStage,
    timestamp: new Date().toISOString(),
    note: note || `Stage advanced to ${toStage}`
  });

  return prospect;
}

/**
 * Returns metrics, CAC, payback, and conversion summary across the acquisition engine.
 */
export function getFunnelMetrics() {
  const total = prospectStore.size;
  const stageCounts = Object.fromEntries(FUNNEL_STAGES.map(s => [s, 0]));
  let totalTimeSpentMinutes = 0;
  let totalCostCents = 0;
  let paidCount = 0;
  let trialCount = 0;
  let valueProvenCount = 0;
  let referralCount = 0;
  let totalRevenueCents = 0;
  const recordedObjections = [];

  for (const p of prospectStore.values()) {
    if (stageCounts[p.stage] !== undefined) stageCounts[p.stage] += 1;
    totalTimeSpentMinutes += p.timeSpentMinutes;
    totalCostCents += p.acquisitionCostCents;
    totalRevenueCents += p.firstMonthRevenueCents;

    if (p.trialCompletedAt || p.stage === 'DEMO_TRIAL') trialCount += 1;
    if (p.valueProvenAt || p.stage === 'VALUE_PROVEN') valueProvenCount += 1;
    if (p.convertedAt || p.stage === 'PAID') paidCount += 1;
    if (p.referredBy) referralCount += 1;

    for (const obj of p.objections) {
      recordedObjections.push({
        prospectId: p.prospectId,
        channel: p.channel,
        messageVersion: p.messageVersion,
        ...obj
      });
    }
  }

  const conversionRate = total > 0 ? ((paidCount / total) * 100).toFixed(1) + '%' : '0.0%';
  const cacCents = paidCount > 0 ? Math.round(totalCostCents / paidCount) : totalCostCents;
  const paybackMonths = paidCount > 0 && totalRevenueCents > 0
    ? (totalCostCents / totalRevenueCents).toFixed(1)
    : 'N/A';

  return {
    channel: PRIMARY_ACQUISITION_CHANNEL.name,
    totalProspects: total,
    stageCounts,
    trialCount,
    valueProvenCount,
    paidCount,
    referralCount,
    conversionRate,
    cacCents,
    paybackMonths,
    totalTimeSpentMinutes,
    totalCostCents,
    totalRevenueCents,
    recordedObjections
  };
}

/**
 * Resets funnel store (for tests).
 */
export function _resetAcquisitionFunnelState() {
  prospectStore.clear();
  channelExperiments.clear();
}
