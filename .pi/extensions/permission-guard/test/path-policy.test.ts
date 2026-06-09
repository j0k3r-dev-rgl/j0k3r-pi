import { mkdir, mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { builtInPermissionPolicy } from '../src/defaults.js';
import { classifyPathTarget, matchesWorkspaceGlob, resolveWorkspaceRoot } from '../src/path-policy.js';
import type { PermissionPolicyConfig } from '../src/types.js';

async function tempWorkspace(prefix: string) {
  const cwd = await mkdtemp(join(tmpdir(), prefix));
  await mkdir(join(cwd, 'src'), { recursive: true });
  return cwd;
}

function policyWithWorkspaceRoot(root?: string): PermissionPolicyConfig {
  return {
    ...structuredClone(builtInPermissionPolicy),
    workspace: {
      ...structuredClone(builtInPermissionPolicy.workspace),
      ...(root === undefined ? {} : { root }),
    },
  };
}

describe('workspace path policy', () => {
  it('uses ctx.cwd as the workspace root by default', async () => {
    const cwd = await tempWorkspace('permission-guard-path-cwd-');
    await writeFile(join(cwd, 'src', 'index.ts'), 'export {};', 'utf8');

    const target = await classifyPathTarget('src/index.ts', { cwd, config: builtInPermissionPolicy });

    expect(target.workspaceRoot).toBe(cwd);
    expect(target.normalizedAbsolute).toBe(join(cwd, 'src', 'index.ts'));
    expect(target.insideWorkspace).toBe(true);
    expect(target.exists).toBe(true);
    expect(target.workspaceRelative).toBe('src/index.ts');
  });

  it('uses JSON workspace.root override instead of ctx.cwd', async () => {
    const cwd = await tempWorkspace('permission-guard-path-override-');
    const appRoot = join(cwd, 'packages', 'app');
    await mkdir(join(appRoot, 'src'), { recursive: true });
    await writeFile(join(appRoot, 'src', 'index.ts'), 'export {};', 'utf8');

    const target = await classifyPathTarget(join(appRoot, 'src', 'index.ts'), {
      cwd,
      config: policyWithWorkspaceRoot(appRoot),
    });

    expect(target.workspaceRoot).toBe(appRoot);
    expect(target.insideWorkspace).toBe(true);
    expect(target.workspaceRelative).toBe('src/index.ts');
  });

  it('normalizes relative traversal outside the workspace', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'permission-guard-path-traversal-'));
    const cwd = join(parent, 'project');
    const outside = join(parent, 'outside');
    await mkdir(cwd, { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, 'file.txt'), 'outside', 'utf8');

    const target = await classifyPathTarget('../outside/file.txt', { cwd, config: builtInPermissionPolicy });

    expect(target.normalizedAbsolute).toBe(join(outside, 'file.txt'));
    expect(target.insideWorkspace).toBe(false);
    expect(target.workspaceRelative).toBeUndefined();
  });

  it('classifies absolute targets inside and outside the workspace', async () => {
    const cwd = await tempWorkspace('permission-guard-path-absolute-');
    const outside = await mkdtemp(join(tmpdir(), 'permission-guard-absolute-outside-'));
    await writeFile(join(cwd, 'src', 'inside.ts'), 'inside', 'utf8');
    await writeFile(join(outside, 'outside.txt'), 'outside', 'utf8');

    const inside = await classifyPathTarget(join(cwd, 'src', 'inside.ts'), { cwd, config: builtInPermissionPolicy });
    const outsideTarget = await classifyPathTarget(join(outside, 'outside.txt'), { cwd, config: builtInPermissionPolicy });

    expect(inside.insideWorkspace).toBe(true);
    expect(outsideTarget.insideWorkspace).toBe(false);
  });

  it('uses the nearest existing parent when classifying create targets', async () => {
    const cwd = await tempWorkspace('permission-guard-path-create-');

    const target = await classifyPathTarget('src/generated/new-file.ts', {
      cwd,
      config: builtInPermissionPolicy,
      forCreate: true,
    });

    expect(target.exists).toBe(false);
    expect(target.nearestExistingParent).toBe(join(cwd, 'src'));
    expect(target.insideWorkspace).toBe(true);
    expect(target.workspaceRelative).toBe('src/generated/new-file.ts');
  });

  it('uses realpath classification for existing targets', async () => {
    const cwd = await tempWorkspace('permission-guard-path-realpath-');
    await writeFile(join(cwd, 'src', 'index.ts'), 'inside', 'utf8');

    const target = await classifyPathTarget('src/../src/index.ts', { cwd, config: builtInPermissionPolicy });

    expect(target.resolvedRealpath).toBe(await realpath(join(cwd, 'src', 'index.ts')));
    expect(target.insideWorkspace).toBe(true);
    expect(target.symlinkEscapesWorkspace).toBe(false);
  });

  it('detects symlink escapes outside the workspace when realpath following is enabled', async () => {
    const cwd = await tempWorkspace('permission-guard-path-symlink-');
    const outside = await mkdtemp(join(tmpdir(), 'permission-guard-symlink-outside-'));
    await writeFile(join(outside, 'secret.txt'), 'not read by policy', 'utf8');
    await symlink(outside, join(cwd, 'link-out'));

    const target = await classifyPathTarget('link-out/secret.txt', { cwd, config: builtInPermissionPolicy });

    expect(target.normalizedAbsolute).toBe(join(cwd, 'link-out', 'secret.txt'));
    expect(target.resolvedRealpath).toBe(await realpath(join(outside, 'secret.txt')));
    expect(target.insideWorkspace).toBe(false);
    expect(target.symlinkEscapesWorkspace).toBe(true);
  });

  it('matches globs against normalized workspace-relative paths', async () => {
    const cwd = await tempWorkspace('permission-guard-path-glob-');
    await writeFile(join(cwd, 'src', 'index.test.ts'), 'test', 'utf8');
    const target = await classifyPathTarget('src/./index.test.ts', { cwd, config: builtInPermissionPolicy });

    expect(matchesWorkspaceGlob(target, ['src/**/*.test.ts'])).toBe(true);
    expect(matchesWorkspaceGlob(target, ['lib/**'])).toBe(false);
  });

  it('resolves relative workspace root overrides against ctx.cwd', () => {
    const cwd = resolve('/tmp/workspace');

    expect(resolveWorkspaceRoot({ cwd, config: policyWithWorkspaceRoot('packages/app') })).toBe(
      join(cwd, 'packages', 'app'),
    );
  });
});
