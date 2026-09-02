import { describe, it, expect } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { executeReverseFunctionCallTree } from '../src/core/reverse-function-call-tree-resolver.js';
import { buildWorkspaceGraph } from '../src/core/workspace-graph.js';

async function createProject(files: Record<string, string>) {
  const rootDir = join(tmpdir(), `pi-reverse-call-tree-go-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootDir, { recursive: true });
  const effectiveFiles = files['.pi/code-research.json'] === undefined
    ? { '.pi/code-research.json': `{"graph":{"enable":true}}\n`, ...files }
    : files;
  for (const [relativePath, content] of Object.entries(effectiveFiles)) {
    const fullPath = join(rootDir, relativePath);
    await mkdir(join(fullPath, '..'), { recursive: true });
    await writeFile(fullPath, content, 'utf8');
  }
  return rootDir;
}

describe('reverse_function_call_tree Go', () => {
  it('traces Go callers recursively', async () => {
    const rootDir = await createProject({
      'go.mod': 'module example\\n',
      'service/service.go': `package service\n\nfunc helper(name string) string {\n\treturn name\n}\n\nfunc Run(name string) string {\n\treturn helper(name)\n}\n\nfunc Handle(name string) string {\n\treturn Run(name)\n}\n`,
    });

    await buildWorkspaceGraph(rootDir);

    const execution = await executeReverseFunctionCallTree(rootDir, { path: 'service/service.go', symbol: 'helper', language: 'go', kind: 'function', max_depth: 5 } as any);
    expect(execution.status).toBe('ok');
    if (execution.status !== 'ok') return;
    expect(execution.result.root.symbol).toBe('helper');
    expect(execution.result.root.callers?.[0].symbol).toBe('Run');
    expect(execution.result.root.callers?.[0].callers?.[0].symbol).toBe('Handle');
  });
});
