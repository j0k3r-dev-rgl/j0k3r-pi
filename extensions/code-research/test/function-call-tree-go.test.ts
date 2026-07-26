import { describe, it, expect } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { executeFunctionCallTree } from '../src/core/function-call-tree-resolver.js';

async function createProject(files: Record<string, string>) {
  const rootDir = join(tmpdir(), `pi-function-call-tree-go-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootDir, { recursive: true });
  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(rootDir, relativePath);
    await mkdir(join(fullPath, '..'), { recursive: true });
    await writeFile(fullPath, content, 'utf8');
  }
  return rootDir;
}

describe('function_call_tree Go', () => {
  it('traces internal same-package calls for Go functions and methods', async () => {
    const rootDir = await createProject({
      'go.mod': 'module example\\n',
      'service/service.go': `package service\n\ntype Worker struct{}\n\nfunc (w *Worker) Run(name string) string {\n\treturn helper(name)\n}\n\nfunc helper(name string) string {\n\treturn format(name)\n}\n\nfunc format(name string) string {\n\treturn name\n}\n`,
    });

    const execution = await executeFunctionCallTree(rootDir, { path: 'service/service.go', symbol: 'Run', language: 'go', kind: 'method', max_depth: 5 } as any);
    expect(execution.status).toBe('ok');
    if (execution.status !== 'ok') return;
    expect(execution.result.root.symbol).toBe('Run');
    expect(execution.result.root.children?.[0].symbol).toBe('helper');
    expect(execution.result.root.children?.[0].children?.[0].symbol).toBe('format');
  });
});
