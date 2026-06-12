import { readdir, readFile } from 'node:fs/promises';
import { isAbsolute, join, parse } from 'node:path';
import { realpath } from 'node:fs/promises';

import type { PiSessionRef } from './types.js';

export interface SessionIndexOptions {
  sessionDir?: string;
}

interface SessionHeader {
  type?: string;
  id?: string;
  cwd?: string;
}

export interface SessionIndexer {
  listWorkspaceSessions(workspaceRoot: string): Promise<PiSessionRef[]>;
}

export class FileSessionIndex implements SessionIndexer {
  private readonly sessionDir: string;

  constructor(options: SessionIndexOptions = {}) {
    this.sessionDir = options.sessionDir ?? 'sessions';
  }

  async listWorkspaceSessions(workspaceRoot: string): Promise<PiSessionRef[]> {
    const targetRoot = await this.canonicalizeRoot(workspaceRoot);
    const files = await this.discoverSessionFiles(this.sessionDir);
    const matches: PiSessionRef[] = [];

    for (const file of files) {
      const header = await this.readHeader(file);
      if (!header || header.type !== 'session') {
        continue;
      }

      const headerCwd = typeof header.cwd === 'string' ? header.cwd : undefined;
      if (!headerCwd) {
        continue;
      }

      const canonicalHeaderCwd = await this.canonicalizeRoot(headerCwd);
      if (canonicalHeaderCwd !== targetRoot) {
        continue;
      }

      const sessionId = typeof header.id === 'string' ? header.id.trim() : undefined;
      if (!sessionId) continue;

      matches.push({
        sessionId,
        sessionFile: file,
        sessionName: parse(file).name,
      });
    }

    return matches.sort((a, b) => a.sessionId!.localeCompare(b.sessionId!));
  }

  private async discoverSessionFiles(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    const files: string[] = [];

    for (const entry of entries) {
      const child = join(directory, entry.name);
      if (entry.isDirectory()) {
        files.push(...await this.discoverSessionFiles(child));
        continue;
      }

      if (entry.isFile() && child.endsWith('.jsonl')) {
        files.push(child);
      }
    }

    return files;
  }

  private async readHeader(file: string): Promise<SessionHeader | undefined> {
    const content = await readFile(file, 'utf8').catch(() => undefined);
    if (!content) return undefined;

    const firstLine = content.split(/\r?\n/).find((line) => line.trim().length > 0);
    if (!firstLine) return undefined;

    try {
      const parsed = JSON.parse(firstLine) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return undefined;
      }
      return parsed as SessionHeader;
    } catch {
      return undefined;
    }
  }

  private async canonicalizeRoot(rawRoot: string): Promise<string> {
    const absolute = isAbsolute(rawRoot) ? rawRoot : join(process.cwd(), rawRoot);
    try {
      return await realpath(absolute);
    } catch {
      return absolute;
    }
  }
}
