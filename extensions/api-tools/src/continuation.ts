import { randomBytes, randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';
import { clampCursorTtlSeconds, redactToolResult } from './security.js';
import type { ApiContinuationMetadata, ApiToolResult } from './types.js';

interface CursorRecord {
  owner: string;
  tool: string;
  action: string;
  artifactId: string;
  startOffset: number;
  expiresAt: number;
  nextCursor?: string;
}

interface ArtifactRecord {
  id: string;
  path: string;
  limits: {
    maxResponseBytes: number;
    maxResponseLines: number;
  };
  status?: string;
  isError?: boolean;
}

function countLines(text: string): number {
  return text.length === 0 ? 0 : text.split('\n').length;
}

function sliceToBudget(text: string, startOffset: number, maxBytes: number, maxLines: number) {
  const totalBytes = Buffer.byteLength(text, 'utf8');
  const totalLines = countLines(text);
  let offset = startOffset;
  let bytes = 0;
  let lines = 0;
  let chunk = '';
  let seenContent = false;

  while (offset < text.length) {
    const char = text[offset]!;
    const next = chunk + char;
    const nextBytes = Buffer.byteLength(next, 'utf8');
    const nextLines = countLines(next);
    if (nextBytes > maxBytes || nextLines > maxLines) break;
    chunk = next;
    bytes = nextBytes;
    lines = nextLines;
    offset += 1;
    seenContent = true;
  }

  if (!seenContent && startOffset < text.length) {
    const char = text[startOffset]!;
    chunk = char;
    bytes = Buffer.byteLength(chunk, 'utf8');
    lines = countLines(chunk);
    offset = startOffset + 1;
  }

  return {
    chunk,
    nextOffset: offset,
    metadata: {
      has_more: offset < text.length,
      returned_bytes: bytes,
      returned_lines: lines,
      total_bytes: totalBytes,
      total_lines: totalLines,
    } satisfies ApiContinuationMetadata,
  };
}

async function ensureContainedFile(root: string, path: string): Promise<void> {
  const rootReal = await realpath(root);
  const info = await lstat(path);
  if (!info.isFile()) throw new Error('Continuation artifact is not a regular file.');
  const fileReal = await realpath(path);
  const rootPrefix = rootReal.endsWith('/') ? rootReal : `${rootReal}/`;
  if (!(fileReal === rootReal || fileReal.startsWith(rootPrefix))) {
    throw new Error('Continuation artifact escaped the owned temporary directory.');
  }
}

function serializeResult(result: ApiToolResult): string {
  return JSON.stringify(result, null, 2);
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
    this.ttlSeconds = clampCursorTtlSeconds(options.ttlSeconds);
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

  private async writeArtifact(text: string, limits: ArtifactRecord['limits'], base: { status?: string; isError?: boolean }): Promise<ArtifactRecord> {
    const root = await this.ensureRoot();
    await mkdir(root, { recursive: true, mode: 0o700 });
    const id = randomUUID();
    const path = join(root, `${id}.json`);
    const handle = await open(path, 'wx', 0o600);
    try {
      await handle.writeFile(text, 'utf8');
    } finally {
      await handle.close();
    }
    const artifact = { id, path, limits, ...base };
    this.artifacts.set(id, artifact);
    return artifact;
  }

  private createCursor(record: Omit<CursorRecord, 'expiresAt' | 'nextCursor'>): string {
    const cursor = randomBytes(16).toString('hex');
    this.registry.set(cursor, { ...record, expiresAt: this.now() + this.ttlSeconds * 1000 });
    return cursor;
  }

  private buildCompleteResult(base: ApiToolResult, continuation: ApiContinuationMetadata): ApiToolResult {
    return {
      ...base,
      details: {
        ...(base.details ?? {}),
        continuation,
      },
    };
  }

  private buildChunkResult(base: { status?: string; isError?: boolean }, chunk: string, continuation: ApiContinuationMetadata): ApiToolResult {
    const content = [{ type: 'text' as const, text: chunk }];
    return {
      content,
      details: {
        status: base.status ?? (base.isError ? 'failure' : 'success'),
        continuation,
      },
      isError: base.isError,
    };
  }

  async finalize(input: {
    tool: string;
    action: string;
    result: ApiToolResult;
    secretValues: string[];
    limits: { maxResponseBytes: number; maxResponseLines: number };
  }): Promise<ApiToolResult> {
    const redacted = redactToolResult(input.result, input.secretValues);
    const fullText = serializeResult(redacted);
    const slice = sliceToBudget(fullText, 0, input.limits.maxResponseBytes, input.limits.maxResponseLines);
    if (!slice.metadata.has_more) {
      return this.buildCompleteResult(redacted, { ...slice.metadata, has_more: false });
    }

    const artifact = await this.writeArtifact(fullText, {
      maxResponseBytes: input.limits.maxResponseBytes,
      maxResponseLines: input.limits.maxResponseLines,
    }, {
      status: typeof redacted.details?.status === 'string' ? redacted.details.status : undefined,
      isError: redacted.isError,
    });
    const nextCursor = this.createCursor({
      owner: this.owner,
      tool: input.tool,
      action: input.action,
      artifactId: artifact.id,
      startOffset: slice.nextOffset,
    });

    return this.buildChunkResult({ status: typeof redacted.details?.status === 'string' ? redacted.details.status : undefined, isError: redacted.isError }, slice.chunk, { ...slice.metadata, has_more: true, next_cursor: nextCursor });
  }

  async continue(input: { tool: string; action: string; cursor: string }): Promise<ApiToolResult> {
    const record = this.registry.get(input.cursor);
    if (!record) return this.cursorError('cursor_invalid', 'The cursor is invalid.');
    if (record.expiresAt < this.now()) return this.cursorError('cursor_expired', 'The cursor has expired.');
    if (record.owner !== this.owner) return this.cursorError('cursor_invalid', 'The cursor is invalid for this session.');
    if (record.tool !== input.tool) return this.cursorError('cursor_wrong_tool', 'The cursor belongs to a different tool.');
    if (record.action !== input.action) return this.cursorError('cursor_wrong_action', 'The cursor belongs to a different action.');

    const artifact = this.artifacts.get(record.artifactId);
    if (!artifact) return this.cursorError('cursor_invalid', 'The cursor artifact is unavailable.');

    try {
      const root = await this.ensureRoot();
      await ensureContainedFile(root, artifact.path);
      const text = await readFile(artifact.path, 'utf8');
      const slice = sliceToBudget(text, record.startOffset, artifact.limits.maxResponseBytes, artifact.limits.maxResponseLines);
      let nextCursor = record.nextCursor;
      if (slice.metadata.has_more && !nextCursor) {
        nextCursor = this.createCursor({
          owner: this.owner,
          tool: record.tool,
          action: record.action,
          artifactId: record.artifactId,
          startOffset: slice.nextOffset,
        });
        record.nextCursor = nextCursor;
      }

      return this.buildChunkResult({ status: artifact.status, isError: artifact.isError }, slice.chunk, { ...slice.metadata, next_cursor: nextCursor });
    } catch {
      return this.cursorError('cursor_invalid', 'The cursor artifact is unavailable.');
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

  private cursorError(code: string, message: string): ApiToolResult {
    return {
      content: [{ type: 'text', text: message }],
      details: {
        status: 'failure',
        error: { code, message, recoverable: true },
      },
      isError: true,
    };
  }
}
