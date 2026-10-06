import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  createEventBus,
  ModelRuntime,
} from '@earendil-works/pi-coding-agent';
import { withDatabase } from '../../src/storage/db.ts';
import { getSession } from '../../src/storage/session-store.ts';
import { createMemory } from '../../src/storage/memory-store.ts';
import { MemoryLifecycle } from '../../src/lifecycle.ts';
import type { InvocationLeaseV1, InvocationIdentityV1 } from '../../src/protocol.ts';
import { OfflineE5Client } from '../fixtures/offline-e5.ts';

function createTempFixture(name: string): { dir: string; dbPath: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), `pi-memory-mini-001-${name}-`));
  const dbPath = join(dir, 'memories.db');
  return {
    dir,
    dbPath,
    cleanup: () => {
      try {
        if (dir.startsWith('/tmp/pi-memory-mini-001-')) {
          rmSync(dir, { recursive: true, force: true });
        }
      } catch {}
    },
  };
}

test('M1-A09: Isolated SDK session with DefaultResourceLoader, inline adapter, and real EventBus', async () => {
  const { dir, dbPath, cleanup } = createTempFixture('sdk-subagent');
  try {
    const lifecycle = new MemoryLifecycle(dbPath, { client: new OfflineE5Client() });
    const childEventBus = createEventBus();

    let capturedLease: InvocationLeaseV1 | undefined;
    let bindCalled = false;

    const identity: InvocationIdentityV1 = {
      version: 1,
      invocationId: 'sdk-inv-1',
      childSessionId: 'sdk-child-sess-1',
      invokingParentSessionId: 'sdk-parent-sess-1',
      taskId: 'sdk-task-1',
      attempt: 1,
    };

    // 1. Adapter inline extension
    const inlineAdapter = {
      name: 'memory-invocation-adapter-v1',
      factory: (pi: any) => {
        pi.events.emit('memory:invocation:bind:v1', {
          version: 1,
          identity,
          childContext: { cwd: dir, isProjectTrusted: () => true },
          accept(lease: InvocationLeaseV1) {
            capturedLease = lease;
            bindCalled = true;
          },
        });

        pi.on('message_start', async (event: any) => {
          if (event?.message?.role === 'user' && capturedLease) {
            await capturedLease.activate();
          }
        });
      },
    };

    // 2. Register memory extension on childEventBus
    const unsubMemory = childEventBus.on('memory:invocation:bind:v1', (request: any) => {
      lifecycle.bindChildInvocation(request);
    });

    const settingsManager = SettingsManager.inMemory({}, { projectTrusted: true });
    const sessionManager = SessionManager.inMemory(dir);

    // 3. Deterministic in-process model runtime and tool execution
    const modelRuntime = await ModelRuntime.create();
    modelRuntime.hasConfiguredAuth = () => true;
    modelRuntime.checkAuth = async () => ({ type: 'api_key', apiKey: 'mock' });

    let turn = 0;
    let toolExecuted = false;

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
          content: [{
            type: 'toolCall',
            id: 'call_1',
            name: 'record_observation',
            arguments: { note: 'Learned something during subagent execution' },
          }],
          api: 'chat',
          provider: 'mock-provider',
          model: 'mock-model',
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          timestamp: Date.now(),
        };
        return {
          async *[Symbol.asyncIterator]() {
            yield { type: 'start', partial: msg };
            yield { type: 'toolcall_start', contentIndex: 0, id: 'call_1', toolName: 'record_observation', partial: msg };
            yield { type: 'toolcall_end', contentIndex: 0, toolCall: { id: 'call_1', name: 'record_observation', arguments: { note: 'Learned something during subagent execution' } }, partial: msg };
            yield { type: 'done', reason: 'toolUse', message: msg };
          },
          result: async () => msg,
        } as any;
      } else {
        const msg: any = {
          role: 'assistant',
          stopReason: 'stop',
          content: [{ type: 'text', text: 'Observation saved successfully' }],
          api: 'chat',
          provider: 'mock-provider',
          model: 'mock-model',
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          timestamp: Date.now(),
        };
        return {
          async *[Symbol.asyncIterator]() {
            yield { type: 'start', partial: msg };
            yield { type: 'text_start', contentIndex: 0, partial: msg };
            yield { type: 'text_delta', contentIndex: 0, delta: 'Observation saved successfully', partial: msg };
            yield { type: 'text_end', contentIndex: 0, content: 'Observation saved successfully', partial: msg };
            yield { type: 'done', reason: 'stop', message: msg };
          },
          result: async () => msg,
        } as any;
      }
    };

    const customTools = [{
      name: 'record_observation',
      label: 'Record Observation',
      description: 'Records an observation into persistent memory',
      parameters: { type: 'object', properties: { note: { type: 'string' } }, required: ['note'] },
      execute: async (toolCallId: string, args: { note: string }) => {
        toolExecuted = true;
        await capturedLease!.perform(undefined, async (cap) => {
          cap.assertActive();
          withDatabase(dbPath, (db) => {
            createMemory(db, {
              scopeKey: '["project","sdk-test"]',
              title: 'SDK learned item',
              content: args.note,
              type: 'discovery',
              sessionId: 'sdk-child-sess-1',
              invokingParentSessionId: 'sdk-parent-sess-1',
              invocationId: 'sdk-inv-1',
            });
          });
        });
        return { content: [{ type: 'text' as const, text: 'Observation stored' }], details: {} };
      },
    }];

    const resourceLoader = new DefaultResourceLoader({
      cwd: dir,
      agentDir: dir,
      settingsManager,
      eventBus: childEventBus,
      extensionFactories: [inlineAdapter],
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
    });
    await resourceLoader.reload();

    const { session } = await createAgentSession({
      cwd: dir,
      agentDir: dir,
      model: mockModel,
      modelRuntime,
      customTools,
      settingsManager,
      sessionManager,
      resourceLoader,
    });

    // Verify bind request was synchronously claimed
    assert.equal(bindCalled, true);
    assert.ok(capturedLease);
    assert.equal(capturedLease.identity.childSessionId, 'sdk-child-sess-1');

    // Before message: no DB record
    assert.equal(existsSync(dbPath), false);

    // Run real session.prompt() without any manual trigger shortcuts
    await session.prompt('Please record this observation');

    // Verify tool execution and model completion occurred
    assert.equal(toolExecuted, true);
    assert.equal(session.getLastAssistantText(), 'Observation saved successfully');

    // Verify activated in DB by the user message
    assert.equal(existsSync(dbPath), true);
    withDatabase(dbPath, (db) => {
      const sess = getSession(db, 'sdk-child-sess-1');
      assert.ok(sess);
      assert.equal(sess.status, 'open');
      assert.equal(sess.kind, 'child');
    });

    // Terminate lease
    await capturedLease.terminate('completed');

    // Child must be retained closed because knowledge was saved
    withDatabase(dbPath, (db) => {
      const sess = getSession(db, 'sdk-child-sess-1');
      assert.ok(sess);
      assert.equal(sess.status, 'closed');
      assert.ok(sess.closed_at !== null);
    });

    session.dispose();
    unsubMemory();
  } finally {
    cleanup();
  }
});
