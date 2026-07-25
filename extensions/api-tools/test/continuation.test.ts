import { access, mkdir, readFile, readdir, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ContinuationManager } from '../src/continuation.js';
import { redactToolResult } from '../src/security.js';

describe('ContinuationManager', () => {
  it('initializes lazily and sweeps only stale temporary roots', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'api-tools-continuation-base-'));
    const freshRoot = join(baseDir, 'pi-api-tools-fresh-root');
    const staleRoot = join(baseDir, 'pi-api-tools-stale-root');
    await mkdir(freshRoot, { recursive: true });
    await mkdir(staleRoot, { recursive: true });
    await utimes(freshRoot, new Date(95_000), new Date(95_000));
    await utimes(staleRoot, new Date(0), new Date(0));

    const manager = new ContinuationManager({ now: () => 100_000, ttlSeconds: 3600, baseDir, staleRootAgeMs: 60_000 });
    expect((await readdir(baseDir)).sort()).toEqual(['pi-api-tools-fresh-root', 'pi-api-tools-stale-root']);

    await manager.finalize({
      tool: 'api_swagger',
      action: 'discover',
      result: { content: [{ type: 'text', text: Array.from({ length: 8 }, (_, index) => `warmup-${index}`).join('\n') }], details: { status: 'success' } },
      secretValues: [],
      limits: { maxResponseBytes: 20, maxResponseLines: 2 },
    });

    await expect(access(staleRoot)).rejects.toThrow();
    await expect(access(freshRoot)).resolves.toBeUndefined();
    const createdRoots = (await readdir(baseDir)).filter((entry) => entry.startsWith('pi-api-tools-'));
    expect(createdRoots.length).toBe(2);
  });

  it('returns complete fitting results directly and oversized results with same-tool cursors using configured budgets', async () => {
    const manager = new ContinuationManager({ now: () => 0, ttlSeconds: 3600 });
    const small = await manager.finalize({
      tool: 'api_swagger',
      action: 'discover',
      result: { content: [{ type: 'text', text: 'small' }], details: { status: 'success' } },
      secretValues: [],
      limits: { maxResponseBytes: 1000, maxResponseLines: 20 },
    });
    expect(small.details!.continuation.has_more).toBe(false);
    expect(small.content[0]!.text).toBe('small');

    const large = await manager.finalize({
      tool: 'api_swagger',
      action: 'discover',
      result: { content: [{ type: 'text', text: Array.from({ length: 10 }, (_, i) => `line-${i}`).join('\n') }], details: { status: 'success' } },
      secretValues: [],
      limits: { maxResponseBytes: 20, maxResponseLines: 2 },
    });
    expect(large.details!.continuation.has_more).toBe(true);

    const next = await manager.continue({ tool: 'api_swagger', action: 'discover', cursor: large.details!.continuation.next_cursor });
    expect(next.details!.continuation.returned_lines).toBeLessThanOrEqual(2);
    expect(next.details!.continuation.has_more).toBe(true);
  });

  it('serializes the full redacted result exactly once without trimming safe details and replays deterministic cursor chunks', async () => {
    const manager = new ContinuationManager({ now: () => 0, ttlSeconds: 3600 });
    const original = {
      content: [{ type: 'text' as const, text: 'api_graphql execute  \n  preserved whitespace' }],
      details: {
        status: 'success',
        request: { action: 'execute', operation_name: 'GetViewer', arbitrary_detail: 'kept' },
        response: {
          body: JSON.stringify({ data: { viewer: { id: '123', token: 'top-secret', bio: 'alpha beta gamma delta epsilon zeta eta theta' } } }, null, 2),
          arbitrary_safe_detail: { nested: ['one', 'two'] },
        },
        custom: { note: 'retain me' },
      },
    };
    const result = await manager.finalize({
      tool: 'api_graphql',
      action: 'execute',
      result: original,
      secretValues: ['top-secret'],
      limits: { maxResponseBytes: 80, maxResponseLines: 4 },
    });

    expect(result.details!.continuation.has_more).toBe(true);
    expect(result.content[0]!.text).not.toContain('top-secret');
    expect(JSON.stringify(result)).not.toContain('artifact_path');
    expect(result.details!.custom).toBeUndefined();
    expect(result.details!.request).toBeUndefined();
    expect(result.details!.response).toBeUndefined();

    const artifacts = Array.from((manager as any).artifacts.values()) as Array<{ id: string; path: string }>;
    expect(artifacts).toHaveLength(1);
    const artifactText = await readFile(artifacts[0].path, 'utf8');
    const expectedArtifact = JSON.stringify(redactToolResult(original, ['top-secret']), null, 2);
    expect(artifactText).toBe(expectedArtifact);
    expect(artifactText).toContain('preserved whitespace');
    expect(artifactText).toContain('retain me');
    expect(artifactText).toContain('[REDACTED]');
    expect(artifactText).not.toContain('top-secret');

    const firstCursor = result.details!.continuation.next_cursor;
    const replayA = await manager.continue({ tool: 'api_graphql', action: 'execute', cursor: firstCursor });
    const replayB = await manager.continue({ tool: 'api_graphql', action: 'execute', cursor: firstCursor });
    expect(replayA.content[0]!.text).toBe(replayB.content[0]!.text);
    expect(replayA.details!.continuation.next_cursor).toBe(replayB.details!.continuation.next_cursor);

    const chunks = [result.content[0]!.text];
    let cursor = result.details!.continuation.next_cursor;
    while (cursor) {
      const next = await manager.continue({ tool: 'api_graphql', action: 'execute', cursor });
      chunks.push(next.content[0]!.text);
      cursor = next.details!.continuation.next_cursor;
    }

    const reconstructed = chunks.join('');
    expect(reconstructed).toBe(expectedArtifact);
  });

  it('creates contained artifacts with restrictive permissions and rejects symlink escapes without leaking paths', async () => {
    const manager = new ContinuationManager({ now: () => 0, ttlSeconds: 3600 });
    const result = await manager.finalize({
      tool: 'api_swagger',
      action: 'discover',
      result: { content: [{ type: 'text', text: Array.from({ length: 8 }, (_, index) => `line-${index}`).join('\n') }], details: { status: 'success' } },
      secretValues: [],
      limits: { maxResponseBytes: 20, maxResponseLines: 2 },
    });

    const root = await (manager as any).ensureRoot();
    const artifacts = Array.from((manager as any).artifacts.values()) as Array<{ id: string; path: string }>;
    const rootMode = (await stat(root)).mode & 0o777;
    const fileMode = (await stat(artifacts[0].path)).mode & 0o777;
    expect(rootMode).toBe(0o700);
    expect(fileMode).toBe(0o600);

    const outsideDir = await mkdtemp(join(tmpdir(), 'api-tools-continuation-outside-'));
    const outsideFile = join(outsideDir, 'outside.txt');
    await readFile('/etc/hosts', 'utf8').then((text) => writeFile(outsideFile, text, 'utf8'));
    const escapedPath = join(root, 'escaped.json');
    await symlink(outsideFile, escapedPath);
    (manager as any).artifacts.set(artifacts[0].id, { ...artifacts[0], path: escapedPath });

    const escaped = await manager.continue({ tool: 'api_swagger', action: 'discover', cursor: result.details!.continuation.next_cursor });
    expect(escaped.details!.error.code).toBe('cursor_invalid');
    expect(JSON.stringify(escaped)).not.toContain(root);
    expect(JSON.stringify(escaped)).not.toContain(escapedPath);
  });

  it('keeps oversized first chunks bounded even when details contain large arbitrary safe metadata', async () => {
    const manager = new ContinuationManager({ now: () => 0, ttlSeconds: 3600 });
    const largeMetadata = 'meta '.repeat(100);
    const result = await manager.finalize({
      tool: 'api_swagger',
      action: 'discover',
      result: {
        content: [{ type: 'text', text: 'line 1\nline 2\nline 3\nline 4' }],
        details: {
          status: 'success',
          request: { action: 'discover', whitespace: '  preserve  this  ' },
          response: { body: 'body '.repeat(100) },
          arbitrary_safe_detail: largeMetadata,
        },
      },
      secretValues: [],
      limits: { maxResponseBytes: 60, maxResponseLines: 3 },
    });

    expect(Buffer.byteLength(result.content[0]!.text, 'utf8')).toBeLessThanOrEqual(60);
    expect(result.content[0]!.text.split('\n').length).toBeLessThanOrEqual(3);
    expect(JSON.stringify(result.details)).not.toContain(largeMetadata);
    expect(result.details!.continuation.has_more).toBe(true);
  });

  it('rejects wrong tool, wrong action, rotated-session, and expired cursors with typed errors', async () => {
    let now = 0;
    const manager = new ContinuationManager({ now: () => now, ttlSeconds: 1 });
    const large = await manager.finalize({
      tool: 'api_graphql',
      action: 'execute',
      result: { content: [{ type: 'text', text: Array.from({ length: 6 }, (_, i) => `line-${i}`).join('\n') }], details: { status: 'success' } },
      secretValues: [],
      limits: { maxResponseBytes: 20, maxResponseLines: 2 },
    });
    const cursor = large.details!.continuation.next_cursor;
    expect((await manager.continue({ tool: 'api_swagger', action: 'execute', cursor })).details!.error.code).toBe('cursor_wrong_tool');
    expect((await manager.continue({ tool: 'api_graphql', action: 'schema', cursor })).details!.error.code).toBe('cursor_wrong_action');
    await manager.rotateSession();
    expect((await manager.continue({ tool: 'api_graphql', action: 'execute', cursor })).details!.error.code).toBe('cursor_invalid');

    const renewed = await manager.finalize({
      tool: 'api_graphql',
      action: 'execute',
      result: { content: [{ type: 'text', text: Array.from({ length: 6 }, (_, i) => `line-${i}`).join('\n') }], details: { status: 'success' } },
      secretValues: [],
      limits: { maxResponseBytes: 20, maxResponseLines: 2 },
    });
    now = 2000;
    expect((await manager.continue({ tool: 'api_graphql', action: 'execute', cursor: renewed.details!.continuation.next_cursor })).details!.error.code).toBe('cursor_expired');
  });

  it('cleans up idempotently and does not restore old cursors', async () => {
    const manager = new ContinuationManager({ now: () => 0, ttlSeconds: 3600 });
    await manager.finalize({
      tool: 'api_swagger',
      action: 'discover',
      result: { content: [{ type: 'text', text: Array.from({ length: 8 }, (_, index) => `warmup-${index}`).join('\n') }], details: { status: 'success' } },
      secretValues: [],
      limits: { maxResponseBytes: 20, maxResponseLines: 2 },
    });

    await manager.cleanup();
    await manager.cleanup();
    expect((await manager.continue({ tool: 'api_swagger', action: 'discover', cursor: 'stale-cursor' })).details!.error.code).toBe('cursor_invalid');
  });
});
