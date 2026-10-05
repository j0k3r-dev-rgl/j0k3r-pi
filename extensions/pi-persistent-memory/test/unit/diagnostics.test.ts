import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer, type Server } from 'node:http';
import { withDatabase } from '../../src/storage/db.ts';
import { initSchema } from '../../src/storage/schema.ts';
import { activateSession } from '../../src/storage/session-store.ts';
import { createMemory } from '../../src/storage/memory-store.ts';
import { E5Client } from '../../src/client/e5-client.ts';
import { MemoryLifecycle } from '../../src/lifecycle.ts';
import { ActivationDiagnostics } from '../../src/diagnostics/activation.ts';

function createTempDb(): { dir: string; dbPath: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'pi-memory-mini-002-diag-'));
  const dbPath = join(dir, 'memories.db');
  return {
    dir,
    dbPath,
    cleanup: () => {
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    },
  };
}

function createMockServer(handler: (req: any, res: any) => void): Promise<{ server: Server; url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      const url = `http://127.0.0.1:${addr.port}`;
      resolve({
        server,
        url,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

const CANONICAL_MODEL = 'intfloat/e5-small-v2';
const CANONICAL_REVISION = 'ffb93f3bd4047442299a41ebb6fa998a38507c52';

test('M2-A07: Diagnostics count scope pending and detect elsewhere pending', async () => {
  const { dbPath, cleanup } = createTempDb();

  const mock = await createMockServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ready',
      model: CANONICAL_MODEL,
      model_revision: CANONICAL_REVISION,
      dimensions: 384,
      normalization: 'l2',
      max_input_tokens: 512,
    }));
  });

  try {
    withDatabase(dbPath, (db) => {
      initSchema(db);
      activateSession(db, 'sess-1', '["project","/app1"]', 'normal');
      activateSession(db, 'sess-2', '["project","/app2"]', 'normal');

      // 2 pending in app1
      createMemory(db, { scopeKey: '["project","/app1"]', title: 'T1', content: 'C1', type: 'fact', sessionId: 'sess-1' });
      createMemory(db, { scopeKey: '["project","/app1"]', title: 'T2', content: 'C2', type: 'fact', sessionId: 'sess-1' });

      // 1 pending in app2
      createMemory(db, { scopeKey: '["project","/app2"]', title: 'T3', content: 'C3', type: 'fact', sessionId: 'sess-2' });
    });

    const client = new E5Client(mock.url);
    const diag = new ActivationDiagnostics(dbPath, client);

    let notifiedMessage = '';
    const ctx = {
      ui: {
        notify: (msg: string) => { notifiedMessage = msg; },
      },
    };

    await diag.runDiagnostics('["project","/app1"]', 'sess-1', ctx);

    assert.ok(notifiedMessage.includes('2 pending in scope'), `Expected "2 pending in scope", got: ${notifiedMessage}`);
    assert.ok(notifiedMessage.includes('pending elsewhere'), `Expected notice of pending elsewhere, got: ${notifiedMessage}`);
    assert.ok(notifiedMessage.includes('Service ready'), `Expected service ready, got: ${notifiedMessage}`);
  } finally {
    await mock.close();
    cleanup();
  }
});

test('M2-A07: Nonblocking activation: handleMessageStart returns immediately while diagnostics run in background', async () => {
  const { dbPath, cleanup } = createTempDb();
  let serverResolve: () => void;
  const serverGate = new Promise<void>((r) => { serverResolve = r; });

  const mock = await createMockServer((_req, res) => {
    serverGate.then(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ready',
        model: CANONICAL_MODEL,
        model_revision: CANONICAL_REVISION,
        dimensions: 384,
        normalization: 'l2',
        max_input_tokens: 512,
      }));
    });
  });

  try {
    const client = new E5Client(mock.url);
    const lifecycle = new MemoryLifecycle(dbPath, { client });

    let notified = false;
    const ctx = {
      sessionId: 'sess-nb',
      cwd: '/tmp',
      isProjectTrusted: () => true,
      ui: {
        notify: () => { notified = true; },
      },
    };

    const start = Date.now();
    await lifecycle.handleMessageStart({ message: { role: 'user' } }, ctx);
    const elapsed = Date.now() - start;

    // handleMessageStart must return immediately without waiting for server response
    assert.ok(elapsed < 200, `handleMessageStart took too long: ${elapsed}ms`);
    assert.equal(notified, false);

    // Release server gate
    serverResolve!();
    const deadline = Date.now() + 2000;
    while (!notified && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal(notified, true);
  } finally {
    await mock.close();
    cleanup();
  }
});

test('M2-A07: Session reload cancels pending diagnostics and suppresses late notifications', async () => {
  const { dbPath, cleanup } = createTempDb();
  let serverResolve: () => void;
  const serverGate = new Promise<void>((r) => { serverResolve = r; });

  const mock = await createMockServer((_req, res) => {
    serverGate.then(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ready',
        model: CANONICAL_MODEL,
        model_revision: CANONICAL_REVISION,
        dimensions: 384,
        normalization: 'l2',
        max_input_tokens: 512,
      }));
    });
  });

  try {
    const client = new E5Client(mock.url);
    const lifecycle = new MemoryLifecycle(dbPath, { client });

    let notified = false;
    const ctx = {
      sessionId: 'sess-reload',
      cwd: '/tmp',
      isProjectTrusted: () => true,
      ui: {
        notify: () => { notified = true; },
      },
    };

    await lifecycle.handleMessageStart({ message: { role: 'user' } }, ctx);

    // Trigger reload immediately
    await lifecycle.handleSessionShutdown('reload', 'sess-reload');

    // Now release server gate
    serverResolve!();
    await new Promise((r) => setTimeout(r, 50));

    // Notification must be suppressed because session was reloaded
    assert.equal(notified, false);
  } finally {
    await mock.close();
    cleanup();
  }
});

test('M2-A07: Child lease termination cancels pending diagnostics without waiting 3s', async () => {
  const { dbPath, cleanup } = createTempDb();
  let serverResolve: () => void;
  const serverGate = new Promise<void>((r) => { serverResolve = r; });

  const mock = await createMockServer((_req, res) => {
    serverGate.then(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ready',
        model: CANONICAL_MODEL,
        model_revision: CANONICAL_REVISION,
        dimensions: 384,
        normalization: 'l2',
        max_input_tokens: 512,
      }));
    });
  });

  try {
    const client = new E5Client(mock.url);
    const { InvocationLease } = await import('../../src/lease.ts');

    let notified = false;
    const lease = new InvocationLease(
      {
        version: 1,
        invocationId: 'inv-diag-1',
        childSessionId: 'child-sess-diag',
        invokingParentSessionId: 'parent-1',
        taskId: 't-1',
        attempt: 1,
      },
      dbPath,
      {
        cwd: '/tmp',
        isProjectTrusted: () => true,
        ui: {
          notify: () => { notified = true; },
        },
      },
      { client },
    );

    await lease.activate();

    // Terminate immediately: should not wait for server response
    const termStart = Date.now();
    await lease.terminate('completed');
    const termElapsed = Date.now() - termStart;

    assert.ok(termElapsed < 200, `terminate took too long: ${termElapsed}ms`);

    // Release server gate
    serverResolve!();
    await new Promise((r) => setTimeout(r, 50));

    // Notification must be suppressed
    assert.equal(notified, false);
  } finally {
    await mock.close();
    cleanup();
  }
});

test('M2-A07: When ctx.ui.notify is unavailable or in noninteractive/headless mode, diagnostic notice falls back to bounded noninteractive output', async () => {
  const { dbPath, cleanup } = createTempDb();

  const mock = await createMockServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ready',
      model: CANONICAL_MODEL,
      model_revision: CANONICAL_REVISION,
      dimensions: 384,
      normalization: 'l2',
      max_input_tokens: 512,
    }));
  });

  try {
    withDatabase(dbPath, (db) => {
      initSchema(db);
      activateSession(db, 'sess-fallback', '["global"]', 'normal');
      createMemory(db, { scopeKey: '["global"]', title: 'T1', content: 'C1', type: 'fact', sessionId: 'sess-fallback' });
    });

    const client = new E5Client(mock.url);

    // Case 1: ctx has no ui at all (e.g. headless or RPC mode)
    let fallbackNoticeReceived = '';
    const diag = new ActivationDiagnostics(dbPath, client, {
      fallbackNotice: (msg: string) => { fallbackNoticeReceived = msg; },
    });

    const headlessCtx = { hasUI: false };
    await diag.runDiagnostics('["global"]', 'sess-fallback', headlessCtx);

    assert.ok(
      fallbackNoticeReceived.includes('1 pending in scope'),
      `Expected noninteractive notice, got: "${fallbackNoticeReceived}"`,
    );
    assert.ok(fallbackNoticeReceived.includes('Service ready'));

    // Case 2: ctx.ui.notify exists but hasUI is false (SDK headless no-op case)
    fallbackNoticeReceived = '';
    let uiNotifyCalled = false;
    const headlessWithNoopNotifyCtx = {
      hasUI: false,
      ui: {
        notify: () => { uiNotifyCalled = true; },
      },
    };

    const diag2 = new ActivationDiagnostics(dbPath, client, {
      fallbackNotice: (msg: string) => { fallbackNoticeReceived = msg; },
    });
    await diag2.runDiagnostics('["global"]', 'sess-fallback', headlessWithNoopNotifyCtx);

    assert.equal(uiNotifyCalled, false, 'Should not rely solely on ui.notify when hasUI is false');
    assert.ok(fallbackNoticeReceived.includes('1 pending in scope'));

    // Case 3: Late cancellation suppresses noninteractive fallback notice
    fallbackNoticeReceived = '';
    const diag3 = new ActivationDiagnostics(dbPath, client, {
      fallbackNotice: (msg: string) => { fallbackNoticeReceived = msg; },
    });
    diag3.cancel();
    await diag3.runDiagnostics('["global"]', 'sess-fallback', headlessCtx);
    assert.equal(fallbackNoticeReceived, '', 'Cancelled diagnostics must suppress noninteractive fallback notice');
  } finally {
    await mock.close();
    cleanup();
  }
});

