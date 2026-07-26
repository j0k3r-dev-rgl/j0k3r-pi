import { describe, it, expect } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { findReferences } from '../src/core/find-references-resolver.js';

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
  it('finds call, import, and local read references for Go symbols', async () => {
    const rootDir = await createProject({
      'go.mod': 'module example\\n',
      'service/helper.go': `package service\n\nfunc Helper(name string) string {\n\treturn name\n}\n`,
      'service/run.go': `package service\n\nimport \"fmt\"\n\nfunc Run(name string) string {\n\tvalue := Helper(name)\n\tfmt.Println(value)\n\treturn value\n}\n`,
    });

    const calls = await findReferences(rootDir, { path: 'service', symbol: 'Helper', language: 'go', kind: 'function' } as any);
    const reads = await findReferences(rootDir, { path: 'service/run.go', symbol: 'value', language: 'go', kind: 'variable' } as any);
    const imports = await findReferences(rootDir, { path: 'service/run.go', symbol: 'fmt', language: 'go', kind: 'variable' } as any);

    expect(calls.some((ref) => ref.reference_kind === 'call' && ref.context_symbol === 'Run')).toBe(true);
    expect(reads.some((ref) => ref.reference_kind === 'read')).toBe(true);
    expect(imports.some((ref) => ref.reference_kind === 'import')).toBe(true);
  });
});
