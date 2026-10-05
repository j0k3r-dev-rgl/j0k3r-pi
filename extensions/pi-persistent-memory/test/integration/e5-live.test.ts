import test from 'node:test';
import assert from 'node:assert/strict';
import { E5Client } from '../../src/client/e5-client.ts';

const isLiveOptIn = process.env.LIVE_SMOKE === '1';

test(
  'M2-A08: Live E5 smoke test performs exactly one query and one passage against running service',
  { skip: !isLiveOptIn ? 'Live smoke test requires explicit opt-in (LIVE_SMOKE=1)' : false },
  async (t) => {
    const client = new E5Client('http://127.0.0.1:8000');
  const health = await client.health();

  if (health.state !== 'ready') {
    t.diagnostic(`Live E5 service not ready (${health.state}: ${(health as any).message ?? 'unreachable'}). Live smoke skipped without restart.`);
    return;
  }

  t.diagnostic(`Live E5 service ready: model=${health.model}, revision=${health.model_revision}`);

  // 1. Exactly ONE query POST
  const queryText = 'What is persistent memory?';
  const queryResult = await client.embedQuery(queryText);

  assert.equal(queryResult.model, 'intfloat/e5-small-v2');
  assert.equal(queryResult.model_revision, 'ffb93f3bd4047442299a41ebb6fa998a38507c52');
  assert.equal(queryResult.dimensions, 384);
  assert.equal(queryResult.normalization, 'l2');
  assert.equal(queryResult.chunks.length, 1);
  assert.equal(queryResult.chunks[0].text, queryText);
  assert.equal(queryResult.chunks[0].start, 0);
  assert.equal(queryResult.chunks[0].end, Array.from(queryText).length);
  assert.equal(queryResult.chunks[0].embedding.length, 384);

  const queryNorm = Math.sqrt(queryResult.chunks[0].embedding.reduce((sum, v) => sum + v * v, 0));
  assert.ok(Math.abs(queryNorm - 1.0) <= 1e-4, `Query vector norm ${queryNorm} outside tolerance`);

  // 2. Exactly ONE passage POST
  const passageTitle = 'Live Smoke Title';
  const passageContent = 'Testing live E5 embeddings passage with Unicode: á, é, í, ó, ú, ñ and astral emoji 🚀.';
  const composedPassage = `${passageTitle}\n${passageContent}`;

  const passageResult = await client.embedPassage(composedPassage);

  assert.equal(passageResult.model, 'intfloat/e5-small-v2');
  assert.equal(passageResult.model_revision, 'ffb93f3bd4047442299a41ebb6fa998a38507c52');
  assert.equal(passageResult.dimensions, 384);
  assert.equal(passageResult.normalization, 'l2');
  assert.ok(passageResult.chunks.length >= 1, 'Passage must return at least 1 chunk');

  // Verify first and last chunk code point bounds
  const codePoints = Array.from(composedPassage);
  assert.equal(passageResult.chunks[0].start, 0);
  assert.equal(passageResult.chunks[passageResult.chunks.length - 1].end, codePoints.length);

  for (const chunk of passageResult.chunks) {
    assert.equal(chunk.embedding.length, 384);
    const chunkNorm = Math.sqrt(chunk.embedding.reduce((sum, v) => sum + v * v, 0));
    assert.ok(Math.abs(chunkNorm - 1.0) <= 1e-4, `Passage chunk norm ${chunkNorm} outside tolerance`);
  }

  t.diagnostic(`Live E5 smoke completed successfully: 1 query (${queryResult.chunks.length} chunk), 1 passage (${passageResult.chunks.length} chunks)`);
});
