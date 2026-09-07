/**
 * Sweeps in-scope open-source repositories for security-relevant findings the
 * codebase scanner can detect, and ranks what is worth a human proof-of-concept.
 *
 * This is a discovery aid, not an oracle. It runs the SAME static analysis that
 * found the mergeos CWE-22 by hand, across many targets at once, so a person
 * only spends PoC time on the few that look real. Nothing here submits anything,
 * and every result is a CANDIDATE until a human proves it against a running
 * instance — exactly the step that cleared anything-llm and lollms on 2026-09-07.
 *
 * Discipline (unchanged): public source only, static reading only, never a live
 * scan of anyone's running service. Cloning a public repo and grepping it is
 * reading published code; probing a deployed target is not, and we do not do it.
 */

/**
 * Of the scanner's five detectors, only some describe a vulnerability a bounty
 * program pays for. A path guard that can be escaped is a CWE-22 report; a
 * swallowed error or a date shift is a reliability bug, real but not a security
 * submission. So findings are split, not lumped: security candidates are what a
 * huntr PoC targets, quality findings feed the audit-tool lane instead.
 */
export const SECURITY_KINDS = new Set(['path-prefix-guard']);

const KIND_CWE = {
  'path-prefix-guard': { cwe: 'CWE-22', title: 'Path traversal via prefix-boundary check' }
};

/**
 * Splits a scanner run into security candidates and quality findings, and
 * attaches the PoC step each candidate needs. Ranking is by how directly the
 * finding maps to an exploit: a path guard is rank 3 (a clear traversal PoC),
 * everything else is quality.
 */
export function classifyFindings(findings = [], { repo } = {}) {
  const security = [];
  const quality = [];
  for (const f of findings) {
    if (SECURITY_KINDS.has(f.kind)) {
      const meta = KIND_CWE[f.kind] || { cwe: 'CWE-unknown', title: f.kind };
      security.push({
        repo, kind: f.kind, cwe: meta.cwe, title: meta.title,
        file: f.file, line: f.line, evidence: f.evidence,
        // Never "confirmed": a candidate is a lead, and the lead is worthless
        // until the PoC in `confirm` actually reads a file outside the root.
        status: 'CANDIDATE-needs-PoC',
        poc: f.confirm || 'Reproduce against a running instance before trusting.'
      });
    } else {
      quality.push({ repo, kind: f.kind, file: f.file, line: f.line });
    }
  }
  security.sort((a, b) => (b.line ? 1 : 0) - (a.line ? 1 : 0));
  return { repo, security, quality };
}

/**
 * The seed set of in-scope Node.js / TypeScript AI-and-ML projects. Node on
 * purpose: the scanner's detectors are written against JS/SQL, so they fire
 * directly here, unlike the Python targets where the method transfers but the
 * regexes do not. Each entry names the server-side subtree worth scanning so the
 * sweep does not waste time on the front-end bundle.
 *
 * `scope` records why the repo is believed in-scope for an OSS bounty program;
 * it is the operator's job to confirm the specific program and its rules before
 * submitting anything. Nothing is asserted as verified from here.
 */
export const NODE_OSS_TARGETS = [
  { repo: 'Mintplex-Labs/anything-llm', subdir: 'server', scope: 'AI/ML app, huntr-class file endpoints' },
  { repo: 'FlowiseAI/Flowise', subdir: 'packages/server', scope: 'LLM flow builder, file + credential handling' },
  { repo: 'danny-avila/LibreChat', subdir: 'api', scope: 'chat platform, upload/download endpoints' },
  { repo: 'lobehub/lobe-chat', subdir: 'src/server', scope: 'chat platform, server actions' },
  { repo: 'janhq/jan', subdir: 'core', scope: 'local AI app, filesystem extension surface' }
];
