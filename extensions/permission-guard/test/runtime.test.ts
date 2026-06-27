import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import permissionGuardExtension from '../index.js';
import { resolveInteractionRequest } from '../src/interaction-channel.js';
import { registerPermissionGuardRuntime } from '../src/runtime.js';
import type { ApprovalChoice } from '../src/types.js';

type ToolCallHandler = (event: any, ctx: any) => Promise<any> | any;
type UserBashHandler = (event: any, ctx: any) => Promise<any> | any;

interface MockPi {
  handlers: Record<string, Function[]>;
  on(event: string, handler: Function): void;
}

function createMockPi(): MockPi {
  return {
    handlers: {},
    on(event, handler) {
      this.handlers[event] ??= [];
      this.handlers[event]!.push(handler);
    },
  };
}

async function tempWorkspace(prefix: string) {
  const cwd = await mkdtemp(join(tmpdir(), prefix));
  await mkdir(join(cwd, 'src'), { recursive: true });
  await writeFile(join(cwd, 'src', 'index.ts'), 'export {};', 'utf8');
  return cwd;
}

async function writeProjectPolicy(cwd: string, policy: Record<string, unknown>) {
  await mkdir(join(cwd, '.pi'), { recursive: true });
  await writeFile(join(cwd, '.pi', 'permissions.json'), JSON.stringify(policy, null, 2), 'utf8');
}

function createCtx(cwd: string, choices: ApprovalChoice[] = [], overrides: Record<string, unknown> = {}) {
  const select = vi.fn(async (_message: string, options: ApprovalChoice[]) => {
    expect(options).toEqual(expect.arrayContaining(['Allow once', 'Allow for session', 'Deny']));
    return choices.shift() ?? 'Deny';
  });

  return {
    cwd,
    mode: 'tui',
    hasUI: true,
    ui: { select },
    sessionManager: { getSessionFile: () => join(cwd, '.pi', 'session.jsonl') },
    ...overrides,
  };
}

async function readAuditLines(auditPath: string) {
  const contents = await readFile(auditPath, 'utf8');
  return contents.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

describe('permission guard runtime wiring', () => {
  it('registers tool_call and user_bash handlers from the extension entrypoint', () => {
    const pi = createMockPi();

    permissionGuardExtension(pi);

    expect(pi.handlers.tool_call).toHaveLength(1);
    expect(pi.handlers.user_bash).toHaveLength(1);
  });

  it('bypasses every permission check without prompting when bypassAll is true', async () => {
    const cwd = await tempWorkspace('permission-guard-runtime-bypass-all-');
    await writeProjectPolicy(cwd, { bypassAll: true });
    const pi = createMockPi();
    registerPermissionGuardRuntime(pi);
    const toolHandler = pi.handlers.tool_call![0] as ToolCallHandler;
    const userBashHandler = pi.handlers.user_bash![0] as UserBashHandler;
    const ctx = createCtx(cwd);

    await expect(toolHandler({ toolName: 'read', toolCallId: 'tc-bypass-read', input: { path: '../outside.txt' } }, ctx)).resolves.toBeUndefined();
    await expect(toolHandler({ toolName: 'bash', toolCallId: 'tc-bypass-bash', input: { command: 'sudo ls /' } }, ctx)).resolves.toBeUndefined();
    await expect(userBashHandler({ command: 'sudo ls /', cwd }, ctx)).resolves.toBeUndefined();
    expect(ctx.ui.select).not.toHaveBeenCalled();
  });

  it('blocks denied built-in tool calls before execution and audits safely even when audit writing fails', async () => {
    const cwd = await tempWorkspace('permission-guard-runtime-deny-');
    const auditPathAsDirectory = await mkdtemp(join(tmpdir(), 'permission-guard-runtime-audit-dir-'));
    await writeProjectPolicy(cwd, {
      outsideWorkspace: { read: 'deny' },
      audit: { path: auditPathAsDirectory },
    });
    const pi = createMockPi();
    registerPermissionGuardRuntime(pi);
    const handler = pi.handlers.tool_call![0] as ToolCallHandler;

    const result = await handler({ toolName: 'read', toolCallId: 'tc-deny', input: { path: '../outside.txt' } }, createCtx(cwd));

    expect(result).toEqual(expect.objectContaining({ block: true }));
    expect(result.reason).toContain('outside_workspace_read_denied');
    expect(result.reason).toContain('Audit warning:');
  });

  it('waits for interactive ask approval before allowing or blocking a tool call', async () => {
    const cwd = await tempWorkspace('permission-guard-runtime-ask-');
    const pi = createMockPi();
    registerPermissionGuardRuntime(pi);
    const handler = pi.handlers.tool_call![0] as ToolCallHandler;
    let resolveChoice!: (choice: ApprovalChoice) => void;
    const select = vi.fn(async (_message: string, options: ApprovalChoice[]) => {
      expect(options).toEqual(expect.arrayContaining(['Allow once', 'Allow for session', 'Deny']));
      return await new Promise<ApprovalChoice>((resolve) => {
        resolveChoice = resolve;
      });
    });
    const ctx = createCtx(cwd, [], { ui: { select } });

    const pending = handler({ toolName: 'read', toolCallId: 'tc-ask', input: { path: '../outside.txt' } }, ctx);
    await vi.waitFor(() => expect(select).toHaveBeenCalledOnce());

    resolveChoice('Deny');
    await expect(pending).resolves.toEqual(expect.objectContaining({ block: true }));
  });

  it('uses SDK/remote requestPermissionApproval hook for main-thread approvals', async () => {
    const cwd = await tempWorkspace('permission-guard-runtime-remote-hook-');
    const pi = createMockPi();
    registerPermissionGuardRuntime(pi);
    const handler = pi.handlers.tool_call![0] as ToolCallHandler;
    const requestPermissionApproval = vi.fn(async (_payload) => 'Allow for session' as const);
    const ctx = createCtx(cwd, [], {
      ui: {
        select: undefined,
        requestPermissionApproval,
      },
    });

    await expect(handler({ toolName: 'read', toolCallId: 'tc-remote', input: { path: '../outside.txt' } }, ctx)).resolves.toBeUndefined();

    expect(requestPermissionApproval).toHaveBeenCalledTimes(1);
    expect(requestPermissionApproval).toHaveBeenCalledWith(expect.objectContaining({
      type: 'interaction_required',
      tool: 'read',
      action: 'read',
      prompt: expect.objectContaining({
        choices: expect.arrayContaining(['Allow once', 'Allow for session', 'Allow this file for project', 'Allow this folder for project', 'Deny']),
      }),
    }));
  });

  it('reuses Allow for session approvals without prompting again for the same scoped request', async () => {
    const cwd = await tempWorkspace('permission-guard-runtime-session-');
    const state = await mkdtemp(join(tmpdir(), 'permission-guard-runtime-session-state-'));
    await writeProjectPolicy(cwd, { audit: { path: join(state, 'audit.ndjson') } });
    const pi = createMockPi();
    registerPermissionGuardRuntime(pi);
    const handler = pi.handlers.tool_call![0] as ToolCallHandler;
    const ctx = createCtx(cwd, ['Allow for session']);
    const event = { toolName: 'read', toolCallId: 'tc-session', input: { path: '../outside.txt' } };

    await expect(handler(event, ctx)).resolves.toBeUndefined();
    await expect(handler(event, ctx)).resolves.toBeUndefined();

    expect(ctx.ui.select).toHaveBeenCalledTimes(1);
    const events = await readAuditLines(join(state, 'audit.ndjson'));
    expect(events.map((entry) => entry.decision)).toEqual(['approval_allow_session']);
  });

  it('applies the same bash policy to agent bash tool calls and user bash commands', async () => {
    const cwd = await tempWorkspace('permission-guard-runtime-bash-');
    const pi = createMockPi();
    registerPermissionGuardRuntime(pi);
    const toolHandler = pi.handlers.tool_call![0] as ToolCallHandler;
    const userBashHandler = pi.handlers.user_bash![0] as UserBashHandler;
    const ctx = createCtx(cwd);

    const agentResult = await toolHandler({ toolName: 'bash', toolCallId: 'tc-bash', input: { command: 'sudo ls' } }, ctx);
    const userResult = await userBashHandler({ command: 'sudo ls', cwd }, ctx);

    expect(agentResult).toEqual(expect.objectContaining({ block: true }));
    expect(agentResult.reason).toContain('bash_privilege_escalation_denied');
    expect(userResult).toEqual({
      result: expect.objectContaining({
        exitCode: 1,
        cancelled: false,
        truncated: false,
        output: expect.stringContaining('bash_privilege_escalation_denied'),
      }),
    });
  });

  it('does not prompt for simple workspace-local bash commands or safe cd compounds when bypassWorkspace is true', async () => {
    const cwd = await tempWorkspace('permission-guard-runtime-bypass-workspace-simple-');
    await writeProjectPolicy(cwd, { bypassWorkspace: true });
    const pi = createMockPi();
    registerPermissionGuardRuntime(pi);
    const handler = pi.handlers.tool_call![0] as ToolCallHandler;
    const ctx = createCtx(cwd);

    await expect(handler({ toolName: 'bash', toolCallId: 'tc-bypass-workspace-simple', input: { command: 'git status --short' } }, ctx)).resolves.toBeUndefined();
    await expect(handler({ toolName: 'bash', toolCallId: 'tc-bypass-workspace-cd', input: { command: 'cd src && npm test' } }, ctx)).resolves.toBeUndefined();

    expect(ctx.ui.select).not.toHaveBeenCalled();
  });

  it('consumes a generic interaction response on retried subagent requests', async () => {
    const cwd = await tempWorkspace('permission-guard-runtime-subagent-response-');
    const responseKey = Symbol.for('pi.subagents.interactionResponses');
    const holder = globalThis as Record<symbol, unknown>;
    const previousResponses = holder[responseKey];
    const pi = createMockPi();
    registerPermissionGuardRuntime(pi);
    const handler = pi.handlers.tool_call![0] as ToolCallHandler;
    const ctx = createCtx(cwd, [], {
      mode: 'print',
      hasUI: false,
      origin: 'subagent',
      requester: { subagentName: 'sdd-verify' },
    });

    try {
      const first = await handler({ toolName: 'read', toolCallId: 'tc-subagent-response-first', input: { path: '../outside.txt' } }, ctx);
      const requestId = (first as any).details?.interaction_request?.requestId;
      const responses = new Map<string, unknown>([[requestId, { choice: 'Allow once' }]]);
      holder[responseKey] = responses;

      await expect(handler({ toolName: 'read', toolCallId: 'tc-subagent-response-retry', input: { path: '../outside.txt' } }, ctx)).resolves.toBeUndefined();
      expect(responses.size).toBe(0);
    } finally {
      if (previousResponses === undefined) delete holder[responseKey];
      else holder[responseKey] = previousResponses;
    }
  });

  it('surfaces subagent-originated asks through generic interaction_required channel data', async () => {
    const cwd = await tempWorkspace('permission-guard-runtime-subagent-');
    const pi = createMockPi();
    registerPermissionGuardRuntime(pi);
    const handler = pi.handlers.tool_call![0] as ToolCallHandler;
    const ctx = createCtx(cwd, ['Allow once']);

    const result = await handler({
      toolName: 'read',
      toolCallId: 'tc-subagent',
      input: { path: '../outside.txt' },
      origin: 'subagent',
      requester: { subagentId: 'sg-1', subagentName: 'sdd-apply', taskId: '2.10' },
    }, ctx);

    expect(ctx.ui.select).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({ block: true, reason: expect.not.stringMatching(/^interaction_required:/) }));
    const published = (result as any).details?.interactionRequest;
    expect(published).toEqual(expect.objectContaining({ handle: expect.any(String), payload: expect.any(Object) }));
    expect((result as any).details?.interaction_request).toEqual(expect.objectContaining({ type: 'interaction_required', kind: 'permission:read:read', origin: 'subagent' }));
    expect(resolveInteractionRequest(published.handle)).toEqual(expect.objectContaining({
      type: 'interaction_required',
      kind: 'permission:read:read',
      origin: 'subagent',
      requester: { subagentId: 'sg-1', subagentName: 'sdd-apply', taskId: '2.10' },
      prompt: expect.objectContaining({
        choices: ['Allow once', 'Allow for session', 'Allow this file for project', 'Allow this folder for project', 'Deny'],
        safeTarget: expect.stringContaining('outside.txt'),
      }),
      payload: expect.objectContaining({
        permission: expect.objectContaining({ tool: 'read', action: 'read', reasonCode: 'outside_workspace_read_requires_approval' }),
      }),
      response: { expected: 'choice' },
    }));
  });

  it('fails closed without generic interaction data when no-ui request is not from a subagent session', async () => {
    const cwd = await tempWorkspace('permission-guard-runtime-no-subagent-fallback-');
    const pi = createMockPi();
    registerPermissionGuardRuntime(pi);
    const handler = pi.handlers.tool_call![0] as ToolCallHandler;
    const ctx = createCtx(cwd, [], { mode: 'json', hasUI: false });

    const result = await handler({ toolName: 'read', toolCallId: 'tc-no-subagent', input: { path: '../outside.txt' } }, ctx);

    expect(result).toEqual(expect.objectContaining({ block: true }));
    expect((result as any).reason).toContain('non_interactive_ask_denied');
    expect((result as any).details?.interactionRequest).toBeUndefined();
  });

  it('surfaces subagent-originated asks without direct UI through structured interaction data instead of non-interactive denial', async () => {
    const cwd = await tempWorkspace('permission-guard-runtime-subagent-no-ui-');
    const pi = createMockPi();
    registerPermissionGuardRuntime(pi);
    const handler = pi.handlers.tool_call![0] as ToolCallHandler;
    const ctx = createCtx(cwd, [], {
      mode: 'json',
      hasUI: false,
      origin: 'nested',
      requester: { subagentId: 'sg-no-ui', subagentName: 'sdd-verify', taskId: '3.6' },
    });

    const result = await handler({
      toolName: 'read',
      toolCallId: 'tc-subagent-no-ui',
      input: { path: '../outside.txt' },
    }, ctx);

    expect(ctx.ui.select).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({ block: true }));
    expect((result as any).reason).not.toContain('non_interactive_ask_denied');
    const published = (result as any).details?.interactionRequest;
    expect((result as any).details?.interaction_request).toEqual(expect.objectContaining({ type: 'interaction_required', kind: 'permission:read:read', origin: 'subagent' }));
    expect(resolveInteractionRequest(published.handle)).toEqual(expect.objectContaining({
      type: 'interaction_required',
      kind: 'permission:read:read',
      origin: 'subagent',
      requester: { subagentId: 'sg-no-ui', subagentName: 'sdd-verify', taskId: '3.6' },
      prompt: expect.objectContaining({
        choices: ['Allow once', 'Allow for session', 'Allow this file for project', 'Allow this folder for project', 'Deny'],
        safeTarget: expect.stringContaining('outside.txt'),
      }),
    }));
  });

  it('does not leak secret-like command values or long raw commands in interaction requests', async () => {
    const cwd = await tempWorkspace('permission-guard-runtime-interaction-redaction-');
    await writeProjectPolicy(cwd, { bash: { network: 'ask', maxCommandPreviewChars: 80 } });
    const pi = createMockPi();
    registerPermissionGuardRuntime(pi);
    const handler = pi.handlers.tool_call![0] as ToolCallHandler;
    const secret = 'sentinel-super-secret-token-value';
    const command = `curl 'https://example.com/data?token=${secret}&q=${'x'.repeat(300)}'`;
    const ctx = createCtx(cwd, [], {
      mode: 'print',
      hasUI: false,
      origin: 'subagent',
      requester: { subagentName: 'sdd-verify' },
    });

    const result = await handler({ toolName: 'bash', toolCallId: 'tc-redaction', input: { command } }, ctx);
    const serialized = JSON.stringify((result as any).details?.interaction_request);

    expect(serialized).toContain('interaction_required');
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('x'.repeat(120));
    expect(serialized).not.toContain(command);
  });

  it('uses subagent session metadata to surface no-direct-UI asks when tool events lack origin fields', async () => {
    const cwd = await tempWorkspace('permission-guard-runtime-subagent-registry-');
    const pi = createMockPi();
    registerPermissionGuardRuntime(pi);
    const handler = pi.handlers.tool_call![0] as ToolCallHandler;
    const sessionId = 'subagent-session-registry';
    const registryKey = Symbol.for('pi.subagents.interactionSessions');
    const previousRegistry = (globalThis as Record<symbol, unknown>)[registryKey];
    const registry = new Map<string, unknown>();
    registry.set(sessionId, {
      requester: { subagentName: 'sdd-verify', description: 'manual validation' },
    });
    (globalThis as Record<symbol, unknown>)[registryKey] = registry;
    const ctx = createCtx(cwd, [], {
      mode: 'print',
      hasUI: false,
      sessionManager: {
        getSessionFile: () => undefined,
        getSessionId: () => sessionId,
      },
    });

    try {
      const result = await handler({
        toolName: 'read',
        toolCallId: 'tc-subagent-registry',
        input: { path: '../outside.txt' },
      }, ctx);

      expect(ctx.ui.select).not.toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({ block: true }));
      expect((result as any).reason).not.toContain('non_interactive_ask_denied');
      const published = (result as any).details?.interactionRequest;
      expect((result as any).details?.interaction_request).toEqual(expect.objectContaining({ type: 'interaction_required', kind: 'permission:read:read', origin: 'subagent' }));
      expect(resolveInteractionRequest(published.handle)).toEqual(expect.objectContaining({
        type: 'interaction_required',
        kind: 'permission:read:read',
        origin: 'subagent',
        requester: { subagentName: 'sdd-verify', description: 'manual validation' },
      }));
    } finally {
      if (previousRegistry === undefined) {
        delete (globalThis as Record<symbol, unknown>)[registryKey];
      } else {
        (globalThis as Record<symbol, unknown>)[registryKey] = previousRegistry;
      }
    }
  });

  it('persists direct Allow this file for project approvals and reuses them without another prompt', async () => {
    const cwd = await tempWorkspace('permission-guard-runtime-path-file-project-');
    const outsideRoot = await mkdtemp(join(tmpdir(), 'permission-guard-runtime-path-file-project-outside-'));
    const approvedFile = join(outsideRoot, 'approved.txt');
    await writeFile(approvedFile, 'approved', 'utf8');
    await writeProjectPolicy(cwd, { bypassAll: false });
    const pi = createMockPi();
    registerPermissionGuardRuntime(pi);
    const handler = pi.handlers.tool_call![0] as ToolCallHandler;
    const ctx = createCtx(cwd, ['Allow this file for project']);
    const event = { toolName: 'read', toolCallId: 'tc-path-file-project', input: { path: approvedFile } };

    await expect(handler(event, ctx)).resolves.toBeUndefined();
    await expect(handler(event, ctx)).resolves.toBeUndefined();

    const saved = JSON.parse(await readFile(join(cwd, '.pi', 'permissions.json'), 'utf8'));
    expect(saved.pathApprovals.scopedApprovals).toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: 'file', normalizedAbsolute: approvedFile, tools: ['read', 'ls', 'find', 'grep'] }),
    ]));
    expect(ctx.ui.select).toHaveBeenCalledTimes(1);
  });

  it('persists workspace-only Allow for project bash approvals as safeCommands', async () => {
    const cwd = await tempWorkspace('permission-guard-runtime-project-approval-');
    const pi = createMockPi();
    registerPermissionGuardRuntime(pi);
    const handler = pi.handlers.tool_call![0] as ToolCallHandler;
    const ctx = createCtx(cwd, ['Allow for project']);

    await expect(handler({
      toolName: 'bash',
      toolCallId: 'tc-project-approval',
      input: { command: 'npm --prefix .pi/extensions/permission-guard test -- --run' },
    }, ctx)).resolves.toBeUndefined();

    const saved = JSON.parse(await readFile(join(cwd, '.pi', 'permissions.json'), 'utf8'));
    expect(saved.bash.safeCommands).toContain('regex:^npm\\s+--prefix\\s+(?!/|~|\\.\\.(?:/|$)|.*\\/\\.\\.(?:/|$))[A-Za-z0-9._/@+-]+\\s+test(?:\\s+--\\s+.*)?$');
    expect(saved.bash.scopedApprovals ?? []).toEqual([]);

    await expect(handler({
      toolName: 'bash',
      toolCallId: 'tc-project-approval-variant',
      input: { command: 'npm --prefix .pi/extensions/subagents test -- --run' },
    }, ctx)).resolves.toBeUndefined();
    expect(ctx.ui.select).toHaveBeenCalledTimes(1);
  });

  it('publishes path approval options for supported external subagent path requests', async () => {
    const cwd = await tempWorkspace('permission-guard-runtime-subagent-path-options-');
    const outsideRoot = await mkdtemp(join(tmpdir(), 'permission-guard-runtime-subagent-path-options-outside-'));
    const approvedFile = join(outsideRoot, 'approved.txt');
    await writeFile(approvedFile, 'approved', 'utf8');
    const pi = createMockPi();
    registerPermissionGuardRuntime(pi);
    const handler = pi.handlers.tool_call![0] as ToolCallHandler;
    const ctx = createCtx(cwd, [], {
      mode: 'print',
      hasUI: false,
      origin: 'subagent',
      requester: { subagentName: 'sdd-apply' },
    });

    const result = await handler({ toolName: 'read', toolCallId: 'tc-subagent-path-options', input: { path: approvedFile } }, ctx);

    expect((result as any).details?.interaction_request).toEqual(expect.objectContaining({
      type: 'interaction_required',
      kind: 'permission:read:read',
      payload: expect.objectContaining({
        permission: expect.objectContaining({
          projectScope: expect.objectContaining({
            pathApprovalOptions: expect.objectContaining({
              file: expect.objectContaining({ scope: 'file', normalizedAbsolute: approvedFile }),
              folder: expect.objectContaining({ scope: 'folder', normalizedAbsolute: outsideRoot }),
            }),
          }),
        }),
      }),
    }));
  });

  it('does not handle unsupported tool_call tools', async () => {
    const cwd = await tempWorkspace('permission-guard-runtime-unsupported-');
    const pi = createMockPi();
    registerPermissionGuardRuntime(pi);
    const handler = pi.handlers.tool_call![0] as ToolCallHandler;

    await expect(handler({ toolName: 'unknown_tool', toolCallId: 'tc-unknown', input: {} }, createCtx(cwd))).resolves.toBeUndefined();
  });

  it('does not create a project permissions file as part of runtime registration', async () => {
    const cwd = await tempWorkspace('permission-guard-runtime-no-config-create-');
    const pi = createMockPi();
    registerPermissionGuardRuntime(pi);
    const handler = pi.handlers.tool_call![0] as ToolCallHandler;

    await handler({ toolName: 'read', toolCallId: 'tc-inside', input: { path: 'src/index.ts' } }, createCtx(cwd));

    await expect(stat(join(cwd, '.pi', 'permissions.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
