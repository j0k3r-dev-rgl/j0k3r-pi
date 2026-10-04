import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { discoverAccounts } from '../src/accounts.js';

describe('Account discovery and correlation', () => {
  it('discovers only Gemini prefixes from per-account models without local credentials', async () => {
    const files = [
      { name: 'google + one.json', auth_index: 'opaque-google', provider: 'antigravity' },
      { name: 'codex.json', auth_index: 'opaque-codex', provider: 'codex' },
      { name: 'claude.json', auth_index: 'opaque-claude', provider: 'antigravity' },
      { name: 'disabled.json', auth_index: 'opaque-disabled', disabled: true },
      { name: 'no-prefix.json', auth_index: 'opaque-unprefixed' },
    ];
    const catalogs = {
      'google + one.json': ['google/gemini-3.8-flash-high', 'google/gemini-3.7-flash-high', 'google/claude-sonnet', 'gemini-3.8-flash-high'],
      'codex.json': ['main/gpt-6', 'second/gpt-6', 'main/not-gemini'],
      'claude.json': ['claude-only/claude-sonnet'],
      'no-prefix.json': ['gemini-3.8-flash-high'],
    };
    const requested = [];
    const accounts = await discoverAccounts({
      authDir: '/does-not-exist', baseUrl: 'http://fixture', managementKey: 'fixture-key',
      fetchFn: async (url, init) => {
        assert.equal(init.headers.Authorization, 'Bearer fixture-key');
        const parsed = new URL(url);
        if (parsed.pathname === '/v0/management/auth-files') return Response.json({ files });
        assert.equal(parsed.pathname, '/v0/management/auth-files/models');
        const name = parsed.searchParams.get('name');
        requested.push(name);
        return Response.json({ models: catalogs[name].map((id) => ({ id })) });
      },
    });
    assert.deepEqual(accounts, [{ prefix: 'google', authIndex: 'opaque-google', email: '', status: 'unknown' }]);
    assert.ok(requested.includes('google + one.json'));
    assert.ok(!requested.includes('disabled.json'));
  });

  it('sorts unique Gemini prefixes and excludes shared ambiguous prefixes and malformed entries', async () => {
    const files = ['z', 'a', 'shared-1', 'shared-2'].map((name) => ({ name, auth_index: name }));
    files.push({ name: 'invalid-index', auth_index: '' });
    const catalogs = {
      z: [{ id: 'z/gemini-3.8-flash-high' }, { id: 'z/gemini-3.7-flash-high' }, { id: 'z/gpt-6' }, null, {}, { id: 42 }],
      a: [{ id: 'a/gemini-3.8-flash-high' }],
      'shared-1': [{ id: 'shared/gemini-3.8-flash-high' }],
      'shared-2': [{ id: 'shared/gemini-3.8-flash-high' }],
    };
    const accounts = await discoverAccounts({ managementKey: 'fixture', fetchFn: async (url) => {
      const name = new URL(url).searchParams.get('name');
      return Response.json(name ? { models: catalogs[name] } : { files });
    } });
    assert.deepEqual(accounts.map((a) => [a.prefix, a.authIndex]), [['a', 'a'], ['z', 'z']]);
  });

  it('does not infer prefixes on model lookup failure and propagates cancellation during lookup', async () => {
    const files = [{ name: 'google.json', auth_index: 'opaque', prefix: 'unverified' }];
    assert.deepEqual(await discoverAccounts({ managementKey: 'fixture', fetchFn: async (url) => {
      return new URL(url).search ? new Response('', { status: 500 }) : Response.json({ files });
    } }), []);
    const controller = new AbortController();
    await assert.rejects(discoverAccounts({ managementKey: 'fixture', signal: controller.signal, fetchFn: async (url) => {
      if (new URL(url).search) { controller.abort(); throw controller.signal.reason; }
      return Response.json({ files });
    } }), { name: 'AbortError' });
  });

  it('bounds auth-files fetch and body read, and propagates abort', async () => {
    for (const read of [false, true]) {
      const result = await Promise.race([discoverAccounts({ managementKey: 'fixture', timeoutMs: 20, fetchFn: async () => read ? new Response(new ReadableStream({ start() {} })) : new Promise(() => {}) }), new Promise((resolve) => setTimeout(() => resolve('pending'), 100))]);
      assert.deepEqual(result, []);
    }
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(discoverAccounts({ signal: controller.signal }), { name: 'AbortError' });
  });

  it('handles missing key/directory, malformed inventory, and oversized responses safely', async () => {
    assert.deepEqual(await discoverAccounts({ managementKey: '', fetchFn: () => { throw new Error('must not fetch'); } }), []);
    assert.deepEqual(await discoverAccounts({ authDir: '/does-not-exist', managementKey: 'fixture', fetchFn: async () => Response.json({ files: [{ name: 'missing.json', auth_index: 'opaque' }] }) }), []);
    assert.deepEqual(await discoverAccounts({ managementKey: 'fixture', fetchFn: async () => new Response('x'.repeat(1024 * 1024 + 1)) }), []);
  });
});
