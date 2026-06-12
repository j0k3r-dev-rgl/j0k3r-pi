import { mkdtemp, mkdir, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { ExactWorkspaceRegistry } from '../src/workspace-registry.js';
import { TelegramControlConfig, TelegramIdentity } from '../src/types.js';

describe('ExactWorkspaceRegistry', () => {
  const identity: TelegramIdentity = { userId: 99, chatId: 10, chatType: 'private' };

  it('canonicalizes configured workspace roots and resolves relative roots against cwd', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'telegram-control-workspace-registry-') + 'canon-');
    const relativeRoot = join(workspaceRoot, 'allowed');
    await mkdir(relativeRoot, { recursive: true });

    const config: TelegramControlConfig = {
      telegram: { allowedUserIds: [99] },
      workspaces: [
        { id: 'alpha', label: 'Allowed', root: 'allowed' },
      ],
    };

    const registry = new ExactWorkspaceRegistry(config, { cwd: workspaceRoot });
    const views = await registry.listAuthorizedWorkspaces(identity);

    expect(views).toEqual([
      {
        id: 'alpha',
        label: 'Allowed',
        canonicalRoot: resolve(relativeRoot),
        matchedConfigRoot: resolve(relativeRoot),
      },
    ]);
  });

  it('allows exact canonical matching when selection is a path alias that normalizes to the allowlisted root', async () => {
    const base = await mkdtemp(join(tmpdir(), 'telegram-control-workspace-registry-') + 'alias-');
    const workspaceRoot = join(base, 'canonical');
    await mkdir(workspaceRoot, { recursive: true });
    const aliasRoot = join(base, 'alias');
    await symlink(workspaceRoot, aliasRoot);

    const config: TelegramControlConfig = {
      telegram: { allowedUserIds: [99] },
      workspaces: [
        { id: 'alias', label: 'Alias', root: workspaceRoot },
      ],
    };

    const registry = new ExactWorkspaceRegistry(config, { cwd: base });
    const byCanonical = await registry.resolveWorkspace(workspaceRoot, identity);
    expect(byCanonical.ok).toBe(true);

    const byAlias = await registry.resolveWorkspace(aliasRoot, identity);
    expect(byAlias.ok).toBe(true);
    if (byAlias.ok) {
      expect(byAlias.workspace.canonicalRoot).toBe(resolve(workspaceRoot));
      expect(byAlias.workspace.canonicalRoot).toBe(resolve(base, 'canonical'));
    }
  });

  it('rejects aliases that do not canonicalize to an allowlisted root', async () => {
    const base = await mkdtemp(join(tmpdir(), 'telegram-control-workspace-registry-') + 'reject-');
    const allowed = join(base, 'allowed');
    const other = join(base, 'other');
    const alias = join(base, 'alias');
    await mkdir(allowed, { recursive: true });
    await mkdir(other, { recursive: true });
    await symlink(other, alias);

    const config: TelegramControlConfig = {
      telegram: { allowedUserIds: [99] },
      workspaces: [
        { id: 'allowed', label: 'Allowed', root: allowed },
      ],
    };

    const registry = new ExactWorkspaceRegistry(config, { cwd: base });
    const decision = await registry.resolveWorkspace(alias, identity);

    expect(decision).toEqual({ ok: false, reason: 'missing' });
  });

  it('resolves workspace by stable id and detects ambiguous label selectors', async () => {
    const base = await mkdtemp(join(tmpdir(), 'telegram-control-workspace-registry-') + 'labels-');
    await mkdir(join(base, 'first'), { recursive: true });
    await mkdir(join(base, 'second'), { recursive: true });

    const config: TelegramControlConfig = {
      telegram: { allowedUserIds: [99] },
      workspaces: [
        { id: 'first', label: 'Common Label', root: join(base, 'first') },
        { id: 'second', label: 'Common Label', root: join(base, 'second') },
      ],
    };

    const registry = new ExactWorkspaceRegistry(config, { cwd: base });

    const byId = await registry.resolveWorkspace('first', identity);
    expect(byId.ok).toBe(true);
    if (byId.ok) {
      expect(byId.workspace.id).toBe('first');
    }

    const ambiguous = await registry.resolveWorkspace('Common Label', identity);
    expect(ambiguous).toEqual({ ok: false, reason: 'ambiguous' });
  });
});
