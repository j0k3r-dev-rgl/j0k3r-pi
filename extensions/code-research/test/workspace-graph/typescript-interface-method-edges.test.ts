import { describe, it, expect } from 'vitest';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildWorkspaceGraph } from '../../src/core/workspace-graph.js';
import { readWorkspaceGraphState } from '../../src/core/graph-persistence.js';

async function createProject(prefix: string, files: Record<string, string>): Promise<string> {
  const rootDir = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootDir, { recursive: true });
  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(rootDir, relativePath);
    await mkdir(join(fullPath, '..'), { recursive: true });
    await writeFile(fullPath, content, 'utf8');
  }
  return rootDir;
}

describe('TypeScript workspace graph interface method edges', () => {
  it('persists interface method relationship ids and nested typed receiver calls', async () => {
    const rootDir = await createProject('pi-ts-graph-interface-method', {
      'src/repository.ts': `export interface ReviewAnalysisRepository {\n  transitionToTerminal(id: string): Promise<void>;\n}\n`,
      'src/processor.ts': `import type { ReviewAnalysisRepository } from './repository';\n\nexport class ReviewAnalysisProcessor {\n  constructor(private readonly repository: ReviewAnalysisRepository) {}\n\n  async cancelActiveReviewAnalysis(id: string): Promise<void> {\n    await this.repository.transitionToTerminal(id);\n  }\n\n  beginTerminalTransition(id: string): void {\n    this.observe(this.repository.transitionToTerminal(id));\n  }\n\n  private observe(value: Promise<void>): void { void value; }\n}\n`,
    });

    await buildWorkspaceGraph(rootDir);
    const state = await readWorkspaceGraphState(rootDir);
    if (state.status !== 'ok') throw new Error('missing graph state');
    const subproject = state.data.subprojects[0];
    const shard = JSON.parse(await readFile(join(rootDir, '.pi/workspace-code-graph/graphs', `${subproject.id}.json`), 'utf8'));
    const symbols = shard.nodes.filter((node: any) => node.kind === 'symbol');
    const target = symbols.find((node: any) => node.qualifiedName === 'ReviewAnalysisRepository.transitionToTerminal');
    expect(target).toMatchObject({ declarationKind: 'interface_method', relationshipId: expect.any(String) });

    const edges = shard.edges.filter((edge: any) => edge.kind === 'calls' && edge.to === target.id);
    const callers = edges.map((edge: any) => symbols.find((node: any) => node.id === edge.from)?.qualifiedName).sort();
    expect(callers).toEqual(['ReviewAnalysisProcessor.beginTerminalTransition', 'ReviewAnalysisProcessor.cancelActiveReviewAnalysis']);
    expect(edges.every((edge: any) => edge.callsite.receiverType === 'ReviewAnalysisRepository')).toBe(true);
    expect(edges.every((edge: any) => edge.reason === 'receiver-type-contract-method')).toBe(true);
  });
});
