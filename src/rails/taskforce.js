import { RailAdapter, RAIL_MODE } from './base.js';
import { evaluateExecutionGate } from './execution-gate.js';
import { getRuntimeConfig } from '../config.js';

export class TaskForceRail extends RailAdapter {
  constructor({
    apiKey = getRuntimeConfig().rails.taskforce.apiKey,
    baseUrl = getRuntimeConfig().rails.taskforce.baseUrl,
    mode = RAIL_MODE.READ_ONLY
  } = {}) {
    super({ name: 'taskforce', mode });
    this.apiKey = apiKey || null;
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async health() {
    return {
      name: this.name,
      mode: this.mode,
      configured: Boolean(this.apiKey),
      baseUrl: this.baseUrl,
      safeDefault: this.mode === RAIL_MODE.READ_ONLY
    };
  }

  async discover() {
    if (!this.apiKey) {
      return { ok: false, blocked: true, reason: 'TASKFORCE_API_KEY missing', tasks: [] };
    }
    return this.#request('/api/agent/tasks', { method: 'GET' });
  }

  async verify(task) {
    const normalized = normalizeTask(task);
    return {
      task: normalized,
      gate: evaluateExecutionGate(normalized.executionGate)
    };
  }

  async claimOrApply(taskId, payload = {}) {
    this.assertExecutable('claim/apply');
    if (!this.apiKey) throw new Error('TASKFORCE_API_KEY missing');
    if (!taskId) throw new Error('taskId is required');
    return this.#request(`/api/agent/tasks/${encodeURIComponent(taskId)}/apply`, {
      method: 'POST',
      body: payload
    });
  }

  async deliver(taskId, payload = {}) {
    this.assertExecutable('deliver');
    if (!this.apiKey) throw new Error('TASKFORCE_API_KEY missing');
    if (!taskId) throw new Error('taskId is required');
    return this.#request(`/api/agent/tasks/${encodeURIComponent(taskId)}/submit`, {
      method: 'POST',
      body: payload
    });
  }

  async followUp(taskId) {
    if (!this.apiKey) throw new Error('TASKFORCE_API_KEY missing');
    return this.#request(`/api/agent/tasks/${encodeURIComponent(taskId)}/messages`, { method: 'GET' });
  }

  async checkAcceptance(taskId) {
    if (!this.apiKey) throw new Error('TASKFORCE_API_KEY missing');
    return this.#request(`/api/agent/tasks/${encodeURIComponent(taskId)}`, { method: 'GET' });
  }

  async checkPayment() {
    if (!this.apiKey) throw new Error('TASKFORCE_API_KEY missing');
    return this.#request('/api/agent/wallet', { method: 'GET' });
  }

  async #request(path, { method = 'GET', body } = {}) {
    const headers = { 'accept': 'application/json', 'authorization': `Bearer ${this.apiKey}` };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000)
    });
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    if (!response.ok) {
      const error = new Error(`TaskForce ${method} ${path} failed: HTTP ${response.status}`);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }
}

function normalizeTask(task = {}) {
  return {
    id: task.id || task.task_id || null,
    title: task.title || task.name || '',
    reward: Number(task.reward ?? task.budget ?? 0),
    raw: task,
    executionGate: {
      payerVerified: Boolean(task.escrow_funded ?? task.escrowFunded ?? task.payer_verified),
      taskOpen: ['open', 'available', 'active'].includes(String(task.status || '').toLowerCase()),
      acceptanceCriteriaClear: Boolean(task.acceptance_criteria || task.acceptanceCriteria || task.description),
      deliveryPathExecutable: true,
      noContradictoryInstructions: !task.blocked && !task.do_not_claim,
      payoutPathExecutable: Boolean(task.payout_method || (task.escrow_funded ?? task.escrowFunded)),
      noRecurringManualStep: task.requires_call !== true && task.requires_manual_presence !== true,
      noUpfrontSpend: Number(task.worker_cost || task.upfront_cost || 0) === 0,
      noUnsupportedSigning: task.requires_wallet_signature !== true,
      payout: Number(task.reward ?? task.budget ?? 0),
      acceptanceProbability: Number(task.acceptance_probability ?? 0.5),
      settlementProbability: Number(task.settlement_probability ?? 0.9),
      executionFriction: Number(task.execution_friction ?? 1)
    }
  };
}

export function createTaskForceRail(options) { return new TaskForceRail(options); }
