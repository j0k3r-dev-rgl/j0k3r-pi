import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { builtInPermissionPolicy } from '../src/defaults.js';
import { analyzeShellCommand } from '../src/shell-analyzer.js';
import { extractShellPathEffects } from '../src/shell-path-effects.js';
import type { PermissionPolicyConfig } from '../src/types.js';

async function tempWorkspace(prefix: string) {
  const cwd = await mkdtemp(join(tmpdir(), prefix));
  await mkdir(join(cwd, 'packages', 'app', 'src'), { recursive: true });
  await writeFile(join(cwd, 'packages', 'app', 'src', 'index.ts'), 'export {};', 'utf8');
  await writeFile(join(cwd, 'package.json'), '{"name":"root"}', 'utf8');
  return cwd;
}

function policy(workspaceRoot: string): PermissionPolicyConfig {
  return {
    ...structuredClone(builtInPermissionPolicy),
    bypassAll: false,
    workspace: { ...structuredClone(builtInPermissionPolicy.workspace), root: workspaceRoot },
  };
}

describe('shell path effects', () => {
  it('extracts redirection and command path effects after a relative cd', async () => {
    const cwd = await tempWorkspace('permission-guard-shell-effects-');
    const config = policy(cwd);
    const analysis = await analyzeShellCommand({ command: 'cd packages/app && cat src/index.ts > out.txt', cwd, config });
    const result = await extractShellPathEffects({ analysis, context: { cwd, workspaceRoot: cwd, policyIdentity: 'test-policy' }, config });

    expect(result.effectsComplete).toBe(true);
    expect(result.pathEffects).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'argument', intent: 'read', raw: 'src/index.ts', classified: expect.objectContaining({ insideWorkspace: true, workspaceRelative: 'packages/app/src/index.ts' }) }),
      expect.objectContaining({ source: 'redirection', intent: 'write', raw: 'out.txt', classified: expect.objectContaining({ insideWorkspace: true, workspaceRelative: 'packages/app/out.txt' }) }),
    ]));
  });

  it('extracts path effects for npm --prefix and git -C', async () => {
    const cwd = await tempWorkspace('permission-guard-shell-effects-prefix-');
    const config = policy(cwd);

    const npmAnalysis = await analyzeShellCommand({ command: 'npm --prefix packages/app test', cwd, config });
    const npmResult = await extractShellPathEffects({ analysis: npmAnalysis, context: { cwd, workspaceRoot: cwd, policyIdentity: 'test-policy' }, config });
    expect(npmResult.pathEffects).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'option', intent: 'cwd', raw: 'packages/app', classified: expect.objectContaining({ insideWorkspace: true, workspaceRelative: 'packages/app' }) }),
    ]));

    const gitAnalysis = await analyzeShellCommand({ command: 'git -C packages/app status', cwd, config });
    const gitResult = await extractShellPathEffects({ analysis: gitAnalysis, context: { cwd, workspaceRoot: cwd, policyIdentity: 'test-policy' }, config });
    expect(gitResult.pathEffects).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'option', intent: 'cwd', raw: 'packages/app', classified: expect.objectContaining({ insideWorkspace: true, workspaceRelative: 'packages/app' }) }),
    ]));
  });

  it('detects symlink escapes and outside-workspace effects', async () => {
    const cwd = await tempWorkspace('permission-guard-shell-effects-symlink-');
    const outside = await mkdtemp(join(tmpdir(), 'permission-guard-shell-effects-outside-'));
    await writeFile(join(outside, 'secret.txt'), 'secret', 'utf8');
    await symlink(outside, join(cwd, 'packages', 'app', 'outside-link'));
    const config = policy(cwd);

    const analysis = await analyzeShellCommand({ command: 'cd packages/app && cat outside-link/secret.txt /tmp/global.txt', cwd, config });
    const result = await extractShellPathEffects({ analysis, context: { cwd, workspaceRoot: cwd, policyIdentity: 'test-policy' }, config });

    expect(result.effectsComplete).toBe(true);
    expect(result.pathEffects).toEqual(expect.arrayContaining([
      expect.objectContaining({ raw: 'outside-link/secret.txt', classified: expect.objectContaining({ insideWorkspace: false, symlinkEscapesWorkspace: true }) }),
      expect.objectContaining({ raw: '/tmp/global.txt', classified: expect.objectContaining({ insideWorkspace: false }) }),
    ]));
  });

  it('expands tilde paths before classifying bash path effects', async () => {
    const cwd = await tempWorkspace('permission-guard-shell-effects-tilde-');
    const config = policy(cwd);
    const analysis = await analyzeShellCommand({ command: 'find ~/sias/app -maxdepth 1 -mindepth 1 -print | sort', cwd, config });
    const result = await extractShellPathEffects({ analysis, context: { cwd, workspaceRoot: cwd, policyIdentity: 'test-policy' }, config });

    expect(result.pathEffects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        raw: '~/sias/app',
        classified: expect.objectContaining({
          insideWorkspace: false,
          normalizedAbsolute: join(homedir(), 'sias', 'app'),
        }),
      }),
    ]));
  });

  it('marks ambiguous unknown path effects conservatively', async () => {
    const cwd = await tempWorkspace('permission-guard-shell-effects-ambiguous-');
    const config = policy(cwd);
    const analysis = await analyzeShellCommand({ command: 'custom-tool ./maybe.txt', cwd, config });
    const result = await extractShellPathEffects({ analysis, context: { cwd, workspaceRoot: cwd, policyIdentity: 'test-policy' }, config });

    expect(result.effectsComplete).toBe(false);
    expect(result.pathEffects).toEqual(expect.arrayContaining([
      expect.objectContaining({ raw: './maybe.txt', ambiguous: true, reason: 'unknown_path_effects' }),
    ]));
  });
});
