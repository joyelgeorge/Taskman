import { databaseEnabled, query } from './db.js';

// In-memory registry for skill packs: key = `${skillId}@${version}`
const skillPacksRegistry = new Map();

/**
 * Skill Pack Schema:
 * - skillId: string (e.g. 'github-paid-bounty', 'invoice-recovery', 'treds-onboarding')
 * - version: string (e.g. '1.0.0')
 * - domain: string
 * - supportedTaskClasses: string[]
 * - contextSources: string[]
 * - schemas: Record<string, object>
 * - qualificationRules: string[]
 * - requiredCapabilities: string[]
 * - allowedAdapters: string[]
 * - executionRequirements: object
 * - freshnessPolicies: object
 * - knownFailurePatterns: string[]
 * - benchmarkFixtures: Array<{ input: any, expected: any }>
 * - status: 'active' | 'deprecated' | 'disabled'
 * - execute: async (taskContext) => result
 */

export function registerSkillPack(spec) {
  if (!spec.skillId || !spec.version) {
    throw new Error('Skill pack requires both skillId and version');
  }
  const fullKey = `${spec.skillId}@${spec.version}`;
  if (skillPacksRegistry.has(fullKey)) {
    throw new Error(`Skill pack ${fullKey} is already registered (immutable version)`);
  }

  const pack = Object.freeze({
    skillId: spec.skillId,
    version: spec.version,
    domain: spec.domain || 'general',
    supportedTaskClasses: Object.freeze([...(spec.supportedTaskClasses || [])]),
    contextSources: Object.freeze([...(spec.contextSources || [])]),
    schemas: Object.freeze({ ...(spec.schemas || {}) }),
    qualificationRules: Object.freeze([...(spec.qualificationRules || [])]),
    requiredCapabilities: Object.freeze([...(spec.requiredCapabilities || [])]),
    allowedAdapters: Object.freeze([...(spec.allowedAdapters || [])]),
    executionRequirements: Object.freeze({ ...(spec.executionRequirements || {}) }),
    freshnessPolicies: Object.freeze({ ...(spec.freshnessPolicies || {}) }),
    knownFailurePatterns: Object.freeze([...(spec.knownFailurePatterns || [])]),
    benchmarkFixtures: Object.freeze([...(spec.benchmarkFixtures || [])]),
    status: spec.status || 'active',
    execute: spec.execute || null
  });

  skillPacksRegistry.set(fullKey, pack);
  return pack;
}

export function getSkillPack(skillId, version = null) {
  if (version) {
    return skillPacksRegistry.get(`${skillId}@${version}`) || null;
  }
  // Find latest active version matching skillId
  const matching = Array.from(skillPacksRegistry.values())
    .filter(p => p.skillId === skillId && p.status === 'active');
  if (matching.length === 0) return null;
  // Sort descending by version string
  matching.sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
  return matching[0];
}

export function listSkillPacks({ domain = null, taskClass = null, activeOnly = true } = {}) {
  let packs = Array.from(skillPacksRegistry.values());
  if (activeOnly) {
    packs = packs.filter(p => p.status === 'active');
  }
  if (domain) {
    packs = packs.filter(p => p.domain === domain);
  }
  if (taskClass) {
    packs = packs.filter(p => p.supportedTaskClasses.includes(taskClass));
  }
  return packs;
}

/**
 * Extracts context fragments specifically relevant to a skill pack
 * so irrelevant domain fragments are never placed into model context.
 */
export function extractSkillContextFragment(skillPack, taskClass) {
  if (!skillPack) return null;
  return {
    skillId: skillPack.skillId,
    version: skillPack.version,
    domain: skillPack.domain,
    qualificationRules: skillPack.qualificationRules,
    schemas: skillPack.schemas,
    knownFailurePatterns: skillPack.knownFailurePatterns
  };
}

/**
 * Executes a domain task through the skill pack interface,
 * verifying capabilities and failing closed on rule violations.
 */
export async function executeSkillPack({
  skillId,
  version = null,
  taskClass,
  taskInput,
  grantedCapabilities = []
}) {
  const pack = getSkillPack(skillId, version);
  if (!pack) {
    throw new Error(`Skill pack ${skillId}${version ? '@' + version : ''} not found or inactive`);
  }

  if (pack.supportedTaskClasses.length > 0 && !pack.supportedTaskClasses.includes(taskClass)) {
    throw new Error(`Task class '${taskClass}' not supported by skill pack ${pack.skillId}`);
  }

  // Capability authorization check: all required capabilities of the skill pack must be granted
  for (const cap of pack.requiredCapabilities) {
    if (!grantedCapabilities.includes(cap)) {
      throw new Error(`Missing required capability '${cap}' for skill pack ${pack.skillId}`);
    }
  }

  if (typeof pack.execute !== 'function') {
    throw new Error(`Skill pack ${pack.skillId}@${pack.version} has no execution handler`);
  }

  const result = await pack.execute(taskInput);
  return {
    skillId: pack.skillId,
    version: pack.version,
    outcome: result
  };
}

export function resetSkillPacksRegistry() {
  skillPacksRegistry.clear();
}
