import { readFile } from 'node:fs/promises';
import { resolve as resolvePath, dirname as dirnamePath } from 'node:path';
import { realpath } from 'node:fs/promises';

import type { PiTrustValidator } from './types.js';

type RawTrustStore = Record<string, unknown>;

export interface PiTrustValidatorOptions {
  trustFilePath?: string;
  piCodingAgentDir?: string;
  fallbackTrustFilePaths?: string[];
  exactRootOnly?: boolean;
}

export class FilePiTrustValidator implements PiTrustValidator {
  private readonly trustFilePaths: string[];
  private readonly exactRootOnly: boolean;

  constructor(options: PiTrustValidatorOptions = {}) {
    this.exactRootOnly = options.exactRootOnly === true;
    const custom = options.trustFilePath;
    const primary = custom
      ? custom
      : resolvePath(options.piCodingAgentDir ?? process.env.PI_CODING_AGENT_DIR ?? process.cwd(), 'trust.json');

    this.trustFilePaths = [
      primary,
      ...(options.fallbackTrustFilePaths ?? []),
    ].filter((path, index, paths) => paths.indexOf(path) === index);
  }

  async validate(canonicalRoot: string): Promise<{
    trusted: boolean;
    matchedPath?: string;
    decision?: boolean;
    reason?: 'missing_store' | 'nearest_false' | 'nearest_true' | 'invalid_store';
  }> {
    const loaded = await this.loadTrustStore();
    if (!loaded.ok) return loaded.result;

    const trustStore = loaded.trustStore;
    const keys = Object.keys(trustStore);
    if (keys.length === 0) {
      return {
        trusted: false,
      };
    }

    const root = await this.canonicalize(canonicalRoot);
    let cursor = root;

    while (true) {
      if (Object.prototype.hasOwnProperty.call(trustStore, cursor)) {
        const decisionRaw = trustStore[cursor];
        if (typeof decisionRaw !== 'boolean') {
          return {
            trusted: false,
            matchedPath: cursor,
            reason: 'invalid_store',
          };
        }

        const exactMatch = cursor === root;
        const trusted = decisionRaw && (!this.exactRootOnly || exactMatch);
        return {
          trusted,
          matchedPath: cursor,
          decision: trusted,
          reason: decisionRaw ? 'nearest_true' : 'nearest_false',
        };
      }

      const parent = dirnamePath(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }

    return {
      trusted: false,
      decision: false,
    };
  }

  private async loadTrustStore(): Promise<
    | { ok: true; trustStore: RawTrustStore }
    | { ok: false; result: { trusted: false; reason: 'missing_store' | 'invalid_store' } }
  > {
    let sawInvalid = false;
    for (const trustFilePath of this.trustFilePaths) {
      try {
        const raw = await readFile(trustFilePath, 'utf8');
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          sawInvalid = true;
          continue;
        }
        return { ok: true, trustStore: parsed as RawTrustStore };
      } catch {
        continue;
      }
    }

    return {
      ok: false,
      result: {
        trusted: false,
        reason: sawInvalid ? 'invalid_store' : 'missing_store',
      },
    };
  }

  private async canonicalize(rawPath: string): Promise<string> {
    const resolved = resolvePath(rawPath);
    try {
      return await realpath(resolved);
    } catch {
      return resolved;
    }
  }
}
