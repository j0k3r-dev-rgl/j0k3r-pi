import { randomBytes, randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';
import { continuationFailure } from './error-classify.js';
import { redactDeep } from './security.js';
import type { ApiActionDocument, ApiContinuationMetadata, ApiToolResult } from './types.js';

interface CursorRecord {
  owner: string;
  tool: string;
  action: string;
  artifactId: string;
  startIndex: number;
  expiresAt: number;
}

interface ArtifactRecord {
  id: string;
  path: string;
  limits: {
    maxResponseBytes: number;
    maxResponseLines: number;
    maxRecordsPerPage?: number;
  };
}

interface StoredDocument {
  document: ApiActionDocument;
}

function countLines(text: string): number {
  return text.length === 0 ? 0 : text.split('\n').length;
}

function pageText(records: ApiActionDocument['records']): string {
  return records.map((record) => record.text).join('\n');
}

function continuationText(text: string, continuation: ApiContinuationMetadata): string {
  if (!continuation.has_more || !continuation.next_cursor) return text;
  const followUp = `${continuation.follow_up.tool} action=${continuation.follow_up.action} cursor=${continuation.next_cursor}`;
  return `${text}\n\nnext_cursor: ${continuation.next_cursor}\nfollow_up: ${followUp}`;
}

function paginateRecords(document: ApiActionDocument, startIndex: number, maxBytes: number, maxLines: number, maxRecordsPerPage?: number) {
  const pageRecords: ApiActionDocument['records'] = [];
  let index = startIndex;
  let text = '';

  while (index < document.records.length) {
    if (typeof maxRecordsPerPage === 'number' && maxRecordsPerPage > 0 && pageRecords.length >= maxRecordsPerPage) break;
    const candidateRecords = [...pageRecords, document.records[index]!];
    const candidateText = pageText(candidateRecords);
    if (pageRecords.length > 0 && (Buffer.byteLength(candidateText, 'utf8') > maxBytes || countLines(candidateText) > maxLines)) break;
    if (pageRecords.length === 0 && (Buffer.byteLength(candidateText, 'utf8') > maxBytes || countLines(candidateText) > maxLines)) {
      throw new Error('Atomic record exceeds continuation budget.');
    }
    pageRecords.push(document.records[index]!);
    text = candidateText;
    index += 1;
  }

  return {
    pageRecords,
    nextIndex: index,
    text,
    returnedBytes: Buffer.byteLength(text, 'utf8'),
    returnedLines: countLines(text),
  };
}

async function ensureContainedFile(root: string, path: string): Promise<void> {
  const rootReal = await realpath(root);
  const info = await lstat(path);
  if (!info.isFile()) throw new Error('Continuation artifact is not a regular file.');
  const fileReal = await realpath(path);
  const rootPrefix = rootReal.endsWith('/') ? rootReal : `${rootReal}/`;
  if (!(fileReal === rootReal || fileReal.startsWith(rootPrefix))) throw new Error('Continuation artifact escaped the owned temporary directory.');
}

export class ContinuationManager {
  private owner = randomBytes(16).toString('hex');
  private rootDirPromise?: Promise<string>;
  private registry = new Map<string, CursorRecord>();
  private artifacts = new Map<string, ArtifactRecord>();
  private readonly now: () => number;
  private readonly ttlSeconds: number;
  private readonly baseDir: string;
  private readonly rootPrefix: string;
  private readonly staleRootAgeMs: number;

  constructor(options: { now?: () => number; ttlSeconds?: number; baseDir?: string; rootPrefix?: string; staleRootAgeMs?: number } = {}) {
    this.now = options.now ?? (() => Date.now());
    this.ttlSeconds = Math.max(1, Math.floor(options.ttlSeconds ?? 3600));
    this.baseDir = options.baseDir ?? tmpdir();
    this.rootPrefix = options.rootPrefix ?? 'pi-api-tools-';
    this.staleRootAgeMs = Math.max(0, options.staleRootAgeMs ?? 5 * 60 * 1000);
  }

  private async sweepStaleRoots(): Promise<void> {
    const entries = await readdir(this.baseDir, { withFileTypes: true }).catch(() => []);
    await Promise.all(entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(this.rootPrefix))
      .map(async (entry) => {
        const path = join(this.baseDir, entry.name);
        const info = await stat(path).catch(() => undefined);
        if (!info) return;
        if ((this.now() - info.mtimeMs) < this.staleRootAgeMs) return;
        await rm(path, { recursive: true, force: true }).catch(() => undefined);
      }));
  }

  private async initializeRoot(): Promise<string> {
    await mkdir(this.baseDir, { recursive: true, mode: 0o700 });
    await this.sweepStaleRoots();
    const root = await mkdtemp(join(this.baseDir, this.rootPrefix));
    await mkdir(root, { recursive: true, mode: 0o700 });
    return root;
  }

  private async ensureRoot(): Promise<string> {
    this.rootDirPromise ??= this.initializeRoot();
    return this.rootDirPromise;
  }

  private async writeArtifact(value: StoredDocument, limits: ArtifactRecord['limits']): Promise<ArtifactRecord> {
    const root = await this.ensureRoot();
    const id = randomUUID();
    const path = join(root, `${id}.json`);
    const handle = await open(path, 'wx', 0o600);
    try {
      await handle.writeFile(JSON.stringify(value, null, 2), 'utf8');
    } finally {
      await handle.close();
    }
    const artifact = { id, path, limits };
    this.artifacts.set(id, artifact);
    return artifact;
  }

  private createCursor(record: Omit<CursorRecord, 'expiresAt'>): string {
    const cursor = randomBytes(16).toString('hex');
    this.registry.set(cursor, { ...record, expiresAt: this.now() + this.ttlSeconds * 1000 });
    return cursor;
  }

  private buildToolResult(document: ApiActionDocument, pageRecords: ApiActionDocument['records'], continuation: ApiContinuationMetadata): ApiToolResult {
    const text = continuationText(pageText(pageRecords), continuation);
    const resultContinuation = {
      ...continuation,
      returned_bytes: Buffer.byteLength(text, 'utf8'),
      returned_lines: countLines(text),
    };
    return {
      content: [{ type: 'text', text }],
      details: {
        contract_version: document.contract_version,
        status: document.status,
        action: document.action,
        identity: document.identity,
        failure: document.failure,
        continuation: resultContinuation,
        render: {
          authorization_state: document.render?.authorization?.state,
          count_label: document.render?.count_label,
        },
      },
      isError: document.status === 'failure',
    };
  }

  private cursorError(code: string, message: string): ApiToolResult {
    const failure = continuationFailure(code, message);
    return {
      content: [{ type: 'text', text: failure.message }],
      details: {
        contract_version: 2,
        status: 'failure',
        action: 'continue',
        failure,
        continuation: {
          returned_count: 1,
          has_more: false,
          follow_up: { tool: 'unknown', action: 'unknown', cursor_parameter: 'cursor' },
          returned_bytes: Buffer.byteLength(failure.message, 'utf8'),
          returned_lines: countLines(failure.message),
        },
      },
      isError: true,
    };
  }

  async finalize(input: {
    tool: string;
    action: string;
    document: ApiActionDocument;
    secretValues: string[];
    limits: { maxResponseBytes: number; maxResponseLines: number; maxRecordsPerPage?: number };
  }): Promise<ApiToolResult> {
    const document = redactDeep(input.document, input.secretValues) as ApiActionDocument;
    try {
      const page = paginateRecords(document, 0, input.limits.maxResponseBytes, input.limits.maxResponseLines, input.limits.maxRecordsPerPage);
      if (page.nextIndex >= document.records.length) {
        return this.buildToolResult(document, page.pageRecords, {
          returned_count: page.pageRecords.length,
          total: document.total ?? document.records.length,
          has_more: false,
          follow_up: { tool: input.tool, action: input.action, cursor_parameter: 'cursor' },
          returned_bytes: page.returnedBytes,
          returned_lines: page.returnedLines,
        });
      }

      const artifact = await this.writeArtifact({ document }, { maxResponseBytes: input.limits.maxResponseBytes, maxResponseLines: input.limits.maxResponseLines, maxRecordsPerPage: input.limits.maxRecordsPerPage });
      const nextCursor = this.createCursor({ owner: this.owner, tool: input.tool, action: input.action, artifactId: artifact.id, startIndex: page.nextIndex });
      return this.buildToolResult(document, page.pageRecords, {
        returned_count: page.pageRecords.length,
        total: document.total ?? document.records.length,
        has_more: true,
        next_cursor: nextCursor,
        follow_up: { tool: input.tool, action: input.action, cursor_parameter: 'cursor' },
        returned_bytes: page.returnedBytes,
        returned_lines: page.returnedLines,
      });
    } catch {
      return this.cursorError('oversized_record', 'The result contains an oversized record that cannot be paginated safely.');
    }
  }

  async continue(input: { tool: string; action: string; cursor: string }): Promise<ApiToolResult> {
    const record = this.registry.get(input.cursor);
    if (!record) return this.cursorError('invalid', 'The cursor is invalid.');
    if (record.expiresAt < this.now()) return this.cursorError('expired', 'The cursor has expired.');
    if (record.owner !== this.owner) return this.cursorError('invalid', 'The cursor is invalid for this session.');
    if (record.tool !== input.tool) return this.cursorError('wrong_tool', 'The cursor belongs to a different tool.');
    if (record.action !== input.action) return this.cursorError('wrong_action', 'The cursor belongs to a different action.');

    const artifact = this.artifacts.get(record.artifactId);
    if (!artifact) return this.cursorError('invalid', 'The cursor artifact is unavailable.');

    try {
      const root = await this.ensureRoot();
      await ensureContainedFile(root, artifact.path);
      const stored = JSON.parse(await readFile(artifact.path, 'utf8')) as StoredDocument;
      const limitsPage = paginateRecords(stored.document, record.startIndex, artifact.limits.maxResponseBytes, artifact.limits.maxResponseLines, artifact.limits.maxRecordsPerPage);
      const nextCursor = limitsPage.nextIndex < stored.document.records.length
        ? this.createCursor({ owner: this.owner, tool: input.tool, action: input.action, artifactId: artifact.id, startIndex: limitsPage.nextIndex })
        : undefined;
      return this.buildToolResult(stored.document, limitsPage.pageRecords, {
        returned_count: limitsPage.pageRecords.length,
        total: stored.document.total ?? stored.document.records.length,
        has_more: limitsPage.nextIndex < stored.document.records.length,
        next_cursor: nextCursor,
        follow_up: { tool: input.tool, action: input.action, cursor_parameter: 'cursor' },
        returned_bytes: limitsPage.returnedBytes,
        returned_lines: limitsPage.returnedLines,
      });
    } catch {
      return this.cursorError('invalid', 'The cursor artifact is unavailable.');
    }
  }

  async rotateSession(): Promise<string> {
    await this.cleanup();
    this.owner = randomBytes(16).toString('hex');
    return this.owner;
  }

  async cleanup(): Promise<void> {
    this.registry.clear();
    for (const artifact of this.artifacts.values()) {
      await unlink(artifact.path).catch(() => undefined);
    }
    this.artifacts.clear();
    const rootPromise = this.rootDirPromise;
    this.rootDirPromise = undefined;
    const root = await rootPromise?.catch(() => undefined);
    if (root) await rm(root, { recursive: true, force: true }).catch(() => undefined);
  }
}
