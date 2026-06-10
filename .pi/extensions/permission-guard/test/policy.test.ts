import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { builtInPermissionPolicy } from '../src/defaults.js';
import { classifyPathTarget } from '../src/path-policy.js';
import { evaluatePermission } from '../src/policy.js';
import { buildScopedBashApproval } from '../src/project-approval.js';
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

function bashRequest(command: string, hasUI = true, workspaceRoot = '/workspace'): PermissionRequest {
  return {
    id: `req-${command}`,
    source: 'tool_call',
    origin: 'main',
    tool: 'bash',
    action: 'bash',
    rawInputSummary: `bash ${command}`,
    command: { raw: command, summary: command },
    executionContext: { cwd: workspaceRoot, workspaceRoot, policyIdentity: 'test-policy' },
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

  it('reuses scoped project bash approvals only for compatible command shapes within approved roots', () => {
    const workspaceRoot = '/workspace';
    const approvedRoot = '/home/test/sias/app';
    const baseRequest = bashRequest(`find ${approvedRoot} -maxdepth 1 -mindepth 1 -print | sort`, true, workspaceRoot);
    const baseDecision = evaluatePermission(policy({ workspace: { root: workspaceRoot } }), baseRequest);
    const approval = buildScopedBashApproval(baseRequest, baseDecision);
    expect(approval).toBeDefined();

    const config = policy({
      workspace: { root: workspaceRoot },
      bash: {
        ...structuredClone(builtInPermissionPolicy.bash),
        scopedApprovals: [approval!],
      },
    });

    const childPath = evaluatePermission(config, bashRequest(`find ${approvedRoot}/back -maxdepth 1 -mindepth 1 -print | sort`, true, workspaceRoot));
    const differentRead = evaluatePermission(config, bashRequest(`cat ${approvedRoot}/file.txt`, true, workspaceRoot));
    const differentDelete = evaluatePermission(config, bashRequest(`rm ${approvedRoot}/file.txt`, true, workspaceRoot));
    const packageInstall = evaluatePermission(config, bashRequest('npm install', true, workspaceRoot));
    const outsideRoot = evaluatePermission(config, bashRequest('find /home/test/other-app -maxdepth 1 -mindepth 1 -print | sort', true, workspaceRoot));

    expect(childPath).toMatchObject({ decision: 'allow', reasonCode: 'project_approval_allowed', details: { matchedLayer: 'project' } });
    expect(differentRead).toMatchObject({ decision: 'ask', finalDecision: 'requires_approval' });
    expect(differentDelete).toMatchObject({ decision: 'ask', finalDecision: 'requires_approval' });
    expect(packageInstall).toMatchObject({ decision: 'ask', finalDecision: 'requires_approval' });
    expect(outsideRoot).toMatchObject({ decision: 'ask', finalDecision: 'requires_approval' });
  });

  it('does not reuse scoped bash approvals for sibling directories with the same command shape', () => {
    const cwd = '/workspace';
    const approvedRequest = {
      ...bashRequest('npm --prefix .pi/extensions/permission-guard test -- --run'),
      executionContext: { cwd, workspaceRoot: cwd, policyIdentity: 'test-policy' },
    };
    const approvedBase = evaluatePermission(policy({ workspace: { root: cwd } }), approvedRequest);
    const config = policy({
      workspace: { root: cwd },
      bash: {
        ...structuredClone(builtInPermissionPolicy.bash),
        scopedApprovals: [{
          version: 1,
          id: 'bash_approval_npm_prefix',
          createdAt: '2026-06-10T00:00:00.000Z',
          normalizedCommand: 'npm --prefix .pi/extensions/permission-guard test -- --run',
          commandSignature: approvedBase.details.shellAnalysis!.commandSignature,
          effectSignature: approvedBase.details.shellAnalysis!.effectSignature,
          allowedRoots: [{ kind: 'directory', raw: '/workspace/.pi/extensions/permission-guard', normalizedAbsolute: '/workspace/.pi/extensions/permission-guard', resolvedRealpath: '/workspace/.pi/extensions/permission-guard' }],
          source: 'project',
        }],
      },
    });

    const sameRoot = evaluatePermission(config, approvedRequest);
    const sibling = evaluatePermission(config, {
      ...bashRequest('npm --prefix .pi/extensions/subagents test -- --run'),
      executionContext: { cwd, workspaceRoot: cwd, policyIdentity: 'test-policy' },
    });

    expect(sameRoot).toMatchObject({ decision: 'allow', reasonCode: 'project_approval_allowed' });
    expect(sibling).toMatchObject({ decision: 'ask', finalDecision: 'requires_approval' });
  });

  it('reuses compatible scoped bash approvals for child directories under the approved root', () => {
    const cwd = '/workspace';
    const approvedRequest = {
      ...bashRequest('find /home/test/sias/app -maxdepth 1 -mindepth 1 -print | sort'),
      executionContext: { cwd, workspaceRoot: cwd, policyIdentity: 'test-policy' },
    };
    const approvedBase = evaluatePermission(policy({ workspace: { root: cwd } }), approvedRequest);
    const config = policy({
      workspace: { root: cwd },
      bash: {
        ...structuredClone(builtInPermissionPolicy.bash),
        scopedApprovals: [{
          version: 1,
          id: 'bash_approval_find_sias',
          createdAt: '2026-06-10T00:00:00.000Z',
          normalizedCommand: 'find /home/test/sias/app -maxdepth 1 -mindepth 1 -print | sort',
          commandSignature: approvedBase.details.shellAnalysis!.commandSignature,
          effectSignature: approvedBase.details.shellAnalysis!.effectSignature,
          allowedRoots: [{ kind: 'directory', raw: '/home/test/sias/app', normalizedAbsolute: '/home/test/sias/app', resolvedRealpath: '/home/test/sias/app' }],
          source: 'project',
        }],
      },
    });

    const child = evaluatePermission(config, {
      ...bashRequest('find /home/test/sias/app/back -maxdepth 1 -mindepth 1 -print | sort'),
      executionContext: { cwd, workspaceRoot: cwd, policyIdentity: 'test-policy' },
    });
    const differentCommand = evaluatePermission(config, {
      ...bashRequest('cat /home/test/sias/app/README.md'),
      executionContext: { cwd, workspaceRoot: cwd, policyIdentity: 'test-policy' },
    });
    const outside = evaluatePermission(config, {
      ...bashRequest('find /home/test/other -maxdepth 1 -mindepth 1 -print | sort'),
      executionContext: { cwd, workspaceRoot: cwd, policyIdentity: 'test-policy' },
    });

    expect(child).toMatchObject({ decision: 'allow', reasonCode: 'project_approval_allowed' });
    expect(differentCommand).toMatchObject({ decision: 'ask', finalDecision: 'requires_approval' });
    expect(outside).toMatchObject({ decision: 'ask', finalDecision: 'requires_approval' });
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
