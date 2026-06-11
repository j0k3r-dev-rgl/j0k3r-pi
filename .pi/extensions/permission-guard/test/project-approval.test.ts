import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  addProjectBashApproval,
  addProjectPathApproval,
  buildProjectPathApproval,
  buildScopedBashApproval,
} from '../src/project-approval.js';
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

  it('writes workspace-only compound bash project approvals to reusable safeCommands while skipping safe cd segments', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'permission-guard-project-approval-safe-'));
    await mkdir(join(cwd, '.pi'), { recursive: true });
    await writeFile(join(cwd, '.pi', 'permissions.json'), JSON.stringify({ bash: { safeCommands: ['git status'] }, audit: { enabled: true } }, null, 2), 'utf8');

    await addProjectBashApproval(cwd, {
      ...approval(cwd),
      normalizedCommand: 'cd .pi/extensions/subagents && npm run typecheck && npm test',
      allowedRoots: [{ kind: 'directory', raw: join(cwd, '.pi/extensions/subagents'), normalizedAbsolute: join(cwd, '.pi/extensions/subagents'), resolvedRealpath: join(cwd, '.pi/extensions/subagents') }],
    });

    const saved = JSON.parse(await readFile(join(cwd, '.pi', 'permissions.json'), 'utf8'));
    expect(saved.bash.safeCommands).toEqual([
      'git status',
      'regex:^npm\\s+run\\s+typecheck(?:\\s+--\\s+.*)?$',
      'regex:^npm\\s+test(?:\\s+.*)?$',
    ]);
    expect(saved.bash.scopedApprovals ?? []).toEqual([]);
    expect(saved.audit).toEqual({ enabled: true });
  });

  it('writes simple workspace bash project approvals to reusable safe command patterns', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'permission-guard-project-approval-simple-safe-'));
    await mkdir(join(cwd, '.pi'), { recursive: true });
    await writeFile(join(cwd, '.pi', 'permissions.json'), JSON.stringify({ bash: { safeCommands: [] } }, null, 2), 'utf8');

    await addProjectBashApproval(cwd, { ...approval(cwd), normalizedCommand: 'git status --short' });

    const saved = JSON.parse(await readFile(join(cwd, '.pi', 'permissions.json'), 'utf8'));
    expect(saved.bash.safeCommands).toEqual(['regex:^git\\s+status(?:\\s+--short)?$']);
    expect(saved.bash.scopedApprovals ?? []).toEqual([]);
  });

  it('builds outside-workspace cd approvals as scoped directory approvals even when the following command is read-only', () => {
    const workspaceRoot = '/workspace';
    const outsideRoot = '/home/test/sias/app';
    const request = bashRequest(`cd ${outsideRoot} && ls`, workspaceRoot);
    const decision = evaluatePermission(policy(workspaceRoot), request);

    const approval = buildScopedBashApproval(request, decision);

    expect(approval).toEqual(expect.objectContaining({
      normalizedCommand: `cd ${outsideRoot} && ls`,
      allowedRoots: [expect.objectContaining({
        kind: 'directory',
        normalizedAbsolute: outsideRoot,
      })],
    }));
  });

  it('writes outside-workspace bash project approvals to scopedApprovals', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'permission-guard-project-approval-scoped-'));
    await mkdir(join(cwd, '.pi'), { recursive: true });
    await writeFile(join(cwd, '.pi', 'permissions.json'), JSON.stringify({ bash: { safeCommands: ['git status'] }, audit: { enabled: true } }, null, 2), 'utf8');

    await addProjectBashApproval(cwd, {
      ...approval(cwd),
      allowedRoots: [{ kind: 'directory', raw: '/home/test/sias/app', normalizedAbsolute: '/home/test/sias/app', resolvedRealpath: '/home/test/sias/app' }],
    });

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

  it('builds exact file and containing-folder project path approvals from read requests', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'permission-guard-project-path-build-'));
    const outsideRoot = await mkdtemp(join(tmpdir(), 'permission-guard-project-path-build-outside-'));
    const filePath = join(outsideRoot, 'docs', 'approved.txt');
    await mkdir(join(outsideRoot, 'docs'), { recursive: true });
    await writeFile(filePath, 'ok', 'utf8');
    const config = policy(cwd);
    const request: PermissionRequest = {
      id: 'path-request',
      source: 'tool_call',
      origin: 'main',
      tool: 'read',
      action: 'read',
      rawInputSummary: `read ${filePath}`,
      target: await import('../src/path-policy.js').then(({ classifyPathTarget }) => classifyPathTarget(filePath, { cwd, config })),
      mode: 'tui',
      hasUI: true,
      policyIdentity: 'test-policy',
      timestamp: '2026-06-10T00:00:00.000Z',
    };

    expect(buildProjectPathApproval(request, 'file')).toEqual(expect.objectContaining({
      scope: 'file',
      normalizedAbsolute: filePath,
      tools: ['read', 'ls', 'find', 'grep'],
    }));
    expect(buildProjectPathApproval(request, 'folder')).toEqual(expect.objectContaining({
      scope: 'folder',
      normalizedAbsolute: join(outsideRoot, 'docs'),
      tools: ['read', 'ls', 'find', 'grep'],
    }));
  });

  it('writes path approvals to project permissions, deduplicates exact matches, merges tool lists, and preserves bash approvals', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'permission-guard-project-path-save-'));
    await mkdir(join(cwd, '.pi'), { recursive: true });
    await writeFile(join(cwd, '.pi', 'permissions.json'), JSON.stringify({
      bash: { safeCommands: ['git status'] },
      pathApprovals: {
        scopedApprovals: [{
          version: 1,
          id: 'path-approval-existing',
          createdAt: '2026-06-10T00:00:00.000Z',
          scope: 'file',
          raw: '/tmp/approved.txt',
          normalizedAbsolute: '/tmp/approved.txt',
          resolvedRealpath: '/tmp/approved.txt',
          tools: ['read'],
          source: 'project',
        }],
      },
    }, null, 2), 'utf8');

    await addProjectPathApproval(cwd, {
      version: 1,
      id: 'path-approval-new',
      createdAt: '2026-06-10T00:00:00.000Z',
      scope: 'file',
      raw: '/tmp/approved.txt',
      normalizedAbsolute: '/tmp/approved.txt',
      resolvedRealpath: '/tmp/approved.txt',
      tools: ['ls', 'find', 'grep'],
      source: 'project',
    });

    const saved = JSON.parse(await readFile(join(cwd, '.pi', 'permissions.json'), 'utf8'));
    expect(saved.bash.safeCommands).toEqual(['git status']);
    expect(saved.pathApprovals.scopedApprovals).toHaveLength(1);
    expect(saved.pathApprovals.scopedApprovals[0]).toEqual(expect.objectContaining({
      scope: 'file',
      normalizedAbsolute: '/tmp/approved.txt',
      tools: ['read', 'ls', 'find', 'grep'],
    }));
  });
});
