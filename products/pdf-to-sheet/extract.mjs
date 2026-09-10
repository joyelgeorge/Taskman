/**
 * PDF -> clean spreadsheet, via Claude's native PDF reading.
 *
 * This is the fulfilment engine behind the extraction gig: the operator points
 * it at a customer's PDF and gets a CSV back in seconds — the edge that beats a
 * freelancer typing it by hand. Claude reads the PDF directly (digital text AND
 * scanned pages), so there is no OCR step and no brittle parser to babysit; the
 * messy, multi-column, scanned documents that generic converters mangle are
 * exactly the ones this handles, which is the whole reason to exist.
 *
 * Deterministic pieces (CSV shaping, model-output parsing) are pure and tested.
 * The one network call is isolated so the rest is verifiable without a key.
 */

const API = 'https://api.anthropic.com/v1/messages';

/** Pull a JSON array out of a model reply that may wrap it in prose or fences. */
export function parseRows(text) {
  if (typeof text !== 'string') throw new Error('model reply was not text');
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('no JSON array in model reply — the document may have no tabular data');
  }
  const rows = JSON.parse(text.slice(start, end + 1));
  if (!Array.isArray(rows)) throw new Error('parsed value was not an array');
  return rows.filter((r) => r && typeof r === 'object' && !Array.isArray(r));
}

/** Rows (array of flat objects) -> CSV. Column order = first-seen across rows. */
export function toCsv(rows) {
  if (!rows.length) return '';
  const cols = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!cols.includes(k)) cols.push(k);
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [cols.map(esc).join(',')];
  for (const r of rows) lines.push(cols.map((c) => esc(r[c])).join(','));
  return lines.join('\n') + '\n';
}

/** Build the messages payload for a PDF + an extraction instruction. */
export function buildPayload({ base64, instruction, model }) {
  const want = instruction && instruction.trim()
    ? `Extract: ${instruction.trim()}.`
    : 'Extract every row of tabular / line-item data (e.g. invoice lines, transactions, table rows).';
  return {
    model: model || process.env.PDF_MODEL || 'claude-sonnet-5',
    max_tokens: 8000,
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
        { type: 'text', text:
          `${want}\n\nReturn ONLY a JSON array of objects, one object per row, with consistent, `
          + `snake_case keys taken from the document's own column headers. Preserve values exactly as `
          + `written (do not reformat numbers or dates). If a cell is blank, use an empty string. No `
          + `commentary, no markdown — just the JSON array.` }
      ]
    }]
  };
}

/** One extraction. Returns { rows, csv }. Requires ANTHROPIC_API_KEY. */
export async function pdfToRows(pdfBytes, { instruction = '', model, apiKey = process.env.ANTHROPIC_API_KEY, fetchImpl = fetch } = {}) {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required — set it in the environment before running');
  const base64 = Buffer.from(pdfBytes).toString('base64');
  const res = await fetchImpl(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(buildPayload({ base64, instruction, model }))
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text = (data.content || []).map((c) => c.text || '').join('');
  const rows = parseRows(text);
  return { rows, csv: toCsv(rows) };
}
