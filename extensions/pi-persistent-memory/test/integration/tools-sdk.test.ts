import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createAgentSession,
  SessionManager,
  SettingsManager,
  DefaultResourceLoader,
  ModelRuntime,
} from '@earendil-works/pi-coding-agent';
import { withDatabase } from '../../src/storage/db.ts';
import { MemoryLifecycle } from '../../src/lifecycle.ts';
import { createMemoryTools } from '../../src/tools/index.ts';
import { createMemoryExtension } from '../../src/extension.ts';
import type { InvocationLeaseV1, InvocationIdentityV1 } from '../../src/protocol.ts';

function createTempFixture(name: string): { dir: string; dbPath: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), `pi-memory-mini-005-${name}-`));
  const dbPath = join(dir, 'memories.db');
  return {
    dir,
    dbPath,
    cleanup: () => {
      try {
        if (dir.includes('pi-memory-mini-005-')) {
          rmSync(dir, { recursive: true, force: true });
        }
      } catch {}
    },
  };
}

test('M5-A02: Tool execution before first user message fails with session_not_active without opening DB', async () => {
  const { dbPath, cleanup } = createTempFixture('gate-before');
  try {
    const lifecycle = new MemoryLifecycle(dbPath);
    const tools = createMemoryTools(lifecycle);
    const saveTool = tools.find((t) => t.name === 'memory_save')!;

    // Call before any message_start
    await assert.rejects(
      async () => {
        await saveTool.execute('call-1', { action: 'save', title: 'T', content: 'C', type: 'note' }, undefined, undefined, {} as any);
      },
      /session_not_active/,
    );

    // Verify DB was NOT even created
    assert.equal(existsSync(dbPath), false, 'DB must not be created before first user message');
  } finally {
    cleanup();
  }
});

test('M5-A02: First user message activates normal session and tools execute successfully', async () => {
  const { dir, dbPath, cleanup } = createTempFixture('gate-activate');
  try {
    const lifecycle = new MemoryLifecycle(dbPath);
    const tools = createMemoryTools(lifecycle);
    const saveTool = tools.find((t) => t.name === 'memory_save')!;
    const getTool = tools.find((t) => t.name === 'memory_get')!;

    const ctx = {
      sessionId: 'sess-normal-1',
      cwd: dir,
      isProjectTrusted: () => true,
    };

    // First user message activates
    await lifecycle.handleMessageStart({ message: { role: 'user' } }, ctx);
    assert.equal(existsSync(dbPath), true, 'DB should now be initialized');

    // Tool executes successfully
    const saveRes = await saveTool.execute(
      'call-1',
      { action: 'save', title: 'First Note', content: 'Content of first note', type: 'note' },
      undefined,
      undefined,
      ctx as any,
    );
    assert.equal(saveRes.isError, false);
    const memId = (saveRes.details as any)?.id;
    assert.ok(memId > 0);

    // Get detail
    const getRes = await getTool.execute(
      'call-2',
      { id: memId },
      undefined,
      undefined,
      ctx as any,
    );
    assert.equal(getRes.isError, false);
    const firstBlock: any = getRes.content[0];
    assert.match(firstBlock?.text ?? '', /First Note/);
  } finally {
    cleanup();
  }
});

test('M5-A02: Terminated child lease binding never falls back to standalone execution', async () => {
  const { dir, dbPath, cleanup } = createTempFixture('lease-fail');
  try {
    const lifecycle = new MemoryLifecycle(dbPath);
    const tools = createMemoryTools(lifecycle);
    const saveTool = tools.find((t) => t.name === 'memory_save')!;

    let capturedLease: InvocationLeaseV1 | undefined;
    const identity: InvocationIdentityV1 = {
      version: 1,
      invocationId: 'inv-fail-1',
      childSessionId: 'child-sess-fail-1',
      invokingParentSessionId: 'parent-sess-1',
      taskId: 'task-1',
      attempt: 1,
    };

    lifecycle.bindChildInvocation({
      version: 1,
      identity,
      childContext: { cwd: dir, isProjectTrusted: () => true },
      accept: (lease) => {
        capturedLease = lease;
      },
    });

    assert.ok(capturedLease);
    await capturedLease.activate();
    // Terminate the lease
    await capturedLease.terminate('completed');

    // Executing tool through lifecycle now MUST fail with invocation_terminated
    await assert.rejects(
      async () => {
        await saveTool.execute(
          'call-1',
          { action: 'save', title: 'Late Note', content: 'Should fail', type: 'note' },
          undefined,
          undefined,
          {} as any,
        );
      },
      /invocation_terminated/,
    );
  } finally {
    cleanup();
  }
});

test('M5-A02: Session shutdown/reload cancels in-flight operations and marks generation unusable', async () => {
  const { dir, dbPath, cleanup } = createTempFixture('shutdown-abort');
  try {
    const lifecycle = new MemoryLifecycle(dbPath);
    const tools = createMemoryTools(lifecycle);
    const saveTool = tools.find((t) => t.name === 'memory_save')!;

    const ctx = {
      sessionId: 'sess-to-shutdown',
      cwd: dir,
      isProjectTrusted: () => true,
    };

    await lifecycle.handleMessageStart({ message: { role: 'user' } }, ctx);

    // Shutdown session
    await lifecycle.handleSessionShutdown('quit', 'sess-to-shutdown');

    // Subsequent tool execution fails because session generation was shut down
    await assert.rejects(
      async () => {
        await saveTool.execute(
          'call-1',
          { action: 'save', title: 'T', content: 'C', type: 'note' },
          undefined,
          undefined,
          ctx as any,
        );
      },
      /session_not_active/,
    );
  } finally {
    cleanup();
  }
});

test('M5-A08: Real isolated SDK session executes memory tools deterministically', async () => {
  const { dir, dbPath, cleanup } = createTempFixture('sdk-tools-loop');
  try {
    const extensionFactory = createMemoryExtension(dbPath);

    const resourceLoader = new DefaultResourceLoader({
      cwd: dir,
      agentDir: dir,
      extensionFactories: [extensionFactory],
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
    });
    await resourceLoader.reload();

    const settingsManager = SettingsManager.inMemory({}, { projectTrusted: true });
    const sessionManager = SessionManager.inMemory(dir);

    const modelRuntime = await ModelRuntime.create();
    modelRuntime.hasConfiguredAuth = () => true;
    modelRuntime.checkAuth = async () => ({ type: 'api_key', apiKey: 'mock' });

    let turn = 0;
    const mockModel: any = {
      id: 'mock-model',
      provider: 'mock-provider',
      api: 'chat',
      name: 'Mock Model',
    };

    modelRuntime.streamSimple = (model: any, context: any, options: any) => {
      turn++;
      if (turn === 1) {
        const msg: any = {
          role: 'assistant',
          stopReason: 'toolUse',
          content: [
            {
              type: 'toolCall',
              id: 'call_save',
              name: 'memory_save',
              arguments: {
                action: 'save',
                title: 'SDK Architecture Note',
                content: 'Verified isolated tool loop in SDK.',
                type: 'architecture',
              },
            },
          ],
          api: 'chat',
          provider: 'mock-provider',
          model: 'mock-model',
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          timestamp: Date.now(),
        };
        return {
          async *[Symbol.asyncIterator]() {
            yield { type: 'start', partial: msg };
            yield { type: 'toolcall_start', contentIndex: 0, id: 'call_save', toolName: 'memory_save', partial: msg };
            yield {
              type: 'toolcall_end',
              contentIndex: 0,
              toolCall: {
                id: 'call_save',
                name: 'memory_save',
                arguments: {
                  action: 'save',
                  title: 'SDK Architecture Note',
                  content: 'Verified isolated tool loop in SDK.',
                  type: 'architecture',
                },
              },
              partial: msg,
            };
            yield { type: 'done', reason: 'toolUse', message: msg };
          },
          result: async () => msg,
        } as any;
      }

      // Turn 2: call memory_context
      if (turn === 2) {
        const msg: any = {
          role: 'assistant',
          stopReason: 'toolUse',
          content: [
            {
              type: 'toolCall',
              id: 'call_ctx',
              name: 'memory_context',
              arguments: {},
            },
          ],
          api: 'chat',
          provider: 'mock-provider',
          model: 'mock-model',
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          timestamp: Date.now(),
        };
        return {
          async *[Symbol.asyncIterator]() {
            yield { type: 'start', partial: msg };
            yield { type: 'toolcall_start', contentIndex: 0, id: 'call_ctx', toolName: 'memory_context', partial: msg };
            yield {
              type: 'toolcall_end',
              contentIndex: 0,
              toolCall: {
                id: 'call_ctx',
                name: 'memory_context',
                arguments: {},
              },
              partial: msg,
            };
            yield { type: 'done', reason: 'toolUse', message: msg };
          },
          result: async () => msg,
        } as any;
      }

      // Final turn: text response
      const textMsg: any = {
        role: 'assistant',
        stopReason: 'stop',
        content: [{ type: 'text', text: 'Memory operations completed successfully.' }],
        api: 'chat',
        provider: 'mock-provider',
        model: 'mock-model',
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        timestamp: Date.now(),
      };
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: 'start', partial: textMsg };
          yield { type: 'text_start', contentIndex: 0, partial: textMsg };
          yield { type: 'text_delta', contentIndex: 0, delta: 'Memory operations completed successfully.', partial: textMsg };
          yield { type: 'text_end', contentIndex: 0, content: 'Memory operations completed successfully.', partial: textMsg };
          yield { type: 'done', reason: 'stop', message: textMsg };
        },
        result: async () => textMsg,
      } as any;
    };

    const sessionResult = await createAgentSession({
      cwd: dir,
      agentDir: dir,
      sessionManager,
      settingsManager,
      modelRuntime,
      model: mockModel,
      resourceLoader,
    });

    assert.ok(sessionResult.session);
    const session = sessionResult.session;

    // Send user message
    await session.prompt('Save memory note and check context');

    // Verify turn occurred and memory was saved in DB
    assert.ok(turn >= 2, `Expected at least 2 turns, got ${turn}`);
    withDatabase(dbPath, (db) => {
      const rows = db.prepare("SELECT * FROM memories WHERE title = 'SDK Architecture Note';").all() as any[];
      assert.equal(rows.length, 1);
      assert.equal(rows[0].type, 'architecture');
    });

    await session.dispose();
  } finally {
    cleanup();
  }
});
