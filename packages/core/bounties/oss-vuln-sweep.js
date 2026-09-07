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
export const SECURITY_KINDS = new Set(['path-prefix-guard', 'command-injection', 'ssrf']);

const KIND_CWE = {
  'path-prefix-guard': { cwe: 'CWE-22', title: 'Path traversal via prefix-boundary check' },
  'command-injection': { cwe: 'CWE-78', title: 'OS command injection via shell interpolation' },
  'ssrf': { cwe: 'CWE-918', title: 'Server-side request forgery via attacker-controlled URL' }
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
  { repo: 'janhq/jan', subdir: 'core', scope: 'local AI app, filesystem extension surface' },
  // Added 2026-09-07 after verifying each: language TypeScript, actively pushed,
  // not archived, and the named subtree exists (checked via the GitHub contents
  // API). Scope note is the reason each is believed eligible for an OSS bounty;
  // the operator confirms the specific program and its rules before submitting.
  { repo: 'labring/FastGPT', subdir: 'projects/app/src', scope: 'RAG/LLM platform, file upload + dataset ingestion' },
  { repo: 'huggingface/chat-ui', subdir: 'src', scope: 'chat UI, upload and file-serving routes' },
  { repo: 'langfuse/langfuse', subdir: 'web/src', scope: 'LLM observability, media upload + export endpoints' },
  { repo: 'continuedev/continue', subdir: 'core', scope: 'AI coding assistant, local filesystem + context providers' },
  { repo: 'n8n-io/n8n', subdir: 'packages/cli', scope: 'automation platform with AI nodes, large file-handling surface' },
  { repo: 'activepieces/activepieces', subdir: 'packages/server', scope: 'automation + AI, file storage and flow endpoints' }
];

/**
 * The moderate-maturity tier, added 2026-09-07 after a live scan proved the
 * point: the flagships above are hardened and returned zero candidates across a
 * full sweep, because they have security teams and years of triage behind them.
 * Recently-shipped AI apps in the ~300-5000 star band do not, and the same
 * detectors fire on them (this tier produced 51 raw candidates on first scan
 * where the flagships produced none).
 *
 * Two honest caveats, because a candidate is not a bug and a scan target is not
 * a customer:
 *   - Bounty-eligibility is NOT assumed here. Most repos this size have no
 *     bounty program; the operator confirms one per repo before submitting. Many
 *     of these are valuable instead as the DEMAND population for a pre-launch
 *     scan service (issue #205) — the same builders who would pay to be scanned.
 *   - Findings from this tier still pass the PoC gate before they mean anything.
 *     The first two candidates triaged by hand were both false positives for
 *     exploitability (a CLI tool's own argument; a config URL near a request
 *     read), which is exactly why the gate exists.
 */
export const MODERATE_AI_TARGETS = [
  { repo: 'cyrusagents/cyrus', subdir: 'packages', scope: 'AI coding agent, git/exec plumbing (CLI inputs — gate carefully)' },
  { repo: 'wecode-ai/Wegent', subdir: 'frontend/src', scope: 'AI chat frontend, Next.js API proxy routes' },
  { repo: 'kitfunso/hippo-memory', subdir: 'src', scope: 'AI memory store, CLI + dashboard file serving' }
];
