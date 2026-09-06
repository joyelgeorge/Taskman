import {
  listDrones, getDrone, registerDrone, setDroneEnabled, droneRunHistory, runDrone,
  listSignals, signalStats,
  cronStatuses, listCronRuns,
  listAlerts,
  latestHealth, runHealthChecks,
  listImprovements, decideImprovement,
  railEconomics, evaluateRailViability,
  evaluateRailGovernor, enforceRailGovernor, globalBudgetStatus, setGlobalMonthlyBudget,
  setRailEnabled,
  DRONE_KINDS,
  listTargets, registerTarget, setTargetEnabled, latestScans, scanHistory,
  financeReport, recordExpense, listExpenses, EXPENSE_CATEGORIES,
  listFinanceReportHistory,
  recordOrder, markOrderDelivered, recordOrderPayout, listOrders, orderEconomics,
  listSources, registerSource, listObservations, listRollups, storageStats,
  listStreams, registerStream, incomeReport
} from '@taskman/core';
import { healthCheck as dbHealth } from '@taskman/db';
import { runCron } from '../crons/lib/run.js';
import { getJob, cronNames } from '../crons/registry.js';
import {
  listOutreachDrafts, getOutreachDraft, updateOutreachDraftStatus
} from '../../src/transforms/outreach-draft.js';
import {
  listBountyCandidates, getBountyCandidate, updateBountyCandidateStatus,
  listTriageRecords, getBountyYieldReport
} from '@taskman/core';

import { providerStatus } from '../../src/providers.js';
import { getObservabilitySnapshot } from '../../src/observability.js';



/**
 * Read routes are open; anything with a side effect requires the bearer token
 * when TASKMAN_API_TOKEN is set. Triggering a cron or disabling a drone changes
 * what the autonomous system does next, so those are not public even on a URL
 * nobody has been told about.
 */
function authorized(req) {
  const expected = process.env.TASKMAN_API_TOKEN;
  if (!expected) return true;
  const header = (req.headers.authorization || '').trim();
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] === expected : false;
}

const notFound = { status: 404, body: { error: 'not found' } };

export async function route(req, url, readBody) {
  const { pathname } = url;
  const method = req.method;
  const mutating = method !== 'GET';

  if (mutating && !authorized(req)) {
    return { status: 401, body: { error: 'unauthorized: set Authorization: Bearer <TASKMAN_API_TOKEN>' } };
  }

  // ---- system -------------------------------------------------------------
  if (method === 'GET' && pathname === '/api/health') {
    const crons = await cronStatuses();
    const alerts = await listAlerts({ open: true });
    const db = await dbHealth();
    const unhealthyCrons = crons.filter(c => !['OK', 'DISABLED'].includes(c.status));
    const critical = alerts.some(a => a.severity === 'CRITICAL');
    const status = !db.ok ? 'DOWN' : (critical || unhealthyCrons.length ? 'DEGRADED' : 'OK');
    // Non-200 when degraded so an external uptime monitor notices without parsing.
    return { status: status === 'OK' ? 200 : 503, body: { status, db, openAlerts: alerts.length, unhealthyCrons } };
  }

  if (method === 'GET' && pathname === '/api/status') {
    const [drones, signals, crons, alerts, rails, improvements] = await Promise.all([
      listDrones(), signalStats(), cronStatuses(), listAlerts({ open: true }), railEconomics(), listImprovements({ limit: 5 })
    ]);
    return {
      status: 200,
      body: {
        drones: { total: drones.length, enabled: drones.filter(d => d.enabled).length },
        signals,
        crons: crons.map(c => ({ cron: c.cronName, status: c.status, lastRunAt: c.lastRunAt, silentSeconds: c.silentSeconds })),
        openAlerts: alerts.length,
        revenue: {
          clearedCents: rails.reduce((s, r) => s + r.clearedCents, 0),
          spendCents: rails.reduce((s, r) => s + r.spendCents, 0),
          rails: rails.length
        },
        models: {
          providers: providerStatus(),
          observability: getObservabilitySnapshot({ includeTraces: false })
        },
        topImprovements: improvements.map(i => ({ id: i.id, title: i.title, score: i.score })),
        asOf: new Date().toISOString()
      }
    };
  }

  // ---- drones -------------------------------------------------------------
  if (method === 'GET' && pathname === '/api/drones') {
    return { status: 200, body: { kinds: DRONE_KINDS, drones: await listDrones() } };
  }

  if (method === 'POST' && pathname === '/api/drones') {
    const body = await readBody();
    if (!body.id || !body.kind || !body.targetUrl) {
      return { status: 400, body: { error: 'id, kind and targetUrl are required', kinds: DRONE_KINDS } };
    }
    if (!DRONE_KINDS.includes(body.kind)) {
      return { status: 400, body: { error: `unknown kind "${body.kind}"`, kinds: DRONE_KINDS } };
    }
    return { status: 200, body: await registerDrone(body) };
  }

  const droneRuns = pathname.match(/^\/api\/drones\/([^/]+)\/runs$/);
  if (method === 'GET' && droneRuns) {
    return { status: 200, body: { runs: await droneRunHistory(decodeURIComponent(droneRuns[1])) } };
  }

  const droneEnabled = pathname.match(/^\/api\/drones\/([^/]+)\/enabled$/);
  if (method === 'POST' && droneEnabled) {
    const body = await readBody();
    if (typeof body.enabled !== 'boolean') return { status: 400, body: { error: 'enabled (boolean) is required' } };
    const drone = await setDroneEnabled(decodeURIComponent(droneEnabled[1]), body.enabled);
    return drone ? { status: 200, body: drone } : notFound;
  }

  const droneRun = pathname.match(/^\/api\/drones\/([^/]+)\/run$/);
  if (method === 'POST' && droneRun) {
    const drone = await getDrone(decodeURIComponent(droneRun[1]));
    if (!drone) return notFound;
    return { status: 200, body: await runDrone(drone) };
  }

  // ---- signals ------------------------------------------------------------
  if (method === 'GET' && pathname === '/api/signals') {
    const status = url.searchParams.get('status');
    const limit = Math.min(Number(url.searchParams.get('limit') || 50), 200);
    return { status: 200, body: { stats: await signalStats(), signals: await listSignals({ status, limit }) } };
  }

  // ---- crons --------------------------------------------------------------
  if (method === 'GET' && pathname === '/api/crons') {
    return { status: 200, body: { crons: await cronStatuses(), known: cronNames } };
  }

  const cronRuns = pathname.match(/^\/api\/crons\/([^/]+)\/runs$/);
  if (method === 'GET' && cronRuns) {
    return { status: 200, body: { runs: await listCronRuns({ cronName: decodeURIComponent(cronRuns[1]), limit: 25 }) } };
  }

  const cronRun = pathname.match(/^\/api\/crons\/([^/]+)\/run$/);
  if (method === 'POST' && cronRun) {
    const name = decodeURIComponent(cronRun[1]);
    let job;
    try { job = getJob(name); } catch { return notFound; }
    return { status: 200, body: await runCron(job.definition, () => job.handler(), { force: true }) };
  }

  // ---- alerts & health ----------------------------------------------------
  if (method === 'GET' && pathname === '/api/alerts') {
    const open = url.searchParams.get('open') !== 'false';
    return { status: 200, body: { alerts: await listAlerts({ open }) } };
  }

  if (method === 'GET' && pathname === '/api/components') {
    return { status: 200, body: { components: await latestHealth() } };
  }

  if (method === 'POST' && pathname === '/api/components/check') {
    return { status: 200, body: await runHealthChecks({}) };
  }

  // ---- money --------------------------------------------------------------
  if (method === 'GET' && pathname === '/api/money/economics') {
    const [rails, globalBudget] = await Promise.all([railEconomics(), globalBudgetStatus()]);
    return { status: 200, body: { rails, globalBudget, asOf: new Date().toISOString() } };
  }

  const railViability = pathname.match(/^\/api\/money\/rails\/([^/]+)\/viability$/);
  if (method === 'GET' && railViability) {
    return { status: 200, body: await evaluateRailViability({ rail: decodeURIComponent(railViability[1]) }) };
  }

  // The governed verdict: current state, what the ledger evidence says the next
  // state should be, and why. GET previews it; POST writes the transition.
  const railGovernor = pathname.match(/^\/api\/money\/rails\/([^/]+)\/governor$/);
  if (method === 'GET' && railGovernor) {
    return { status: 200, body: await evaluateRailGovernor({ rail: decodeURIComponent(railGovernor[1]) }) };
  }
  if (method === 'POST' && railGovernor) {
    return { status: 200, body: await enforceRailGovernor({ rail: decodeURIComponent(railGovernor[1]) }) };
  }

  const railReenable = pathname.match(/^\/api\/money\/rails\/([^/]+)\/reenable$/);
  if (method === 'POST' && railReenable) {
    const body = await readBody();
    // Re-enabling a DISABLED rail is a manual act by design (docs/TARGET_DESIGN.md
    // §8) — the system never argues its own way out of a market that did not pay.
    return { status: 200, body: await setRailEnabled(decodeURIComponent(railReenable[1]), true, body.note || null) };
  }

  if (method === 'GET' && pathname === '/api/money/budget') {
    return { status: 200, body: await globalBudgetStatus() };
  }
  if (method === 'POST' && pathname === '/api/money/budget') {
    const body = await readBody();
    if (!Number.isFinite(Number(body.capCents))) return { status: 400, body: { error: 'capCents (number) is required' } };
    return { status: 200, body: await setGlobalMonthlyBudget(body.capCents) };
  }

  // ---- satellite scans ------------------------------------------------------
  // Reconnaissance findings on candidate money-flow venues: reachable? bot-
  // defended? what shape? — the automated version of the manual check run
  // against Upwork, Fiverr, and California's unclaimed-property registry.
  if (method === 'GET' && pathname === '/api/scans') {
    return { status: 200, body: { scans: await latestScans() } };
  }

  if (method === 'GET' && pathname === '/api/scans/targets') {
    return { status: 200, body: { targets: await listTargets() } };
  }

  if (method === 'POST' && pathname === '/api/scans/targets') {
    const body = await readBody();
    if (!body.targetKey || !body.targetUrl) {
      return { status: 400, body: { error: 'targetKey and targetUrl are required' } };
    }
    return { status: 200, body: await registerTarget(body) };
  }

  const targetEnabled = pathname.match(/^\/api\/scans\/targets\/([^/]+)\/enabled$/);
  if (method === 'POST' && targetEnabled) {
    const body = await readBody();
    if (typeof body.enabled !== 'boolean') return { status: 400, body: { error: 'enabled (boolean) is required' } };
    const target = await setTargetEnabled(decodeURIComponent(targetEnabled[1]), body.enabled);
    return target ? { status: 200, body: target } : notFound;
  }

  const targetHistory = pathname.match(/^\/api\/scans\/targets\/([^/]+)\/history$/);
  if (method === 'GET' && targetHistory) {
    return { status: 200, body: { scans: await scanHistory(decodeURIComponent(targetHistory[1])) } };
  }

  if (method === 'POST' && pathname === '/api/scans/run') {
    const job = getJob('satellite-scan');
    return { status: 200, body: await runCron(job.definition, () => job.handler(), { force: true }) };
  }

  // ---- finance --------------------------------------------------------------
  // Deterministic only — see docs/MARKETING_FINANCE_WING.md §3. No model touches
  // money math anywhere in this route group.
  if (method === 'GET' && pathname === '/api/finance/report') {
    const trailingDays = Math.min(Math.max(Number(url.searchParams.get('trailingDays') || 30), 1), 365);
    return { status: 200, body: await financeReport({ trailingDays }) };
  }

  if (method === 'GET' && pathname === '/api/finance/report/history') {
    const since = url.searchParams.get('since') || null;
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 30), 1), 365);
    return { status: 200, body: { history: await listFinanceReportHistory({ since, limit }) } };
  }

  if (method === 'GET' && pathname === '/api/finance/expenses') {
    const category = url.searchParams.get('category');
    const campaignKey = url.searchParams.get('campaignKey');
    return { status: 200, body: { categories: EXPENSE_CATEGORIES, expenses: await listExpenses({ category, campaignKey }) } };
  }

  if (method === 'POST' && pathname === '/api/finance/expenses') {
    const body = await readBody();
    if (!body.category || !Number.isFinite(Number(body.amountCents))) {
      return { status: 400, body: { error: 'category and amountCents (number) are required', categories: EXPENSE_CATEGORIES } };
    }
    try {
      return { status: 200, body: await recordExpense(body) };
    } catch (error) {
      return { status: 400, body: { error: String(error.message || error) } };
    }
  }

  // ---- orders (gig rails) ---------------------------------------------------
  // Marketplace orders fulfilled by hand — see docs/FIVERR_LANE.md and #135.
  // An order is a rail attempt and its payout is a settlement; there is no
  // separate orders table, deliberately.
  const DEFAULT_GIG_RAIL = 'fiverr-bookkeeping';

  if (method === 'GET' && pathname === '/api/orders') {
    const rail = url.searchParams.get('rail') || DEFAULT_GIG_RAIL;
    const [orders, economics] = await Promise.all([listOrders({ rail }), orderEconomics({ rail })]);
    return { status: 200, body: { rail, economics, orders } };
  }

  if (method === 'POST' && pathname === '/api/orders') {
    const body = await readBody();
    try {
      return { status: 200, body: await recordOrder({ rail: body.rail || DEFAULT_GIG_RAIL, ...body }) };
    } catch (error) {
      return { status: 400, body: { error: String(error.message || error) } };
    }
  }

  const orderDelivered = pathname.match(/^\/api\/orders\/([^/]+)\/delivered$/);
  if (method === 'POST' && orderDelivered) {
    const body = await readBody();
    const updated = await markOrderDelivered(decodeURIComponent(orderDelivered[1]), body);
    return updated ? { status: 200, body: updated } : notFound;
  }

  const orderPayout = pathname.match(/^\/api\/orders\/([^/]+)\/payout$/);
  if (method === 'POST' && orderPayout) {
    const body = await readBody();
    try {
      return {
        status: 200,
        body: await recordOrderPayout({
          rail: body.rail || DEFAULT_GIG_RAIL,
          orderId: decodeURIComponent(orderPayout[1]),
          ...body
        })
      };
    } catch (error) {
      return { status: 400, body: { error: String(error.message || error) } };
    }
  }

  // ---- observations (the data store) ----------------------------------------
  // See docs/DATA_ECOSYSTEM.md. Rollups are the asset and are kept forever;
  // raw rows are disposable and pruned past retention.
  if (method === 'GET' && pathname === '/api/data') {
    const [sources, storage] = await Promise.all([listSources(), storageStats()]);
    return { status: 200, body: { sources, storage } };
  }

  if (method === 'POST' && pathname === '/api/data/sources') {
    const body = await readBody();
    try {
      return { status: 200, body: await registerSource(body) };
    } catch (error) {
      return { status: 400, body: { error: String(error.message || error) } };
    }
  }

  if (method === 'GET' && pathname === '/api/data/series') {
    const seriesKey = url.searchParams.get('key');
    const limit = Math.min(Number(url.searchParams.get('limit') || 90), 1000);
    const [rollups, raw] = await Promise.all([
      listRollups({ seriesKey, limit }),
      listObservations({ seriesKey, limit: 20 })
    ]);
    return { status: 200, body: { seriesKey, rollups, recentRaw: raw } };
  }

  if (method === 'POST' && pathname === '/api/data/collect') {
    const job = getJob('data-collect');
    return { status: 200, body: await runCron(job.definition, () => job.handler(), { force: true }) };
  }

  // ---- improvements -------------------------------------------------------
  if (method === 'GET' && pathname === '/api/improvements') {
    const status = url.searchParams.get('status') || 'PROPOSED';
    return { status: 200, body: { improvements: await listImprovements({ status }) } };
  }

  const decision = pathname.match(/^\/api\/improvements\/([^/]+)\/decision$/);
  if (method === 'POST' && decision) {
    const body = await readBody();
    try {
      const updated = await decideImprovement(decodeURIComponent(decision[1]), body.status);
      return updated ? { status: 200, body: updated } : notFound;
    } catch (error) {
      return { status: 400, body: { error: String(error.message || error) } };
    }
  }

  // ---- outreach review ------------------------------------------------------
  // Human-gated: drafts are reviewed and sent manually; only outcomes are recorded here.
  if (method === 'GET' && pathname === '/api/outreach/drafts') {
    const campaignKey = url.searchParams.get('campaignKey');
    const status = url.searchParams.get('status');
    return { status: 200, body: { drafts: await listOutreachDrafts({ campaignKey, status }) } };
  }

  const outreachDraft = pathname.match(/^\/api\/outreach\/drafts\/([^/]+)$/);
  if (method === 'GET' && outreachDraft) {
    const draft = await getOutreachDraft(decodeURIComponent(outreachDraft[1]));
    return draft ? { status: 200, body: { draft } } : notFound;
  }

  if (method === 'PATCH' && outreachDraft) {
    const body = await readBody();
    if (!body.status) return { status: 400, body: { error: 'status is required' } };
    try {
      const id = decodeURIComponent(outreachDraft[1]);
      const updatedDraft = await updateOutreachDraftStatus(id, body.status);
      if (body.status === 'CONVERTED') {
        await recordExpense({
          category: 'marketing',
          campaignKey: updatedDraft.campaignKey,
          amountCents: 1,
          description: 'outreach-conversion:' + id
        });
      }
      return { status: 200, body: { draft: updatedDraft } };
    } catch (error) {
      return { status: 400, body: { error: String(error.message || error) } };
    }
  }

  // ---- bounty candidates review (Issue #194) --------------------------------
  // Human-gated: external bounty PRs are never auto-submitted.
  // Candidates are prepared here with disclosure text and test evidence.
  if (method === 'GET' && pathname === '/api/bounties/candidates') {
    const repoFilter = url.searchParams.get('repo');
    const status = url.searchParams.get('status');
    const candidates = await listBountyCandidates({ repo: repoFilter, status });
    return { status: 200, body: { candidates } };
  }

  const bountyCandidateMatch = pathname.match(/^\/api\/bounties\/candidates\/([^/]+)$/);
  if (method === 'GET' && bountyCandidateMatch) {
    const candidate = await getBountyCandidate(decodeURIComponent(bountyCandidateMatch[1]));
    return candidate ? { status: 200, body: { candidate } } : notFound;
  }

  if (method === 'PATCH' && bountyCandidateMatch) {
    const body = await readBody();
    if (!body.status) return { status: 400, body: { error: 'status is required' } };
    try {
      const id = decodeURIComponent(bountyCandidateMatch[1]);
      const updatedCandidate = await updateBountyCandidateStatus(id, body.status, {
        submissionMetadata: body.submissionMetadata || null
      });
      return { status: 200, body: { candidate: updatedCandidate } };
    } catch (error) {
      return { status: 400, body: { error: String(error.message || error) } };
    }
  }

  // ---- bounty triage & yield reporting (Issue #195) -------------------------
  if (method === 'GET' && pathname === '/api/bounties/triage/report') {
    return { status: 200, body: await getBountyYieldReport() };
  }

  if (method === 'GET' && pathname === '/api/bounties/triage') {
    const verdict = url.searchParams.get('verdict');
    const repoFilter = url.searchParams.get('repo');
    const records = await listTriageRecords({ verdict, repo: repoFilter });
    return { status: 200, body: { records } };
  }

  // ---- money-making opportunities & streams ---------------------------------


  if (method === 'GET' && pathname === '/api/money/opportunities') {
    const [report, streams] = await Promise.all([
      incomeReport(),
      listStreams({})
    ]);
    return {
      status: 200,
      body: {
        ...report,
        streams
      }
    };
  }

  if (method === 'POST' && pathname === '/api/money/opportunities') {
    const body = await readBody();
    if (!body.title || !body.mechanism || !body.requires || !body.nextAction || !body.unblockedBy) {
      return {
        status: 400,
        body: { error: 'title, mechanism, requires, nextAction, and unblockedBy are required' }
      };
    }

    const streamKey = body.streamKey || String(body.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const proofCents = body.proofCents != null ? Number(body.proofCents) : null;
    const testCostHours = body.testCostHours != null ? Number(body.testCostHours) : 0;
    const pSuccess = Math.min(1, Math.max(0, body.pSuccess != null ? Number(body.pSuccess) : (body.unblockedBy === 'machine' ? 0.7 : 0.4)));

    // Usual economic calculations
    const grossReward = (proofCents || 0) / 100;
    const expectedValue = grossReward * pSuccess;
    const opportunityCost = testCostHours * 50; // $50/hr opportunity baseline
    const expectedNetValue = expectedValue - opportunityCost;
    const hourlyProofRate = testCostHours > 0 ? (grossReward / testCostHours) : grossReward;
    const stats = {
      grossReward,
      pSuccess,
      expectedValue,
      opportunityCost,
      expectedNetValue,
      hourlyProofRate,
      viable: expectedNetValue >= 0 || testCostHours <= 2
    };

    const stream = await registerStream({
      streamKey,
      title: body.title,
      mechanism: body.mechanism,
      requires: body.requires,
      nextAction: body.nextAction,
      unblockedBy: body.unblockedBy,
      state: body.state || 'HYPOTHESIS',
      stateReason: body.stateReason || `Registered via operator UI. EV: $${expectedNetValue.toFixed(2)}, Proof: $${grossReward.toFixed(2)}`,
      testCostHours,
      proofCents,
      evidence: body.evidence || [{ kind: 'economic_calculation', stats, at: new Date().toISOString() }],
      origin: body.origin || 'operator_ui'
    });

    return {
      status: 201,
      body: {
        stream,
        stats
      }
    };
  }

  return notFound;
}
