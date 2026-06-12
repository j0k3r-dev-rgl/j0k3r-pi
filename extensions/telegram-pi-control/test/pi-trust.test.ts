import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { FilePiTrustValidator } from '../src/pi-trust.js';

describe('FilePiTrustValidator', () => {
  it('reports missing store as untrusted', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'telegram-control-pitrust-missing-'));
    const validator = new FilePiTrustValidator({
      trustFilePath: join(directory, 'no-trust.json'),
    });

    const result = await validator.validate('/tmp/example/project');

    expect(result.trusted).toBe(false);
    expect(result.reason).toBe('missing_store');
    expect(result.decision).toBeUndefined();
  });

  it('uses fallback trust file when configured pi agent dir has no trust.json', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'telegram-control-pitrust-fallback-'));
    const badAgentDir = join(directory, 'wrong-agent-dir');
    const fallbackAgentDir = join(directory, '.pi', 'agent');
    await mkdir(fallbackAgentDir, { recursive: true });
    await writeFile(join(fallbackAgentDir, 'trust.json'), JSON.stringify({
      '/tmp/fallback-project': true,
    }));

    const validator = new FilePiTrustValidator({
      piCodingAgentDir: badAgentDir,
      fallbackTrustFilePaths: [join(fallbackAgentDir, 'trust.json')],
    });

    const result = await validator.validate('/tmp/fallback-project');

    expect(result).toEqual({
      trusted: true,
      matchedPath: '/tmp/fallback-project',
      decision: true,
      reason: 'nearest_true',
    });
  });

  it('can require exact trust roots and reject trusted parents for nested paths', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'telegram-control-pitrust-exact-'));
    const trustFile = join(directory, 'trust.json');
    await writeFile(trustFile, JSON.stringify({
      '/tmp/exact-parent': true,
    }));

    const validator = new FilePiTrustValidator({ trustFilePath: trustFile, exactRootOnly: true });
    const exact = await validator.validate('/tmp/exact-parent');
    const nested = await validator.validate('/tmp/exact-parent/child');

    expect(exact.trusted).toBe(true);
    expect(nested.trusted).toBe(false);
    expect(nested.matchedPath).toBe('/tmp/exact-parent');
  });

  it('uses nearest-parent trust semantics and returns nearest_true when parent is trusted', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'telegram-control-pitrust-trusted-'));
    const trustFile = join(directory, 'trust.json');
    await writeFile(trustFile, JSON.stringify({
      '/tmp': true,
      '/tmp/trust-parent': true,
      '/tmp/trust-parent/child': false,
    }));

    const validator = new FilePiTrustValidator({ trustFilePath: trustFile });
    const result = await validator.validate('/tmp/trust-parent/child/grandchild');

    expect(result).toEqual({
      trusted: false,
      matchedPath: '/tmp/trust-parent/child',
      decision: false,
      reason: 'nearest_false',
    });
  });

  it('returns nearest_true for a trusted exact root and nearest_true for trusted parent', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'telegram-control-pitrust-parent-'));
    const trustFile = join(directory, 'trust.json');
    await writeFile(trustFile, JSON.stringify({
      '/tmp/allow-list': true,
      '/tmp/allow-list/project': true,
      '/tmp/other': false,
    }));

    const validator = new FilePiTrustValidator({ trustFilePath: trustFile });
    const exact = await validator.validate('/tmp/allow-list/project');
    const parent = await validator.validate('/tmp/allow-list/project/nested/workspace');

    expect(exact).toEqual({
      trusted: true,
      matchedPath: '/tmp/allow-list/project',
      decision: true,
      reason: 'nearest_true',
    });
    expect(parent).toEqual({
      trusted: true,
      matchedPath: '/tmp/allow-list/project',
      decision: true,
      reason: 'nearest_true',
    });
  });

  it('reports nearest_false for untrusted allowlisted roots and returns a false decision', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'telegram-control-pitrust-denied-'));
    const trustFile = join(directory, 'trust.json');
    await writeFile(trustFile, JSON.stringify({
      '/tmp/disallowed': false,
      '/tmp/allow': true,
    }));

    const validator = new FilePiTrustValidator({ trustFilePath: trustFile });
    const denied = await validator.validate('/tmp/disallowed');

    expect(denied).toEqual({
      trusted: false,
      matchedPath: '/tmp/disallowed',
      decision: false,
      reason: 'nearest_false',
    });
  });
});
