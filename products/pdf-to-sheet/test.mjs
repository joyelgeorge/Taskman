import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRows, toCsv, buildPayload, pdfToRows } from './extract.mjs';

test('parseRows extracts a JSON array wrapped in prose or fences', () => {
  assert.deepEqual(parseRows('here you go:\n```json\n[{"a":1}]\n```'), [{ a: 1 }]);
  assert.deepEqual(parseRows('[{"x":"y"},{"x":"z"}]').length, 2);
});

test('parseRows drops non-object entries and errors when there is no array', () => {
  assert.deepEqual(parseRows('[{"a":1}, 5, null, "x"]'), [{ a: 1 }]);
  assert.throws(() => parseRows('the document has no table'));
});

test('toCsv unions columns in first-seen order and escapes commas/quotes/newlines', () => {
  const csv = toCsv([{ desc: 'Widget, blue', qty: 2 }, { desc: 'Line\n2', total: '5' }]);
  assert.equal(csv, 'desc,qty,total\n"Widget, blue",2,\n"Line\n2",,5\n');
});

test('toCsv of nothing is empty', () => { assert.equal(toCsv([]), ''); });

test('buildPayload sends the PDF as a document block and asks for JSON rows', () => {
  const p = buildPayload({ base64: 'QkFTRTY0', instruction: 'invoice lines', model: 'claude-sonnet-5' });
  assert.equal(p.messages[0].content[0].type, 'document');
  assert.equal(p.messages[0].content[0].source.media_type, 'application/pdf');
  assert.match(p.messages[0].content[1].text, /JSON array/);
  assert.match(p.messages[0].content[1].text, /invoice lines/);
});

test('pdfToRows orchestrates end to end against a mocked API (no key needed)', async () => {
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({ content: [{ type: 'text', text: '[{"item":"A","price":"10"},{"item":"B","price":"20"}]' }] })
  });
  const { rows, csv } = await pdfToRows(Buffer.from('%PDF-1.4 fake'), { apiKey: 'test', fetchImpl: fakeFetch });
  assert.equal(rows.length, 2);
  assert.equal(csv, 'item,price\nA,10\nB,20\n');
});

test('pdfToRows refuses to run without an API key', async () => {
  await assert.rejects(pdfToRows(Buffer.from('x'), { apiKey: '' }));
});
