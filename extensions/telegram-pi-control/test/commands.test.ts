import { mkdtemp, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it, vi } from 'vitest';

import { CommandRouter } from '../src/commands.js';
import { ExactWorkspaceRegistry } from '../src/workspace-registry.js';
import { InMemoryBindingManager } from '../src/bindings.js';
import { InMemoryTelegramPermissionApprovalStore } from '../src/permission-approval-store.js';
import { TelegramCommandInput, TelegramCommand, TelegramControlConfig, AuditEvent } from '../src/types.js';

function identity() {
  return {
    userId: 42,
    chatId: 123,
    chatType: 'private' as const,
  };
}

function commandInput(text: string): TelegramCommandInput {
  const user = identity();
  if (text.startsWith('/')) {
    const [command, ...args] = text.slice(1).split(/\s+/);
    return {
      kind: 'command',
      command: command as TelegramCommand['command'],
      args,
      identity: user,
      rawText: text,
    };
  }

  return {
    kind: 'text',
    text,
    identity: user,
    rawText: text,
  };
}

describe('CommandRouter', () => {
  it('handles /start and /status for unbound chats', async () => {
    const root = await mkdtemp(join(tmpdir(), 'telegram-control-command-start-'));
    await mkdir(join(root, 'a'), { recursive: true });

    const config: TelegramControlConfig = {
      telegram: { allowedUserIds: [42] },
      workspaces: [{ id: 'a', label: 'A', root: join(root, 'a') }],
    };
    const registry = new ExactWorkspaceRegistry(config, { cwd: root });
    const bindings = new InMemoryBindingManager();

    const router = new CommandRouter({
      workspaceRegistry: registry,
      trustValidator: {
        async validate() {
          return { trusted: true, matchedPath: join(root, 'a'), decision: true, reason: 'nearest_true' };
        },
      },
      bindings,
      sessionIndex: { listWorkspaceSessions: vi.fn().mockResolvedValue([]) },
      openSession: vi.fn(async () => ({ sessionId: 's1' })),
      createSession: vi.fn(async () => ({ sessionId: 's2' })),
      sendPrompt: vi.fn(),
      sendSteer: vi.fn(),
      sendFollowup: vi.fn(),
      sendAbort: vi.fn(),
    });

    const start = await router.handle(commandInput('/start'));
    const status = await router.handle(commandInput('/status'));

    expect(start.kind).toBe('ok');
    expect(start.text).toContain('ready');
    expect(status.kind).toBe('ok');
    expect(status.text).toContain('No active workspace/session binding');
  });

  it('lists only trusted workspaces in /workspaces', async () => {
    const root = await mkdtemp(join(tmpdir(), 'telegram-control-command-workspaces-'));
    const wA = join(root, 'a');
    const wB = join(root, 'b');
    await mkdir(wA, { recursive: true });
    await mkdir(wB, { recursive: true });

    const config: TelegramControlConfig = {
      telegram: { allowedUserIds: [42] },
      workspaces: [
        { id: 'a', label: 'A', root: wA },
        { id: 'b', label: 'B', root: wB },
      ],
    };

    const registry = new ExactWorkspaceRegistry(config, { cwd: root });
    const bindings = new InMemoryBindingManager();

    const router = new CommandRouter({
      workspaceRegistry: registry,
      trustValidator: {
        async validate(canonicalRoot: string) {
          if (canonicalRoot === wA) {
            return { trusted: true, matchedPath: wA, decision: true, reason: 'nearest_true' };
          }
          return { trusted: false, matchedPath: wB, decision: false, reason: 'nearest_false' };
        },
      },
      bindings,
      sessionIndex: { listWorkspaceSessions: vi.fn().mockResolvedValue([]) },
      openSession: vi.fn(async () => ({ sessionId: 's1' })),
      createSession: vi.fn(async () => ({ sessionId: 's2' })),
      sendPrompt: vi.fn(),
      sendSteer: vi.fn(),
      sendFollowup: vi.fn(),
      sendAbort: vi.fn(),
    });

    const result = await router.handle(commandInput('/workspaces'));

    expect(result.kind).toBe('ok');
    expect(result.text).toContain(`A (a) — ${wA}`);
    expect(result.text).not.toContain('B (b)');
  });

  it('opens trusted workspace and binds active workspace/session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'telegram-control-command-open-'));
    await mkdir(join(root, 'a'), { recursive: true });

    const config: TelegramControlConfig = {
      telegram: { allowedUserIds: [42] },
      workspaces: [{ id: 'a', label: 'A', root: join(root, 'a') }],
    };

    const registry = new ExactWorkspaceRegistry(config, { cwd: root });
    const bindings = new InMemoryBindingManager();
    const openSession = vi.fn(async () => ({ sessionId: 'opened-session' }));

    const router = new CommandRouter({
      workspaceRegistry: registry,
      trustValidator: {
        async validate() {
          return { trusted: true, matchedPath: join(root, 'a'), decision: true, reason: 'nearest_true' };
        },
      },
      bindings,
      sessionIndex: { listWorkspaceSessions: vi.fn().mockResolvedValue([]) },
      openSession,
      createSession: vi.fn(async () => ({ sessionId: 'ignored' })),
      sendPrompt: vi.fn(),
      sendSteer: vi.fn(),
      sendFollowup: vi.fn(),
      sendAbort: vi.fn(),
    });

    const result = await router.handle(commandInput('/open a'));

    expect(result.kind).toBe('ok');
    expect(openSession).toHaveBeenCalledOnce();
    expect(bindings.get(123)?.workspace.id).toBe('a');
    expect(bindings.get(123)?.sessionId).toBe('opened-session');
  });

  it('lists workspace sessions for the current binding', async () => {
    const root = await mkdtemp(join(tmpdir(), 'telegram-control-command-sessions-'));
    await mkdir(join(root, 'a'), { recursive: true });

    const config: TelegramControlConfig = {
      telegram: { allowedUserIds: [42] },
      workspaces: [{ id: 'a', label: 'A', root: join(root, 'a') }],
    };

    const registry = new ExactWorkspaceRegistry(config, { cwd: root });
    const bindings = new InMemoryBindingManager();

    const listWorkspaceSessions = vi.fn(async () => [
      { sessionId: 's1', sessionName: 'first' },
      { sessionId: 's2' },
    ]);

    const router = new CommandRouter({
      workspaceRegistry: registry,
      trustValidator: {
        async validate() {
          return { trusted: true, matchedPath: join(root, 'a'), decision: true, reason: 'nearest_true' };
        },
      },
      bindings,
      sessionIndex: { listWorkspaceSessions },
      openSession: vi.fn(async () => ({ sessionId: 'opened-session' })),
      createSession: vi.fn(async () => ({ sessionId: 'created' })),
      sendPrompt: vi.fn(),
      sendSteer: vi.fn(),
      sendFollowup: vi.fn(),
      sendAbort: vi.fn(),
    });

    await router.handle(commandInput('/open a'));
    const result = await router.handle(commandInput('/sessions'));

    expect(result.kind).toBe('ok');
    expect(result.text).toContain('s1 (first)');
    expect(result.text).toContain('s2');
    expect(listWorkspaceSessions).toHaveBeenCalledOnce();
  });

  it('creates a new session via /new and rebinds', async () => {
    const root = await mkdtemp(join(tmpdir(), 'telegram-control-command-new-'));
    await mkdir(join(root, 'a'), { recursive: true });

    const config: TelegramControlConfig = {
      telegram: { allowedUserIds: [42] },
      workspaces: [{ id: 'a', label: 'A', root: join(root, 'a') }],
    };

    const registry = new ExactWorkspaceRegistry(config, { cwd: root });
    const bindings = new InMemoryBindingManager();
    const createSession = vi.fn(async (_workspace, name?: string) => ({
      sessionId: `created-${name ?? 'default'}`,
    }));

    const router = new CommandRouter({
      workspaceRegistry: registry,
      trustValidator: {
        async validate() {
          return { trusted: true, matchedPath: join(root, 'a'), decision: true, reason: 'nearest_true' };
        },
      },
      bindings,
      sessionIndex: { listWorkspaceSessions: vi.fn().mockResolvedValue([]) },
      openSession: vi.fn(async () => ({ sessionId: 'opened' })),
      createSession,
      sendPrompt: vi.fn(),
      sendSteer: vi.fn(),
      sendFollowup: vi.fn(),
      sendAbort: vi.fn(),
    });

    const result = await router.handle(commandInput('/new a meeting'));

    expect(result.kind).toBe('ok');
    expect(createSession).toHaveBeenCalledOnce();
    expect(bindings.get(123)?.sessionId).toBe('created-meeting');
  });

  it('closes the active binding and stops the active session client', async () => {
    const root = await mkdtemp(join(tmpdir(), 'telegram-control-command-close-'));
    await mkdir(join(root, 'a'), { recursive: true });

    const config: TelegramControlConfig = {
      telegram: { allowedUserIds: [42] },
      workspaces: [{ id: 'a', label: 'A', root: join(root, 'a') }],
    };

    const registry = new ExactWorkspaceRegistry(config, { cwd: root });
    const bindings = new InMemoryBindingManager();
    const closeSession = vi.fn(async () => undefined);

    const router = new CommandRouter({
      workspaceRegistry: registry,
      trustValidator: {
        async validate() {
          return { trusted: true, matchedPath: join(root, 'a'), decision: true, reason: 'nearest_true' };
        },
      },
      bindings,
      sessionIndex: { listWorkspaceSessions: vi.fn().mockResolvedValue([]) },
      openSession: vi.fn(async () => ({ sessionId: 'opened' })),
      createSession: vi.fn(async () => ({ sessionId: 'created' })),
      closeSession,
      sendPrompt: vi.fn(),
      sendSteer: vi.fn(),
      sendFollowup: vi.fn(),
      sendAbort: vi.fn(),
    });

    await router.handle(commandInput('/open a'));
    expect(bindings.get(123)).toBeDefined();

    const result = await router.handle(commandInput('/close'));

    expect(result.kind).toBe('ok');
    expect(result.text).toContain('Session closed');
    expect(closeSession).toHaveBeenCalledOnce();
    expect(bindings.get(123)).toBeUndefined();

    const after = await router.handle(commandInput('/status'));
    expect(after.text).toContain('No active workspace/session binding');
  });

  it('lists, approves, and denies scoped permission requests for the active binding', async () => {
    const root = await mkdtemp(join(tmpdir(), 'telegram-control-command-permissions-'));
    const wA = join(root, 'a');
    await mkdir(wA, { recursive: true });

    const config: TelegramControlConfig = {
      telegram: { allowedUserIds: [42] },
      workspaces: [{ id: 'a', label: 'A', root: wA }],
    };

    const registry = new ExactWorkspaceRegistry(config, { cwd: root });
    const bindings = new InMemoryBindingManager();
    const permissionStore = new InMemoryTelegramPermissionApprovalStore();
    const answerPermission = vi.fn(async (_binding, requestId: string, choice: any) => ({ ok: true as const, requestId, choice }));

    const router = new CommandRouter({
      workspaceRegistry: registry,
      trustValidator: {
        async validate() {
          return { trusted: true, matchedPath: wA, decision: true, reason: 'nearest_true' };
        },
      },
      bindings,
      sessionIndex: { listWorkspaceSessions: vi.fn().mockResolvedValue([]) },
      openSession: vi.fn(async () => ({ sessionId: 'opened' })),
      createSession: vi.fn(async () => ({ sessionId: 'created' })),
      closeSession: vi.fn(async () => undefined),
      permissionStore,
      answerPermission,
      sendPrompt: vi.fn(),
      sendSteer: vi.fn(),
      sendFollowup: vi.fn(),
      sendAbort: vi.fn(),
    });

    await router.handle(commandInput('/open a'));
    const binding = bindings.get(123)!;
    permissionStore.upsert(123, binding, {
      id: 'req-1',
      requestId: 'req-1',
      workspaceRoot: wA,
      workspaceId: 'a',
      sessionId: 'opened',
      rpcKey: binding.rpcKey,
      title: 'Permission required for bash',
      message: 'Bash command requires approval.',
      reason: 'approval required',
      reasonCode: 'bash_default_requires_approval',
      riskLevel: 'medium',
      tool: 'bash',
      action: 'bash',
      choices: ['Allow once', 'Allow for session', 'Deny'],
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    const listed = await router.handle(commandInput('/permissions'));
    expect(listed.kind).toBe('ok');
    expect(listed.text).toContain('req-1');

    const approved = await router.handle(commandInput('/approve req-1 session'));
    expect(approved.kind).toBe('ok');
    expect(approved.text).toContain('approved');
    expect(answerPermission).toHaveBeenCalledWith(binding, 'req-1', 'Allow for session');
    expect(permissionStore.list(123, binding)).toEqual([]);

    const stale = await router.handle(commandInput('/deny req-1'));
    expect(stale.kind).toBe('error');
    expect(stale.text).toContain('No matching pending permission request');
  });

  it('arms and disarms binding with bounded duration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'telegram-control-command-arm-'));
    await mkdir(join(root, 'a'), { recursive: true });

    const config: TelegramControlConfig = {
      telegram: { allowedUserIds: [42] },
      workspaces: [{ id: 'a', label: 'A', root: join(root, 'a') }],
      policy: {
        armDurationSeconds: 600,
        maxArmDurationSeconds: 600,
      },
    };

    const registry = new ExactWorkspaceRegistry(config, { cwd: root });
    const bindings = new InMemoryBindingManager();
    let now = 10_000;

    const router = new CommandRouter({
      workspaceRegistry: registry,
      trustValidator: {
        async validate() {
          return { trusted: true, matchedPath: join(root, 'a'), decision: true, reason: 'nearest_true' };
        },
      },
      bindings,
      sessionIndex: { listWorkspaceSessions: vi.fn().mockResolvedValue([]) },
      openSession: vi.fn(async () => ({ sessionId: 'opened' })),
      createSession: vi.fn(async () => ({ sessionId: 'created' })),
      sendPrompt: vi.fn(),
      sendSteer: vi.fn(),
      sendFollowup: vi.fn(),
      sendAbort: vi.fn(),
      nowMs: () => now,
      defaultArmDurationSeconds: 300,
      maxArmDurationSeconds: 600,
    });

    await router.handle(commandInput('/open a'));
    now += 100;
    const arm = await router.handle(commandInput('/arm 120'));
    expect(arm.kind).toBe('ok');

    const status = await router.handle(commandInput('/status'));
    expect(status.text).toContain('Armed until');

    const disarm = await router.handle(commandInput('/disarm'));
    expect(disarm.kind).toBe('ok');

    const after = await router.handle(commandInput('/status'));
    expect(after.text).toContain('Not armed');
  });

  it('requires arming before abort/prompt/steer/followup', async () => {
    const root = await mkdtemp(join(tmpdir(), 'telegram-control-command-fullcontrol-'));
    await mkdir(join(root, 'a'), { recursive: true });

    const config: TelegramControlConfig = {
      telegram: { allowedUserIds: [42] },
      workspaces: [{ id: 'a', label: 'A', root: join(root, 'a') }],
    };

    const registry = new ExactWorkspaceRegistry(config, { cwd: root });
    const bindings = new InMemoryBindingManager();
    const sendPrompt = vi.fn(async () => undefined);
    const sendSteer = vi.fn(async () => undefined);
    const sendFollowup = vi.fn(async () => undefined);
    const sendAbort = vi.fn(async () => undefined);

    const router = new CommandRouter({
      workspaceRegistry: registry,
      trustValidator: {
        async validate() {
          return { trusted: true, matchedPath: join(root, 'a'), decision: true, reason: 'nearest_true' };
        },
      },
      bindings,
      sessionIndex: { listWorkspaceSessions: vi.fn().mockResolvedValue([]) },
      openSession: vi.fn(async () => ({ sessionId: 'opened' })),
      createSession: vi.fn(async () => ({ sessionId: 'created' })),
      sendPrompt,
      sendSteer,
      sendFollowup,
      sendAbort,
      nowMs: () => 10_000,
    });

    await router.handle(commandInput('/open a'));

    const deniedAbort = await router.handle(commandInput('/abort'));
    const deniedPrompt = await router.handle(commandInput('plain message'));
    const deniedSteer = await router.handle(commandInput('/steer adjust'));
    const deniedFollowup = await router.handle(commandInput('/followup after'));

    expect(deniedAbort.kind).toBe('denied');
    expect(deniedPrompt.kind).toBe('denied');
    expect(deniedSteer.kind).toBe('denied');
    expect(deniedFollowup.kind).toBe('denied');

    const armed = await router.handle(commandInput('/arm 60'));
    expect(armed.kind).toBe('ok');

    const acceptedAbort = await router.handle(commandInput('/abort'));
    const acceptedPrompt = await router.handle(commandInput('plain message'));
    const acceptedSteer = await router.handle(commandInput('/steer adjust'));
    const acceptedFollowup = await router.handle(commandInput('/followup after'));

    expect(acceptedAbort.kind).toBe('ok');
    expect(acceptedPrompt.kind).toBe('ok');
    expect(acceptedPrompt).toMatchObject({ silent: true, text: '' });
    expect(acceptedSteer.kind).toBe('ok');
    expect(acceptedSteer).toMatchObject({ silent: true, text: '' });
    expect(acceptedFollowup.kind).toBe('ok');
    expect(acceptedFollowup).toMatchObject({ silent: true, text: '' });

    expect(sendPrompt).toHaveBeenCalledTimes(1);
    expect(sendSteer).toHaveBeenCalledTimes(1);
    expect(sendFollowup).toHaveBeenCalledTimes(1);
    expect(sendAbort).toHaveBeenCalledTimes(1);
  });

  it('records command audits with richer metadata for control actions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'telegram-control-command-audit-'));
    await mkdir(join(root, 'a'), { recursive: true });

    const config: TelegramControlConfig = {
      telegram: { allowedUserIds: [42] },
      workspaces: [{ id: 'a', label: 'A', root: join(root, 'a') }],
    };
    const registry = new ExactWorkspaceRegistry(config, { cwd: root });
    const bindings = new InMemoryBindingManager();
    const auditEvents: AuditEvent[] = [];

    const openSession = vi.fn(async () => ({ sessionId: 'opened', sessionFile: 'opened.sv' }));
    const sendPrompt = vi.fn(async () => undefined);

    const router = new CommandRouter({
      workspaceRegistry: registry,
      trustValidator: {
        async validate() {
          return { trusted: true, matchedPath: join(root, 'a'), decision: true, reason: 'nearest_true' };
        },
      },
      bindings,
      sessionIndex: { listWorkspaceSessions: vi.fn().mockResolvedValue([]) },
      openSession,
      createSession: vi.fn(async () => ({ sessionId: 'created' })),
      sendPrompt,
      sendSteer: vi.fn(async () => undefined),
      sendFollowup: vi.fn(async () => undefined),
      sendAbort: vi.fn(async () => undefined),
      audit: async (entry) => {
        auditEvents.push({
          version: 1,
          timestamp: new Date().toISOString(),
          ...entry,
        });
      },
      defaultArmDurationSeconds: 120,
      maxArmDurationSeconds: 120,
    });

    await router.handle(commandInput('/open a'));
    await router.handle(commandInput('/arm 60'));
    const promptResult = await router.handle(commandInput('hello prompt'));

    expect(promptResult.kind).toBe('ok');
    expect(sendPrompt).toHaveBeenCalledTimes(1);

    const lastPrompt = auditEvents.find((entry) => entry.event === 'control_action' && entry.action === 'prompt');
    expect(lastPrompt).toMatchObject({
      actor: {
        userId: 42,
        chatId: 123,
      },
      event: 'control_action',
      decision: 'allow',
      workspace: 'a',
      sessionId: 'opened',
      sessionFile: 'opened.sv',
      action: 'prompt',
    });
  });

  it('rejects control messages exceeding maxPromptChars', async () => {
    const root = await mkdtemp(join(tmpdir(), 'telegram-control-command-prompterror-'));
    await mkdir(join(root, 'a'), { recursive: true });

    const config: TelegramControlConfig = {
      telegram: { allowedUserIds: [42] },
      policy: {
        maxPromptChars: 4,
      },
      workspaces: [{ id: 'a', label: 'A', root: join(root, 'a') }],
    };

    const registry = new ExactWorkspaceRegistry(config, { cwd: root });
    const bindings = new InMemoryBindingManager();
    const auditEvents: AuditEvent[] = [];

    const router = new CommandRouter({
      workspaceRegistry: registry,
      trustValidator: {
        async validate() {
          return { trusted: true, matchedPath: join(root, 'a'), decision: true, reason: 'nearest_true' };
        },
      },
      bindings,
      sessionIndex: { listWorkspaceSessions: vi.fn().mockResolvedValue([]) },
      openSession: vi.fn(async () => ({ sessionId: 'opened' })),
      createSession: vi.fn(async () => ({ sessionId: 'created' })),
      sendPrompt: vi.fn(async () => undefined),
      sendSteer: vi.fn(async () => undefined),
      sendFollowup: vi.fn(async () => undefined),
      sendAbort: vi.fn(async () => undefined),
      audit: async (entry) => {
        auditEvents.push({
          version: 1,
          timestamp: new Date().toISOString(),
          ...entry,
        });
      },
      maxPromptChars: config.policy?.maxPromptChars,
    });

    await router.handle(commandInput('/open a'));
    await router.handle(commandInput('/arm 60'));

    const deniedPrompt = await router.handle(commandInput('toolong-message'));
    expect(deniedPrompt.kind).toBe('denied');
    expect(deniedPrompt.text).toContain('Message exceeds policy.maxPromptChars');

    const deniedSteer = await router.handle(commandInput('/steer a very long steer message'));
    expect(deniedSteer.kind).toBe('denied');
    expect(deniedSteer.text).toContain('Message exceeds policy.maxPromptChars');

    const deniedFollowup = await router.handle(commandInput('/followup too much text'));
    expect(deniedFollowup.kind).toBe('denied');
    expect(deniedFollowup.text).toContain('Message exceeds policy.maxPromptChars');

    const deniedRecord = auditEvents.find((entry) => entry.event === 'control_action' && entry.decision === 'deny');
    expect(deniedRecord?.reason).toBe('message exceeds maxPromptChars');
  });
});
