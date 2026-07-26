import { describe, it, expect } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildWorkspaceGraph } from '../../src/core/workspace-graph.js';
import { readSubprojectGraphShard } from '../../src/core/graph-persistence.js';

async function createProject(files: Record<string, string>) {
  const rootDir = join(tmpdir(), `pi-graph-go-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootDir, { recursive: true });
  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(rootDir, relativePath);
    await mkdir(join(fullPath, '..'), { recursive: true });
    await writeFile(fullPath, content, 'utf8');
  }
  return rootDir;
}

describe('workspace graph shard content for Go', () => {
  it('stores Go file/symbol nodes, call edges, and coverage proof', async () => {
    const rootDir = await createProject({
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'go.mod': 'module example\\n',
      'service/service.go': `package service\n\ntype Worker struct{}\n\nfunc (w *Worker) Run(name string) string {\n\treturn helper(name)\n}\n\nfunc helper(name string) string {\n\treturn format(name)\n}\n\nfunc format(name string) string {\n\treturn name\n}\n`,
    });

    const built = await buildWorkspaceGraph(rootDir);
    const subprojectId = built.state.subprojects[0]?.id;
    expect(subprojectId).toBeTruthy();
    if (!subprojectId) return;

    const shardResult = await readSubprojectGraphShard(rootDir, subprojectId);
    expect(shardResult.status).toBe('ok');
    if (shardResult.status !== 'ok') return;

    const shard = shardResult.data;
    const fileNode = shard.nodes.find((node) => node.kind === 'file' && node.path === 'service/service.go');
    const run = shard.nodes.find((node) => node.kind === 'symbol' && node.file === 'service/service.go' && node.name === 'Run');
    const helper = shard.nodes.find((node) => node.kind === 'symbol' && node.file === 'service/service.go' && node.name === 'helper');
    const format = shard.nodes.find((node) => node.kind === 'symbol' && node.file === 'service/service.go' && node.name === 'format');

    expect(fileNode).toMatchObject({ kind: 'file', language: 'go', path: 'service/service.go' });
    expect(run).toMatchObject({ kind: 'symbol', language: 'go', symbolKind: 'method', owner: 'Worker' });
    expect(helper).toMatchObject({ kind: 'symbol', language: 'go', symbolKind: 'function' });
    expect(shard.goSymbolCoverage).toMatchObject({ modelVersion: 1, generation: shard.generation, completeFiles: ['service/service.go'] });
    expect(shard.edges.some((edge) => edge.kind === 'calls' && edge.from === run?.id && edge.to === helper?.id)).toBe(true);
    expect(shard.edges.some((edge) => edge.kind === 'calls' && edge.from === helper?.id && edge.to === format?.id)).toBe(true);
  });
});
