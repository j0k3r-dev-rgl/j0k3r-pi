import { describe, it, expect } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildCodeChangeSurface } from '../src/core/code-change-surface.js';
import { buildWorkspaceGraph } from '../src/core/workspace-graph.js';
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
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'src/review-analysis-repository.ts': `export interface ReviewAnalysisRepository {\n  transitionToTerminal(id: string): Promise<void>;\n}\n\nexport class SqlReviewAnalysisRepository implements ReviewAnalysisRepository {\n  async transitionToTerminal(id: string): Promise<void> {\n    void id;\n  }\n}\n`,
      'src/review-analysis-processor.ts': `import type { ReviewAnalysisRepository } from './review-analysis-repository';\n\nexport class ReviewAnalysisProcessor {\n  constructor(private repository: ReviewAnalysisRepository) {}\n\n  async complete(id: string): Promise<void> {\n    await this.repository.transitionToTerminal(id);\n  }\n}\n`,
      'src/review-analysis-retry-processor.ts': `import type { ReviewAnalysisRepository } from './review-analysis-repository';\n\nexport class ReviewAnalysisRetryProcessor {\n  constructor(private repository: ReviewAnalysisRepository) {}\n\n  async retry(id: string): Promise<void> {\n    await this.repository.transitionToTerminal(id);\n  }\n}\n`,
      'test/review-analysis-processor.test.ts': `import { ReviewAnalysisProcessor } from '../src/review-analysis-processor';\nimport { SqlReviewAnalysisRepository } from '../src/review-analysis-repository';\n\nit('completes review analysis', async () => {\n  const repository = new SqlReviewAnalysisRepository();\n  const processor = new ReviewAnalysisProcessor(repository);\n  await processor.complete('done');\n});\n`,
      'test/review-analysis-retry-processor.test.ts': `import { ReviewAnalysisRetryProcessor } from '../src/review-analysis-retry-processor';\nimport { SqlReviewAnalysisRepository } from '../src/review-analysis-repository';\n\nconst repository = new SqlReviewAnalysisRepository();\nconst processor = new ReviewAnalysisRetryProcessor(repository);\nawait processor.retry('done');\n`,
      'test/sql-review-analysis-repository.test.ts': `import { SqlReviewAnalysisRepository } from '../src/review-analysis-repository';\n\nconst repository = new SqlReviewAnalysisRepository();\nawait repository.transitionToTerminal('done');\n`,
    });
    await buildWorkspaceGraph(rootDir);

    const surface = await buildCodeChangeSurface(rootDir, {
      path: 'src/review-analysis-repository.ts',
      query: 'transitionToTerminal',
      language: 'ts',
      kind: 'method',
    });

    expect(surface.status).toBe('ready');
    expect(surface.contract.items[0]).toMatchObject({ symbol: 'transitionToTerminal', kind: 'method' });
    expect(surface.implementations.items.some((item: any) => item.qualified_name === 'SqlReviewAnalysisRepository.transitionToTerminal')).toBe(true);
    expect(surface.callers.items.map((item: any) => item.symbol).sort()).toEqual(['complete', 'retry']);
    expect(new Set(surface.callers.items.map((item: any) => `${item.file}:${item.symbol}:${item.call_line}`)).size).toBe(surface.callers.items.length);
    expect(surface.likely_tests.items.find((item: any) => item.file.includes('review-analysis-processor.test.ts'))).toMatchObject({ line: 7, context_symbol: 'completes review analysis' });
    expect(surface.likely_tests.items.map((item: any) => item.file).sort()).toEqual([
      expect.stringContaining('review-analysis-processor.test.ts'),
      expect.stringContaining('review-analysis-retry-processor.test.ts'),
      expect.stringContaining('sql-review-analysis-repository.test.ts'),
    ]);
    expect(surface.risks).toContain('Interface-mediated or heuristic edges are present; inspect contract and concrete implementations before editing.');
    expect(surface.trust.level).toBe('medium');
    expect(surface.fallback.required).toBe(false);
    expect(surface.validation_suggestions[0]).toContain('Review likely affected test files');
  });

  it('reports representative likely tests when multiple Java test call sites map to the same file', async () => {
    const rootDir = await createProject('pi-change-surface-java-representative-tests', {
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'src/main/java/app/RootDeleteReview.java': `package app;\npublic interface RootDeleteReview { void deleteById(String id); }\n`,
      'src/main/java/app/RootDeleteReviewUseCase.java': `package app;\npublic class RootDeleteReviewUseCase implements RootDeleteReview { public void deleteById(String id) {} }\n`,
      'src/main/java/app/RootReviewRestController.java': `package app;\npublic class RootReviewRestController { private final RootDeleteReview rootDeleteReview; public RootReviewRestController(RootDeleteReview rootDeleteReview) { this.rootDeleteReview = rootDeleteReview; } public void deleteReview(String id) { rootDeleteReview.deleteById(id); } }\n`,
      'src/test/java/app/RootDeleteReviewUseCaseTest.java': `package app;\nclass RootDeleteReviewUseCaseTest { void first() { new RootDeleteReviewUseCase().deleteById("1"); } void second() { new RootDeleteReviewUseCase().deleteById("2"); } }\n`,
    });
    await buildWorkspaceGraph(rootDir);

    const surface = await buildCodeChangeSurface(rootDir, {
      path: 'src/main/java/app/RootDeleteReviewUseCase.java',
      query: 'deleteById',
      language: 'java',
      kind: 'method',
    });

    expect(surface.test_reporting.mode).toBe('representative');
    expect(surface.test_reporting.evidence_total).toBeGreaterThan(surface.test_reporting.files_total ?? 0);
    expect(surface.content).toContain('Test reporting: representative');
  });

  it('deduplicates Java interface-mediated callers and validation suggestions', async () => {
    const rootDir = await createProject('pi-change-surface-java-dedupe', {
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'src/main/java/app/RootDeleteReview.java': `package app;\npublic interface RootDeleteReview { void deleteById(String id); }\n`,
      'src/main/java/app/RootDeleteReviewUseCase.java': `package app;\npublic class RootDeleteReviewUseCase implements RootDeleteReview { public void deleteById(String id) {} }\n`,
      'src/main/java/app/RootReviewRestController.java': `package app;\npublic class RootReviewRestController { private final RootDeleteReview rootDeleteReview; public RootReviewRestController(RootDeleteReview rootDeleteReview) { this.rootDeleteReview = rootDeleteReview; } public void deleteReview(String id) { rootDeleteReview.deleteById(id); } }\n`,
      'src/test/java/app/RootDeleteReviewUseCaseTest.java': `package app;\nclass RootDeleteReviewUseCaseTest { void testDelete() { new RootDeleteReviewUseCase().deleteById("1"); } }\n`,
      'src/test/java/app/RootReviewRestControllerTest.java': `package app;\nclass RootReviewRestControllerTest { void testRoute() { new RootReviewRestController(new RootDeleteReviewUseCase()).deleteReview("1"); } }\n`,
    });
    await buildWorkspaceGraph(rootDir);

    const surface = await buildCodeChangeSurface(rootDir, {
      path: 'src/main/java/app/RootDeleteReviewUseCase.java',
      query: 'deleteById',
      language: 'java',
      kind: 'method',
    });

    expect(surface.callers.items.map((item: any) => `${item.class}.${item.symbol}`)).toEqual(['RootReviewRestController.deleteReview']);
    expect(surface.validation_suggestions.filter((item) => item.includes('RootReviewRestController.java'))).toHaveLength(1);
    expect(surface.likely_tests.items.map((item: any) => item.file).sort()).toEqual([
      expect.stringContaining('RootDeleteReviewUseCaseTest.java'),
      expect.stringContaining('RootReviewRestControllerTest.java'),
    ]);
  });

  it('expands Java interface methods to implementations, callers, and tests', async () => {
    const rootDir = await createProject('pi-change-surface-java-interface', {
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'src/main/java/app/RootDeleteReview.java': `package app;\npublic interface RootDeleteReview { void deleteById(String id); }\n`,
      'src/main/java/app/RootDeleteReviewUseCase.java': `package app;\npublic class RootDeleteReviewUseCase implements RootDeleteReview { public void deleteById(String id) {} }\n`,
      'src/main/java/app/RootReviewRestController.java': `package app;\npublic class RootReviewRestController { private final RootDeleteReview rootDeleteReview; public RootReviewRestController(RootDeleteReview rootDeleteReview) { this.rootDeleteReview = rootDeleteReview; } public void deleteReview(String id) { rootDeleteReview.deleteById(id); } }\n`,
      'src/test/java/app/RootDeleteReviewUseCaseTest.java': `package app;\nclass RootDeleteReviewUseCaseTest { void testDelete() { new RootDeleteReviewUseCase().deleteById("1"); } }\n`,
      'src/test/java/app/RootReviewRestControllerTest.java': `package app;\nclass RootReviewRestControllerTest { void testRoute() { new RootReviewRestController(new RootDeleteReviewUseCase()).deleteReview("1"); } }\n`,
    });
    await buildWorkspaceGraph(rootDir);

    const surface = await buildCodeChangeSurface(rootDir, {
      path: 'src/main/java/app/RootDeleteReview.java',
      query: 'deleteById',
      language: 'java',
      kind: 'method',
    });

    expect(surface.implementations.items.map((item: any) => item.qualified_name)).toEqual(['app.RootDeleteReviewUseCase.deleteById']);
    expect(surface.callers.items.map((item: any) => `${item.class}.${item.symbol}`)).toEqual(['RootReviewRestController.deleteReview']);
    expect(surface.likely_tests.items.map((item: any) => item.file).sort()).toEqual([
      expect.stringContaining('RootDeleteReviewUseCaseTest.java'),
      expect.stringContaining('RootReviewRestControllerTest.java'),
    ]);
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
    expect(surface.caller_reporting.mode).toBe('representative');
    expect(surface.callers.follow_up).toMatchObject({ tool: 'code_find', params: { path: 'src/target.ts', query: 'target', relation: 'references', language: 'ts', kind: 'function' } });
    expect(surface.content).toContain('Callers to inspect: 5/8 (3 omitted)');
  });

  it('returns exhaustive callers up to max_callers', async () => {
    const callers: Record<string, string> = {};
    for (let index = 0; index < 8; index += 1) {
      callers[`src/caller-${index}.ts`] = `import { target } from './target';\nexport function caller${index}(): void { target(); }\n`;
    }
    const rootDir = await createProject('pi-change-surface-exhaustive-callers', {
      'src/target.ts': `export function target(): void {}\n`,
      ...callers,
    });

    const surface = await buildCodeChangeSurface(rootDir, {
      path: 'src/target.ts',
      query: 'target',
      language: 'ts',
      kind: 'function',
      caller_mode: 'exhaustive',
      max_callers: 20,
    });

    expect(surface.callers.items).toHaveLength(8);
    expect(surface.callers.omitted).toBe(0);
    expect(surface.caller_reporting.mode).toBe('exhaustive');
    expect(surface.content).toContain('Caller reporting: exhaustive');
  });

  it('returns exhaustive test evidence up to max_tests', async () => {
    const rootDir = await createProject('pi-change-surface-exhaustive-tests', {
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'src/service.ts': `export function target(): void {}\n`,
      'test/service-a.test.ts': `import { target } from '../src/service';\nit('first', () => { target(); });\n`,
      'test/service-b.test.ts': `import { target } from '../src/service';\nit('second', () => { target(); });\n`,
    });
    await buildWorkspaceGraph(rootDir);

    const surface = await buildCodeChangeSurface(rootDir, {
      path: 'src/service.ts',
      query: 'target',
      language: 'ts',
      kind: 'function',
      test_mode: 'exhaustive',
      max_tests: 20,
    });

    expect(surface.test_reporting.mode).toBe('exhaustive');
    expect(surface.likely_tests.items.map((item: any) => item.context_symbol).sort()).toEqual(['first', 'second']);
    expect(surface.content).toContain('Test reporting: exhaustive');
  });

  it('registers schema and renders compact trust plus fallback state', async () => {
    const tool = registerTool();
    expect(tool.name).toBe('code_change_surface');
    expect(JSON.stringify(tool.parameters.required)).toContain('path');
    expect(JSON.stringify(tool.parameters.required)).toContain('query');
    expect(JSON.stringify(tool.parameters)).toContain('glob');
    expect(JSON.stringify(tool.parameters)).toContain('test_mode');
    expect(JSON.stringify(tool.parameters)).toContain('caller_mode');
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
