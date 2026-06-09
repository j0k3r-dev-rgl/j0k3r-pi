import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { builtInPermissionPolicy } from '../src/defaults.js';
import { classifyPathTarget } from '../src/path-policy.js';
import { evaluatePermission } from '../src/policy.js';
import type { PermissionPolicyConfig, PermissionRequest } from '../src/types.js';

async function tempWorkspace(prefix: string) {
  const cwd = await mkdtemp(join(tmpdir(), prefix));
  await mkdir(join(cwd, 'src'), { recursive: true });
  return cwd;
}

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

async function pathRequest(rawPath: string, cwd: string, action: PermissionRequest['action'] = 'read', hasUI = true): Promise<PermissionRequest> {
  const config = policy({ workspace: { root: cwd } });
  return {
    id: `req-${rawPath}`,
    source: 'tool_call',
    origin: 'main',
    tool: action === 'list' ? 'ls' : 'read',
    action,
    rawInputSummary: `${action} ${rawPath}`,
    target: await classifyPathTarget(rawPath, { cwd, config }),
    mode: hasUI ? 'tui' : 'json',
    hasUI,
    policyIdentity: 'test-policy',
    timestamp: '2026-06-09T00:00:00.000Z',
  };
}

function bashRequest(command: string, hasUI = true): PermissionRequest {
  return {
    id: `req-${command}`,
    source: 'tool_call',
    origin: 'main',
    tool: 'bash',
    action: 'bash',
    rawInputSummary: `bash ${command}`,
    command: { raw: command, summary: command },
    mode: hasUI ? 'tui' : 'json',
    hasUI,
    policyIdentity: 'test-policy',
    timestamp: '2026-06-09T00:00:00.000Z',
  };
}

describe('pure permission policy engine', () => {
  it('returns a deterministic decision shape for workspace allows', async () => {
    const cwd = await tempWorkspace('permission-guard-policy-shape-');
    await writeFile(join(cwd, 'src', 'index.ts'), 'export {};', 'utf8');
    const request = await pathRequest('src/index.ts', cwd);

    expect(evaluatePermission(policy({ workspace: { root: cwd } }), request)).toEqual({
      decision: 'allow',
      finalDecision: 'allow',
      reason: 'Workspace read is allowed by policy.',
      reasonCode: 'workspace_read_allowed',
      riskLevel: 'low',
      details: {
        safeTarget: '<workspace>/src/index.ts',
        workspaceRoot: cwd,
        matchedLayer: 'workspace',
        noPreview: false,
      },
      audit: false,
    });
  });

  it.each([
    { mode: 'allow' as const, finalDecision: 'allow' as const, reasonCode: 'tool_mode_allow' },
    { mode: 'deny' as const, finalDecision: 'deny' as const, reasonCode: 'tool_mode_deny' },
  ])('honors per-tool $mode mode before path policy', async ({ mode, finalDecision, reasonCode }) => {
    const cwd = await tempWorkspace('permission-guard-policy-tool-mode-');
    const request = await pathRequest('../outside.txt', cwd);

    expect(evaluatePermission(policy({ workspace: { root: cwd }, tools: { read: mode } }), request)).toMatchObject({
      finalDecision,
      reasonCode,
      details: { matchedLayer: 'tool' },
    });
  });

  it('uses policy mode to continue into workspace/outside evaluation', async () => {
    const cwd = await tempWorkspace('permission-guard-policy-tool-policy-');
    const request = await pathRequest('../outside.txt', cwd);

    expect(evaluatePermission(policy({ workspace: { root: cwd }, tools: { read: 'policy' } }), request)).toMatchObject({
      decision: 'ask',
      finalDecision: 'requires_approval',
      reasonCode: 'outside_workspace_read_requires_approval',
      details: { matchedLayer: 'outsideWorkspace' },
    });
  });

  it('allows everything except audit when the guard is disabled', async () => {
    const cwd = await tempWorkspace('permission-guard-policy-disabled-');
    const request = await pathRequest('../outside.txt', cwd);

    expect(evaluatePermission(policy({ enabled: false }), request)).toMatchObject({
      decision: 'allow',
      finalDecision: 'allow',
      reasonCode: 'permission_guard_disabled',
      details: { matchedLayer: 'disabled' },
      audit: false,
    });
  });

  it('applies secret deny before session cache or workspace allow', async () => {
    const cwd = await tempWorkspace('permission-guard-policy-secret-cache-');
    await writeFile(join(cwd, '.env'), 'SENTINEL_SECRET=1', 'utf8');
    const request = await pathRequest('.env', cwd);

    const result = evaluatePermission(policy({ workspace: { root: cwd } }), request, {
      entries: [{ cacheKey: 'anything', action: 'read', tool: 'read', targetPattern: request.target!.normalizedAbsolute, policyIdentity: 'test-policy' }],
    });

    expect(result).toMatchObject({
      decision: 'deny',
      finalDecision: 'deny',
      reasonCode: 'secret_path_denied',
      details: { matchedLayer: 'secret', noPreview: true },
    });
    expect(JSON.stringify(result)).not.toContain('SENTINEL_SECRET');
  });

  it('applies workspace deny and ask globs before workspace allow defaults', async () => {
    const cwd = await tempWorkspace('permission-guard-policy-layer-');
    await mkdir(join(cwd, '.git'), { recursive: true });
    await writeFile(join(cwd, '.git', 'config'), 'git config', 'utf8');
    await writeFile(join(cwd, 'src', 'review.md'), 'review', 'utf8');

    const deny = await pathRequest('.git/config', cwd);
    const ask = await pathRequest('src/review.md', cwd);
    const config = policy({ workspace: { root: cwd, deny: ['.git/**'], ask: ['src/**/*.md'] } });

    expect(evaluatePermission(config, deny)).toMatchObject({ decision: 'deny', reasonCode: 'workspace_path_denied' });
    expect(evaluatePermission(config, ask)).toMatchObject({ decision: 'ask', reasonCode: 'workspace_path_requires_approval' });
  });

  it('applies workspace and outside-workspace action policies', async () => {
    const cwd = await tempWorkspace('permission-guard-policy-workspace-outside-');
    await writeFile(join(cwd, 'src', 'index.ts'), 'inside', 'utf8');

    const inside = await pathRequest('src/index.ts', cwd, 'read');
    const outside = await pathRequest('../outside.txt', cwd, 'read');
    const config = policy({ workspace: { root: cwd, allowRead: 'allow' }, outsideWorkspace: { read: 'deny' } });

    expect(evaluatePermission(config, inside)).toMatchObject({ decision: 'allow', reasonCode: 'workspace_read_allowed' });
    expect(evaluatePermission(config, outside)).toMatchObject({ decision: 'deny', reasonCode: 'outside_workspace_read_denied' });
  });

  it('converts ask to allow only for matching scoped session approvals', async () => {
    const cwd = await tempWorkspace('permission-guard-policy-session-');
    const request = await pathRequest('../outside.txt', cwd);
    const config = policy({ workspace: { root: cwd } });

    const unmatched = evaluatePermission(config, request, {
      entries: [{ cacheKey: 'wrong', action: 'read', tool: 'read', targetPattern: '/somewhere-else', policyIdentity: 'test-policy' }],
    });
    const matched = evaluatePermission(config, request, {
      entries: [{ cacheKey: 'ok', action: 'read', tool: 'read', targetPattern: request.target!.normalizedAbsolute, policyIdentity: 'test-policy' }],
    });

    expect(unmatched).toMatchObject({ decision: 'ask', finalDecision: 'requires_approval' });
    expect(matched).toMatchObject({ decision: 'allow', finalDecision: 'allow', reasonCode: 'session_approval_allowed' });
  });

  it('denies ask decisions without UI by default and allows only when configured', async () => {
    const config = policy({ nonInteractive: { onAsk: 'deny' } });
    const allowConfig = policy({ nonInteractive: { onAsk: 'allow' } });
    const request = bashRequest('curl https://example.com', false);

    expect(evaluatePermission(config, request)).toMatchObject({
      decision: 'deny',
      finalDecision: 'deny',
      reasonCode: 'non_interactive_ask_denied',
      details: { matchedLayer: 'nonInteractive' },
    });
    expect(evaluatePermission(allowConfig, request)).toMatchObject({
      decision: 'allow',
      finalDecision: 'allow',
      reasonCode: 'non_interactive_ask_allowed',
    });
  });
});
