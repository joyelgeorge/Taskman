/**
 * The shape a revenue job is written in.
 *
 * Every wedge this project has built was a hand-written module — audit
 * fulfilment, scan fulfilment — the same shape twice with no shared contract, so
 * a third meant a third place for a gate to be forgotten. This is that contract,
 * and it lives beside the territory registry because the registry is already the
 * single list of lanes and did not need a fifth concept next to it.
 *
 * Two rules are structural rather than advisory:
 *
 *   A job that can CHARGE must be able to VERIFY. Money may not be taken for an
 *   outcome nothing checked. The runner enforces this at execution; refusing the
 *   shape means the mistake cannot be written down in the first place.
 *
 *   A stage the runner does not know is refused, not ignored. Silently skipping
 *   an unrecognised stage is how a job comes to look complete while doing less
 *   than it says.
 *
 * A descriptor with no stages at all is perfectly valid: it is a territory we
 * have an opinion about and have not built. Declaring stages that do not exist
 * would be the fictional-deliverable failure this project has already had.
 */

/** The loop every wedge in this project turns out to be. */
export const JOB_STAGE = Object.freeze({
  CONNECT: 'connect',     // reach the data
  LISTEN: 'listen',       // take it in on a schedule
  DETECT: 'detect',       // find the discrepancy
  INTERVENE: 'intervene', // produce a draft — a human sends it
  VERIFY: 'verify',       // confirm the customer actually recovered something
  MEASURE: 'measure',     // how much
  CHARGE: 'charge'        // the settlement row, and the only point of the loop
});

/**
 * How hard it is to get a first yes. The primary ranking dimension
 * (docs/READ-FIRST.md), and the labels must stay in step with
 * packages/core/territory/scoring.js — a test asserts they do.
 */
export const DISTRIBUTION = Object.freeze({
  RELATIONSHIP_EXISTS: 'relationship_exists',
  BUYERS_ALREADY_SEARCHING: 'buyers_already_searching',
  FINDABLE: 'findable',
  MUST_CREATE_DEMAND: 'must_create_demand'
});

const STAGES = new Set(Object.values(JOB_STAGE));
const DISTRIBUTIONS = new Set(Object.values(DISTRIBUTION));

/** True when the descriptor carries stages a runner could actually execute. */
export function isRunnableJob(entry = {}) {
  return Boolean(entry.stages && Object.keys(entry.stages).length);
}

/** Throws with the reason. A descriptor that cannot describe itself is a finding. */
export function assertValidJob(entry = {}) {
  const key = entry.key || '(no key)';

  if (entry.distribution !== undefined && !DISTRIBUTIONS.has(entry.distribution)) {
    throw new Error(
      `${key}: distribution "${entry.distribution}" is not one of ${[...DISTRIBUTIONS].join(', ')} — `
      + 'a label the scorer cannot score silently becomes the pessimistic default'
    );
  }

  if (!isRunnableJob(entry)) return entry;

  for (const [name, fn] of Object.entries(entry.stages)) {
    if (!STAGES.has(name)) {
      throw new Error(`${key}: "${name}" is not a stage the runner knows (${[...STAGES].join(', ')})`);
    }
    if (typeof fn !== 'function') {
      throw new Error(`${key}: stage "${name}" is not callable — a stage that is a plan is not a stage`);
    }
  }

  if (entry.stages[JOB_STAGE.CHARGE] && !entry.stages[JOB_STAGE.VERIFY]) {
    throw new Error(
      `${key}: declares charge without verify — money may not be taken for an outcome nothing checked`
    );
  }

  return entry;
}
