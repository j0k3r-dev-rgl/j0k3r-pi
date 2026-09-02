import { describe, it, expect } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildCodeChangeSurface } from '../src/core/code-change-surface.js';
import { registerCodeChangeSurfaceTool } from '../src/tools/code-change-surface.js';

const renderTheme = { fg: (_name: string, text: string) => text, bold: (text: string) => text };

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

function registerTool(): any {
  let tool: any;
  registerCodeChangeSurfaceTool({ registerTool(definition: any) { tool = definition; } });
  return tool;
}

describe('code_change_surface', () => {
  it('returns a bounded actionable map for an interface-mediated terminal transition', async () => {
    const rootDir = await createProject('pi-change-surface-sias', {
      'src/review-analysis-repository.ts': `export interface ReviewAnalysisRepository {\n  transitionToTerminal(id: string): Promise<void>;\n}\n\nexport class SqlReviewAnalysisRepository implements ReviewAnalysisRepository {\n  async transitionToTerminal(id: string): Promise<void> {\n    void id;\n  }\n}\n`,
      'src/review-analysis-processor.ts': `import type { ReviewAnalysisRepository } from './review-analysis-repository';\n\nexport class ReviewAnalysisProcessor {\n  constructor(private repository: ReviewAnalysisRepository) {}\n\n  async complete(id: string): Promise<void> {\n    await this.repository.transitionToTerminal(id);\n  }\n}\n`,
      'src/review-analysis-retry-processor.ts': `import type { ReviewAnalysisRepository } from './review-analysis-repository';\n\nexport class ReviewAnalysisRetryProcessor {\n  constructor(private repository: ReviewAnalysisRepository) {}\n\n  async retry(id: string): Promise<void> {\n    await this.repository.transitionToTerminal(id);\n  }\n}\n`,
      'test/review-analysis-processor.test.ts': `import { ReviewAnalysisProcessor } from '../src/review-analysis-processor';\nimport { SqlReviewAnalysisRepository } from '../src/review-analysis-repository';\n\nconst repository = new SqlReviewAnalysisRepository();\nconst processor = new ReviewAnalysisProcessor(repository);\nawait processor.complete('done');\n`,
      'test/review-analysis-retry-processor.test.ts': `import { ReviewAnalysisRetryProcessor } from '../src/review-analysis-retry-processor';\nimport { SqlReviewAnalysisRepository } from '../src/review-analysis-repository';\n\nconst repository = new SqlReviewAnalysisRepository();\nconst processor = new ReviewAnalysisRetryProcessor(repository);\nawait processor.retry('done');\n`,
    });

    const surface = await buildCodeChangeSurface(rootDir, {
      path: 'src/review-analysis-repository.ts',
      query: 'transitionToTerminal',
      language: 'ts',
      kind: 'method',
    });

    expect(surface.status).toBe('ready');
    expect(surface.contract.items[0]).toMatchObject({ symbol: 'transitionToTerminal', kind: 'method' });
    expect(surface.implementations.items.some((item: any) => item.file.endsWith('review-analysis-repository.ts'))).toBe(true);
    expect(surface.callers.items.map((item: any) => item.symbol).sort()).toEqual(['complete', 'retry']);
    expect(surface.likely_tests.items.map((item: any) => item.file).sort()).toEqual([
      expect.stringContaining('review-analysis-processor.test.ts'),
      expect.stringContaining('review-analysis-retry-processor.test.ts'),
    ]);
    expect(surface.risks).toContain('Interface-mediated or heuristic edges are present; inspect contract and concrete implementations before editing.');
    expect(surface.trust.level).toBe('medium');
    expect(surface.fallback.required).toBe(false);
    expect(surface.validation_suggestions[0]).toContain('Review likely affected test files');
  });

  it('reports concrete fallback inspection needs instead of guessing when the anchor is missing', async () => {
    const rootDir = await createProject('pi-change-surface-missing', {
      'src/service.ts': `export function run(): void {}\n`,
    });

    const surface = await buildCodeChangeSurface(rootDir, {
      path: 'src/service.ts',
      query: 'missingSymbol',
      language: 'ts',
      kind: 'function',
    });

    expect(surface.status).toBe('needs_fallback');
    expect(surface.contract.items).toEqual([]);
    expect(surface.fallback.required).toBe(true);
    expect(surface.fallback.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ tool: 'code_find', params: expect.objectContaining({ query: 'missingSymbol', relation: 'declaration' }) }),
      expect.objectContaining({ tool: 'code_find', params: expect.objectContaining({ query: 'missingSymbol', relation: 'references' }) }),
    ]));
    expect(surface.implementations.items).toEqual([]);
    expect(surface.callers.items).toEqual([]);
  });

  it('caps high-fanout sections and records exact continuation actions', async () => {
    const callers: Record<string, string> = {};
    for (let index = 0; index < 8; index += 1) {
      callers[`src/caller-${index}.ts`] = `import { target } from './target';\nexport function caller${index}(): void { target(); }\n`;
    }
    const rootDir = await createProject('pi-change-surface-fanout', {
      'src/target.ts': `export function target(): void {}\n`,
      ...callers,
    });

    const surface = await buildCodeChangeSurface(rootDir, {
      path: 'src/target.ts',
      query: 'target',
      language: 'ts',
      kind: 'function',
    });

    expect(surface.callers.items).toHaveLength(5);
    expect(surface.callers.total).toBe(8);
    expect(surface.callers.omitted).toBe(3);
    expect(surface.callers.follow_up).toMatchObject({ tool: 'code_find', params: { path: 'src/target.ts', query: 'target', relation: 'references', language: 'ts', kind: 'function' } });
    expect(surface.content).toContain('Callers to inspect: 5/8 (3 omitted)');
  });

  it('registers schema and renders compact trust plus fallback state', async () => {
    const tool = registerTool();
    expect(tool.name).toBe('code_change_surface');
    expect(JSON.stringify(tool.parameters.required)).toContain('path');
    expect(JSON.stringify(tool.parameters.required)).toContain('query');
    expect(JSON.stringify(tool.parameters)).toContain('glob');
    expect(JSON.stringify(tool.parameters)).not.toContain('py');

    const result = { content: [{ type: 'text', text: 'full content marker' }], details: { query: 'target', path: 'src/target.ts', status: 'ready', trust: { level: 'medium' }, fallback: { required: false }, summary: { contract: { returned: 1, total: 1 }, implementations: { returned: 1, total: 1 }, callers: { returned: 5, total: 8 }, likely_tests: { returned: 0, total: 0 } } } };
    const compact = tool.renderResult(result, { expanded: false, isPartial: false }, renderTheme).render(120).join('\n');
    expect(compact).toContain('code_change_surface');
    expect(compact).toContain('trust=medium');
    expect(compact).toContain('fallback=no');
    expect(compact).toContain('callers 5/8');
    expect(compact).not.toContain('full content marker');
  });
});
