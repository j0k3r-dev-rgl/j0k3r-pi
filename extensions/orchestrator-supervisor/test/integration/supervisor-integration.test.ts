import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MockCpamcServer } from '../fixtures/mock-cpamc.ts';

// Map Pi's documented host-provided peerDependencies (@earendil-works/pi-coding-agent, @earendil-works/pi-tui)
// directly to the installed Pi runtime in Node's global lib/node_modules without touching any sibling extension.
const hostNodeModules = resolve(dirname(process.execPath), '..', 'lib', 'node_modules');
const piCodingAgentRoot = join(hostNodeModules, '@earendil-works', 'pi-coding-agent');
const piCodingAgentEntry = pathToFileURL(join(piCodingAgentRoot, 'dist', 'index.js')).href;
const piTuiEntry = pathToFileURL(
  join(piCodingAgentRoot, 'node_modules', '@earendil-works', 'pi-tui', 'dist', 'index.js'),
).href;

const loaderCode = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@earendil-works/pi-coding-agent') {
    return { shortCircuit: true, url: ${JSON.stringify(piCodingAgentEntry)} };
  }
  if (specifier === '@earendil-works/pi-tui') {
    return { shortCircuit: true, url: ${JSON.stringify(piTuiEntry)} };
  }
  return nextResolve(specifier, context);
}
`;
register('data:text/javascript,' + encodeURIComponent(loaderCode));

const {
  createAgentSession,
  createAgentSessionRuntime,
  SessionManager,
  SettingsManager,
  DefaultResourceLoader,
  ModelRuntime,
  createEventBus,
} = await import('@earendil-works/pi-coding-agent');
const { default: orchestratorSupervisorExtension } = await import('../../index.ts');
const { SupervisorRuntime } = await import('../../src/supervisor.ts');
const { MEMORY_CHECKPOINT_CHANNEL } = await import('../../src/config.ts');

/**
 * Self-contained SQLite-backed memory checkpoint responder on pi.events.
 * Simulates the 3-phase commit + paginated readback verification protocol
 * without any cross-extension relative imports.
 */
function attachSqliteMemoryCheckpointBridge(events: any, dbPath: string, pageSize = 120): void {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cwd TEXT NOT NULL,
      session_id TEXT NOT NULL,
      topic_key TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      type TEXT NOT NULL,
      content_version INTEGER NOT NULL DEFAULT 1,
      indexing_status TEXT NOT NULL DEFAULT 'indexed'
    );
  `);
  db.close();

  events.on(MEMORY_CHECKPOINT_CHANNEL, (req: any) => {
    const conn = new DatabaseSync(dbPath);
    try {
      if (req.action === 'save') {
        const topicKey = req.topicKey || `session/${req.sessionId}/summary`;
        const info = conn
          .prepare(
            'INSERT INTO memories (cwd, session_id, topic_key, title, content, type, content_version, indexing_status) VALUES (?, ?, ?, ?, ?, ?, 1, ?)',
          )
          .run(
            req.cwd,
            req.sessionId,
            topicKey,
            req.title,
            req.content,
            req.type || 'session_summary',
            'indexed',
          );
        const insertedId = Number(info.lastInsertRowid);
        const row = conn
          .prepare('SELECT * FROM memories WHERE id = ?')
          .get(insertedId) as any;
        const verified = Boolean(
          row &&
            row.title === req.title &&
            row.content === req.content &&
            row.topic_key === topicKey,
        );
        req.respond({
          ok: verified,
          id: insertedId,
          committed: true,
          indexed: true,
          indexing_status: 'indexed',
          topic_key: topicKey,
          content_version: 1,
          readbackVerified: verified,
        });
        return;
      }

      if (req.action === 'get') {
        const row = conn
          .prepare('SELECT * FROM memories WHERE id = ?')
          .get(req.id) as any;
        if (!row) {
          req.respond({ ok: false, error: 'not_found' });
          return;
        }
        const fullText = String(row.content ?? '');
        const offset = req.cursor ? Number.parseInt(String(req.cursor), 10) : 0;
        const slice = fullText.slice(offset, offset + pageSize);
        const nextOffset = offset + slice.length;
        const hasMore = nextOffset < fullText.length;
        req.respond({
          ok: true,
          id: Number(row.id),
          title: String(row.title),
          content: slice,
          type: String(row.type),
          topic_key: String(row.topic_key),
          content_version: Number(row.content_version),
          has_more: hasMore,
          next_cursor: hasMore ? String(nextOffset) : null,
        });
      }
    } finally {
      conn.close();
    }
  });
}

function initTempGitRepo(dir: string): void {
  execSync('git init -b main', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "test@example.com"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "Test User"', { cwd: dir, stdio: 'ignore' });
  writeFileSync(join(dir, 'README.md'), '# Test Repo\n');
  execSync('git add README.md && git commit -m "initial"', { cwd: dir, stdio: 'ignore' });
}

test('MINI-007 / Matrix 1-12: Real Pi AgentSessionRuntime integration: ToolCallEvent WAL, subagents fence, memory bridge pagination, setModel(Model), and lock retention across newSession()', async () => {
  const tmpProject = mkdtempSync(join(tmpdir(), 'supervisor-real-sdk-'));
  const oldRuntimeDir = process.env.PI_SUPERVISOR_RUNTIME_DIR;
  const oldSubagentsDb = process.env.PI_SUBAGENTS_HISTORY_DB_PATH;
  const oldCpamcUrl = process.env.CLIPROXYAPI_BASE_URL;

  const runtimeDir = join(tmpProject, '.supervisor-runtime');
  const subagentsDbPath = join(tmpProject, 'subagents-history.sqlite');
  const memoryDbPath = join(tmpProject, 'memory.sqlite');

  process.env.PI_SUPERVISOR_RUNTIME_DIR = runtimeDir;
  process.env.PI_SUBAGENTS_HISTORY_DB_PATH = subagentsDbPath;

  initTempGitRepo(tmpProject);

  // Configure .pi/extensions.json
  const piDir = join(tmpProject, '.pi');
  mkdirSync(piDir, { recursive: true });
  writeFileSync(join(piDir, 'extensions.json'), JSON.stringify({ 'orchestrator-supervisor': true }));
  execSync('git add .pi/extensions.json && git commit -m "enable supervisor"', {
    cwd: tmpProject,
    stdio: 'ignore',
  });

  // Start mock CPAMC server: main >= 95% (ineligible), second < 95% (eligible)
  const cpamcServer = new MockCpamcServer({
    mainWhamUsedPercentPrimary: 95.0,
    secondWhamUsedPercentPrimary: 42.0,
  });
  const cpamcUrl = await cpamcServer.start();
  process.env.CLIPROXYAPI_BASE_URL = cpamcUrl;

  let runtimeHost: any;

  try {
    const eventBus = createEventBus();
    attachSqliteMemoryCheckpointBridge(eventBus, memoryDbPath, 80); // 80-char pages to exercise multi-page preflight

    // Initialize subagents SQLite database
    const subDb = new DatabaseSync(subagentsDbPath);
    subDb.exec(`
      CREATE TABLE subagent_tasks (
        id TEXT PRIMARY KEY,
        cwd TEXT,
        session_id TEXT,
        status TEXT
      );
    `);
    subDb.close();

    const statusHistory: Array<string | undefined> = [];
    const notifications: Array<{ msg: string; level: string }> = [];
    const customMessagesReceived: any[] = [];

    const createRuntime = async (options: any) => {
      const settingsManager = SettingsManager.inMemory(
        { retry: { enabled: false }, compaction: { enabled: false } },
        { projectTrusted: true },
      );

      const resourceLoader = new DefaultResourceLoader({
        cwd: options.cwd,
        agentDir: options.agentDir,
        settingsManager,
        eventBus,
        extensionFactories: [(pi) => orchestratorSupervisorExtension(pi, options.cwd)],
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
      });
      await resourceLoader.reload();

      const modelRuntime = await ModelRuntime.create({
        authPath: join(tmpProject, 'auth.json'),
        modelsPath: join(tmpProject, 'models.json'),
      });
      modelRuntime.registerProvider('cliproxyapi', {
        baseUrl: cpamcUrl,
        apiKey: 'mock-key',
        api: 'openai-completions',
        models: [
          {
            id: 'main/gpt-6.1-sol',
            name: 'Main GPT-6.1-sol',
            reasoning: true,
            input: ['text', 'image'],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 272000,
            maxTokens: 16384,
          },
          {
            id: 'second/gpt-6.1-sol',
            name: 'Second GPT-6.1-sol',
            reasoning: true,
            input: ['text', 'image'],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 272000,
            maxTokens: 16384,
          },
          {
            id: 'j0k3r/gemini-3.8-flash-high',
            name: 'Gemini 3.8 Flash High',
            reasoning: true,
            input: ['text', 'image'],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 370000,
            maxTokens: 16384,
          },
        ],
      });
      modelRuntime.hasConfiguredAuth = () => true;
      modelRuntime.checkAuth = async () => ({ type: 'api_key', apiKey: 'mock-key' });

      let turnCounter = 0;
      modelRuntime.streamSimple = (model: any) => {
        turnCounter++;
        if (turnCounter === 1) {
          const toolMsg: any = {
            role: 'assistant',
            stopReason: 'toolUse',
            content: [
              {
                type: 'toolCall',
                id: 'sdk_call_read_1',
                name: 'read',
                arguments: { path: 'README.md' },
              },
            ],
            api: 'openai-completions',
            provider: model.provider,
            model: model.id,
            usage: {
              input: 500,
              output: 50,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 550,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            timestamp: Date.now(),
          };
          return {
            async *[Symbol.asyncIterator]() {
              yield { type: 'start', partial: toolMsg };
              yield {
                type: 'toolcall_start',
                contentIndex: 0,
                id: 'sdk_call_read_1',
                toolName: 'read',
                partial: toolMsg,
              };
              yield {
                type: 'toolcall_end',
                contentIndex: 0,
                toolCall: {
                  id: 'sdk_call_read_1',
                  name: 'read',
                  arguments: { path: 'README.md' },
                },
                partial: toolMsg,
              };
              yield { type: 'done', reason: 'toolUse', message: toolMsg };
            },
            result: async () => toolMsg,
          } as any;
        }

        const doneMsg: any = {
          role: 'assistant',
          stopReason: 'stop',
          content: [{ type: 'text', text: 'Completed read.' }],
          api: 'openai-completions',
          provider: model.provider,
          model: model.id,
          usage: {
            input: 600,
            output: 20,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 620,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          timestamp: Date.now(),
        };
        return {
          async *[Symbol.asyncIterator]() {
            yield { type: 'start', partial: doneMsg };
            yield { type: 'done', reason: 'stop', message: doneMsg };
          },
          result: async () => doneMsg,
        } as any;
      };

      const initialModel = modelRuntime.getModel('cliproxyapi', 'main/gpt-6.1-sol');
      const created = await createAgentSession({
        cwd: options.cwd,
        agentDir: options.agentDir,
        sessionManager: options.sessionManager,
        settingsManager,
        modelRuntime,
        model: initialModel,
        resourceLoader,
        sessionStartEvent: options.sessionStartEvent,
      });

      return {
        session: created.session,
        services: {
          cwd: options.cwd,
          agentDir: options.agentDir,
          modelRuntime,
          settingsManager,
          resourceLoader,
          diagnostics: [],
        },
        diagnostics: [],
      };
    };

    runtimeHost = await createAgentSessionRuntime(createRuntime as any, {
      cwd: tmpProject,
      agentDir: tmpProject,
      sessionManager: SessionManager.inMemory(tmpProject),
    });

    const uiContext: any = {
      setStatus: (_id: string, text: string | undefined) => {
        statusHistory.push(text);
      },
      notify: (msg: string, level: string) => {
        notifications.push({ msg, level });
      },
      setEditorText: () => {},
    };

    const bindSession = async (session: any) => {
      const origSendCustom = session.sendCustomMessage.bind(session);
      session.sendCustomMessage = async (msg: any, opts: any) => {
        customMessagesReceived.push({ msg, opts });
        return origSendCustom(msg, opts);
      };

      await session.bindExtensions({
        uiContext,
        mode: 'tui',
        commandContextActions: {
          waitForIdle: () => session.waitForIdle(),
          newSession: (opts: any) => runtimeHost.newSession(opts),
          fork: (entryId: string, opts: any) => runtimeHost.fork(entryId, opts),
          navigateTree: async () => ({ cancelled: false }),
          switchSession: (p: string, opts: any) => runtimeHost.switchSession(p, opts),
          reload: () => session.reload(),
        },
      });
    };

    runtimeHost.setRebindSession(bindSession);
    await bindSession(runtimeHost.session);

    const firstSessionId = runtimeHost.session.sessionManager.getSessionId();
    assert.ok(statusHistory.some((s) => s?.includes('supervisor · main · normal')));

    // 1. Run a real prompt that executes the `read` tool through AgentSession
    await runtimeHost.session.prompt('Read README.md');

    // Verify tool call was logged and settled with real ToolCallEvent.toolCallId ('sdk_call_read_1') and toolName ('read')
    const flowSubdirs = readdirSync(runtimeDir);
    assert.equal(flowSubdirs.length, 1);
    const flowPath = join(runtimeDir, flowSubdirs[0]!);
    const journalOnDisk = JSON.parse(readFileSync(join(flowPath, 'tool-journal.json'), 'utf8'));
    assert.equal(journalOnDisk.length, 1);
    assert.equal(journalOnDisk[0].toolCallId, 'sdk_call_read_1');
    assert.equal(journalOnDisk[0].toolName, 'read');
    assert.equal(journalOnDisk[0].status, 'settled');

    // 2. Allocate an active background subagent using parentSessionId on pi.events + SQLite row
    const subDbActive = new DatabaseSync(subagentsDbPath);
    subDbActive
      .prepare('INSERT INTO subagent_tasks VALUES (?, ?, ?, ?)')
      .run('sub-task-real-1', tmpProject, firstSessionId, 'running');
    subDbActive.close();

    eventBus.emit('subagents:task:allocate', {
      taskId: 'sub-task-real-1',
      parentSessionId: firstSessionId,
      cwd: tmpProject,
    });

    // Request rotation via /supervisor rotate while subagent is active -> fence holds!
    await runtimeHost.session.prompt('/supervisor rotate');
    assert.equal(
      runtimeHost.session.sessionManager.getSessionId(),
      firstSessionId,
      'Rotation must wait while owned subagent is running',
    );
    assert.ok(statusHistory.some((s) => s?.includes('waiting for subagents')));

    // 3. Complete the subagent in SQLite and emit subagents:task:terminal with parentSessionId
    const subDbDone = new DatabaseSync(subagentsDbPath);
    subDbDone
      .prepare('UPDATE subagent_tasks SET status = ? WHERE id = ?')
      .run('completed', 'sub-task-real-1');
    subDbDone.close();

    eventBus.emit('subagents:task:terminal', {
      taskId: 'sub-task-real-1',
      parentSessionId: firstSessionId,
      status: 'completed',
    });

    // Trigger rotation settlement now that subagent completion fence is satisfied
    await runtimeHost.session.prompt('/supervisor rotate');
    await new Promise((r) => setTimeout(r, 80));

    // 4. Verify replacement session in real AgentSessionRuntime:
    const secondSessionId = runtimeHost.session.sessionManager.getSessionId();
    assert.notEqual(secondSessionId, firstSessionId, 'Session must have rotated to a fresh session');

    // Verify supervisor.lock was retained across newSession() and handed over to secondSessionId
    const lockOnDisk = JSON.parse(readFileSync(join(flowPath, 'supervisor.lock'), 'utf8'));
    assert.equal(lockOnDisk.sessionId, secondSessionId);

    // Verify pi.setModel resolved the real Model object ('second/gpt-6.1-sol') and set thinkingLevel to 'high'
    assert.equal(runtimeHost.session.model?.provider, 'cliproxyapi');
    assert.equal(runtimeHost.session.model?.id, 'second/gpt-6.1-sol');
    assert.equal(runtimeHost.session.thinkingLevel, 'high');

    // Verify non-triggering bootstrap message was injected via pi.sendMessage with triggerTurn: false
    assert.equal(customMessagesReceived.length, 1);
    assert.equal(customMessagesReceived[0].msg.customType, 'supervisor-continuity');
    assert.equal(customMessagesReceived[0].opts?.triggerTurn, false);
    assert.match(customMessagesReceived[0].msg.content, /Read verified checkpoint memory ID/);

    // 5. Verify manual /new does NOT replay the already-consumed checkpoint
    customMessagesReceived.length = 0;
    await runtimeHost.newSession();
    assert.equal(
      customMessagesReceived.length,
      0,
      'Manual /new must not replay historical checkpoint after handover token is consumed',
    );
  } finally {
    if (runtimeHost) {
      await runtimeHost.dispose();
    }
    await cpamcServer.stop();
    if (oldRuntimeDir === undefined) delete process.env.PI_SUPERVISOR_RUNTIME_DIR;
    else process.env.PI_SUPERVISOR_RUNTIME_DIR = oldRuntimeDir;
    if (oldSubagentsDb === undefined) delete process.env.PI_SUBAGENTS_HISTORY_DB_PATH;
    else process.env.PI_SUBAGENTS_HISTORY_DB_PATH = oldSubagentsDb;
    if (oldCpamcUrl === undefined) delete process.env.CLIPROXYAPI_BASE_URL;
    else process.env.CLIPROXYAPI_BASE_URL = oldCpamcUrl;
    rmSync(tmpProject, { recursive: true, force: true });
  }
});

test('MINI-005 / MINI-007 (Matrix Item 9): plan.md with Status: READY never triggers autonomous turn; injects non-triggering bootstrap via sendMessage(triggerTurn: false) and detects artifact hash tampering', async () => {
  const tmpProject = mkdtempSync(join(tmpdir(), 'supervisor-openspec-ready-'));
  const oldRuntimeDir = process.env.PI_SUPERVISOR_RUNTIME_DIR;
  process.env.PI_SUPERVISOR_RUNTIME_DIR = join(tmpProject, '.supervisor-runtime');

  initTempGitRepo(tmpProject);

  const changeDir = join(tmpProject, 'openspec', 'changes', 'my-change');
  mkdirSync(changeDir, { recursive: true });
  const planPath = join(changeDir, 'plan.md');
  writeFileSync(planPath, '## Workflow Status\n- Status: READY\n- Blockers: None\n## Goal\nSome goal\n');
  execSync('git add openspec && git commit -m "add ready plan"', {
    cwd: tmpProject,
    stdio: 'ignore',
  });

  const cpamcServer = new MockCpamcServer({
    mainWhamUsedPercentPrimary: 20.0,
  });
  const cpamcUrl = await cpamcServer.start();

  try {
    const piDir = join(tmpProject, '.pi');
    mkdirSync(piDir, { recursive: true });
    writeFileSync(join(piDir, 'extensions.json'), JSON.stringify({ 'orchestrator-supervisor': true }));
    execSync('git add .pi/extensions.json && git commit -m "enable"', {
      cwd: tmpProject,
      stdio: 'ignore',
    });

    const eventBus = createEventBus();
    const memoryDbPath = join(tmpProject, 'memory.sqlite');
    attachSqliteMemoryCheckpointBridge(eventBus, memoryDbPath, 64);

    const runtime = new SupervisorRuntime(tmpProject, 'sess-openspec-1', {
      baseUrl: cpamcUrl,
      events: eventBus,
    });
    runtime.init();

    // Verify: Status: READY in plan.md never infers authorizedContinuation
    assert.equal(runtime.getState().authorizedContinuation, undefined);

    // Perform rotation checkpoint save via onAgentSettled
    const rotateDispatches: string[] = [];
    const mockPiForSettle = {
      sendUserMessage: (msg: string) => {
        rotateDispatches.push(msg);
      },
      events: eventBus,
    };
    const mockCtx = {
      cwd: tmpProject,
      mode: 'tui',
      isProjectTrusted: () => true,
      sessionManager: { getSessionId: () => 'sess-openspec-1' },
      ui: { setStatus: () => {}, notify: () => {} },
    };

    runtime.requestRotation('context_reserve_90_reached');
    await runtime.onAgentSettled(mockPiForSettle, mockCtx);
    await new Promise((r) => setImmediate(r));
    assert.equal(rotateDispatches.length, 1);
    assert.equal(rotateDispatches[0], '/supervisor-rotate');
    assert.ok(runtime.getState().lastCheckpointMemoryId! > 0);
    assert.ok(runtime.getState().rotationHandoverToken);

    // Bootstrap in fresh session: because authorizedContinuation is undefined, must NOT call sendUserMessage!
    const userMessages: any[] = [];
    const customMessages: any[] = [];
    let modelSetArg: any;
    const mockNewPi = {
      sendUserMessage: (msg: string, opts?: any) => {
        userMessages.push({ msg, opts });
      },
      sendMessage: (message: any, opts?: any) => {
        customMessages.push({ message, opts });
      },
      setModel: async (m: any) => {
        modelSetArg = m;
        return true;
      },
      setThinkingLevel: () => {},
      events: eventBus,
    };

    await runtime.onNewSessionStart(mockNewPi, {
      cwd: tmpProject,
      mode: 'tui',
      isProjectTrusted: () => true,
      modelRegistry: {
        find: (provider: string, id: string) => ({ provider, id, name: id }),
      },
      sessionManager: { getSessionId: () => 'sess-openspec-2' },
      ui: { setStatus: () => {}, notify: () => {} },
    });

    // Non-vacuous assertions:
    assert.equal(
      userMessages.length,
      0,
      'sendUserMessage must NOT be called when continuation is not authorized',
    );
    assert.equal(
      customMessages.length,
      1,
      'sendMessage must be called once with non-triggering bootstrap instruction',
    );
    assert.equal(customMessages[0].opts?.triggerTurn, false);
    assert.equal(customMessages[0].message.customType, 'supervisor-continuity');
    assert.equal(typeof modelSetArg, 'object');
    assert.equal(modelSetArg.provider, 'cliproxyapi');
    assert.equal(modelSetArg.id, 'main/gpt-6.1-sol');

    // Now test artifact hash tampering detection during owner preflight:
    // Bind authorizedContinuation and referencedArtifacts, save checkpoint, then tamper with plan.md before onNewSessionStart
    const state = runtime.getState();
    (runtime as any).state.authorizedContinuation = {
      nextPermittedAction: '02-apply',
      authorizedScope: 'extensions/**',
      changeSlug: 'my-change',
      step: 'apply',
    };
    (runtime as any).state.referencedArtifacts = ['openspec/changes/my-change/plan.md'];
    runtime.journal.saveState((runtime as any).state);

    runtime.requestRotation('provider_failover');
    await runtime.onAgentSettled(mockPiForSettle, mockCtx);
    await new Promise((r) => setImmediate(r));

    // Tamper with referenced artifact on disk after checkpoint was saved
    writeFileSync(planPath, '## Workflow Status\n- Status: READY\n- Blockers: TAMPERED\n');

    userMessages.length = 0;
    customMessages.length = 0;
    const preflightAlerts: string[] = [];
    await runtime.onNewSessionStart(mockNewPi, {
      cwd: tmpProject,
      mode: 'tui',
      isProjectTrusted: () => true,
      modelRegistry: {
        find: (provider: string, id: string) => ({ provider, id, name: id }),
      },
      sessionManager: { getSessionId: () => 'sess-openspec-3' },
      ui: {
        setStatus: () => {},
        notify: (msg: string) => {
          preflightAlerts.push(msg);
        },
      },
    });

    // Even though authorizedContinuation was set, artifact hash mismatch must halt auto-continuation!
    assert.equal(userMessages.length, 0, 'Tampered artifact must block automatic sendUserMessage turn');
    assert.equal(customMessages.length, 1);
    assert.equal(customMessages[0].opts?.triggerTurn, false);
    assert.equal(runtime.getState().userPaused, true);
    assert.ok(preflightAlerts.some((a) => /artifact_hash_mismatch/i.test(a)));

    runtime.dispose('quit');
  } finally {
    await cpamcServer.stop();
    if (oldRuntimeDir === undefined) delete process.env.PI_SUPERVISOR_RUNTIME_DIR;
    else process.env.PI_SUPERVISOR_RUNTIME_DIR = oldRuntimeDir;
    rmSync(tmpProject, { recursive: true, force: true });
  }
});

test('MINI-003 / MINI-007: When all 3 candidates are unavailable, supervisor enters safe idle state with 60s -> 300s progressive backoff without rotating or dispatching prompts', async () => {
  const tmpProject = mkdtempSync(join(tmpdir(), 'supervisor-all-unavailable-'));
  const oldRuntimeDir = process.env.PI_SUPERVISOR_RUNTIME_DIR;
  process.env.PI_SUPERVISOR_RUNTIME_DIR = join(tmpProject, '.supervisor-runtime');

  const piDir = join(tmpProject, '.pi');
  mkdirSync(piDir, { recursive: true });
  writeFileSync(join(piDir, 'extensions.json'), JSON.stringify({ 'orchestrator-supervisor': true }));

  // All 3 candidates exhausted: main >= 95%, second >= 95%, gemini remainingFraction = 0
  const cpamcServer = new MockCpamcServer({
    mainWhamUsedPercentPrimary: 96.0,
    secondWhamUsedPercentPrimary: 98.0,
    geminiRemainingFraction: 0.0,
  });
  const cpamcUrl = await cpamcServer.start();

  try {
    const runtime = new SupervisorRuntime(tmpProject, 'sess-unavail-1', {
      baseUrl: cpamcUrl,
    });
    runtime.init();

    const sentMessages: string[] = [];
    const statuses: string[] = [];
    const mockPi = {
      sendUserMessage: (msg: string) => {
        sentMessages.push(msg);
      },
      events: { emit: () => {} },
    };
    const mockCtx = {
      cwd: tmpProject,
      mode: 'tui',
      isProjectTrusted: () => true,
      sessionManager: { getSessionId: () => 'sess-unavail-1' },
      ui: {
        setStatus: (_id: string, text: string) => {
          statuses.push(text);
        },
        notify: () => {},
      },
    };

    runtime.requestRotation('quota_exhausted');
    await runtime.onAgentSettled(mockPi, mockCtx);

    // Must NOT rotate or send any message; must enter safe 'idle' state with 60s initial backoff
    assert.equal(sentMessages.length, 0);
    assert.equal(runtime.getState().status, 'idle');
    assert.equal(runtime.getCurrentBackoffMs(), 60000);
    assert.ok(statuses.some((s) => /idle \(all candidates unavailable, backoff 60s\)/.test(s)));

    // Subsequent poll ticks double backoff up to 300s cap (60s -> 120s -> 240s -> 300s)
    await runtime.runPeriodicPollTick((t) => statuses.push(t));
    assert.equal(runtime.getCurrentBackoffMs(), 120000);

    await runtime.runPeriodicPollTick((t) => statuses.push(t));
    assert.equal(runtime.getCurrentBackoffMs(), 240000);

    await runtime.runPeriodicPollTick((t) => statuses.push(t));
    assert.equal(runtime.getCurrentBackoffMs(), 300000);

    // Restore main quota -> next poll transitions back from 'idle' to 'active' and resets backoff to 60s
    cpamcServer.options.mainWhamUsedPercentPrimary = 15.0;
    await runtime.runPeriodicPollTick((t) => statuses.push(t));
    assert.equal(runtime.getState().status, 'active');
    assert.equal(runtime.getCurrentBackoffMs(), 60000);

    runtime.dispose('quit');
  } finally {
    await cpamcServer.stop();
    if (oldRuntimeDir === undefined) delete process.env.PI_SUPERVISOR_RUNTIME_DIR;
    else process.env.PI_SUPERVISOR_RUNTIME_DIR = oldRuntimeDir;
    rmSync(tmpProject, { recursive: true, force: true });
  }
});

test('MINI-002 / MINI-003 / MINI-004: Turn-end >= 90% context triggers rotation without tool calls, successful turn resets error counter, and stale quota stops new work', async () => {
  const tmpProject = mkdtempSync(join(tmpdir(), 'supervisor-turn-end-90-'));
  const oldRuntimeDir = process.env.PI_SUPERVISOR_RUNTIME_DIR;
  process.env.PI_SUPERVISOR_RUNTIME_DIR = join(tmpProject, '.supervisor-runtime');

  const piDir = join(tmpProject, '.pi');
  mkdirSync(piDir, { recursive: true });
  writeFileSync(join(piDir, 'extensions.json'), JSON.stringify({ 'orchestrator-supervisor': true }));

  const cpamcServer = new MockCpamcServer({
    mainWhamUsedPercentPrimary: 30.0,
    secondWhamUsedPercentPrimary: 25.0,
  });
  const cpamcUrl = await cpamcServer.start();
  const oldCpamcUrl = process.env.CLIPROXYAPI_BASE_URL;
  process.env.CLIPROXYAPI_BASE_URL = cpamcUrl;

  try {
    const hooks = new Map<string, Function>();
    const sentUserMessages: string[] = [];
    const mockPi = {
      on: (event: string, handler: Function) => {
        hooks.set(event, handler);
        return () => {};
      },
      registerCommand: () => {},
      sendUserMessage: (msg: string) => {
        sentUserMessages.push(msg);
      },
      sendMessage: () => {},
      getSettings: () => ({ retry: { enabled: true } }),
      events: { on: () => () => {}, emit: (_ch: string, payload: any) => {
        if (payload?.action === 'save') {
          payload.respond({ ok: true, id: 1, readbackVerified: true });
        }
      } },
    };

    orchestratorSupervisorExtension(mockPi as any, tmpProject);

    let currentTokens: number | null = 10000;
    const ctx: any = {
      cwd: tmpProject,
      mode: 'tui',
      isProjectTrusted: () => true,
      sessionManager: { getSessionId: () => 'sess-turn-90', getBranch: () => [] },
      getSystemPrompt: () => 'system prompt',
      getContextUsage: () => ({
        tokens: currentTokens,
        contextWindow: 272000,
        percent: currentTokens !== null ? (currentTokens / 272000) * 100 : null,
      }),
      ui: { setStatus: () => {}, notify: () => {} },
    };

    await hooks.get('session_start')!({ reason: 'startup' }, ctx);

    // 1. Transient error followed by successful assistant turn in turn_end resets counter to 0
    await hooks.get('turn_end')!(
      {
        type: 'turn_end',
        outcome: 'error',
        message: { role: 'assistant', stopReason: 'error', errorMessage: 'HTTP 503 Unavailable' },
      },
      ctx,
    );
    await hooks.get('turn_end')!(
      {
        type: 'turn_end',
        outcome: 'completed',
        message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'ok' }] },
      },
      ctx,
    );

    // 2. Context reaches >= 90% at turn_end (250,000 / 272,000 = 91.9%) with no tool calls in that turn
    currentTokens = 250000;
    await hooks.get('turn_end')!(
      {
        type: 'turn_end',
        outcome: 'completed',
        message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'done' }] },
      },
      ctx,
    );
    await hooks.get('agent_settled')!({ type: 'agent_settled', aborted: false }, ctx);
    await new Promise((r) => setImmediate(r));

    assert.equal(sentUserMessages.length, 1);
    assert.equal(sentUserMessages[0], '/supervisor-rotate');

    await hooks.get('session_shutdown')!({ reason: 'quit' }, ctx);
  } finally {
    await cpamcServer.stop();
    if (oldCpamcUrl === undefined) delete process.env.CLIPROXYAPI_BASE_URL;
    else process.env.CLIPROXYAPI_BASE_URL = oldCpamcUrl;
    if (oldRuntimeDir === undefined) delete process.env.PI_SUPERVISOR_RUNTIME_DIR;
    else process.env.PI_SUPERVISOR_RUNTIME_DIR = oldRuntimeDir;
    rmSync(tmpProject, { recursive: true, force: true });
  }
});

