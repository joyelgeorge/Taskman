import { listRevenueRecords } from './revenue-store.js';
import { CANONICAL_QUEUES } from './orchestration-profiles.js';

export const PIPELINE_HEALTH_STATUS = Object.freeze({
  HEALTHY: 'HEALTHY',
  DEGRADED: 'DEGRADED',
  STALLED: 'STALLED'
});

/**
 * Computes pipeline health, queue depth, stage latencies, and stall alerts.
 */
export async function getPipelineObservabilitySummary({ maxStallMinutes = 120 } = {}) {
  const candidateItems = await listRevenueRecords(CANONICAL_QUEUES.candidates, { limit: 100 });
  const validationItems = await listRevenueRecords(CANONICAL_QUEUES.validation, { limit: 100 });
  const executionItems = await listRevenueRecords(CANONICAL_QUEUES.execution, { limit: 100 });
  const outcomeItems = await listRevenueRecords(CANONICAL_QUEUES.outcomes, { limit: 100 });
  const inferenceItems = await listRevenueRecords(CANONICAL_QUEUES.inference, { limit: 100 });

  const now = Date.now();
  const stalls = [];

  // Check for items stuck in queues beyond threshold
  const checkStall = (items, stage) => {
    for (const item of items) {
      if (item.status === 'NEW' || item.status === 'CLAIMED' || item.status === 'IN_PROGRESS') {
        const itemTimeStr = (item.payload && (item.payload.stalledSince || item.payload.createdAt)) || item.updatedAt || item.createdAt;
        const itemTimestamp = itemTimeStr ? new Date(itemTimeStr).getTime() : NaN;
        const ageMinutes = !isNaN(itemTimestamp) ? (now - itemTimestamp) / 60_000 : 0;
        if (ageMinutes > maxStallMinutes) {
          stalls.push({
            stage,
            recordId: item.id,
            noveltyKey: item.noveltyKey,
            ageMinutes: Math.round(ageMinutes),
            status: item.status
          });
        }
      }
    }
  };

  checkStall(candidateItems, 'DISCOVER/CANDIDATES');
  checkStall(validationItems, 'VALIDATE');
  checkStall(executionItems, 'EXECUTE');

  const status = stalls.length > 0 ? PIPELINE_HEALTH_STATUS.STALLED : PIPELINE_HEALTH_STATUS.HEALTHY;

  return {
    status,
    checkedAt: new Date().toISOString(),
    queueDepth: {
      candidates: candidateItems.length,
      validation: validationItems.length,
      execution: executionItems.length,
      outcomes: outcomeItems.length,
      inference: inferenceItems.length
    },
    activeStalls: stalls,
    totalRecordsTracked: candidateItems.length + validationItems.length + executionItems.length + outcomeItems.length + inferenceItems.length
  };
}
