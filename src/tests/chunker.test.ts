import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeJsonContent,
  generateChunks,
  computeSha256,
  formatRecordForChat,
} from '../lib/jsonEngine';

test('SHA-256 calculation produces 64-char hex string', async () => {
  const hash = await computeSha256('{"hello":"world"}');
  assert.equal(typeof hash, 'string');
  assert.equal(hash.length, 64);
});

test('analyzeJsonContent correctly parses root array structure', () => {
  const sample = JSON.stringify([
    { id: 1, name: 'Alice', role: 'admin' },
    { id: 2, name: 'Bob', role: 'editor' },
  ]);
  const analysis = analyzeJsonContent(sample);

  assert.equal(analysis.isValid, true);
  assert.equal(analysis.rootType, 'array');
  assert.equal(analysis.totalRecords, 2);
  assert.equal(analysis.recordsPath, 'item');
  assert.equal(analysis.sampleSchema.name, 'string');
});

test('analyzeJsonContent identifies nested collection inside object', () => {
  const sample = JSON.stringify({
    status: 'success',
    version: '2.0',
    records: [
      { id: 101, value: 42.5 },
      { id: 102, value: 99.1 },
      { id: 103, value: 12.0 },
    ],
  });
  const analysis = analyzeJsonContent(sample);

  assert.equal(analysis.isValid, true);
  assert.equal(analysis.rootType, 'object');
  assert.equal(analysis.recordsPath, 'records.item');
  assert.equal(analysis.totalRecords, 3);
  assert.ok(analysis.availableSections.includes('records'));
});

test('analyzeJsonContent catches corrupt JSON gracefully', () => {
  const corrupt = '[{"id": 1, "unclosed: ';
  const analysis = analyzeJsonContent(corrupt);

  assert.equal(analysis.isValid, false);
  assert.ok(analysis.errorMessage?.includes('syntax error'));
});

test('generateChunks creates valid chunks with accurate remainder logic', async () => {
  // 105 items split into chunks of 40 records
  // Expect: Chunk 1 = 40, Chunk 2 = 40, Chunk 3 = 25
  const dataset = Array.from({ length: 105 }, (_, i) => ({
    id: i + 1,
    title: `Item ${i + 1}`,
    metadata: { tag: `tag_${i % 5}` },
  }));

  const result = await generateChunks(dataset, 40, 'test_file_1');

  assert.equal(result.totalChunks, 3);
  assert.equal(result.chunks[0].recordCount, 40);
  assert.equal(result.chunks[0].recordStart, 1);
  assert.equal(result.chunks[0].recordEnd, 40);

  assert.equal(result.chunks[1].recordCount, 40);
  assert.equal(result.chunks[1].recordStart, 41);
  assert.equal(result.chunks[1].recordEnd, 80);

  // Remainder chunk
  assert.equal(result.chunks[2].recordCount, 25);
  assert.equal(result.chunks[2].recordStart, 81);
  assert.equal(result.chunks[2].recordEnd, 105);

  // Ensure each chunk contains valid nested data
  assert.equal(result.chunks[2].records[0].id, 81);
  assert.equal(result.chunks[2].records[24].id, 105);
});

test('formatRecordForChat truncates oversized records to fit Telegram message limits', () => {
  const hugeRecord = {
    id: 1,
    hugePayload: 'X'.repeat(5000),
  };
  const formatted = formatRecordForChat(1, 100, 'test.json', hugeRecord);
  assert.ok(formatted.includes('[truncated for chat view]'));
  assert.ok(formatted.length < 3500);
});
