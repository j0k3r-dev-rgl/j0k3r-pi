import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
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
  const pathApprovalTools = ['read', 'ls', 'find', 'grep'] as const;
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

  it('allows valid global skill files to load without outside-workspace approval', async () => {
    const cwd = await tempWorkspace('permission-guard-policy-trusted-global-skill-');
    const agentDir = await mkdtemp(join(tmpdir(), 'permission-guard-policy-agent-dir-'));
    const skillFile = join(agentDir, 'skills', 'workflow-triage', 'SKILL.md');
    await mkdir(join(agentDir, 'skills', 'workflow-triage'), { recursive: true });
    await writeFile(skillFile, '---\nname: workflow-triage\ndescription: choose the lightest workflow\n---\n# Workflow\n', 'utf8');
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = agentDir;

    try {
      const request = await pathRequest(skillFile, cwd, 'read');

      expect(evaluatePermission(policy({ workspace: { root: cwd } }), request)).toMatchObject({
        decision: 'allow',
        finalDecision: 'allow',
        reasonCode: 'trusted_skill_read_allowed',
        details: { matchedLayer: 'trustedSkill' },
      });
    } finally {
      if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    }
  });

  it('does not auto-allow malformed files in skill locations', async () => {
    const cwd = await tempWorkspace('permission-guard-policy-trusted-malformed-skill-');
    const agentDir = await mkdtemp(join(tmpdir(), 'permission-guard-policy-agent-dir-'));
    const skillFile = join(agentDir, 'skills', 'broken-skill', 'SKILL.md');
    await mkdir(join(agentDir, 'skills', 'broken-skill'), { recursive: true });
    await writeFile(skillFile, '---\nname: broken-skill\n---\n# Missing description\n', 'utf8');
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = agentDir;

    try {
      const request = await pathRequest(skillFile, cwd, 'read');

      expect(evaluatePermission(policy({ workspace: { root: cwd } }), request)).toMatchObject({
        decision: 'ask',
        finalDecision: 'requires_approval',
        reasonCode: 'outside_workspace_read_requires_approval',
      });
    } finally {
      if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    }
  });

  it('does not auto-allow skill location symlink escapes', async () => {
    const cwd = await tempWorkspace('permission-guard-policy-trusted-symlink-skill-');
    const agentDir = await mkdtemp(join(tmpdir(), 'permission-guard-policy-agent-dir-'));
    const outsideSkill = await mkdtemp(join(tmpdir(), 'permission-guard-policy-external-skill-'));
    const skillLink = join(agentDir, 'skills', 'linked-skill');
    await mkdir(join(agentDir, 'skills'), { recursive: true });
    await writeFile(join(outsideSkill, 'SKILL.md'), '---\nname: linked-skill\ndescription: external skill through symlink\n---\n# External\n', 'utf8');
    await symlink(outsideSkill, skillLink, 'dir');
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = agentDir;

    try {
      const request = await pathRequest(join(skillLink, 'SKILL.md'), cwd, 'read');

      expect(evaluatePermission(policy({ workspace: { root: cwd } }), request)).toMatchObject({
        decision: 'ask',
        finalDecision: 'requires_approval',
        reasonCode: 'outside_workspace_read_requires_approval',
      });
    } finally {
      if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    }
  });

  it('allows valid project .agents skills from trusted ancestor locations without approval', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'permission-guard-policy-project-agents-skill-'));
    const cwd = join(repoRoot, 'packages', 'app');
    const skillFile = join(repoRoot, '.agents', 'skills', 'project-skill', 'SKILL.md');
    await mkdir(join(repoRoot, '.git'), { recursive: true });
    await mkdir(cwd, { recursive: true });
    await mkdir(join(repoRoot, '.agents', 'skills', 'project-skill'), { recursive: true });
    await writeFile(skillFile, '---\nname: project-skill\ndescription: project-local workflow guidance\n---\n# Project skill\n', 'utf8');

    const request = await pathRequest(skillFile, cwd, 'read');

    expect(evaluatePermission(policy({ workspace: { root: cwd } }), request)).toMatchObject({
      decision: 'allow',
      finalDecision: 'allow',
      reasonCode: 'trusted_skill_read_allowed',
      details: { matchedLayer: 'trustedSkill' },
    });
  });

  it('auto-allows workspace-confined non-bash requests when workspace policy already allows', async () => {
    const cwd = await tempWorkspace('permission-guard-policy-bypass-workspace-');
    await writeFile(join(cwd, 'src', 'index.ts'), 'inside', 'utf8');
    const request = await pathRequest('src/index.ts', cwd, 'read');
    const config = policy({ workspace: { root: cwd, allowRead: 'allow' }, bypassWorkspace: true });

    expect(evaluatePermission(config, request)).toMatchObject({
      decision: 'allow',
      finalDecision: 'allow',
      reasonCode: 'bypass_workspace_request_allowed',
      details: { matchedLayer: 'workspace' },
    });
  });

  it('does not bypass workspace-denied non-bash requests', async () => {
    const cwd = await tempWorkspace('permission-guard-policy-bypass-deny-');
    const request = await pathRequest('src/index.ts', cwd, 'read');
    const config = policy({ workspace: { root: cwd, allowRead: 'deny', deny: ['*.ts'] }, bypassWorkspace: true });

    expect(evaluatePermission(config, request)).toMatchObject({
      decision: 'deny',
      finalDecision: 'deny',
      reasonCode: 'workspace_read_denied',
      details: { matchedLayer: 'workspace' },
    });
  });

  it('does not bypass outside-workspace requests when bypassWorkspace is enabled', async () => {
    const cwd = await tempWorkspace('permission-guard-policy-bypass-outside-');
    const outsideRequest = await pathRequest('../outside.txt', cwd, 'read');
    const config = policy({ workspace: { root: cwd }, bypassWorkspace: true, outsideWorkspace: { read: 'allow' } });

    expect(evaluatePermission(config, outsideRequest)).toMatchObject({
      decision: 'allow',
      finalDecision: 'allow',
      reasonCode: 'outside_workspace_read_allowed',
      details: { matchedLayer: 'outsideWorkspace' },
    });
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

  it.each(pathApprovalTools)('reuses persisted exact file approvals for %s in the same project', async (tool) => {
    const cwd = await tempWorkspace(`permission-guard-policy-path-file-${tool}-`);
    const outsideRoot = await mkdtemp(join(tmpdir(), `permission-guard-policy-path-file-outside-${tool}-`));
    const approvedFile = join(outsideRoot, 'docs', 'approved.txt');
    await mkdir(join(outsideRoot, 'docs'), { recursive: true });
    await writeFile(approvedFile, 'ok', 'utf8');
    const config = policy({
      workspace: { root: cwd },
      pathApprovals: {
        scopedApprovals: [{
          version: 1,
          id: `path-approval-${tool}`,
          createdAt: '2026-06-10T00:00:00.000Z',
          scope: 'file',
          raw: approvedFile,
          normalizedAbsolute: approvedFile,
          resolvedRealpath: approvedFile,
          tools: [tool],
          source: 'project',
        }],
      },
    });
    const request = await pathRequest(approvedFile, cwd, tool === 'read' ? 'read' : tool === 'grep' ? 'search' : 'list');
    request.tool = tool;

    expect(evaluatePermission(config, request)).toMatchObject({
      decision: 'allow',
      finalDecision: 'allow',
      reasonCode: 'project_path_approval_allowed',
      details: { matchedLayer: 'project', matchedRule: `path-approval-${tool}` },
    });
  });

  it('reuses recursive folder approvals for descendants and future children only for supported tools', async () => {
    const cwd = await tempWorkspace('permission-guard-policy-path-folder-');
    const outsideRoot = await mkdtemp(join(tmpdir(), 'permission-guard-policy-path-folder-outside-'));
    const approvedFolder = join(outsideRoot, 'docs');
    await mkdir(join(approvedFolder, 'archive', '2026'), { recursive: true });
    await writeFile(join(approvedFolder, 'archive', '2026', 'item.txt'), 'ok', 'utf8');
    const config = policy({
      workspace: { root: cwd },
      pathApprovals: {
        scopedApprovals: [{
          version: 1,
          id: 'path-folder-approval',
          createdAt: '2026-06-10T00:00:00.000Z',
          scope: 'folder',
          raw: approvedFolder,
          normalizedAbsolute: approvedFolder,
          resolvedRealpath: approvedFolder,
          tools: ['read', 'ls', 'find', 'grep'],
          source: 'project',
        }],
      },
    });

    const readRequest = await pathRequest(join(approvedFolder, 'archive', '2026', 'item.txt'), cwd, 'read');
    const futureRequest = await pathRequest(join(approvedFolder, 'future.txt'), cwd, 'read');
    const prefixSibling = await pathRequest(join(outsideRoot, 'docs-private', 'secret.txt'), cwd, 'read');
    const unsupported = { ...readRequest, tool: 'write' as const, action: 'write' as const, rawInputSummary: 'write outside' };

    expect(evaluatePermission(config, readRequest)).toMatchObject({ decision: 'allow', reasonCode: 'project_path_approval_allowed' });
    expect(evaluatePermission(config, futureRequest)).toMatchObject({ decision: 'allow', reasonCode: 'project_path_approval_allowed' });
    expect(evaluatePermission(config, prefixSibling)).toMatchObject({ decision: 'ask', finalDecision: 'requires_approval' });
    expect(evaluatePermission(config, unsupported)).toMatchObject({ decision: 'ask', finalDecision: 'requires_approval' });
  });

  it('preserves project isolation, secret deny precedence, and symlink escape denial for path approvals', async () => {
    const cwd = await tempWorkspace('permission-guard-policy-path-safety-');
    const otherProject = await tempWorkspace('permission-guard-policy-path-other-project-');
    const outsideRoot = await mkdtemp(join(tmpdir(), 'permission-guard-policy-path-safety-outside-'));
    const approvedFolder = join(outsideRoot, 'docs');
    const realFolder = join(outsideRoot, 'real-folder');
    await mkdir(approvedFolder, { recursive: true });
    await mkdir(realFolder, { recursive: true });
    await writeFile(join(approvedFolder, '.env'), 'SECRET=1', 'utf8');
    await writeFile(join(realFolder, 'safe.txt'), 'ok', 'utf8');
    await symlink(realFolder, join(approvedFolder, 'escape'));

    const config = policy({
      workspace: { root: cwd },
      pathApprovals: {
        scopedApprovals: [{
          version: 1,
          id: 'path-folder-safety',
          createdAt: '2026-06-10T00:00:00.000Z',
          scope: 'folder',
          raw: approvedFolder,
          normalizedAbsolute: approvedFolder,
          resolvedRealpath: approvedFolder,
          tools: ['read', 'ls', 'find', 'grep'],
          source: 'project',
        }],
      },
    });

    const sameProjectSecret = await pathRequest(join(approvedFolder, '.env'), cwd, 'read');
    const otherProjectRequest = await pathRequest(join(approvedFolder, 'safe.txt'), otherProject, 'read');
    const symlinkEscaped = await pathRequest(join(approvedFolder, 'escape', 'safe.txt'), cwd, 'read');

    expect(evaluatePermission(config, sameProjectSecret)).toMatchObject({ decision: 'deny', reasonCode: 'secret_path_denied' });
    expect(evaluatePermission(policy({ workspace: { root: otherProject } }), otherProjectRequest)).toMatchObject({ decision: 'ask', finalDecision: 'requires_approval' });
    expect(evaluatePermission(config, symlinkEscaped)).toMatchObject({ decision: 'ask', finalDecision: 'requires_approval' });
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
