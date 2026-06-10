import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { addProjectBashApproval, buildScopedBashApproval } from '../src/project-approval.js';
import { builtInPermissionPolicy } from '../src/defaults.js';
import { evaluatePermission } from '../src/policy.js';
import type { PermissionPolicyConfig, PermissionRequest, ScopedBashApproval } from '../src/types.js';

function approval(root: string): ScopedBashApproval {
  return {
    version: 1,
    id: 'bash_approval_test',
    createdAt: '2026-06-10T00:00:00.000Z',
    normalizedCommand: 'npm --prefix packages/app test',
    commandSignature: 'sha256:command',
    effectSignature: 'sha256:effect',
    allowedRoots: [{ kind: 'workspace', raw: root, normalizedAbsolute: root, resolvedRealpath: root }],
    reasonCode: 'bash_outside_workspace_requires_approval',
    source: 'project',
  };
}

function policy(workspaceRoot: string): PermissionPolicyConfig {
  return {
    ...structuredClone(builtInPermissionPolicy),
    workspace: { ...structuredClone(builtInPermissionPolicy.workspace), root: workspaceRoot },
  };
}

function bashRequest(command: string, workspaceRoot: string): PermissionRequest {
  return {
    id: `req-${command}`,
    source: 'tool_call',
    origin: 'main',
    tool: 'bash',
    action: 'bash',
    rawInputSummary: `bash ${command}`,
    command: { raw: command, summary: command },
    executionContext: { cwd: workspaceRoot, workspaceRoot, policyIdentity: 'test-policy' },
    mode: 'tui',
    hasUI: true,
    policyIdentity: 'test-policy',
    timestamp: '2026-06-10T00:00:00.000Z',
  };
}

describe('project scoped approvals', () => {
  it('builds outside-workspace directory approvals from approved path roots instead of the workspace root', () => {
    const workspaceRoot = '/workspace';
    const approvedRoot = '/home/test/sias/app';
    const request = bashRequest(`find ${approvedRoot} -maxdepth 1 -mindepth 1 -print | sort`, workspaceRoot);
    const decision = evaluatePermission(policy(workspaceRoot), request);

    const approval = buildScopedBashApproval(request, decision);

    expect(approval).toEqual(expect.objectContaining({
      allowedRoots: [expect.objectContaining({
        kind: 'directory',
        raw: approvedRoot,
        normalizedAbsolute: approvedRoot,
      })],
    }));
    expect(approval?.allowedRoots).not.toContainEqual(expect.objectContaining({ normalizedAbsolute: workspaceRoot }));
  });

  it('builds outside-workspace directory approvals with expanded tilde roots', () => {
    const workspaceRoot = '/workspace';
    const request = bashRequest('find ~/sias/app -maxdepth 1 -mindepth 1 -print | sort', workspaceRoot);
    const decision = evaluatePermission(policy(workspaceRoot), request);

    const approval = buildScopedBashApproval(request, decision);

    expect(approval).toEqual(expect.objectContaining({
      allowedRoots: [expect.objectContaining({
        kind: 'directory',
        raw: join(homedir(), 'sias', 'app'),
        normalizedAbsolute: join(homedir(), 'sias', 'app'),
      })],
    }));
    expect(approval?.allowedRoots[0]?.normalizedAbsolute).not.toContain('/~/');
  });

  it('builds inside-workspace path-effect approvals from the approved directory, not the whole workspace', () => {
    const workspaceRoot = '/workspace';
    const request = bashRequest('npm --prefix .pi/extensions/permission-guard test -- --run', workspaceRoot);
    const decision = evaluatePermission(policy(workspaceRoot), request);

    const approval = buildScopedBashApproval(request, decision);

    expect(approval).toEqual(expect.objectContaining({
      allowedRoots: [expect.objectContaining({
        kind: 'directory',
        normalizedAbsolute: '/workspace/.pi/extensions/permission-guard',
      })],
    }));
    expect(approval?.allowedRoots).not.toContainEqual(expect.objectContaining({ normalizedAbsolute: workspaceRoot }));
  });

  it('writes additive bash.scopedApprovals while preserving existing fields', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'permission-guard-project-approval-'));
    await mkdir(join(cwd, '.pi'), { recursive: true });
    await writeFile(join(cwd, '.pi', 'permissions.json'), JSON.stringify({ bash: { safeCommands: ['git status'] }, audit: { enabled: true } }, null, 2), 'utf8');

    await addProjectBashApproval(cwd, approval(cwd));

    const saved = JSON.parse(await readFile(join(cwd, '.pi', 'permissions.json'), 'utf8'));
    expect(saved.bash.safeCommands).toEqual(['git status']);
    expect(saved.bash.scopedApprovals).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'bash_approval_test' })]));
    expect(saved.audit).toEqual({ enabled: true });
  });

  it('merges corrected approval roots for an existing command/effect signature', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'permission-guard-project-approval-merge-'));
    await mkdir(join(cwd, '.pi'), { recursive: true });
    await writeFile(join(cwd, '.pi', 'permissions.json'), JSON.stringify({
      bash: {
        scopedApprovals: [{
          ...approval(cwd),
          allowedRoots: [{ kind: 'workspace', raw: cwd, normalizedAbsolute: cwd, resolvedRealpath: cwd }],
        }],
      },
    }, null, 2), 'utf8');

    await addProjectBashApproval(cwd, {
      ...approval(cwd),
      allowedRoots: [{ kind: 'directory', raw: '/home/test/sias/app', normalizedAbsolute: '/home/test/sias/app', resolvedRealpath: '/home/test/sias/app' }],
    });

    const saved = JSON.parse(await readFile(join(cwd, '.pi', 'permissions.json'), 'utf8'));
    expect(saved.bash.scopedApprovals).toHaveLength(1);
    expect(saved.bash.scopedApprovals[0].allowedRoots).toEqual(expect.arrayContaining([
      expect.objectContaining({ normalizedAbsolute: cwd }),
      expect.objectContaining({ normalizedAbsolute: '/home/test/sias/app' }),
    ]));
  });
});
