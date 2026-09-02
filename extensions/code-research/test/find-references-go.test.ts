import { describe, it, expect } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { findReferences } from '../src/core/find-references-resolver.js';
import { buildWorkspaceGraph } from '../src/core/workspace-graph.js';

async function createProject(files: Record<string, string>) {
  const rootDir = join(tmpdir(), `pi-find-references-go-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootDir, { recursive: true });
  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(rootDir, relativePath);
    await mkdir(join(fullPath, '..'), { recursive: true });
    await writeFile(fullPath, content, 'utf8');
  }
  return rootDir;
}

describe('findReferences Go', () => {
  it('finds graph-modeled call references for Go symbols', async () => {
    const rootDir = await createProject({
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'go.mod': 'module example\\n',
      'service/helper.go': `package service\n\nfunc Helper(name string) string {\n\treturn name\n}\n`,
      'service/run.go': `package service\n\nimport \"fmt\"\n\nfunc Run(name string) string {\n\tvalue := Helper(name)\n\tfmt.Println(value)\n\treturn value\n}\n`,
    });

    await buildWorkspaceGraph(rootDir);

    const calls = await findReferences(rootDir, { path: 'service', symbol: 'Helper', language: 'go', kind: 'function' } as any);
    expect(calls.some((ref) => ref.reference_kind === 'call' && ref.context_symbol === 'Run')).toBe(true);
  });
});
