const ALLOWED_TYPES = new Set([
  'fact',
  'assumption',
  'rejection',
  'gap_opened',
  'gap_resolved',
  'future_path',
  'money_event'
]);

function clamp(n, fallback = 0.5) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(0, Math.min(1, x));
}

function stripFence(text) {
  const raw = String(text || '').trim();
  if (!raw.startsWith('```')) return raw;
  return raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

function extractJson(text) {
  const raw = stripFence(text);
  try { return JSON.parse(raw); } catch {}
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
  throw new Error('AI response did not contain a valid JSON object');
}

function normalizeEvent(event, index) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    throw new Error(`events[${index}] must be an object`);
  }
  const type = String(event.type || '').toLowerCase();
  if (!ALLOWED_TYPES.has(type)) throw new Error(`events[${index}].type is not allowed: ${type}`);
  const summary = typeof event.summary === 'string' ? event.summary.trim() : '';
  if (!summary) throw new Error(`events[${index}].summary is required`);

  const normalized = {
    type,
    key: event.key == null ? null : String(event.key),
    summary,
    confidence: clamp(event.confidence),
    sourceType: event.source_type ? String(event.source_type) : 'ai_inference',
    value: event.value && typeof event.value === 'object' ? event.value : { summary },
    metadata: event.metadata && typeof event.metadata === 'object' ? event.metadata : {}
  };

  if (type === 'gap_opened' || type === 'gap_resolved') {
    normalized.gap = String(event.gap || normalized.value.gap || summary);
    normalized.value = { ...normalized.value, gap: normalized.gap, summary };
  }
  if (type === 'rejection') {
    normalized.terminal = Boolean(event.terminal ?? normalized.value.terminal ?? false);
    normalized.value = { ...normalized.value, summary, terminal: normalized.terminal };
  }
  if (type === 'future_path') {
    const nextBestAction = event.next_best_action || normalized.value.nextBestAction || summary;
    normalized.value = { ...normalized.value, nextBestAction: String(nextBestAction), summary };
  }
  if (type === 'money_event') {
    const amount = event.amount == null ? normalized.value.amount : event.amount;
    const attributableValue = event.attributable_value == null ? normalized.value.attributableValue : event.attributable_value;
    normalized.money = {
      eventType: String(event.event_type || normalized.value.eventType || 'economic_outcome'),
      amount: amount == null ? null : Number(amount),
      currency: event.currency || normalized.value.currency || null,
      attributableValue: attributableValue == null ? null : Number(attributableValue),
      evidence: event.evidence && typeof event.evidence === 'object' ? event.evidence : normalized.value.evidence || { summary }
    };
    normalized.value = { ...normalized.value, ...normalized.money, summary };
  }
  return normalized;
}

export function buildLearningPrompt({ objective, context }) {
  return `${objective}\n\nCurrent durable knowledge:\n${JSON.stringify(context)}\n\nYou are one reasoning layer inside Taskman. Resolve only the most valuable unresolved gap. Do not repeat rejected paths. Use only relevant context.\n\nReturn ONLY valid JSON with this exact top-level shape:\n{\n  "answer": "concise useful result for the task",\n  "events": [\n    {\n      "type": "fact|assumption|rejection|gap_opened|gap_resolved|future_path|money_event",\n      "summary": "single concise statement",\n      "confidence": 0.0,\n      "key": "optional stable key",\n      "gap": "required for gap events",\n      "terminal": false,\n      "next_best_action": "required for future_path",\n      "event_type": "required for money_event",\n      "amount": null,\n      "currency": null,\n      "attributable_value": null,\n      "value": {},\n      "evidence": {},\n      "metadata": {}\n    }\n  ]\n}\n\nRules:\n- Never invent a money event. Emit money_event only when the run contains concrete evidence of an economic outcome.\n- Facts should be directly supported by the run or provided context.\n- Assumptions must remain explicitly uncertain.\n- Rejections must include the reason in summary/value.\n- Resolve a gap only if this run actually resolves it.\n- Always emit one future_path event unless the task is terminal.\n- Keep events minimal; every event must materially change future decisions.`;
}

export function parseLearningEnvelope(text) {
  const parsed = extractJson(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Structured response must be an object');
  if (typeof parsed.answer !== 'string') throw new Error('Structured response.answer must be a string');
  if (!Array.isArray(parsed.events)) throw new Error('Structured response.events must be an array');
  if (parsed.events.length > 20) throw new Error('Structured response contains too many events');
  return { answer: parsed.answer.trim(), events: parsed.events.map(normalizeEvent) };
}

export function validateLearningEnvelope(envelope) {
  const futurePaths = envelope.events.filter(e => e.type === 'future_path');
  const terminalRejection = envelope.events.some(e => e.type === 'rejection' && e.terminal);
  if (!terminalRejection && futurePaths.length === 0) throw new Error('Non-terminal response must include a future_path event');
  return envelope;
}
