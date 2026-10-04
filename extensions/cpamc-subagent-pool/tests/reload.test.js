import { it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

function installedPiLoader() {
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    const cli = path.join(dir, 'pi');
    if (!fs.existsSync(cli)) continue;
    let root = path.dirname(fs.realpathSync(cli));
    while (root !== path.dirname(root)) {
      const loader = path.join(root, 'dist/core/extensions/loader.js');
      if (fs.existsSync(loader)) return pathToFileURL(loader).href;
      root = path.dirname(root);
    }
  }
  throw new Error('Reload integration test requires the installed Pi CLI on PATH');
}

it('actual Pi loader refreshes nested runtime modules after reload', { timeout: 15000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpamc-reload-'));
  const originalHome = process.env.HOME;
  const originalKey = process.env.CLIPROXYAPI_MANAGEMENT_KEY;
  const originalBase = process.env.CLIPROXYAPI_BASE_URL;
  const originalFetch = globalThis.fetch;
  let loaded;
  try {
    const source = fileURLToPath(new URL('../', import.meta.url));
    const runtime = path.join(dir, 'extension');
    fs.mkdirSync(runtime);
    fs.cpSync(path.join(source, 'src'), path.join(runtime, 'src'), { recursive: true });
    fs.copyFileSync(path.join(source, 'package.json'), path.join(runtime, 'package.json'));
    const format = fs.existsSync(path.join(source, 'index.ts')) ? 'ts' : 'js';
    const entry = path.join(runtime, `index.${format}`);
    fs.copyFileSync(path.join(source, `index.${format}`), entry);
    process.env.HOME = dir;
    process.env.CLIPROXYAPI_MANAGEMENT_KEY = 'fixture-key';
    delete process.env.CLIPROXYAPI_BASE_URL;
    const requests = [];
    globalThis.fetch = async (url) => {
      const parsed = new URL(url);
      requests.push(parsed);
      if (parsed.pathname === '/v0/management/auth-files') {
        return Response.json({ files: [{ name: 'google.json', auth_index: 'opaque' }] });
      }
      if (parsed.pathname === '/v0/management/auth-files/models') {
        return Response.json({ models: [{ id: 'google/gemini-3.8-flash-high' }] });
      }
      assert.equal(parsed.pathname, '/v0/management/api-call');
      return Response.json({ status_code: 200, body: { groups: [{ displayName: 'Gemini Models', buckets: [{ window: '5h', remainingFraction: 0.8 }] }] } });
    };
    const { loadExtensions, clearExtensionCache } = await import(installedPiLoader());
    const stateFile = path.join(dir, '.pi/agent/cpamc-subagent-pool-state.json');
    // Supply the real EventBus to preserve Pi's synchronous cross-extension contract.
    const { createEventBus } = await import(new URL('../event-bus.js', installedPiLoader()));
    const loadAndClaim = async (reason, taskId) => {
      const bus = createEventBus();
      loaded = await loadExtensions([entry], runtime, bus);
      assert.deepEqual(loaded.errors, []);
      const handler = loaded.extensions[0].handlers.get('session_start')[0];
      await handler({ reason });
      const deadline = Date.now() + 3000;
      while (!JSON.parse(fs.readFileSync(stateFile, 'utf8')).accounts[0]?.quota?.lastCheckedAt) {
        assert.ok(Date.now() < deadline, 'startup quota refresh must commit');
        await delay(5);
      }
      let allocator;
      bus.emit('subagents:task:allocate', { taskId, claimModel: (fn) => { allocator = fn; } });
      assert.equal(typeof allocator, 'function');
      return allocator();
    };
    const first = await loadAndClaim('startup', 'first');
    assert.equal(first.model.id, 'google/gemini-3.8-flash-high');
    assert.ok(requests.every((url) => url.port === '8317'));
    await loaded.extensions[0].handlers.get('session_shutdown')[0]({ reason: 'reload' });
    // Clear saved state, so the next startup must fetch and persist again.
    fs.unlinkSync(stateFile);
    for (const [name, before, after] of [
      ['accounts', 'http://127.0.0.1:8317', 'http://127.0.0.1:8318'],
      ['lifecycle', "const DEFAULT_TARGET_MODEL = 'gemini-3.8-flash-high';", "const DEFAULT_TARGET_MODEL = 'gemini-3.7-flash-high';"],
    ]) {
      const file = path.join(runtime, 'src', `${name}.${format}`);
      const text = fs.readFileSync(file, 'utf8');
      assert.ok(text.includes(before));
      fs.writeFileSync(file, text.replace(before, after));
    }
    requests.length = 0;
    clearExtensionCache();
    const second = await loadAndClaim('reload', 'second');
    assert.equal(second.model.id, 'google/gemini-3.7-flash-high');
    assert.ok(requests.length >= 3);
    assert.ok(requests.every((url) => url.port === '8318'), 'reload must refresh nested accounts module too');
    assert.equal(JSON.parse(fs.readFileSync(stateFile, 'utf8')).accounts[0].quota.remainingFraction, 0.8);
  } finally {
    if (loaded?.extensions[0]) await loaded.extensions[0].handlers.get('session_shutdown')[0]({ reason: 'quit' });
    if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
    if (originalKey === undefined) delete process.env.CLIPROXYAPI_MANAGEMENT_KEY; else process.env.CLIPROXYAPI_MANAGEMENT_KEY = originalKey;
    if (originalBase === undefined) delete process.env.CLIPROXYAPI_BASE_URL; else process.env.CLIPROXYAPI_BASE_URL = originalBase;
    globalThis.fetch = originalFetch;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
