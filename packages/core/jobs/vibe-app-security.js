/**
 * The vibe-coded-app security lane, as an actual revenue job.
 *
 * Everything this lane needs already existed and was disconnected: a scanner, a
 * qualifier, a lead store, an attempt log, a ledger, and five written
 * procedures. This is the wiring — the one file where a lead becomes a
 * settlement row, under the runner's four gates.
 *
 * The procedures in .claude/skills/verify-lead-before-contact,
 * send-and-log-outreach and close-to-settlement are implemented here rather
 * than only described, because a procedure a human has to remember is a
 * procedure that gets skipped at 2am.
 */

import { JOB_STAGE } from './job-spec.js';
import { scrubSecrets } from '../../../src/adapters/coding-agent-adapter.js';

/**
 * Finding classes that make an owner act today. Everything else is a real
 * finding and a real offer, but pitching it as an emergency is how the lane
 * loses its reputation on attempt one.
 */
export const COMPELLING = Object.freeze(new Set([
  'exposed-secret', 'command-injection', 'unauthenticated-admin-route'
]));

/**
 * Count issues AND distinct files per class.
 *
 * Measured 2026-09-15: `missing-rls` is emitted once per table, so one
 * architectural gap in one schema dump became seventy criticals and the sweep
 * headline ran about 5x high. The ratio is returned so a draft can correct our
 * own number instead of repeating it.
 */
export function classifyFindings(findings = []) {
  const byKind = {};
  for (const f of findings) {
    const k = (byKind[f.kind] ||= { count: 0, fileSet: new Set() });
    k.count += 1;
    k.fileSet.add(f.file);
  }
  const compelling = findings.filter(f => COMPELLING.has(f.kind)).length;
  const out = {};
  for (const [kind, v] of Object.entries(byKind)) out[kind] = { count: v.count, files: v.fileSet.size };

  return {
    byKind: out,
    headline: findings.length,
    compelling,
    // How badly the raw count overstates the number of distinct problems.
    inflationRatio: compelling > 0 ? findings.length / compelling : findings.length
  };
}

/** A leaked live credential beats any quantity of systemic-but-architectural findings. */
export function rankLeads(leads = []) {
  return [...leads]
    .map(l => ({ ...l, classified: classifyFindings(l.findings) }))
    .sort((a, b) =>
      b.classified.compelling - a.classified.compelling ||
      b.findings.length - a.findings.length);
}

/**
 * The first message. Rotate-first, one verified finding, no price, no link, and
 * never the secret's value — `evidence` from the scanner routinely contains the
 * key itself, which is the difference between a disclosure and a republication.
 */
export function draftDisclosure({ repo, findings = [], now = new Date() } = {}) {
  const c = classifyFindings(findings);
  const secret = findings.find(f => f.kind === 'exposed-secret');
  const rls = c.byKind['missing-rls'];

  const lines = [
    `# Disclosure draft — ${repo}`,
    '',
    `**Status: DRAFT — NOT SENT.** The operator sends this. Claude does not contact anyone.`,
    `Prepared ${now.toISOString().slice(0, 10)} from a fresh clone, since deleted.`,
    '',
    '## Verified',
    ''
  ];

  if (secret) {
    lines.push(
      `- \`exposed-secret\` — **${c.byKind['exposed-secret'].count}**, first at \`${secret.file}:${secret.line ?? '?'}\`.`,
      '  The value is deliberately not reproduced here or anywhere else.'
    );
  }
  if (rls) {
    lines.push(
      `- \`missing-rls\` — ${rls.count} occurrences across **${rls.files} file(s)**.`,
      '  This is one systemic issue counted once per table, not that many holes.'
    );
  }

  lines.push(
    '',
    `Our own sweep headline for this repository was **${c.headline}**. The number of`,
    `distinct problems that compel action is **${c.compelling}**. Quote the second one.`,
    '',
    '## What to send',
    '',
    'Hello — I run automated security scans of public repositories and yours matched.',
    'I have no track record to point at; this is free and you owe nothing.',
    '',
    secret
      ? [
          `Your repository contains a live credential at \`${secret.file}\`.`,
          '',
          '1. **Rotate it today.** Editing the file does not help — the value stays in',
          '   git history permanently, so the key must be replaced at the provider.',
          '2. Move the new value to an environment variable.',
          '3. Check whether the same key appears elsewhere in the repository.'
        ].join('\n')
      : 'Row-Level Security is not enabled on your database tables, which means the\nanon key can read and write them directly.',
    '',
    'That is the whole message — happy to answer questions either way.',
    '',
    '---',
    '',
    '## Before sending',
    '',
    '- [ ] Re-verify against a fresh clone; these numbers age.',
    '- [ ] Find a private channel: SECURITY.md, private reporting, profile email,',
    '      then commit metadata. A public issue must describe nothing.',
    '- [ ] No price, no link, no invoice in this message.',
    '- [ ] After sending: `npm run outreach -- log --lane vibe-app-security ...`'
  );

  // Belt and braces: the scanner's `evidence` can carry the key, and a draft is
  // a file that gets committed.
  return scrubSecrets(lines.join('\n'));
}

/**
 * Build the job. Dependencies are injected so the whole loop is testable without
 * a network, a clone, or a ledger — and so the seams are visible.
 */
export function vibeAppSecurityJob({ scan, write, payment = null } = {}) {
  return {
    key: 'vibe-app-security',
    verdict: 'unproven',
    distribution: 'must_create_demand',
    rail: 'vibe-app-security',
    economics: { pricing: 'flat', amountCents: 11000, currency: 'USD' },
    note: 'Cold disclosure of verified findings in public vibe-coded app repositories, '
      + 'priced as a fix rather than a scan. Unproven until one attempt converts.',
    stages: {
      [JOB_STAGE.DETECT]: async () => rankLeads(await scan()),

      // Gated by the runner: reaches a person, so it needs an operator token.
      [JOB_STAGE.INTERVENE]: async ({ context }) => {
        const drafts = [];
        for (const lead of context[JOB_STAGE.DETECT] ?? []) {
          const path = `docs/outreach/${new Date().toISOString().slice(0, 10)}-${lead.repo.replace(/\//g, '-')}.md`;
          await write(path, draftDisclosure(lead));
          drafts.push(path);
        }
        return drafts;
      },

      // Evidence for the ledger. No payment reference means no charge, and the
      // runner enforces that rather than trusting this to return honestly.
      [JOB_STAGE.VERIFY]: async () => (payment ? payment() : null),

      [JOB_STAGE.CHARGE]: async ({ context }) => context.evidence ?? null
    }
  };
}
