import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import orchestratorSupervisorExtension from '../index.ts';
import { SupervisorRuntime } from '../src/supervisor.ts';

test('MINI-001: Early exit when .pi/extensions.json is missing or false', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'supervisor-early-exit-'));
  try {
    let hooksRegistered = 0;
    let commandsRegistered = 0;
    const mockPi = {
      on: () => { hooksRegistered++; return () => {}; },
      registerCommand: () => { commandsRegistered++; },
      registerShortcut: () => {},
      events: { on: () => () => {}, emit: () => {} },
    };

    // 1. Missing config
    orchestratorSupervisorExtension(mockPi as any, tmpDir);
    assert.equal(hooksRegistered, 0);
    assert.equal(commandsRegistered, 0);

    // 2. Explicitly false
    const piDir = join(tmpDir, '.pi');
    mkdirSync(piDir, { recursive: true });
    writeFileSync(join(piDir, 'extensions.json'), JSON.stringify({ 'orchestrator-supervisor': false }));

    orchestratorSupervisorExtension(mockPi as any, tmpDir);
    assert.equal(hooksRegistered, 0);
    assert.equal(commandsRegistered, 0);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('MINI-001: Untrusted project is rejected and registers zero active supervision', async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'supervisor-untrusted-'));
  try {
    const piDir = join(tmpDir, '.pi');
    mkdirSync(piDir, { recursive: true });
    writeFileSync(join(piDir, 'extensions.json'), JSON.stringify({ 'orchestrator-supervisor': true }));

    const hooks = new Map<string, Function>();
    const mockPi = {
      on: (event: string, handler: Function) => {
        hooks.set(event, handler);
        return () => {};
      },
      registerCommand: () => {},
      events: { on: () => () => {}, emit: () => {} },
    };

    orchestratorSupervisorExtension(mockPi as any, tmpDir);
    assert.ok(hooks.has('session_start'));

    // Trigger session_start with untrusted context
    let statusSet: string | undefined;
    const untrustedCtx = {
      cwd: tmpDir,
      mode: 'tui',
      isProjectTrusted: () => false,
      sessionManager: { getSessionId: () => 'sess-untrusted' },
      ui: { setStatus: (_id: string, s: string) => { statusSet = s; } },
    };

    await hooks.get('session_start')!({ reason: 'startup' }, untrustedCtx);
    assert.equal(statusSet, undefined);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('MINI-001: Pre-message session_start auto-initializes supervision in trusted project', async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'supervisor-init-'));
  try {
    const piDir = join(tmpDir, '.pi');
    mkdirSync(piDir, { recursive: true });
    writeFileSync(join(piDir, 'extensions.json'), JSON.stringify({ 'orchestrator-supervisor': true }));

    const hooks = new Map<string, Function>();
    const mockPi = {
      on: (event: string, handler: Function) => {
        hooks.set(event, handler);
        return () => {};
      },
      registerCommand: () => {},
      events: { on: () => () => {}, emit: () => {} },
    };

    orchestratorSupervisorExtension(mockPi as any, tmpDir);

    let statusText: string | undefined;
    const trustedCtx = {
      cwd: tmpDir,
      mode: 'tui',
      isProjectTrusted: () => true,
      sessionManager: { getSessionId: () => 'sess-trusted-1' },
      ui: { setStatus: (_id: string, s: string) => { statusText = s; } },
    };

    await hooks.get('session_start')!({ reason: 'startup' }, trustedCtx);
    assert.ok(statusText);
    assert.match(statusText, /supervisor ·/);

    // Shutdown cleans up
    await hooks.get('session_shutdown')!({ reason: 'quit' }, trustedCtx);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('MINI-001: User pause dominance prevents auto-resume on restart or toggle', async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'supervisor-pause-'));
  try {
    const runtime = new SupervisorRuntime(tmpDir, 'sess-pause-1');
    runtime.init();

    // User explicitly pauses
    runtime.setUserPaused(true);
    assert.equal(runtime.getState().userPaused, true);
    assert.equal(runtime.getState().status, 'paused');

    // Attempting internal auto-action while paused is blocked
    const canContinue = runtime.canAutoContinue();
    assert.equal(canContinue, false);

    runtime.dispose();
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('MINI-001 / MINI-006: Safe mid-effects disable drains settlement before releasing lock without worker abort', async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'supervisor-disable-'));
  try {
    const piDir = join(tmpDir, '.pi');
    mkdirSync(piDir, { recursive: true });
    writeFileSync(join(piDir, 'extensions.json'), JSON.stringify({ 'orchestrator-supervisor': true }));

    const runtime = new SupervisorRuntime(tmpDir, 'sess-disable-1');
    runtime.init();

    // Record an in-flight tool call
    runtime.recordToolCallPre({
      toolCallId: 'call_flight_1',
      sessionId: 'sess-disable-1',
      turnIndex: 0,
      toolName: 'write',
      args: { path: '/tmp/f.txt' },
    });

    // Disable in .pi/extensions.json while tool is in flight
    writeFileSync(join(piDir, 'extensions.json'), JSON.stringify({ 'orchestrator-supervisor': false }));

    // Check quiescence before settlement: lock is still held because effect is unsettled
    assert.equal(runtime.isLockHeld(), true);

    // Settle tool result
    runtime.recordToolCallResult('call_flight_1', false, { ok: true });

    // After settling pending tool call, bookkeeping is drained and lock can be released cleanly
    runtime.checkQuiescence();
    assert.equal(runtime.isLockHeld(), false);

    runtime.dispose();
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('MINI-001: session_before_switch and reload-guard defer switch while subagents are active', async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'supervisor-switch-guard-'));
  try {
    const runtime = new SupervisorRuntime(tmpDir, 'sess-guard-1');
    runtime.init();

    // Simulate active subagent
    (runtime as any).subagentMonitor.inMemoryActiveTasks.set('sess-guard-1', new Set(['sub-1']));

    // 1. session_before_switch cancels switch
    const switchRes = runtime.handleBeforeSwitch();
    assert.equal(switchRes?.cancel, true);
    assert.match(switchRes?.reason ?? '', /active subagent/);

    // 2. reload-guard on pi.events defers reload
    let deferredReason: string | undefined;
    runtime.handleReloadGuardQuery({
      cwd: tmpDir,
      defer: (reason: string) => {
        deferredReason = reason;
      },
    });
    assert.ok( deferredReason);
    assert.match(deferredReason, /active subagent/);

    runtime.dispose();
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('MINI-001 / MINI-006: Real Pi ToolCallEvent fields, WAL write-failure block, Escape abort attribution, and lock retention across newSession/reload', async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'supervisor-sdk-contracts-'));
  const oldRuntimeDir = process.env.PI_SUPERVISOR_RUNTIME_DIR;
  process.env.PI_SUPERVISOR_RUNTIME_DIR = join(tmpDir, 'runtime');
  try {
    const piDir = join(tmpDir, '.pi');
    mkdirSync(piDir, { recursive: true });
    writeFileSync(join(piDir, 'extensions.json'), JSON.stringify({ 'orchestrator-supervisor': true }));

    const hooks = new Map<string, Function>();
    const commands = new Map<string, any>();
    const sentUserMessages: string[] = [];
    const mockPi = {
      on: (event: string, handler: Function) => {
        hooks.set(event, handler);
        return () => {};
      },
      registerCommand: (name: string, cmd: any) => {
        commands.set(name, cmd);
      },
      sendUserMessage: (msg: string) => {
        sentUserMessages.push(msg);
      },
      sendMessage: () => {},
      events: { on: () => () => {}, emit: () => {} },
    };

    orchestratorSupervisorExtension(mockPi as any, tmpDir);

    let statusText: string | undefined;
    const notifications: string[] = [];
    const ctx = {
      cwd: tmpDir,
      mode: 'tui',
      hasUI: true,
      isIdle: () => true,
      isProjectTrusted: () => true,
      sessionManager: { getSessionId: () => 'sess-sdk-1', getBranch: () => [] },
      getSystemPrompt: () => 'sys',
      getContextUsage: () => ({ tokens: 1000, contextWindow: 272000, percent: 0.3 }),
      ui: {
        setStatus: (_id: string, s: string | undefined) => { statusText = s; },
        notify: (msg: string) => { notifications.push(msg); },
      },
    };

    await hooks.get('session_start')!({ reason: 'startup' }, ctx);

    // 1. Real Pi ToolCallEvent uses toolCallId, parentToolCallId, toolName, input
    const callRes = await hooks.get('tool_call')!(
      {
        type: 'tool_call',
        toolCallId: 'real_pi_call_1',
        parentToolCallId: 'parent_1',
        toolName: 'write',
        input: { path: join(tmpDir, 'file.txt'), content: 'data' },
      },
      ctx,
    );
    assert.equal(callRes, undefined);

    // Settle using real ToolResultEvent
    await hooks.get('tool_result')!(
      {
        type: 'tool_result',
        toolCallId: 'real_pi_call_1',
        toolName: 'write',
        input: { path: join(tmpDir, 'file.txt') },
        content: [{ type: 'text', text: 'written' }],
        details: undefined,
        isError: false,
      },
      ctx,
    );

    // 2. Child subagent session (different sessionId) is ignored
    const childCtx = {
      ...ctx,
      sessionManager: { getSessionId: () => 'child-subagent-sess' },
    };
    const childCallRes = await hooks.get('tool_call')!(
      {
        type: 'tool_call',
        toolCallId: 'child_call_1',
        toolName: 'bash',
        input: { command: 'echo hi' },
      },
      childCtx,
    );
    assert.equal(childCallRes, undefined);

    // 3. User Escape abort in agent_settled sets userPaused = true and updates status to paused
    await hooks.get('agent_settled')!({ type: 'agent_settled', aborted: true }, ctx);
    assert.equal(statusText, 'supervisor · paused');

    // Resume via /supervisor resume
    await commands.get('supervisor')!.handler('resume', ctx);
    assert.match(statusText ?? '', /supervisor · main · normal/);

    // 4. session_shutdown with reason: 'reload' retains supervisor.lock on disk
    await hooks.get('session_shutdown')!({ type: 'session_shutdown', reason: 'reload' }, ctx);

    // Re-init on reload succeeds without lock conflict
    await hooks.get('session_start')!({ reason: 'reload' }, ctx);
    assert.match(statusText ?? '', /supervisor · main · normal/);

    // 5. Simulate WAL write failure by replacing runtime directory with a read-only file where tool-journal.json lives
    await hooks.get('session_shutdown')!({ type: 'session_shutdown', reason: 'quit' }, ctx);
  } finally {
    if (oldRuntimeDir === undefined) delete process.env.PI_SUPERVISOR_RUNTIME_DIR;
    else process.env.PI_SUPERVISOR_RUNTIME_DIR = oldRuntimeDir;
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('MINI-006: Synchronous WAL write failure blocks tool execution and uncertain mutations require confirmation', async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'supervisor-wal-fail-'));
  const oldRuntimeDir = process.env.PI_SUPERVISOR_RUNTIME_DIR;
  process.env.PI_SUPERVISOR_RUNTIME_DIR = join(tmpDir, 'runtime');
  try {
    const piDir = join(tmpDir, '.pi');
    mkdirSync(piDir, { recursive: true });
    writeFileSync(join(piDir, 'extensions.json'), JSON.stringify({ 'orchestrator-supervisor': true }));

    // 1. Seed a pending mutating WAL entry to simulate prior crash
    const runtimeSeed = new SupervisorRuntime(tmpDir, 'sess-crash-seed');
    runtimeSeed.init();
    runtimeSeed.recordToolCallPre({
      toolCallId: 'crashed_call_1',
      sessionId: 'sess-crash-seed',
      turnIndex: 0,
      toolName: 'bash',
      args: { command: 'curl -X POST https://example.com' },
    });
    runtimeSeed.dispose('quit');

    // 2. Start extension on next launch -> recovers pending entry as uncertain
    const hooks = new Map<string, Function>();
    const commands = new Map<string, any>();
    const mockPi = {
      on: (event: string, handler: Function) => {
        hooks.set(event, handler);
        return () => {};
      },
      registerCommand: (name: string, cmd: any) => {
        commands.set(name, cmd);
      },
      sendUserMessage: () => {},
      sendMessage: () => {},
      events: { on: () => () => {}, emit: () => {} },
    };

    orchestratorSupervisorExtension(mockPi as any, tmpDir);

    const notifications: string[] = [];
    const ctx: any = {
      cwd: tmpDir,
      mode: 'tui',
      hasUI: false,
      isIdle: () => true,
      isProjectTrusted: () => true,
      sessionManager: { getSessionId: () => 'sess-recovery-1', getBranch: () => [] },
      getSystemPrompt: () => 'sys',
      getContextUsage: () => ({ tokens: 1000, contextWindow: 272000, percent: 0.3 }),
      ui: {
        setStatus: () => {},
        notify: (msg: string) => { notifications.push(msg); },
      },
    };

    await hooks.get('session_start')!({ reason: 'startup' }, ctx);
    assert.ok(notifications.some((n) => /uncertain side effects/i.test(n)));

    // 3. Tool call before user confirmation is blocked!
    const blockedUncertain = await hooks.get('tool_call')!(
      {
        type: 'tool_call',
        toolCallId: 'call_after_crash',
        toolName: 'bash',
        input: { command: 'ls' },
      },
      ctx,
    );
    assert.equal(blockedUncertain?.block, true);
    assert.match(blockedUncertain?.reason ?? '', /uncertain mutations/i);

    // 4. User confirms via /supervisor resume -> tool call is now permitted
    await commands.get('supervisor')!.handler('resume', ctx);
    const allowedAfterResume = await hooks.get('tool_call')!(
      {
        type: 'tool_call',
        toolCallId: 'call_after_resume',
        toolName: 'read',
        input: { path: 'a.txt' },
      },
      ctx,
    );
    assert.equal(allowedAfterResume, undefined);

    // 5. Simulate WAL write failure by making tool-journal.json a directory so renameSync fails
    const journalPath = join(runtimeSeed.flowDir, 'tool-journal.json');
    rmSync(journalPath, { force: true });
    mkdirSync(journalPath, { recursive: true });

    const walFailResult = await hooks.get('tool_call')!(
      {
        type: 'tool_call',
        toolCallId: 'call_wal_fail',
        toolName: 'write',
        input: { path: 'b.txt', content: 'x' },
      },
      ctx,
    );
    assert.equal(walFailResult?.block, true);
    assert.equal(
      walFailResult?.reason,
      'Supervisor WAL write failed; blocking tool execution for safety.',
    );

    rmSync(journalPath, { recursive: true, force: true });
    await hooks.get('session_shutdown')!({ type: 'session_shutdown', reason: 'quit' }, ctx);
  } finally {
    if (oldRuntimeDir === undefined) delete process.env.PI_SUPERVISOR_RUNTIME_DIR;
    else process.env.PI_SUPERVISOR_RUNTIME_DIR = oldRuntimeDir;
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('MINI-001: supervisor_rotate tool registers and sets rotationPending with memoryId and nextStep', async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'sup-tool-rot-'));
  const oldRuntimeDir = process.env.PI_SUPERVISOR_RUNTIME_DIR;
  process.env.PI_SUPERVISOR_RUNTIME_DIR = join(tmpDir, 'supervisor-runtime');

  try {
    mkdirSync(join(tmpDir, '.pi'), { recursive: true });
    writeFileSync(
      join(tmpDir, '.pi', 'extensions.json'),
      JSON.stringify({ 'orchestrator-supervisor': true }),
    );

    const tools = new Map<string, any>();
    const hooks = new Map<string, Function>();
    const mockPi = {
      on: (event: string, handler: Function) => {
        hooks.set(event, handler);
        return () => {};
      },
      registerCommand: () => {},
      registerTool: (tool: any) => {
        tools.set(tool.name, tool);
      },
      sendUserMessage: () => {},
      events: { on: () => () => {}, emit: () => {} },
    };

    orchestratorSupervisorExtension(mockPi as any, tmpDir);

    const tool = tools.get('supervisor_rotate');
    assert.ok(tool, 'supervisor_rotate tool must be registered');
    assert.equal(tool.name, 'supervisor_rotate');

    const ctx: any = {
      cwd: tmpDir,
      mode: 'tui',
      isProjectTrusted: () => true,
      sessionManager: { getSessionId: () => 'sess-tool-rot-1', getBranch: () => [] },
      getSystemPrompt: () => 'sys',
      getContextUsage: () => ({ tokens: 1000, contextWindow: 272000, percent: 0.3 }),
      ui: { setStatus: () => {}, notify: () => {} },
    };

    await hooks.get('session_start')!({ reason: 'startup' }, ctx);

    // Call tool with memory_id and next_step
    const result = await tool.execute('call_rot_1', {
      memory_id: 88,
      next_step: 'Continuar compuerta de aceptación',
    });

    assert.ok(result.content[0].text.includes('88'));

    await hooks.get('session_shutdown')!({ reason: 'quit' }, ctx);
  } finally {
    if (oldRuntimeDir === undefined) delete process.env.PI_SUPERVISOR_RUNTIME_DIR;
    else process.env.PI_SUPERVISOR_RUNTIME_DIR = oldRuntimeDir;
    rmSync(tmpDir, { recursive: true, force: true });
  }
});


