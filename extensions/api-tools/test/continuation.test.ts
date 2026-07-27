import { access, mkdir, readFile, readdir, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ContinuationManager } from '../src/continuation.js';
import { successDocument } from '../src/result-format.js';

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
      document: successDocument({ tool: 'api_swagger', action: 'discover', records: Array.from({ length: 8 }, (_, index) => ({ id: `r${index}`, kind: 'operation', text: `warmup-${index}` })) }),
      secretValues: [],
      limits: { maxResponseBytes: 20, maxResponseLines: 2 },
    });

    await expect(access(staleRoot)).rejects.toThrow();
    await expect(access(freshRoot)).resolves.toBeUndefined();
  });

  it('returns complete fitting results directly and oversized results with same-tool cursors using record pages', async () => {
    const manager = new ContinuationManager({ now: () => 0, ttlSeconds: 3600 });
    const small = await manager.finalize({
      tool: 'api_swagger',
      action: 'discover',
      document: successDocument({ tool: 'api_swagger', action: 'discover', records: [{ id: '1', kind: 'operation', text: 'small' }] }),
      secretValues: [],
      limits: { maxResponseBytes: 1000, maxResponseLines: 20 },
    });
    expect(small.details!.continuation.has_more).toBe(false);
    expect(small.content[0]!.text).toBe('small');

    const large = await manager.finalize({
      tool: 'api_swagger',
      action: 'discover',
      document: successDocument({ tool: 'api_swagger', action: 'discover', records: Array.from({ length: 10 }, (_, i) => ({ id: `r${i}`, kind: 'operation', text: `line-${i}` })) }),
      secretValues: [],
      limits: { maxResponseBytes: 20, maxResponseLines: 2 },
    });
    expect(large.details!.continuation.has_more).toBe(true);
    expect(large.content[0].text).toContain('line-0\nline-1');
    expect(large.content[0].text).toContain('next_cursor:');
    expect(large.content[0].text).toContain('api_swagger action=discover');

    const next = await manager.continue({ tool: 'api_swagger', action: 'discover', cursor: large.details!.continuation.next_cursor! });
    expect(next.content[0].text).toContain('line-2\nline-3');
  });

  it('serializes the full redacted document exactly once and replays deterministic cursor pages', async () => {
    const manager = new ContinuationManager({ now: () => 0, ttlSeconds: 3600 });
    const document = successDocument({
      tool: 'api_graphql',
      action: 'execute',
      identity: 'Viewer',
      records: [
        { id: '1', kind: 'request', text: 'query Viewer' },
        { id: '2', kind: 'text_frame', text: 'token: top-secret' },
        { id: '3', kind: 'text_frame', text: 'tail' },
      ],
    });
    const result = await manager.finalize({
      tool: 'api_graphql',
      action: 'execute',
      document,
      secretValues: ['top-secret'],
      limits: { maxResponseBytes: 20, maxResponseLines: 2 },
    });

    expect(result.details!.continuation.has_more).toBe(true);
    expect(JSON.stringify(result)).not.toContain('top-secret');

    const artifacts = Array.from((manager as any).artifacts.values()) as Array<{ id: string; path: string }>;
    expect(artifacts).toHaveLength(1);
    const artifactText = await readFile(artifacts[0]!.path, 'utf8');
    expect(artifactText).toContain('[REDACTED]');
    expect(artifactText).not.toContain('top-secret');

    const firstCursor = result.details!.continuation.next_cursor;
    const replayA = await manager.continue({ tool: 'api_graphql', action: 'execute', cursor: firstCursor! });
    const replayB = await manager.continue({ tool: 'api_graphql', action: 'execute', cursor: firstCursor! });
    expect(replayA.content[0]!.text).toContain('token: [REDACTED]');
    expect(replayB.content[0]!.text).toContain('token: [REDACTED]');
    expect(replayA.content[0]!.text.replace(/next_cursor: .*\nfollow_up: .*$/s, '')).toBe(replayB.content[0]!.text.replace(/next_cursor: .*\nfollow_up: .*$/s, ''));
  });

  it('creates contained artifacts with restrictive permissions and rejects symlink escapes without leaking paths', async () => {
    const manager = new ContinuationManager({ now: () => 0, ttlSeconds: 3600 });
    const result = await manager.finalize({
      tool: 'api_swagger',
      action: 'discover',
      document: successDocument({ tool: 'api_swagger', action: 'discover', records: Array.from({ length: 8 }, (_, index) => ({ id: `r${index}`, kind: 'operation', text: `line-${index}` })) }),
      secretValues: [],
      limits: { maxResponseBytes: 20, maxResponseLines: 2 },
    });

    const root = await (manager as any).ensureRoot();
    const artifacts = Array.from((manager as any).artifacts.values()) as Array<{ id: string; path: string }>;
    const rootMode = (await stat(root)).mode & 0o777;
    const fileMode = (await stat(artifacts[0]!.path)).mode & 0o777;
    expect(rootMode).toBe(0o700);
    expect(fileMode).toBe(0o600);

    const outsideDir = await mkdtemp(join(tmpdir(), 'api-tools-continuation-outside-'));
    const outsideFile = join(outsideDir, 'outside.txt');
    await writeFile(outsideFile, 'outside', 'utf8');
    const escapedPath = join(root, 'escaped.json');
    await symlink(outsideFile, escapedPath);
    (manager as any).artifacts.set(artifacts[0]!.id, { ...(manager as any).artifacts.get(artifacts[0]!.id), path: escapedPath });

    const escaped = await manager.continue({ tool: 'api_swagger', action: 'discover', cursor: result.details!.continuation.next_cursor! });
    expect(escaped.details!.failure!.code).toBe('continuation.invalid');
    expect(JSON.stringify(escaped)).not.toContain(root);
    expect(JSON.stringify(escaped)).not.toContain(escapedPath);
  });

  it('rejects wrong tool, wrong action, rotated-session, and expired cursors with typed errors', async () => {
    let now = 0;
    const manager = new ContinuationManager({ now: () => now, ttlSeconds: 1 });
    const large = await manager.finalize({
      tool: 'api_graphql',
      action: 'execute',
      document: successDocument({ tool: 'api_graphql', action: 'execute', records: Array.from({ length: 6 }, (_, i) => ({ id: `r${i}`, kind: 'text_frame', text: `line-${i}` })) }),
      secretValues: [],
      limits: { maxResponseBytes: 20, maxResponseLines: 2 },
    });
    const cursor = large.details!.continuation.next_cursor;
    expect((await manager.continue({ tool: 'api_swagger', action: 'execute', cursor: cursor! })).details!.failure!.code).toBe('continuation.wrong_tool');
    expect((await manager.continue({ tool: 'api_graphql', action: 'schema', cursor: cursor! })).details!.failure!.code).toBe('continuation.wrong_action');
    await manager.rotateSession();
    expect((await manager.continue({ tool: 'api_graphql', action: 'execute', cursor: cursor! })).details!.failure!.code).toBe('continuation.invalid');

    const renewed = await manager.finalize({
      tool: 'api_graphql',
      action: 'execute',
      document: successDocument({ tool: 'api_graphql', action: 'execute', records: Array.from({ length: 6 }, (_, i) => ({ id: `r${i}`, kind: 'text_frame', text: `line-${i}` })) }),
      secretValues: [],
      limits: { maxResponseBytes: 20, maxResponseLines: 2 },
    });
    now = 2000;
    expect((await manager.continue({ tool: 'api_graphql', action: 'execute', cursor: renewed.details!.continuation.next_cursor! })).details!.failure!.code).toBe('continuation.expired');
  });
});
