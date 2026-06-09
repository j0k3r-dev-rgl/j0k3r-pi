import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { builtInPermissionPolicy } from '../src/defaults.js';
import { classifyPathTarget } from '../src/path-policy.js';
import { evaluatePermission } from '../src/policy.js';
import { APPROVAL_CHOICES, buildPermissionRequiredPayload, resolveApproval } from '../src/approval.js';
import { createSessionApprovalCache } from '../src/session-cache.js';
import type { PermissionDecisionResult, PermissionPolicyConfig, PermissionRequest } from '../src/types.js';

type PolicyOverrides = Omit<Partial<PermissionPolicyConfig>, 'workspace' | 'outsideWorkspace' | 'tools' | 'approvals' | 'nonInteractive'> & {
  workspace?: Partial<PermissionPolicyConfig['workspace']>;
  outsideWorkspace?: Partial<PermissionPolicyConfig['outsideWorkspace']>;
  tools?: Partial<PermissionPolicyConfig['tools']>;
  approvals?: Partial<PermissionPolicyConfig['approvals']>;
  nonInteractive?: Partial<PermissionPolicyConfig['nonInteractive']>;
};

function policy(overrides: PolicyOverrides = {}): PermissionPolicyConfig {
  return {
    ...structuredClone(builtInPermissionPolicy),
    ...overrides,
    workspace: { ...structuredClone(builtInPermissionPolicy.workspace), ...(overrides.workspace ?? {}) },
    outsideWorkspace: { ...structuredClone(builtInPermissionPolicy.outsideWorkspace), ...(overrides.outsideWorkspace ?? {}) },
    tools: { ...structuredClone(builtInPermissionPolicy.tools), ...(overrides.tools ?? {}) },
    approvals: { ...structuredClone(builtInPermissionPolicy.approvals), ...(overrides.approvals ?? {}) },
    nonInteractive: { ...structuredClone(builtInPermissionPolicy.nonInteractive), ...(overrides.nonInteractive ?? {}) },
  };
}

async function tempWorkspace(prefix: string) {
  const cwd = await mkdtemp(join(tmpdir(), prefix));
  await mkdir(join(cwd, 'src'), { recursive: true });
  return cwd;
}

async function outsideReadRequest(cwd: string, rawPath = '../outside.txt', overrides: Partial<PermissionRequest> = {}): Promise<PermissionRequest> {
  const config = policy({ workspace: { root: cwd } });
  const target = await classifyPathTarget(rawPath, { cwd, config });
  return {
    id: `req-${rawPath}`,
    source: 'tool_call',
    origin: 'main',
    tool: 'read',
    action: 'read',
    rawInputSummary: `read ${rawPath}`,
    target,
    mode: 'tui',
    hasUI: true,
    policyIdentity: 'test-policy',
    timestamp: '2026-06-09T00:00:00.000Z',
    ...overrides,
  };
}

function askDecision(config: PermissionPolicyConfig, request: PermissionRequest): PermissionDecisionResult {
  const decision = evaluatePermission(config, request);
  expect(decision).toMatchObject({ decision: 'ask', finalDecision: 'requires_approval' });
  return decision;
}

describe('interactive approval and session cache', () => {
  it('uses the exact English prompt choices', async () => {
    const cwd = await tempWorkspace('permission-guard-approval-choices-');
    await writeFile(join(cwd, '..', 'outside.txt'), 'outside', 'utf8');
    const config = policy({ workspace: { root: cwd } });
    const request = await outsideReadRequest(cwd);
    const decision = askDecision(config, request);
    const prompt = vi.fn(async () => 'Deny' as const);

    await resolveApproval(config, request, decision, { prompt, sessionCache: createSessionApprovalCache({ sessionId: 'session-a' }) });

    expect(APPROVAL_CHOICES).toEqual(['Allow once', 'Allow for session', 'Deny']);
    expect(prompt).toHaveBeenCalledWith(expect.objectContaining({ choices: ['Allow once', 'Allow for session', 'Deny'] }));
  });

  it('allows once without mutating the session cache', async () => {
    const cwd = await tempWorkspace('permission-guard-approval-once-');
    const config = policy({ workspace: { root: cwd } });
    const request = await outsideReadRequest(cwd);
    const decision = askDecision(config, request);
    const cache = createSessionApprovalCache({ sessionId: 'session-once' });

    const resolved = await resolveApproval(config, request, decision, {
      prompt: async () => 'Allow once' as const,
      sessionCache: cache,
    });

    expect(resolved.result).toMatchObject({ decision: 'allow', finalDecision: 'allow', reasonCode: 'approval_allow_once' });
    expect(cache.snapshot().entries).toEqual([]);
    expect(evaluatePermission(config, request, cache.snapshot())).toMatchObject({ decision: 'ask', finalDecision: 'requires_approval' });
  });

  it('stores allow-for-session using a scoped cache entry that can be reused by the pure policy engine', async () => {
    const cwd = await tempWorkspace('permission-guard-approval-session-');
    const config = policy({ workspace: { root: cwd } });
    const request = await outsideReadRequest(cwd);
    const decision = askDecision(config, request);
    const cache = createSessionApprovalCache({ sessionId: 'session-reuse' });

    const resolved = await resolveApproval(config, request, decision, {
      prompt: async () => 'Allow for session' as const,
      sessionCache: cache,
    });

    expect(resolved.result).toMatchObject({ decision: 'allow', finalDecision: 'allow', reasonCode: 'approval_allow_session' });
    const entries = cache.snapshot().entries ?? [];
    expect(entries).toEqual([
      expect.objectContaining({
        action: 'read',
        tool: 'read',
        targetPattern: request.target!.normalizedAbsolute,
        policyIdentity: 'test-policy',
      }),
    ]);
    expect(entries[0]!.cacheKey).toContain('session-reuse');
    expect(evaluatePermission(config, request, cache.snapshot())).toMatchObject({ decision: 'allow', reasonCode: 'session_approval_allowed' });

    const writeRequest = { ...request, id: 'write-req', tool: 'write' as const, action: 'write' as const, rawInputSummary: 'write outside' };
    expect(evaluatePermission(config, writeRequest, cache.snapshot())).toMatchObject({ decision: 'ask', finalDecision: 'requires_approval' });
  });

  it('blocks the current request when the prompt is denied', async () => {
    const cwd = await tempWorkspace('permission-guard-approval-deny-');
    const config = policy({ workspace: { root: cwd } });
    const request = await outsideReadRequest(cwd);
    const decision = askDecision(config, request);

    const resolved = await resolveApproval(config, request, decision, {
      prompt: async () => 'Deny' as const,
      sessionCache: createSessionApprovalCache({ sessionId: 'session-deny' }),
    });

    expect(resolved.result).toMatchObject({ decision: 'deny', finalDecision: 'deny', reasonCode: 'approval_denied' });
  });

  it('treats allow-for-session as allow-once when session cache is disabled', async () => {
    const cwd = await tempWorkspace('permission-guard-approval-cache-disabled-');
    const config = policy({ workspace: { root: cwd }, approvals: { sessionCache: false } });
    const request = await outsideReadRequest(cwd);
    const decision = askDecision(config, request);
    const cache = createSessionApprovalCache({ sessionId: 'session-disabled' });

    const resolved = await resolveApproval(config, request, decision, {
      prompt: async () => 'Allow for session' as const,
      sessionCache: cache,
    });

    expect(resolved.result).toMatchObject({ decision: 'allow', finalDecision: 'allow', reasonCode: 'approval_allow_once' });
    expect(cache.snapshot().entries).toEqual([]);
  });

  it('surfaces subagent-originated asks as permission_required payloads with requester identity instead of prompting locally', async () => {
    const cwd = await tempWorkspace('permission-guard-approval-subagent-');
    const config = policy({ workspace: { root: cwd } });
    const request = await outsideReadRequest(cwd, '../outside.txt', {
      id: 'subagent-request',
      origin: 'subagent',
      requester: { subagentId: 'sg-1', subagentName: 'sdd-apply', taskId: 'task-2.7', description: 'read docs' },
    });
    const decision = askDecision(config, request);
    const prompt = vi.fn(async () => 'Allow once' as const);

    const resolved = await resolveApproval(config, request, decision, {
      prompt,
      sessionCache: createSessionApprovalCache({ sessionId: 'session-subagent' }),
    });

    expect(prompt).not.toHaveBeenCalled();
    expect(resolved.result).toMatchObject({ decision: 'ask', finalDecision: 'requires_approval', reasonCode: 'permission_required' });
    expect(resolved.permissionRequired).toEqual(expect.objectContaining({
      type: 'permission_required',
      requestId: 'subagent-request',
      tool: 'read',
      action: 'read',
      origin: 'subagent',
      requester: request.requester,
      prompt: expect.objectContaining({
        choices: ['Allow once', 'Allow for session', 'Deny'],
        safeTarget: request.target!.normalizedAbsolute,
        limitations: expect.arrayContaining([expect.stringContaining('not a hard sandbox')]),
      }),
      sessionScope: expect.objectContaining({
        action: 'read',
        tool: 'read',
        targetPattern: request.target!.normalizedAbsolute,
        policyIdentity: 'test-policy',
      }),
    }));
  });

  it('builds a permission_required payload with prompt-safe command details', () => {
    const request: PermissionRequest = {
      id: 'bash-ask',
      source: 'tool_call',
      origin: 'subagent',
      requester: { subagentName: 'researcher', taskId: 't-1' },
      tool: 'bash',
      action: 'bash',
      rawInputSummary: 'bash curl https://example.com',
      command: { raw: 'curl https://example.com', summary: 'curl https://example.com' },
      mode: 'tui',
      hasUI: true,
      policyIdentity: 'test-policy',
      timestamp: '2026-06-09T00:00:00.000Z',
    };
    const decision = evaluatePermission(policy(), request);

    expect(buildPermissionRequiredPayload(request, decision)).toEqual(expect.objectContaining({
      type: 'permission_required',
      requestId: 'bash-ask',
      prompt: expect.objectContaining({
        choices: ['Allow once', 'Allow for session', 'Deny'],
        safeCommandSummary: 'curl https://example.com',
      }),
      requester: request.requester,
    }));
  });

  it('fails closed through non-interactive fallback when no UI can collect approval', async () => {
    const cwd = await tempWorkspace('permission-guard-approval-no-ui-');
    const config = policy({ workspace: { root: cwd }, nonInteractive: { onAsk: 'deny' } });
    const request = await outsideReadRequest(cwd, '../outside.txt', { mode: 'json', hasUI: false });
    const baseDecision = evaluatePermission(policy({ workspace: { root: cwd }, nonInteractive: { onAsk: 'allow' } }), request);
    expect(baseDecision).toMatchObject({ decision: 'allow', reasonCode: 'non_interactive_ask_allowed' });

    const resolved = await resolveApproval(config, request, { ...baseDecision, decision: 'ask', finalDecision: 'requires_approval' }, {
      sessionCache: createSessionApprovalCache({ sessionId: 'session-no-ui' }),
    });

    expect(resolved.result).toMatchObject({ decision: 'deny', finalDecision: 'deny', reasonCode: 'non_interactive_ask_denied' });
  });
});
