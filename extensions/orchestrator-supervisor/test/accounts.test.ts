import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { QuotaManager } from '../src/quota-manager.ts';

/**
 * Account discovery is quota metadata only: the routing catalogue itself comes from the
 * Pi registry callback, and automatic routing competes over the saved slots below.
 */
async function fixture() {
  const accounts = [
    { name: 'g2', auth_index: 'g2-index', provider: 'antigravity', models: ['fallback-b/gemini-3.8-flash-high'], remaining: 0.7 },
    { name: 'c3', auth_index: 3, provider: 'codex', models: ['third/gpt-6.1-sol'], used: 20 },
    { name: 'g1', auth_index: 4, provider: 'antigravity', models: ['fallback-a/gemini-3.8-flash-high'], remaining: 0 },
    { name: 'c1', auth_index: 1, provider: 'codex', models: ['main/gpt-6.1-sol'], used: 99 },
    { name: 'c2', auth_index: 2, provider: 'codex', models: ['second/gpt-6.1-sol'], used: 99 },
    { name: 'disabled', auth_index: 5, provider: 'codex', models: ['disabled/gpt-6.1-sol'], used: 0, disabled: true },
    { name: 'unregistered', auth_index: 6, provider: 'antigravity', models: ['unregistered/gemini-3.8-flash-high'], remaining: 1 },
  ];
  const calls: any[] = [];
  const server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const url = new URL(req.url!, 'http://localhost');
    if (url.pathname.endsWith('/auth-files')) {
      res.end(JSON.stringify({ files: accounts.map(({ models, used, remaining, ...a }) => a) })); return;
    }
    if (url.pathname.endsWith('/auth-files/models')) {
      const a = accounts.find(a => a.name === url.searchParams.get('name'));
      res.end(JSON.stringify({ models: a?.models.map(id => ({ id })) ?? [] })); return;
    }
    let body = ''; for await (const chunk of req) body += chunk;
    const input = JSON.parse(body); calls.push(input);
    const a = accounts.find(a => a.auth_index === input.auth_index)!;
    res.end(JSON.stringify(input.url.includes('/wham/') ? { rate_limit: {
      allowed: true, primary_window: { limit_window_seconds: 18000, used_percent: a.used, reset_at: 2000000000 },
      secondary_window: { limit_window_seconds: 604800, used_percent: 0, reset_at: 2000000000 },
    } } : { groups: [{ displayName: 'Google Models', buckets: [{ remainingFraction: a.remaining }] }] }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as any;
  const qm = new QuotaManager({ baseUrl: `http://127.0.0.1:${address.port}`, maxRetries: 1 });
  return { accounts, calls, qm, close: () => new Promise<void>(resolve => server.close(() => resolve())) };
}
const registered = (id: string) => !id.includes('unregistered/');

test('all discovered Codex accounts precede every Gemini fallback; per-account quotas are isolated', async () => {
  const f = await fixture();
  try {
    await f.qm.discoverCandidates(registered);
    assert.deepEqual(f.qm.getCandidates().map(c => c.id), [
      'cliproxyapi/main/gpt-6.1-sol', 'cliproxyapi/second/gpt-6.1-sol', 'cliproxyapi/third/gpt-6.1-sol',
      'cliproxyapi/fallback-a/gemini-3.8-flash-high', 'cliproxyapi/fallback-b/gemini-3.8-flash-high',
    ]);
    // The saved selection names every addressable account, most important first.
    f.qm.setPriorityCandidateIds(f.qm.getCandidates().map(c => c.id));
    assert.equal((await f.qm.selectBestCandidate()).candidate?.prefix, 'third');
    f.accounts.find(a => a.name === 'c3')!.used = 99;
    assert.equal((await f.qm.selectBestCandidate()).candidate?.prefix, 'fallback-b');
    const geminiCalls = f.calls.filter(c => c.url.includes('retrieveUserQuotaSummary'));
    assert.deepEqual(geminiCalls.map(c => c.auth_index), [4, 'g2-index']);
    f.accounts.find(a => a.name === 'g2')!.remaining = 0;
    assert.equal((await f.qm.selectBestCandidate()).allUnavailable, true);
    f.accounts.find(a => a.name === 'c3')!.used = 0;
    assert.equal((await f.qm.checkResetReturn('cliproxyapi/fallback-b/gemini-3.8-flash-high')).targetCandidate?.prefix, 'third');
  } finally { await f.close(); }
});

test('refresh rejects ambiguous routing, picks registered alternatives, and drops disabled accounts', async () => {
  const f = await fixture();
  try {
    f.accounts.push({ name: 'duplicate', auth_index: 30, provider: 'codex', models: ['third/gpt-6.1-sol'], used: 0 });
    f.accounts.find(a => a.name === 'g2')!.models = ['fallback-b/gemini-2.5-flash', 'gemini-3.8-flash-high'];
    await f.qm.discoverCandidates(registered);
    assert.equal(f.qm.getCandidates().some(c => c.prefix === 'third'), false);
    assert.equal(f.qm.getCandidates().find(c => c.prefix === 'fallback-b')?.modelSlug, 'gemini-2.5-flash');
    f.accounts.find(a => a.name === 'g2')!.disabled = true;
    await f.qm.discoverCandidates(registered);
    assert.equal(f.qm.getCandidates().some(c => c.prefix === 'fallback-b'), false);
    assert.equal(f.qm.getCandidates().some(c => c.prefix === 'disabled' || c.prefix === 'unregistered'), false);
  } finally { await f.close(); }
});
