import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUsageCache } from '../src/cache.ts';

test('cache preloads, deduplicates reads and retains the last result on failure', async () => {
  let calls = 0;
  let fail = false;
  const cache = createUsageCache(async () => {
    calls++;
    if (fail) throw new Error('offline');
    return [];
  });
  await Promise.all([cache.load(), cache.load()]);
  assert.equal(calls, 1);
  await cache.load();
  assert.equal(calls, 1);
  assert.ok(cache.snapshot().updatedAt);
  fail = true;
  await assert.rejects(cache.load(true));
  assert.deepEqual(cache.snapshot().groups, []);
  assert.equal(cache.snapshot().error, 'No se pudo actualizar quota');
  cache.stop();
});

test('background loading starts without awaiting network and stops its timer', async (t) => {
  let calls = 0;
  const cache = createUsageCache(async () => { calls++; return []; }, 20);
  t.after(() => cache.stop());
  cache.start();
  await new Promise(resolve => setTimeout(resolve, 55));
  assert.ok(calls >= 2);
  cache.stop();
  const stopped = calls;
  await new Promise(resolve => setTimeout(resolve, 35));
  assert.equal(calls, stopped);
});
