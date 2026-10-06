import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, symlinkSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createAgentSession,
  SessionManager,
  SettingsManager,
  DefaultResourceLoader,
  ModelRuntime,
  createEventBus,
} from '@earendil-works/pi-coding-agent';
import { withDatabase } from '../../src/storage/db.ts';
import { MemoryLifecycle } from '../../src/lifecycle.ts';
import { createMemoryTools } from '../../src/tools/index.ts';
import { createMemoryExtension } from '../../src/extension.ts';
import { DEFAULT_DB_PATH } from '../../src/config.ts';
import type { InvocationLeaseV1, InvocationIdentityV1 } from '../../src/protocol.ts';
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { E5Client, CANONICAL_MODEL, CANONICAL_REVISION } from '../../src/client/e5-client.ts';
import { RELATION_TYPES } from '../../src/graph/types.ts';
import { OfflineE5Client } from '../fixtures/offline-e5.ts';

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

test('Activation: Pi autodiscovers the root entrypoint and registers nine tools without storage or network activity', async () => {
  const { dir, dbPath, cleanup } = createTempFixture('discovery');
  const originalFetch = globalThis.fetch;
  const storageState = () => existsSync(DEFAULT_DB_PATH)
    ? { size: statSync(DEFAULT_DB_PATH).size, modified: statSync(DEFAULT_DB_PATH).mtimeMs }
    : null;
  const beforeLoading = storageState();
  let networkCalls = 0;
  globalThis.fetch = async () => {
    networkCalls++;
    throw new Error('Extension loading must not access the network');
  };
  try {
    const entrypoint = new URL('../../index.ts', import.meta.url);
    assert.ok(existsSync(entrypoint), 'Pi requires a root index.ts entrypoint');
    mkdirSync(join(dir, 'extensions'));
    symlinkSync(new URL('../../', import.meta.url), join(dir, 'extensions', 'pi-persistent-memory'), 'dir');
    const loader = new DefaultResourceLoader({
      cwd: dir, agentDir: dir,
      settingsManager: SettingsManager.inMemory({}, { projectTrusted: true }),
      noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    });
    await loader.reload();
    const loaded = loader.getExtensions();
    assert.deepEqual(loaded.errors, []);
    assert.equal(loaded.extensions.length, 1);
    assert.deepEqual([...loaded.extensions[0].tools.keys()].sort(), [
      'memory_context', 'memory_delete', 'memory_deleted_list', 'memory_entity',
      'memory_get', 'memory_relation', 'memory_restore', 'memory_save', 'memory_search',
    ]);
    assert.equal(existsSync(dbPath), false);
    assert.deepEqual(storageState(), beforeLoading, 'Autodiscovery must not touch the real memory database');
    assert.equal(networkCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    cleanup();
  }
});

test('Activation: session startup reports registered memory tools without creating a database', async () => {
  const { dbPath, cleanup } = createTempFixture('startup-status');
  const handlers = new Map<string, Function[]>();
  const statuses = new Map<string, string | undefined>();
  const pi: any = {
    on: (name: string, handler: Function) => {
      handlers.set(name, [...(handlers.get(name) ?? []), handler]);
      return () => {};
    },
    events: { on: () => () => {} },
    registerTool: () => {},
  };
  const ctx = { ui: { setStatus: (key: string, value: string | undefined) => statuses.set(key, value) } };
  try {
    createMemoryExtension(dbPath, { client: new OfflineE5Client() })(pi);
    assert.ok(handlers.has('session_start'), 'Registered tools should publish their own status');
    for (const handler of handlers.get('session_start')!) await handler({}, ctx);
    assert.equal(statuses.get('pi-persistent-memory'), 'memory · 9 tools');
    assert.equal(existsSync(dbPath), false);
    for (const handler of handlers.get('session_shutdown')!) await handler({ reason: 'quit' }, ctx);
    assert.equal(statuses.get('pi-persistent-memory'), undefined);
    assert.equal(existsSync(dbPath), false);
  } finally {
    cleanup();
  }
});

test('M5-A02: Tool execution before first user message fails with session_not_active without opening DB', async () => {
  const { dbPath, cleanup } = createTempFixture('gate-before');
  try {
    const lifecycle = new MemoryLifecycle(dbPath, { client: new OfflineE5Client() });
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
    const lifecycle = new MemoryLifecycle(dbPath, { client: new OfflineE5Client() });
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
    const lifecycle = new MemoryLifecycle(dbPath, { client: new OfflineE5Client() });
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
    const lifecycle = new MemoryLifecycle(dbPath, { client: new OfflineE5Client() });
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
    const extensionFactory = createMemoryExtension(dbPath, { client: new OfflineE5Client() });

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

test('M6-A01 & M6-A05: complete nine-tool public SDK flow preserves graph, recovery, scopes and bounded pages', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-memory-mini-006-full-flow-'));
  const dbPath = join(dir, 'memories.db');
  const requests: string[] = [];
  const httpCalls: string[] = [];
  const server = createServer(async (req, res) => {
    httpCalls.push(req.url ?? '');
    const metadata = { model: CANONICAL_MODEL, model_revision: CANONICAL_REVISION, dimensions: 384, normalization: 'l2', max_input_tokens: 512 };
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/health') {
      res.end(JSON.stringify({ status: 'ready', ...metadata }));
      return;
    }
    let body = '';
    for await (const chunk of req) body += chunk;
    const payload = JSON.parse(body);
    requests.push(payload.mode);
    const texts = Array.isArray(payload.input) ? payload.input : [payload.input];
    const embedding = Array.from({ length: 384 }, (_, i) => i === 0 ? 1 : 0);
    res.end(JSON.stringify({ ...metadata, data: texts.map((text: string, input_index: number) => ({ input_index, chunks: [{ chunk_index: 0, text, start: 0, end: Array.from(text).length, token_count: 30, embedding }] })) }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const client = new E5Client(`http://127.0.0.1:${port}`);
  const sessions: any[] = [];
  const childLeases = new Map<any, InvocationLeaseV1>();
  async function openSdk(cwd: string, child?: { parentId: string; manager?: ReturnType<typeof SessionManager.inMemory> }) {
    const settings = SettingsManager.inMemory({}, { projectTrusted: true });
    const manager = child?.manager ?? SessionManager.inMemory(cwd);
    const bus = createEventBus();
    let capturedLease: InvocationLeaseV1 | undefined;
    let bind: (() => void) | undefined;
    const identity: InvocationIdentityV1 = { version: 1, invocationId: `integration-invocation-${sessions.length}`, childSessionId: manager.getSessionId(), invokingParentSessionId: child?.parentId ?? 'not-a-child' };
    const adapter = { name: 'memory-invocation-adapter-v1', factory: (pi: any) => {
      bind = () => pi.events.emit('memory:invocation:bind:v1', { version: 1, identity, childContext: loader.getExtensions().runtime.createContext(), accept: (lease: InvocationLeaseV1) => { capturedLease = lease; } });
      pi.on('message_start', async (event: any) => {
        if (event.message.role === 'user') await capturedLease?.activate();
      });
    } };
    const loader = new DefaultResourceLoader({
      cwd, agentDir: dir, settingsManager: settings, eventBus: bus,
      extensionFactories: child ? [createMemoryExtension(dbPath, { client }), adapter] : [createMemoryExtension(dbPath, { client })],
      extensionsOverride: child ? (base) => ({ ...base, extensions: base.extensions.map((extension) => ({ ...extension, handlers: new Map([...extension.handlers].filter(([event]) => ['tool_call', 'tool_result', 'user_bash'].includes(event) || (extension.path === '<inline:memory-invocation-adapter-v1>' && event === 'message_start'))) })) }) : undefined,
      noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    });
    await loader.reload();
    const runtime = await ModelRuntime.create({ authPath: join(dir, 'auth.json'), modelsPath: join(dir, 'models.json') });
    runtime.hasConfiguredAuth = () => true;
    runtime.checkAuth = async () => ({ type: 'api_key', apiKey: 'mock' });
    const model: any = { id: 'integration', provider: 'mock', api: 'chat', name: 'Integration' };
    runtime.streamSimple = () => {
      const message: any = { role: 'assistant', content: [{ type: 'text', text: 'Ready for memory operations.' }], stopReason: 'stop', api: 'chat', provider: 'mock', model: 'integration', timestamp: Date.now(), usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      return { async *[Symbol.asyncIterator]() { yield { type: 'start', partial: message }; yield { type: 'done', reason: 'stop', message }; }, result: async () => message } as any;
    };
    const { session } = await createAgentSession({ cwd, agentDir: dir, settingsManager: settings, sessionManager: manager, modelRuntime: runtime, model, resourceLoader: loader });
    sessions.push(session);
    if (child) {
      bind?.();
      assert.ok(capturedLease, 'Actual child event bus must bind the memory runtime');
      childLeases.set(session, capturedLease);
    }
    return session;
  }
  let callNumber = 0;
  const called = new Set<string>();
  async function call(session: any, name: string, args: any, expectedError = false): Promise<any> {
    const context = session.extensionRunner.createToolContext(`integration/${++callNumber}`, undefined);
    const outcome = await context.executeTool(name, args);
    called.add(name);
    assert.equal(outcome.isError, expectedError, `${name}: ${JSON.stringify(outcome.result)}`);
    assert.ok(Buffer.byteLength(JSON.stringify(outcome.result)) <= 6144, name);
    const text = outcome.result.content.find((block: any) => block.type === 'text')?.text ?? '';
    return expectedError ? text : JSON.parse(text);
  }
  try {
    const a = await openSdk(dir);
    assert.equal(existsSync(dbPath), false);
    await a.prompt('Work on this project; do not save any session summary unless I explicitly request it.');
    const initial = await call(a, 'memory_save', { title: 'C++ graph decision', content: 'Use scoped graph relationships for the C++ service.', type: 'decision', topic_key: 'architecture/graph' });
    assert.equal(initial.indexed, true);
    const id = initial.id;
    const detail = await call(a, 'memory_get', { id });
    assert.equal(detail.content, 'Use scoped graph relationships for the C++ service.');
    assert.ok((await call(a, 'memory_context', {})).items.some((item: any) => item.id === id));
    for (const mode of ['semantic', 'hybrid', 'fts5']) {
      const before = requests.length;
      assert.ok((await call(a, 'memory_search', { mode, query: 'C++' })).results.some((item: any) => item.id === id));
      if (mode === 'fts5') assert.equal(requests.length, before);
    }
    const project = await call(a, 'memory_entity', { action: 'save', type: 'project', name: dir.split('/').pop() });
    const memoryNode = await call(a, 'memory_entity', { action: 'save', type: 'memory', name: String(id), memory_id: id });
    const react = await call(a, 'memory_entity', { action: 'save', type: 'technology', name: 'React', scope: 'global' });
    assert.ok((await call(a, 'memory_entity', { action: 'list' })).entities.some((entity: any) => entity.id === memoryNode.id));
    const relations = [];
    for (const relation_type of RELATION_TYPES) {
      relations.push(await call(a, 'memory_relation', { action: 'save', source: project.id, target: react.id, relation_type }));
    }
    await call(a, 'memory_relation', { action: 'save', source: memoryNode.id, target: react.id, relation_type: 'references' });
    const graph = await call(a, 'memory_search', { mode: 'graph', entity_id: react.id });
    assert.ok(graph.nodes.some((node: any) => node.id === memoryNode.id));
    assert.ok(graph.edges.some((edge: any) => edge.source === project.id && edge.target === react.id));
    await call(a, 'memory_relation', { action: 'delete', id: relations[0].id });
    const noInferenceBeforeDelete = requests.length;
    await call(a, 'memory_delete', { id, owner_scope: 'project' });
    assert.equal(requests.length, noInferenceBeforeDelete);
    await call(a, 'memory_get', { id }, true);
    assert.ok((await call(a, 'memory_deleted_list', {})).items.some((item: any) => item.id === id));
    assert.equal((await call(a, 'memory_search', { mode: 'fts5', query: 'C++' })).results.length, 0);
    assert.ok(!(await call(a, 'memory_search', { mode: 'graph', entity_id: react.id })).nodes.some((node: any) => node.id === memoryNode.id));
    await call(a, 'memory_restore', { id, owner_scope: 'project' });
    assert.equal(requests.length, noInferenceBeforeDelete);
    assert.equal((await call(a, 'memory_save', { action: 'reindex', id })).succeeded, 1);
    const replaced = await call(a, 'memory_save', { title: 'C++ revised decision', content: 'The current C++ decision preserves graph links.', type: 'decision', topic_key: 'architecture/graph' });
    assert.equal(replaced.id, id);
    const liveNode = await call(a, 'memory_entity', { action: 'get', id: memoryNode.id });
    assert.equal(liveNode.id, memoryNode.id);
    assert.equal(liveNode.memory_summary.title, 'C++ revised decision');
    withDatabase(dbPath, (db) => assert.equal(db.prepare("SELECT count(*) AS n FROM memories WHERE type='session_summary'").get()!.n, 0));
    await a.prompt('Please persist an English summary of this session now.');
    await call(a, 'memory_save', { title: 'Requested session summary', content: 'Validated memory and graph operations during this session.', type: 'session_summary' });
    withDatabase(dbPath, (db) => assert.equal(db.prepare("SELECT topic_key FROM memories WHERE type='session_summary'").get()!.topic_key, `session/${a.sessionManager.getSessionId()}/summary`));
    const otherCwd = join(dir, 'other-project');
    mkdirSync(otherCwd);
    const b = await openSdk(otherCwd);
    await b.prompt('Create knowledge for this separate project.');
    const foreign = await call(b, 'memory_save', { title: 'Private project note', content: 'This belongs to another project.', type: 'note' });
    await call(a, 'memory_get', { id: foreign.id }, true);
    assert.equal((await call(a, 'memory_get', { id: foreign.id, global: true })).content, 'This belongs to another project.');
    await call(a, 'memory_delete', { id: foreign.id, owner_scope: 'project' }, true);
    assert.equal((await call(b, 'memory_get', { id: foreign.id })).id, foreign.id);
    const firstChild = await openSdk(dir, { parentId: a.sessionManager.getSessionId() });
    const childId = firstChild.sessionManager.getSessionId();
    withDatabase(dbPath, (db) => assert.equal(db.prepare('SELECT id FROM sessions WHERE id=?').get(childId), undefined));
    await firstChild.prompt('Save a reusable implementation observation, not a session summary.');
    const firstChildMemory = await call(firstChild, 'memory_save', { title: 'Child observation one', content: 'Learned during the first delegated execution.', type: 'discovery' });
    await childLeases.get(firstChild)!.terminate('completed');
    await call(firstChild, 'memory_context', {}, true);
    const resumedChild = await openSdk(dir, { parentId: b.sessionManager.getSessionId(), manager: firstChild.sessionManager });
    assert.equal(resumedChild.sessionManager.getSessionId(), childId);
    await resumedChild.prompt('Continue the delegated task from the second parent.');
    const secondChildMemory = await call(resumedChild, 'memory_save', { title: 'Child observation two', content: 'Learned during continuation from another parent.', type: 'discovery' });
    await childLeases.get(resumedChild)!.terminate('cancelled');
    withDatabase(dbPath, (db) => {
      assert.equal(db.prepare('SELECT kind,status FROM sessions WHERE id=?').get(childId)!.kind, 'child');
      assert.equal(db.prepare('SELECT status FROM sessions WHERE id=?').get(childId)!.status, 'closed');
      assert.equal(db.prepare('SELECT invoking_parent_session_id FROM memories WHERE id=?').get(firstChildMemory.id)!.invoking_parent_session_id, a.sessionManager.getSessionId());
      assert.equal(db.prepare('SELECT invoking_parent_session_id FROM memories WHERE id=?').get(secondChildMemory.id)!.invoking_parent_session_id, b.sessionManager.getSessionId());
    });
    for (const outcome of ['cancelled', 'failed'] as const) {
      const emptyChild = await openSdk(dir, { parentId: a.sessionManager.getSessionId() });
      await emptyChild.prompt('Read without persisting any knowledge.');
      await call(emptyChild, 'memory_context', {});
      await childLeases.get(emptyChild)!.terminate(outcome);
      withDatabase(dbPath, (db) => assert.equal(db.prepare('SELECT id FROM sessions WHERE id=?').get(emptyChild.sessionManager.getSessionId()), undefined));
    }
    const parallel = await Promise.all([
      call(a, 'memory_save', { title: 'Concurrent project A note', content: 'Parallel save belongs to project A.', type: 'note' }),
      call(b, 'memory_save', { title: 'Concurrent project B note', content: 'Parallel save belongs to project B.', type: 'note' }),
    ]);
    await call(a, 'memory_get', { id: parallel[1].id }, true);
    await call(b, 'memory_get', { id: parallel[0].id }, true);
    const callsBeforeReload = httpCalls.length;
    const nativeId = a.sessionManager.getSessionId();
    await a.extensionRunner.emit({ type: 'session_shutdown', reason: 'reload' });
    await call(a, 'memory_context', {}, true);
    withDatabase(dbPath, (db) => {
      assert.equal(db.prepare('SELECT status FROM sessions WHERE id=?').get(nativeId)!.status, 'open');
      assert.equal(db.prepare("SELECT count(*) AS n FROM memories WHERE type='session_summary'").get()!.n, 1);
    });
    assert.equal(httpCalls.length, callsBeforeReload, 'Reload must not issue a health or embedding request');
    await a.prompt('Continue the same native session after reload without requesting a summary.');
    assert.equal((await call(a, 'memory_get', { id })).id, id);
    for (const reason of ['new', 'resume', 'fork', 'quit'] as const) {
      await a.extensionRunner.emit({ type: 'session_shutdown', reason });
      withDatabase(dbPath, (db) => assert.equal(db.prepare('SELECT status FROM sessions WHERE id=?').get(nativeId)!.status, 'closed'));
      await a.prompt(`Return to the selected session after ${reason}, without saving a summary.`);
      withDatabase(dbPath, (db) => assert.equal(db.prepare('SELECT status FROM sessions WHERE id=?').get(nativeId)!.status, 'open'));
    }
    withDatabase(dbPath, (db) => assert.equal(db.prepare("SELECT count(*) AS n FROM memories WHERE type='session_summary'").get()!.n, 1));
    assert.equal(called.size, 9);
    for (const invalidType of ['implements', 'configured_by', 'owned_by']) {
      await call(a, 'memory_relation', { action: 'save', source: project.id, target: react.id, relation_type: invalidType }, true);
    }
    withDatabase(dbPath, (db) => assert.equal(db.prepare('PRAGMA integrity_check').get()!.integrity_check, 'ok'));
  } finally {
    for (const session of sessions) session.dispose();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('M6-A02: public SDK save preserves committed text and distinguishes cancellation, invalid response, input error and availability', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-memory-mini-006-cancel-'));
  const dbPath = join(dir, 'memories.db');
  let started!: () => void;
  const embeddingStarted = new Promise<void>((resolve) => { started = resolve; });
  const server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/health') {
      res.end(JSON.stringify({ status: 'ready', model: CANONICAL_MODEL, model_revision: CANONICAL_REVISION, dimensions: 384, normalization: 'l2', max_input_tokens: 512 }));
      return;
    }
    let body = '';
    for await (const chunk of req) body += chunk;
    const source = String(JSON.parse(body).input);
    if (source.startsWith('Invalid metadata note')) {
      res.end(JSON.stringify({ model: 'incompatible-model', data: [] }));
      return;
    }
    if (source.startsWith('Rejected input note')) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: { code: 'invalid_input', message: 'Input rejected by the fixture' } }));
      return;
    }
    if (source.startsWith('Unavailable service note')) {
      res.statusCode = 503;
      res.end(JSON.stringify({ error: { code: 'model_not_ready', message: 'Fixture engine unavailable' } }));
      return;
    }
    started();
    // Deliberately retain the response until caller abort; no inference or live service.
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const client = new E5Client(`http://127.0.0.1:${(server.address() as { port: number }).port}`);
  let session: any;
  try {
    const settings = SettingsManager.inMemory({}, { projectTrusted: true });
    const loader = new DefaultResourceLoader({ cwd: dir, agentDir: dir, settingsManager: settings, extensionFactories: [createMemoryExtension(dbPath, { client })], noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
    await loader.reload();
    const runtime = await ModelRuntime.create({ authPath: join(dir, 'auth.json'), modelsPath: join(dir, 'models.json') });
    runtime.hasConfiguredAuth = () => true;
    runtime.checkAuth = async () => ({ type: 'api_key', apiKey: 'mock' });
    const model: any = { id: 'cancel', provider: 'mock', api: 'chat', name: 'Cancellation fixture' };
    runtime.streamSimple = () => {
      const message: any = { role: 'assistant', content: [{ type: 'text', text: 'Ready.' }], stopReason: 'stop', api: 'chat', provider: 'mock', model: 'cancel', timestamp: Date.now(), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      return { async *[Symbol.asyncIterator]() { yield { type: 'start', partial: message }; yield { type: 'done', reason: 'stop', message }; }, result: async () => message } as any;
    };
    session = (await createAgentSession({ cwd: dir, agentDir: dir, settingsManager: settings, sessionManager: SessionManager.inMemory(dir), modelRuntime: runtime, model, resourceLoader: loader })).session;
    await session.prompt('Begin a cancellable indexing operation.');
    const ctrl = new AbortController();
    const context = session.extensionRunner.createToolContext('cancel-parent', undefined);
    const pending = context.executeTool('memory_save', { title: 'Committed cancellation note', content: 'Keep this text if embedding is cancelled.', type: 'note' }, { signal: ctrl.signal });
    await embeddingStarted;
    ctrl.abort();
    const outcome = await pending;
    withDatabase(dbPath, (db) => {
      const memory = db.prepare("SELECT * FROM memories WHERE title='Committed cancellation note'").get()!;
      assert.equal(memory.indexing_status, 'pending');
      assert.equal(memory.content, 'Keep this text if embedding is cancelled.');
      assert.equal(db.prepare('SELECT count(*) AS n FROM memory_vectors').get()!.n, 0);
    });
    assert.equal(outcome.isError, true, 'Cancellation must not be returned as a successful public tool outcome');
    assert.equal(outcome.result.details.committed, true);
    assert.equal(outcome.result.details.indexed, false);
    assert.equal(outcome.result.details.category, 'cancelled');
    assert.ok(Buffer.byteLength(JSON.stringify(outcome.result)) <= 6144);
    assert.match(outcome.result.content[0].text, /cancel/i);
    const invalid = await context.executeTool('memory_save', { title: 'Invalid metadata note', content: 'Text must survive an incompatible embedding response.', type: 'note' });
    withDatabase(dbPath, (db) => {
      assert.equal(db.prepare("SELECT indexing_status FROM memories WHERE title='Invalid metadata note'").get()!.indexing_status, 'pending');
    });
    assert.equal(invalid.isError, true, 'An incompatible embedding response must remain an integration error, not public tool success');
    assert.equal(invalid.result.details.committed, true);
    assert.equal(invalid.result.details.indexed, false);
    assert.equal(invalid.result.details.category, 'integration_error');
    const rejected = await context.executeTool('memory_save', { title: 'Rejected input note', content: 'Committed text stays pending when the service rejects input.', type: 'note' });
    assert.equal(rejected.isError, true, 'Correction-required input failure must not be public tool success');
    assert.equal(rejected.result.details.committed, true);
    assert.equal(rejected.result.details.indexed, false);
    assert.equal(rejected.result.details.category, 'input_error');
    const unavailable = await context.executeTool('memory_save', { title: 'Unavailable service note', content: 'Service availability failures preserve a successful text save.', type: 'note' });
    assert.equal(unavailable.isError, false);
    const unavailableData = JSON.parse(unavailable.result.content[0].text);
    assert.equal(unavailableData.committed, true);
    assert.equal(unavailableData.indexed, false);
    assert.match(unavailableData.notice, /unavailable/);
    for (const result of [invalid.result, rejected.result, unavailable.result]) {
      assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 6144);
    }
    withDatabase(dbPath, (db) => {
      assert.equal(db.prepare('SELECT count(*) AS n FROM memories WHERE indexing_status = ?').get('pending')!.n, 4);
      assert.equal(db.prepare('SELECT count(*) AS n FROM memory_vectors').get()!.n, 0);
    });
  } finally {
    session?.dispose();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});
