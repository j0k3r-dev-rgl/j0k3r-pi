import { describe, it, expect, beforeAll } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { findSymbol } from '../src/core/find-symbol-resolver.js';
import { buildWorkspaceGraph } from '../src/core/workspace-graph.js';

describe('findSymbol Go', () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = join(tmpdir(), `pi-find-symbol-go-${Date.now()}`);
    await mkdir(join(tmpDir, '.pi'), { recursive: true });
    await writeFile(join(tmpDir, '.pi', 'code-research.json'), '{"graph":{"enable":true}}\n', 'utf8');
  });

  async function writeTestFile(name: string, content: string) {
    const path = join(tmpDir, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, 'utf8');
    await buildWorkspaceGraph(tmpDir);
    return path;
  }

  it('finds Go package, function, method, type, and interface symbols', async () => {
    const file = await writeTestFile(
      'service.go',
      `package sample\n\ntype Runner interface {\n\tRun(name string) string\n}\n\ntype LocalRunner struct{}\n\nfunc (r *LocalRunner) Run(name string) string {\n\treturn helper(name)\n}\n\nfunc helper(name string) string {\n\treturn name\n}\n`
    );

    const pkg = await findSymbol(tmpDir, { path: file, symbol: 'sample', language: 'go', declaration_kind: 'package' as any });
    const runner = await findSymbol(tmpDir, { path: file, symbol: 'Runner', language: 'go', kind: 'interface' });
    const localRunner = await findSymbol(tmpDir, { path: file, symbol: 'LocalRunner', language: 'go', kind: 'class' });
    const run = await findSymbol(tmpDir, { path: file, symbol: 'Run', language: 'go', kind: 'method', include_signature: true });
    const helper = await findSymbol(tmpDir, { path: file, symbol: 'helper', language: 'go', kind: 'function' });

    expect(pkg[0]).toMatchObject({ symbol: 'sample', declaration_kind: 'package', kind: 'variable' });
    expect(runner[0]).toMatchObject({ symbol: 'Runner', declaration_kind: 'interface', kind: 'interface' });
    expect(localRunner[0]).toMatchObject({ symbol: 'LocalRunner', declaration_kind: 'class', kind: 'class' });
    expect(run.some((result) => result.symbol === 'Run' && result.owner === 'LocalRunner' && result.declaration_kind === 'method')).toBe(true);
    expect(run.some((result) => result.signature?.includes('Run(name string) string'))).toBe(true);
    expect(helper[0]).toMatchObject({ symbol: 'helper', declaration_kind: 'function', kind: 'function' });
  });

  it('keeps Go interface lookup graph-only when implementations are not graph-modeled', async () => {
    const projectRoot = join(tmpDir, `graph-go-${Date.now()}`);
    await mkdir(join(projectRoot, '.pi'), { recursive: true });
    await writeFile(join(projectRoot, '.pi', 'code-research.json'), '{"graph":{"enable":true}}\n', 'utf8');
    await writeTestFile(
      `${projectRoot.replace(`${tmpDir}/`, '')}/api/service.go`,
      `package api\n\ntype Service interface {\n\tRun(name string) string\n}\n`
    );
    await writeTestFile(
      `${projectRoot.replace(`${tmpDir}/`, '')}/impl/local_service.go`,
      `package impl\n\nimport \"example/api\"\n\ntype LocalService struct{}\n\nfunc (s *LocalService) Run(name string) string {\n\treturn name\n}\n\nvar _ api.Service = (*LocalService)(nil)\n`
    );

    await buildWorkspaceGraph(projectRoot);
    const results = await findSymbol(projectRoot, { path: projectRoot, symbol: 'Service', language: 'go', kind: 'interface' });

    expect(results).toHaveLength(1);
    expect(results[0].symbol).toBe('Service');
    expect(results[0].implementation_locations ?? []).toEqual([]);
  });
});
