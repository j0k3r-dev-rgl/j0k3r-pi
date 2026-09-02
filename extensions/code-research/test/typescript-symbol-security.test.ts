import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { findSymbol, resolveFindSymbol } from '../src/core/find-symbol-resolver.js';
import { buildWorkspaceGraph } from '../src/core/workspace-graph.js';
import { getSubprojectShardPath } from '../src/core/graph-persistence.js';

describe('TypeScript symbol security controls', () => {
  it('rejects traversal and symlink escapes before reading source', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-ts-symbol-bound-'));
    const outside = await mkdtemp(join(tmpdir(), 'pi-ts-symbol-outside-'));
    await writeFile(join(outside, 'secret.ts'), 'export const SECRET_SENTINEL = 1;\n');
    await symlink(outside, join(root, 'escape'));
    await expect(findSymbol(root, { path: join(outside, 'secret.ts'), symbol: 'SECRET_SENTINEL', language: 'ts' })).rejects.toThrow(/escapes workspace/);
    await expect(findSymbol(root, { path: 'escape/secret.ts', symbol: 'SECRET_SENTINEL', language: 'ts' })).rejects.toThrow(/escapes workspace/);
  });

  it('enforces file/directory scope and per-result code allowlist', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-ts-symbol-scope-'));
    await mkdir(join(root, '.pi'), { recursive: true });
    await writeFile(join(root, '.pi', 'code-research.json'), '{"graph":{"enable":true}}\n');
    const file = join(root, 'mixed.ts');
    await writeFile(file, `interface Contract { run(): void }\nfunction run() { return 'EXECUTABLE_SENTINEL'; }\ntype Alias = string;\n`);
    await expect(findSymbol(root, { path: root, scope: 'file', symbol: 'run', language: 'ts' })).rejects.toThrow(/scope=file/);
    await expect(findSymbol(root, { path: file, scope: 'directory', symbol: 'run', language: 'ts' })).rejects.toThrow(/scope=directory/);
    await buildWorkspaceGraph(root);
    const run = await findSymbol(root, { path: file, symbol: 'run', language: 'ts', include_code: true });
    expect(run.find((result) => result.declaration_kind === 'function')?.code).toContain('EXECUTABLE_SENTINEL');
    expect(run.find((result) => result.declaration_kind === 'interface_method')?.code).toBeUndefined();
    expect((await findSymbol(root, { path: file, symbol: 'Alias', language: 'ts', include_code: true }))[0].code).toBeUndefined();
  });

  it('does not persist source bodies or string-literal secrets in canonical graph symbols', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-ts-symbol-secret-'));
    await mkdir(join(root, '.pi'), { recursive: true });
    await writeFile(join(root, '.pi/code-research.json'), '{"graph":{"enable":true}}\n');
    await writeFile(join(root, 'secret.ts'), `export function reveal() { return 'DO_NOT_PERSIST_SECRET_BODY'; }\n`);
    const { state } = await buildWorkspaceGraph(root);
    const shardPath = getSubprojectShardPath(root, state.subprojects[0].id);
    const shard = await readFile(shardPath, 'utf8');
    expect(shard).not.toContain('DO_NOT_PERSIST_SECRET_BODY');
    expect(shard).not.toContain('return ');
    const resolution = await resolveFindSymbol(root, { path: 'secret.ts', symbol: 'missing', language: 'ts' });
    expect(JSON.stringify(resolution.diagnostics)).not.toContain('DO_NOT_PERSIST_SECRET_BODY');
  });
});
