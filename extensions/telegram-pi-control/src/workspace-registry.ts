import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { TelegramControlConfig, TelegramIdentity, WorkspaceRegistry, WorkspaceView } from './types.js';

export interface WorkspaceRegistryOptions {
  cwd?: string;
}

interface CanonicalWorkspace extends WorkspaceView {}

export class ExactWorkspaceRegistry implements WorkspaceRegistry {
  private readonly workspaces: TelegramControlConfig['workspaces'];
  private readonly cwd: string;

  private cached: Promise<CanonicalWorkspace[]> | undefined;

  constructor(config: TelegramControlConfig, options: WorkspaceRegistryOptions = {}) {
    this.workspaces = config.workspaces;
    this.cwd = resolve(options.cwd ?? process.cwd());
  }

  async listAuthorizedWorkspaces(_identity: TelegramIdentity): Promise<WorkspaceView[]> {
    if (!this.cached) {
      this.cached = this.resolveWorkspaceViews();
    }

    return this.cached;
  }

  async resolveWorkspace(selector: string, identity: TelegramIdentity): Promise<import('./types.js').WorkspaceDecision> {
    const normalizedSelector = selector?.trim();
    if (!normalizedSelector) return { ok: false, reason: 'missing' };

    const authorized = await this.listAuthorizedWorkspaces(identity);
    const selectorCanonicalRoot = await this.canonicalizePath(normalizedSelector);

    const exactMatches = authorized.filter((workspace) =>
      this.matchesSelector(workspace, normalizedSelector, selectorCanonicalRoot),
    );

    if (exactMatches.length === 1) {
      return {
        ok: true,
        workspace: exactMatches[0],
      };
    }

    if (exactMatches.length > 1) {
      return { ok: false, reason: 'ambiguous' };
    }

    return { ok: false, reason: 'missing' };
  }

  private matchesSelector(view: WorkspaceView, selector: string, selectorCanonical: string): boolean {
    if (view.id === selector) return true;
    if (view.label === selector) return true;
    if (view.canonicalRoot === selectorCanonical) return true;
    if (view.matchedConfigRoot === selectorCanonical) return true;
    return false;
  }

  private async resolveWorkspaceViews(): Promise<CanonicalWorkspace[]> {
    const resolved: CanonicalWorkspace[] = [];

    for (const workspace of this.workspaces) {
      if (!workspace || typeof workspace.id !== 'string' || !workspace.id.trim()) {
        continue;
      }

      const label = typeof workspace.label === 'string' && workspace.label.trim() ? workspace.label.trim() : workspace.id;
      const canonicalRoot = await this.canonicalizePath(workspace.root);

      resolved.push({
        id: workspace.id.trim(),
        label,
        canonicalRoot,
        matchedConfigRoot: canonicalRoot,
      });
    }

    return resolved;
  }

  private async canonicalizePath(rawPath: string): Promise<string> {
    const absolute = resolve(this.cwd, rawPath);
    try {
      return await realpath(absolute);
    } catch {
      return absolute;
    }
  }
}
