import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { builtInPermissionPolicy } from '../src/defaults.js';
import { loadPermissionConfig } from '../src/config.js';

async function tempWorkspace(prefix: string) {
  const cwd = await mkdtemp(join(tmpdir(), prefix));
  const homeDir = join(cwd, 'home');
  return { cwd, homeDir, agentDir: join(homeDir, '.pi', 'agent') };
}

async function writeJson(path: string, value: unknown) {
  await mkdir(resolve(path, '..'), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2), 'utf8');
}

describe('permission guard config loading', () => {
  it('loads built-in safe defaults when no permission JSON exists', async () => {
    const { cwd, homeDir } = await tempWorkspace('permission-guard-defaults-');

    const result = await loadPermissionConfig({ cwd, env: {}, homeDir });

    expect(result.globalConfigPath).toBe(join(homeDir, '.pi', 'agent', 'extensions', 'permission-guard.json'));
    expect(result.projectConfigPath).toBe(join(cwd, '.pi', 'permissions.json'));
    expect(result.loadedConfigPaths).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.config).toMatchObject({
      enabled: true,
      bypassAll: false,
      workspace: {
        allowRead: 'allow',
        allowWrite: 'allow',
        allowCreate: 'allow',
        followSymlinks: 'realpath',
      },
      outsideWorkspace: {
        read: 'ask',
        list: 'ask',
        write: 'ask',
        create: 'ask',
        rememberApprovals: 'session',
      },
      secrets: {
        mode: 'deny',
        maxPreviewBytesForPrompt: 0,
      },
      tools: {
        read: 'policy',
        write: 'policy',
        edit: 'policy',
        grep: 'policy',
        find: 'policy',
        ls: 'policy',
        bash: 'policy',
      },
      bash: {
        default: 'ask',
        network: 'ask',
        outsideWorkspaceFilesystem: 'ask',
        envSecretExposure: 'deny',
      },
      nonInteractive: {
        onAsk: 'deny',
        allowSessionApprovals: false,
      },
      approvals: {
        sessionCache: true,
        allowForSession: true,
      },
      audit: {
        enabled: true,
        logAllowed: false,
        logDenied: true,
        logApprovals: true,
        redactPaths: true,
        maxBytes: 5 * 1024 * 1024,
        maxFiles: 5,
      },
    });
  });

  it('keeps the guard enabled and bypass disabled by default in exported defaults', () => {
    expect(builtInPermissionPolicy.enabled).toBe(true);
    expect(builtInPermissionPolicy.bypassAll).toBe(false);
  });

  it('loads global JSON before project JSON so project overrides win', async () => {
    const { cwd, homeDir, agentDir } = await tempWorkspace('permission-guard-source-order-');
    const globalPath = join(agentDir, 'extensions', 'permission-guard.json');
    const projectPath = join(cwd, '.pi', 'permissions.json');
    await writeJson(globalPath, { outsideWorkspace: { read: 'deny', write: 'deny' } });
    await writeJson(projectPath, { outsideWorkspace: { read: 'ask' } });

    const result = await loadPermissionConfig({ cwd, env: {}, homeDir });

    expect(result.loadedConfigPaths).toEqual([globalPath, projectPath]);
    expect(result.config.outsideWorkspace.read).toBe('ask');
    expect(result.config.outsideWorkspace.write).toBe('deny');
  });

  it('deep-merges objects while preserving unspecified defaults', async () => {
    const { cwd, homeDir } = await tempWorkspace('permission-guard-deep-merge-');
    const projectPath = join(cwd, '.pi', 'permissions.json');
    await writeJson(projectPath, {
      audit: { logAllowed: true },
      bash: { network: 'deny' },
      workspace: { allowRead: 'ask' },
    });

    const result = await loadPermissionConfig({ cwd, env: {}, homeDir });

    expect(result.config.audit).toMatchObject({
      enabled: true,
      logAllowed: true,
      logDenied: true,
      logApprovals: true,
      redactPaths: true,
    });
    expect(result.config.bash.default).toBe('ask');
    expect(result.config.bash.network).toBe('deny');
    expect(result.config.workspace.allowRead).toBe('ask');
    expect(result.config.workspace.allowWrite).toBe('allow');
  });

  it('replaces arrays instead of appending them', async () => {
    const { cwd, homeDir, agentDir } = await tempWorkspace('permission-guard-array-replace-');
    await writeJson(join(agentDir, 'extensions', 'permission-guard.json'), {
      secrets: { denyPaths: ['global-secret'] },
      bash: { safeCommands: ['global-safe'] },
    });
    await writeJson(join(cwd, '.pi', 'permissions.json'), {
      secrets: { denyPaths: ['project-secret'] },
      bash: { safeCommands: ['project-safe'] },
    });

    const result = await loadPermissionConfig({ cwd, env: {}, homeDir });

    expect(result.config.secrets.denyPaths).toEqual(['project-secret']);
    expect(result.config.bash.safeCommands).toEqual(['project-safe']);
  });

  it('falls back to built-in safe defaults for malformed JSON', async () => {
    const { cwd, homeDir } = await tempWorkspace('permission-guard-malformed-');
    const projectPath = join(cwd, '.pi', 'permissions.json');
    await mkdir(join(cwd, '.pi'), { recursive: true });
    await writeFile(projectPath, '{ "outsideWorkspace": { "read": "allow" ', 'utf8');

    const result = await loadPermissionConfig({ cwd, env: {}, homeDir });

    expect(result.loadedConfigPaths).toEqual([projectPath]);
    expect(result.config.outsideWorkspace.read).toBe('ask');
    expect(result.warnings.join('\n')).toContain('malformed json');
    expect(result.warnings.join('\n')).toContain(projectPath);
  });

  it('ignores invalid policy values and falls back to safe defaults with warnings', async () => {
    const { cwd, homeDir } = await tempWorkspace('permission-guard-invalid-policy-');
    await writeJson(join(cwd, '.pi', 'permissions.json'), {
      outsideWorkspace: { read: 'maybe' },
      tools: { read: 'sometimes' },
      nonInteractive: { onAsk: 'prompt' },
    });

    const result = await loadPermissionConfig({ cwd, env: {}, homeDir });

    expect(result.config.outsideWorkspace.read).toBe('ask');
    expect(result.config.tools.read).toBe('policy');
    expect(result.config.nonInteractive.onAsk).toBe('deny');
    expect(result.warnings.join('\n')).toContain('outsideWorkspace.read');
    expect(result.warnings.join('\n')).toContain('tools.read');
    expect(result.warnings.join('\n')).toContain('nonInteractive.onAsk');
  });

  it('warns for secret-like unsupported keys without leaking values', async () => {
    const { cwd, homeDir } = await tempWorkspace('permission-guard-secret-key-');
    const sentinel = 'sentinel-super-secret-token-value';
    await writeJson(join(cwd, '.pi', 'permissions.json'), {
      apiToken: sentinel,
      nested: { password: sentinel },
      workspace: { allowRead: 'allow' },
    });

    const result = await loadPermissionConfig({ cwd, env: {}, homeDir });
    const diagnostics = JSON.stringify(result.warnings);

    expect(diagnostics).toContain('apiToken');
    expect(diagnostics).toContain('nested.password');
    expect(diagnostics).not.toContain(sentinel);
    expect(JSON.stringify(result.config)).not.toContain(sentinel);
  });

  it('accepts enabled: false and bypassAll: true without changing audit defaults', async () => {
    const { cwd, homeDir } = await tempWorkspace('permission-guard-disabled-');
    await writeJson(join(cwd, '.pi', 'permissions.json'), { enabled: false, bypassAll: true });

    const result = await loadPermissionConfig({ cwd, env: {}, homeDir });

    expect(result.config.enabled).toBe(false);
    expect(result.config.bypassAll).toBe(true);
    expect(result.config.audit).toMatchObject({
      enabled: true,
      logAllowed: false,
      logDenied: true,
      logApprovals: true,
      redactPaths: true,
      maxBytes: 5 * 1024 * 1024,
      maxFiles: 5,
    });
  });

  it('resolves relative workspace.root against ctx.cwd for global-install-ready config', async () => {
    const { cwd, homeDir } = await tempWorkspace('permission-guard-relative-root-');
    await writeJson(join(cwd, '.pi', 'permissions.json'), { workspace: { root: 'packages/app' } });

    const result = await loadPermissionConfig({ cwd, env: {}, homeDir });

    expect(result.config.workspace.root).toBe(join(cwd, 'packages', 'app'));
  });
});
