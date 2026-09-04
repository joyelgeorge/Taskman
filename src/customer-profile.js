export const FIRST_PAYING_CUSTOMER_PROFILE = Object.freeze({
  customerType: 'Boutique digital agency owners & Top-Rated / Fiverr Pro freelance studios',
  decisionMakerRole: 'Agency Founder / Sole Proprietor / Managing Partner',
  monthlyVolumeThresholdCents: 300000, // $3,000 / mo min
  currentWorkaround: 'Manual CSV export to Excel/Sheets (4-8 hours/mo)',
  workaroundCostMonthlyCents: 25000, // ~$250/mo in founder time + unrecorded tax deductions
  buyingTriggers: [
    'Month-end bank deposit discrepancy',
    'Quarterly/annual tax preparation fee breakdown request',
    'Unexplained withdrawal deduction or chargeback alert'
  ],
  pricingHypothesisCents: 1900, // $19 / mo
  pricingPerBatchCents: 200,   // $2 / batch
  minimumRoiMultiple: 3.0,
  prospectChannels: [
    'Fiverr Community Forum',
    'r/Fiverr',
    'r/freelance',
    'Fiverr Top Rated Sellers Facebook Group',
    'Digital Freelancer Discord Community',
    'Upwork & Fiverr Agency Hub (LinkedIn)',
    'QuickBooks Community Forums',
    'Indie Hackers Freelancing Group',
    'Fiverr Seller Meetups',
    'YouTube Fiverr Tax Prep Channels'
  ]
});

/**
 * Qualifies whether an inbound prospect matches the first paying customer profile.
 */
export function qualifyProspect({
  monthlyVolumeCents = 0,
  platform = 'fiverr',
  manualHoursMonthly = 4,
  strugglesWithDiscrepancies = true
} = {}) {
  const isFiverr = String(platform).toLowerCase().includes('fiverr');
  const meetsVolume = monthlyVolumeCents >= FIRST_PAYING_CUSTOMER_PROFILE.monthlyVolumeThresholdCents;
  const highBurden = manualHoursMonthly >= 3;

  let score = 0;
  if (isFiverr) score += 40;
  if (meetsVolume) score += 30;
  if (highBurden) score += 20;
  if (strugglesWithDiscrepancies) score += 10;

  const qualified = score >= 70;
  const estimatedAnnualSavingsCents = Math.round((manualHoursMonthly * 40 * 12 * 100) + 40000); // Time + $400 fee deductions
  const subscriptionAnnualCostCents = FIRST_PAYING_CUSTOMER_PROFILE.pricingHypothesisCents * 12;
  const estimatedRoi = subscriptionAnnualCostCents > 0
    ? (estimatedAnnualSavingsCents / subscriptionAnnualCostCents).toFixed(1)
    : '0';

  return {
    qualified,
    qualificationScore: score,
    targetTier: qualified ? 'PRO_AGENCY' : 'STANDARD_FREELANCER',
    recommendation: qualified
      ? 'High priority prospect: offer instant free 30-day statement trial reconciliation'
      : 'Below volume threshold: route to self-serve pay-per-batch option',
    estimatedAnnualSavingsCents,
    estimatedRoiMultiple: `${estimatedRoi}x`
  };
}
