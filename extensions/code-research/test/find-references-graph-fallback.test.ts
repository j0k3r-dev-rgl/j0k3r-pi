import { describe, it, expect } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { findReferences } from '../src/core/find-references-resolver.js';
import { buildWorkspaceGraph } from '../src/core/workspace-graph.js';
import { loadWorkspaceGraphState, writeWorkspaceGraphState } from '../src/core/workspace-state.js';

async function createProject(files: Record<string, string>): Promise<string> {
  const rootDir = join(tmpdir(), `pi-find-references-graph-fallback-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootDir, { recursive: true });

  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(rootDir, relativePath);
    await mkdir(join(fullPath, '..'), { recursive: true });
    await writeFile(fullPath, content, 'utf8');
  }

  return rootDir;
}

describe('findReferences graph fallback', () => {
  it('uses graph-backed TSX JSX read references when requested explicitly', async () => {
    const rootDir = await createProject({
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'src/ImageUploader.tsx': `export const ImageUploader = ({ label }: { label: string }) => {\n  return <section><span>{label}</span></section>;\n};\n`,
      'src/documentacion.tsx': `import { ImageUploader } from './ImageUploader';\n\nexport function Documentation() {\n  return <ImageUploader name="file" label="Documento" />;\n}\n`,
    });

    await buildWorkspaceGraph(rootDir);
    await rm(join(rootDir, 'src/documentacion.tsx'));

    const results = await findReferences(rootDir, {
      path: 'src/ImageUploader.tsx',
      symbol: 'ImageUploader',
      language: 'ts',
      kind: 'function',
      reference_kinds: ['read'],
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      file: join(rootDir, 'src/documentacion.tsx'),
      symbol: 'ImageUploader',
      context_symbol: 'Documentation',
      reference_kind: 'read',
    });
  });

  it('finds TSX component JSX usage with direct fallback when no graph exists', async () => {
    const rootDir = await createProject({
      'src/ImageUploader.tsx': `export const ImageUploader = ({ label }: { label: string }) => {\n  return <section><span>{label}</span></section>;\n};\n`,
      'src/documentacion.tsx': `import { ImageUploader } from './ImageUploader';\n\nexport function Documentation() {\n  return <ImageUploader name="file" label="Documento" />;\n}\n`,
    });

    const results = await findReferences(rootDir, {
      path: 'src/ImageUploader.tsx',
      symbol: 'ImageUploader',
      language: 'ts',
      kind: 'function',
    });

    expect(results.some((result) => result.file === join(rootDir, 'src/documentacion.tsx'))).toBe(true);
    expect(new Set(results.map((result) => result.reference_kind))).toContain('import');
    expect(new Set(results.map((result) => result.reference_kind))).toContain('read');
  });

  it('resolves TSX component references through barrel reexports and tsconfig aliases', async () => {
    const rootDir = await createProject({
      'tsconfig.json': `{"compilerOptions":{"baseUrl":".","paths":{"@/*":["src/*"]}}}\n`,
      'src/components/ImageUploader.tsx': `export const ImageUploader = ({ label }: { label: string }) => {\n  return <section><span>{label}</span></section>;\n};\n`,
      'src/components/index.ts': `export { ImageUploader } from './ImageUploader';\n`,
      'src/documentacion.tsx': `import { ImageUploader } from '@/components';\n\nexport function Documentation() {\n  return <ImageUploader name="file" label="Documento" />;\n}\n`,
    });

    const results = await findReferences(rootDir, {
      path: 'src/components/ImageUploader.tsx',
      symbol: 'ImageUploader',
      language: 'ts',
      kind: 'function',
    });

    expect(results.some((result) => result.file === join(rootDir, 'src/documentacion.tsx') && result.reference_kind === 'read')).toBe(true);
    expect(results.some((result) => result.file === join(rootDir, 'src/documentacion.tsx') && result.reference_kind === 'import')).toBe(true);
  });

  it('resolves default-exported TSX components imported with local names', async () => {
    const rootDir = await createProject({
      'src/ImageUploader.tsx': `const ImageUploader = ({ label }: { label: string }) => {\n  return <section><span>{label}</span></section>;\n};\n\nexport default ImageUploader;\n`,
      'src/documentacion.tsx': `import Uploader from './ImageUploader';\n\nexport function Documentation() {\n  return <Uploader name="file" label="Documento" />;\n}\n`,
    });

    const results = await findReferences(rootDir, {
      path: 'src/ImageUploader.tsx',
      symbol: 'ImageUploader',
      language: 'ts',
      kind: 'function',
    });

    expect(results.some((result) => result.file === join(rootDir, 'src/documentacion.tsx') && result.reference_kind === 'read')).toBe(true);
    expect(results.some((result) => result.file === join(rootDir, 'src/documentacion.tsx') && result.reference_kind === 'import')).toBe(true);
  });

  it('uses graph-backed direct call references when requested explicitly', async () => {
    const rootDir = await createProject({
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'src/service.ts': `export function runService(): void {}\n`,
      'src/controller.ts': `import { runService } from './service.js';\n\nexport function handle(): void {\n  runService();\n}\n`,
    });

    await buildWorkspaceGraph(rootDir);
    await rm(join(rootDir, 'src/service.ts'));

    const results = await findReferences(rootDir, {
      path: 'src/service.ts',
      symbol: 'runService',
      language: 'ts',
      kind: 'function',
      reference_kinds: ['call'],
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      file: join(rootDir, 'src/controller.ts'),
      line: 4,
      column: 2,
      context_symbol: 'handle',
      reference_kind: 'call',
      called_as: 'runService()',
    });
  });

  it('uses graph-backed direct call references for directory-scoped targets', async () => {
    const rootDir = await createProject({
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'src/service.ts': `export function runService(): void {}\n`,
      'src/controller.ts': `import { runService } from './service.js';\n\nexport function handle(): void {\n  runService();\n}\n`,
    });

    await buildWorkspaceGraph(rootDir);
    await rm(join(rootDir, 'src/service.ts'));

    const results = await findReferences(rootDir, {
      path: 'src',
      symbol: 'runService',
      language: 'ts',
      kind: 'function',
      reference_kinds: ['call'],
    });

    expect(results).toHaveLength(1);
    expect(results[0].called_as).toBe('runService()');
    expect(results[0].context_symbol).toBe('handle');
  });

  it('falls back to direct lookup when the graph is stale', async () => {
    const rootDir = await createProject({
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'src/service.ts': `export function oldHelper(): void {}\nexport function useOld(): void { oldHelper(); }\n`,
    });

    await buildWorkspaceGraph(rootDir);
    await writeFile(
      join(rootDir, 'src/service.ts'),
      `export function freshHelper(): void {}\nexport function useFresh(): void { freshHelper(); }\n`,
      'utf8'
    );

    const state = await loadWorkspaceGraphState(rootDir);
    expect(state.status).toBe('ok');
    if (state.status !== 'ok') return;
    await writeWorkspaceGraphState(rootDir, { ...state.data, status: 'stale' });

    const results = await findReferences(rootDir, {
      path: 'src/service.ts',
      symbol: 'freshHelper',
      language: 'ts',
      kind: 'function',
    });

    expect(results).toHaveLength(1);
    expect(results[0].context_symbol).toBe('useFresh');
    expect(results[0].reference_kind).toBe('call');
  });

  it('falls back to direct lookup for normal public calls because graph coverage is incomplete', async () => {
    const rootDir = await createProject({
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'src/main/java/ports/Service.java': `package ports;\n\npublic interface Service {}\n`,
      'src/main/java/app/AppService.java': `package app;\n\nimport ports.Service;\n\npublic class AppService implements Service {}\n`,
      'src/main/java/ports/ExtendedService.java': `package ports;\n\npublic interface ExtendedService extends Service {}\n`,
      'src/main/java/web/Controller.java': `package web;\n\nimport ports.Service;\n\npublic class Controller {\n  private final Service service;\n\n  public Controller(Service service) {\n    this.service = service;\n  }\n}\n`,
    });

    await buildWorkspaceGraph(rootDir);

    const results = await findReferences(rootDir, {
      path: 'src/main/java/ports/Service.java',
      symbol: 'Service',
      language: 'java',
      kind: 'interface',
    });

    expect(new Set(results.map((item) => item.reference_kind))).toEqual(
      new Set(['extends', 'implements', 'import', 'type_reference'])
    );
  });
});
