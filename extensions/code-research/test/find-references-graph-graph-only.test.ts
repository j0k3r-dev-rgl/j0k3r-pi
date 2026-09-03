import { describe, it, expect } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { findReferences } from '../src/core/find-references-resolver.js';
import { buildWorkspaceGraph } from '../src/core/workspace-graph.js';
import { loadWorkspaceGraphState, writeWorkspaceGraphState } from '../src/core/workspace-state.js';

async function createProject(files: Record<string, string>): Promise<string> {
  const rootDir = join(tmpdir(), `pi-find-references-graph-unavailable-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

describe('findReferences graph-only', () => {
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

  it('finds TSX component JSX usage from a prebuilt graph', async () => {
    const rootDir = await createProject({
      'src/ImageUploader.tsx': `export const ImageUploader = ({ label }: { label: string }) => {\n  return <section><span>{label}</span></section>;\n};\n`,
      'src/documentacion.tsx': `import { ImageUploader } from './ImageUploader';\n\nexport function Documentation() {\n  return <ImageUploader name="file" label="Documento" />;\n}\n`,
    });

    await buildWorkspaceGraph(rootDir);

    const results = await findReferences(rootDir, {
      path: 'src/ImageUploader.tsx',
      symbol: 'ImageUploader',
      language: 'ts',
      kind: 'function',
    });

    expect(results.some((result) => result.file === join(rootDir, 'src/documentacion.tsx'))).toBe(true);
    expect(new Set(results.map((result) => result.reference_kind))).toContain('read');
  });

  it('resolves TSX component references through barrel reexports and tsconfig aliases', async () => {
    const rootDir = await createProject({
      'tsconfig.json': `{"compilerOptions":{"baseUrl":".","paths":{"@/*":["src/*"]}}}\n`,
      'src/components/ImageUploader.tsx': `export const ImageUploader = ({ label }: { label: string }) => {\n  return <section><span>{label}</span></section>;\n};\n`,
      'src/components/index.ts': `export { ImageUploader } from './ImageUploader';\n`,
      'src/documentacion.tsx': `import { ImageUploader } from '@/components';\n\nexport function Documentation() {\n  return <ImageUploader name="file" label="Documento" />;\n}\n`,
    });

    await buildWorkspaceGraph(rootDir);

    const results = await findReferences(rootDir, {
      path: 'src/components/ImageUploader.tsx',
      symbol: 'ImageUploader',
      language: 'ts',
      kind: 'function',
    });

    expect(results.some((result) => result.file === join(rootDir, 'src/documentacion.tsx') && result.reference_kind === 'read')).toBe(true);
  });

  it('resolves default-exported TSX components imported with local names', async () => {
    const rootDir = await createProject({
      'src/ImageUploader.tsx': `const ImageUploader = ({ label }: { label: string }) => {\n  return <section><span>{label}</span></section>;\n};\n\nexport default ImageUploader;\n`,
      'src/documentacion.tsx': `import Uploader from './ImageUploader';\n\nexport function Documentation() {\n  return <Uploader name="file" label="Documento" />;\n}\n`,
    });

    await buildWorkspaceGraph(rootDir);

    const results = await findReferences(rootDir, {
      path: 'src/ImageUploader.tsx',
      symbol: 'ImageUploader',
      language: 'ts',
      kind: 'function',
    });

    expect(results.some((result) => result.file === join(rootDir, 'src/documentacion.tsx') && result.reference_kind === 'read')).toBe(true);
  });

  it('uses graph-backed generic TypeScript type-alias references after consumer source removal', async () => {
    const rootDir = await createProject({
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'src/alias.ts': `export type GenericStatusAlias = 'draft' | 'ready';\n`,
      'src/consumer.ts': `import type { GenericStatusAlias } from './alias';\n\nconst current: GenericStatusAlias = 'draft';\nconst asserted = 'ready' as GenericStatusAlias;\n`,
    });

    await buildWorkspaceGraph(rootDir);
    await rm(join(rootDir, 'src/consumer.ts'));

    const results = await findReferences(rootDir, {
      path: 'src/alias.ts',
      symbol: 'GenericStatusAlias',
      language: 'ts',
      kind: 'variable',
      
    });

    expect(results.some((item) => item.reference_kind === 'import' && item.file.endsWith('consumer.ts'))).toBe(true);
    expect(results.filter((item) => item.reference_kind === 'read').map((item) => `${item.line}:${item.column}`).sort()).toEqual(['3:15', '4:28']);
    expect(results.every((item) => item.file.endsWith('consumer.ts'))).toBe(true);
  });

  it('uses graph-backed TS/JS value, member, and callback-passed function read references', async () => {
    const rootDir = await createProject({
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'src/constants.ts': `export const CROP_PRESETS = { square: 1, wide: 2 } as const;\n`,
      'src/status.mjs': `export const STATUS = { SIN_LOCATION: 'sin-location', OK: 'ok' };\nexport const REVIEWABLE_STATUSES = [STATUS.OK];\nexport function buildSheetData(group) { return { autoFilterRef: 'A3:C10' }; }\nexport function toRingPoints(points) { return points; }\nexport function reconcile(groups, coordinates) {\n  const value = STATUS.SIN_LOCATION;\n  const allowed = REVIEWABLE_STATUSES.includes(value);\n  const rows = groups.map(buildSheetData);\n  const sheet = rows[0];\n  const filter = sheet.autoFilterRef;\n  const rings = coordinates.map(toRingPoints);\n  return { allowed, filter, rows, rings };\n}\n`,
      'src/graphql.ts': `export function fetchToGraphql<T>(query: string): T { return {} as T; }\nexport function loadCount() { return fetchToGraphql<number>('query'); }\n`,
      'src/ImageUploader.tsx': `import { CROP_PRESETS } from './constants';\n\nexport function ImageUploader() {\n  const presets = Object.values(CROP_PRESETS);\n  return <button>{CROP_PRESETS.square + presets.length}</button>;\n}\n`,
    });

    await buildWorkspaceGraph(rootDir);

    const cropRefs = await findReferences(rootDir, {
      path: 'src/constants.ts',
      symbol: 'CROP_PRESETS',
      language: 'ts',
      kind: 'variable',
      reference_kinds: ['read'],
    });
    expect(cropRefs.map((item) => item.line).sort()).toEqual([4, 5]);

    const statusRefs = await findReferences(rootDir, {
      path: 'src/status.mjs',
      symbol: 'STATUS',
      language: 'js',
      kind: 'variable',
      reference_kinds: ['read'],
    });
    expect(statusRefs.map((item) => item.line).sort()).toEqual([2, 6]);

    const memberRefs = await findReferences(rootDir, {
      path: 'src/status.mjs',
      symbol: 'SIN_LOCATION',
      language: 'js',
      kind: 'variable',
      reference_kinds: ['read'],
    });
    expect(memberRefs.map((item) => item.called_as)).toEqual(['STATUS.SIN_LOCATION']);

    const reviewableRefs = await findReferences(rootDir, {
      path: 'src/status.mjs',
      symbol: 'REVIEWABLE_STATUSES',
      language: 'js',
      kind: 'variable',
      reference_kinds: ['read'],
    });
    expect(reviewableRefs.map((item) => item.line)).toEqual([7]);

    const callbackRefs = await findReferences(rootDir, {
      path: 'src/status.mjs',
      symbol: 'buildSheetData',
      language: 'js',
      kind: 'function',
      reference_kinds: ['read'],
    });
    expect(callbackRefs.map((item) => item.called_as)).toEqual(['buildSheetData']);

    const ringRefs = await findReferences(rootDir, {
      path: 'src/status.mjs',
      symbol: 'toRingPoints',
      language: 'js',
      kind: 'function',
      reference_kinds: ['read'],
    });
    expect(ringRefs.map((item) => item.called_as)).toEqual(['toRingPoints']);

    const genericCallRefs = await findReferences(rootDir, {
      path: 'src/graphql.ts',
      symbol: 'fetchToGraphql',
      language: 'ts',
      kind: 'function',
      reference_kinds: ['call'],
    });
    expect(genericCallRefs.map((item) => item.called_as)).toEqual(["fetchToGraphql<number>('query')"]);

    const propertyReadRefs = await findReferences(rootDir, {
      path: 'src/status.mjs',
      symbol: 'autoFilterRef',
      language: 'js',
      kind: 'variable',
      reference_kinds: ['read'],
    });
    expect(propertyReadRefs.map((item) => item.called_as)).toEqual(['sheet.autoFilterRef']);
  });

  it('exposes graph-backed external/library call references by external method name', async () => {
    const rootDir = await createProject({
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'src/report.mjs': `export function writeReport(workbook, rows) {\n  rows.map((row) => row.id);\n  workbook.xlsx.writeFile('report.xlsx');\n  workbook.close();\n}\n`,
    });

    await buildWorkspaceGraph(rootDir);

    const writeFileRefs = await findReferences(rootDir, {
      path: 'src',
      symbol: 'writeFile',
      language: 'js',
      kind: 'method',
      reference_kinds: ['call'],
    });
    expect(writeFileRefs.map((item) => `${item.file.replace(rootDir + '/', '')}:${item.line}:${item.called_as}`)).toEqual([
      "src/report.mjs:3:workbook.xlsx.writeFile('report.xlsx')",
    ]);

    const closeRefs = await findReferences(rootDir, {
      path: 'src',
      symbol: 'close',
      language: 'js',
      kind: 'method',
      reference_kinds: ['call'],
    });
    expect(closeRefs.map((item) => item.called_as)).toEqual(['workbook.close()']);
  });

  it('resolves class references through typed DI object property aliases', async () => {
    const rootDir = await createProject({
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'src/publisher.ts': `export class BackNotificationPublisher { constructor(url: string) { void url; } }\n`,
      'src/main.ts': `import { BackNotificationPublisher as DefaultBackNotificationPublisher } from './publisher';\n\ntype PublisherCtor = new (url: string) => BackNotificationPublisher;\ntype MainDeps = { BackNotificationPublisher: PublisherCtor };\nconst defaultDeps: MainDeps = { BackNotificationPublisher: DefaultBackNotificationPublisher };\nexport function start(deps: MainDeps = defaultDeps) {\n  return new deps.BackNotificationPublisher('http://localhost');\n}\n`,
    });

    await buildWorkspaceGraph(rootDir);

    const results = await findReferences(rootDir, {
      path: 'src/publisher.ts',
      symbol: 'BackNotificationPublisher',
      language: 'ts',
      kind: 'class',
    });

    expect(results.some((item) => item.file.endsWith('src/main.ts') && item.reference_kind === 'read' && item.reason === 'typescript_property_alias_instantiate')).toBe(true);
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
    });
  });

  it('includes imported function calls from top-level test callbacks', async () => {
    const rootDir = await createProject({
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'src/form_normalization.ts': `export function shouldNormalizeInputType(input: string): boolean { return input === 'text'; }\n`,
      'src/form_normalization.test.ts': `import { shouldNormalizeInputType } from './form_normalization';\n\nit('normalizes text inputs', () => {\n  expect(shouldNormalizeInputType('text')).toBe(true);\n});\n`,
    });

    await buildWorkspaceGraph(rootDir);
    await rm(join(rootDir, 'src/form_normalization.test.ts'));

    const results = await findReferences(rootDir, {
      path: 'src/form_normalization.ts',
      symbol: 'shouldNormalizeInputType',
      language: 'ts',
      kind: 'function',
      reference_kinds: ['call'],
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      file: join(rootDir, 'src/form_normalization.test.ts'),
      line: 4,
      reference_kind: 'call',
    });
  });

  it('resolves imported function references through typed dependency-object properties', async () => {
    const rootDir = await createProject({
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'src/server.ts': `export function buildServer(options: object): object { return options; }\n`,
      'src/main.ts': `import { buildServer as defaultBuildServer } from './server';\n\ntype BuildServer = typeof defaultBuildServer;\ntype MainDeps = { buildServer: BuildServer; };\nconst defaultDeps: MainDeps = { buildServer: defaultBuildServer };\n\nexport function startSiasAi(deps: MainDeps = defaultDeps): object {\n  return deps.buildServer({});\n}\n`,
    });

    await buildWorkspaceGraph(rootDir);

    const results = await findReferences(rootDir, {
      path: 'src/server.ts',
      symbol: 'buildServer',
      language: 'ts',
      kind: 'function',
      reference_kinds: ['call'],
    });

    expect(results.some((result) => result.file === join(rootDir, 'src/main.ts') && result.line === 8 && result.called_as === 'deps.buildServer({})')).toBe(true);
  });

  it('deduplicates references from overlapping implicit root and nested subproject shards', async () => {
    const rootDir = await createProject({
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'packages/front/package.json': `{"type":"module"}\n`,
      'packages/front/src/service.ts': `export function runService(): void {}\n`,
      'packages/front/src/controller.ts': `import { runService } from './service';\n\nexport function handle(): void {\n  runService();\n}\n`,
    });

    await buildWorkspaceGraph(rootDir);

    const results = await findReferences(rootDir, {
      path: 'packages/front/src/service.ts',
      symbol: 'runService',
      language: 'ts',
      kind: 'function',
      reference_kinds: ['call'],
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ line: 4, context_symbol: 'handle', reference_kind: 'call' });
  });

  it('keeps graph-backed unfiltered TypeScript function references on occurrence lines after target source removal', async () => {
    const rootDir = await createProject({
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'src/actions.ts': `export function chooseDestination(role: string): string { return role; }\nexport function collectModules(modules: string[]): string[] { return modules; }\n`,
      'src/consumer.ts': `import { chooseDestination, collectModules } from './actions.js';\n\nexport function loader(role: string): string {\n  const route = chooseDestination(role);\n  return redirect(route);\n}\n\nexport function configure(): void {\n  const modules = collectModules(['reviews']);\n  modules.forEach((moduleName) => {\n    console.log(moduleName);\n  });\n}\n\ndeclare function redirect(route: string): string;\n`,
    });

    await buildWorkspaceGraph(rootDir);
    await rm(join(rootDir, 'src/actions.ts'));

    const routeRefs = await findReferences(rootDir, {
      path: 'src/actions.ts',
      symbol: 'chooseDestination',
      language: 'ts',
      kind: 'function',
      
    });
    const moduleRefs = await findReferences(rootDir, {
      path: 'src/actions.ts',
      symbol: 'collectModules',
      language: 'ts',
      kind: 'function',
      
    });
    const routeCallRefs = await findReferences(rootDir, {
      path: 'src/actions.ts',
      symbol: 'chooseDestination',
      language: 'ts',
      kind: 'function',
      reference_kinds: ['call'],
      
    });

    expect(routeRefs.map((item) => `${item.reference_kind}:${item.line}:${item.context_symbol}`).sort()).toEqual([
      'call:4:loader',
    ]);
    expect(moduleRefs.map((item) => `${item.reference_kind}:${item.line}:${item.context_symbol}`).sort()).toEqual([
      'call:9:configure',
    ]);
    expect(routeCallRefs).toHaveLength(1);
    expect(routeCallRefs[0]).toMatchObject({ line: 4, reference_kind: 'call', context_symbol: 'loader' });
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

  it('uses graph-backed optional-chained TypeScript method call references after target source removal', async () => {
    const rootDir = await createProject({
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'src/repository.ts': `export class Repository {\n  save(input: object): Promise<void> { void input; return Promise.resolve(); }\n}\n`,
      'src/processor.ts': `import { Repository } from './repository';\nexport class Processor {\n  constructor(private repo?: Repository) {}\n  async persist(repo: Repository): Promise<void> {\n    await this.repo?.save({ source: 'field' });\n    await repo?.save({ source: 'param' });\n    await repo.save({ source: 'normal' });\n    await repo.save?.({ source: 'optional-call' });\n  }\n}\n`,
    });

    await buildWorkspaceGraph(rootDir);
    await rm(join(rootDir, 'src/repository.ts'));

    const results = await findReferences(rootDir, {
      path: 'src/repository.ts',
      symbol: 'save',
      language: 'ts',
      kind: 'method',
      reference_kinds: ['call'],
      
    });

    expect(results.map((item) => item.called_as).sort()).toEqual([
      "repo.save({ source: 'normal' })",
      "repo.save?.({ source: 'optional-call' })",
      "repo?.save({ source: 'param' })",
      "this.repo?.save({ source: 'field' })",
    ]);
    expect(results.every((item) => item.reference_kind === 'call')).toBe(true);
    expect(results.map((item) => item.line).sort()).toEqual([5, 6, 7, 8]);
    expect(results.map((item) => item.file)).toEqual(results.map(() => join(rootDir, 'src/processor.ts')));
  });

  it('uses graph-backed SIAS-mapped java type reference edges for ReviewPersistenceModel, MongoIdUtils, DocumentationItemDTO, and MongoConfigs after source consumers are removed', async () => {
    const rootDir = await createProject({
      '.pi/code-research.json': `{"graph":{"enable":true}}
`,
      'pom.xml': `<project />
`,
      'src/main/java/domain/ReviewPersistenceModel.java': `package domain;

public class ReviewPersistenceModel {
  public static ReviewPersistenceModel create() { return new ReviewPersistenceModel(); }
}
`,
      'src/main/java/domain/DocumentationItemDTO.java': `package domain;

public record DocumentationItemDTO(String id) {}
`,
      'src/main/java/domain/MongoConfigs.java': `package domain;

public interface MongoConfigs {}
`,
      'src/main/java/domain/MongoIdUtils.java': `package domain;

public class MongoIdUtils {
  public static void touch() {}
}
`,
      'src/main/java/web/Controller.java': `package web;

import domain.DocumentationItemDTO;
import domain.MongoConfigs;
import domain.ReviewPersistenceModel;
import domain.MongoIdUtils;
import java.util.List;

public class Controller implements MongoConfigs {
  private final ReviewPersistenceModel current;

  public DocumentationItemDTO build(List<ReviewPersistenceModel> inputs) {
    ReviewPersistenceModel created = new ReviewPersistenceModel();
    ReviewPersistenceModel utility = ReviewPersistenceModel.create();
    MongoIdUtils.touch();
    return new DocumentationItemDTO(utility.toString());
  }
}
`,
    });

    await buildWorkspaceGraph(rootDir);
    await rm(join(rootDir, 'src/main/java/web/Controller.java'));

    const reviewPersistenceModelRefs = await findReferences(rootDir, {
      path: 'src/main/java/domain/ReviewPersistenceModel.java',
      symbol: 'ReviewPersistenceModel',
      language: 'java',
      kind: 'class',
    });

    expect(reviewPersistenceModelRefs.length, 'ReviewPersistenceModel-style model refs').toBeGreaterThan(0);
    expect(new Set(reviewPersistenceModelRefs.map((item) => item.reference_kind))).toEqual(new Set(['import', 'type_reference', 'instantiate', 'read']));
    expect(reviewPersistenceModelRefs.some((item) => item.file.endsWith('Controller.java') && item.reason === 'java_type_reference')).toBe(true);
    expect(reviewPersistenceModelRefs.some((item) => item.file.endsWith('Controller.java') && item.reason === 'java_instantiate')).toBe(true);
    expect(reviewPersistenceModelRefs.some((item) => item.file.endsWith('Controller.java') && item.reason === 'java_read' && item.called_as === 'ReviewPersistenceModel.create()')).toBe(true);

    const mongoIdUtilsRefs = await findReferences(rootDir, {
      path: 'src/main/java/domain/MongoIdUtils.java',
      symbol: 'MongoIdUtils',
      language: 'java',
      kind: 'class',
      reference_kinds: ['read'],
    });
    expect(mongoIdUtilsRefs.some((item) => item.reason === 'java_read' && item.called_as === 'MongoIdUtils.touch()'), 'MongoIdUtils-style static utility refs').toBe(true);

    const documentationItemDtoRefs = await findReferences(rootDir, {
      path: 'src/main/java/domain/DocumentationItemDTO.java',
      symbol: 'DocumentationItemDTO',
      language: 'java',
      kind: 'class',
    });
    expect(documentationItemDtoRefs.some((item) => item.reference_kind === 'instantiate' && item.reason === 'java_instantiate'), 'DocumentationItemDTO-style DTO/record refs').toBe(true);

    const mongoConfigsRefs = await findReferences(rootDir, {
      path: 'src/main/java/domain/MongoConfigs.java',
      symbol: 'MongoConfigs',
      language: 'java',
      kind: 'interface',
    });
    expect(mongoConfigsRefs.some((item) => item.reference_kind === 'implements'), 'MongoConfigs-style config/interface relationship refs').toBe(true);
  });

  it('returns no references when the graph is stale', async () => {
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

    expect(results).toEqual([]);
  });

  it('uses graph-backed Java interface method references through implementation relationship ids', async () => {
    const rootDir = await createProject({
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'src/main/java/ports/Repository.java': `package ports;\n\npublic interface Repository {\n  void markCoreDeleted(String id);\n}\n`,
      'src/main/java/app/MongoRepository.java': `package app;\n\nimport ports.Repository;\n\npublic class MongoRepository implements Repository {\n  public void markCoreDeleted(String id) {}\n}\n`,
      'src/test/java/app/InMemoryRepository.java': `package app;\n\nimport ports.Repository;\n\npublic class InMemoryRepository implements Repository {\n  public void markCoreDeleted(String id) {}\n}\n`,
      'src/main/java/app/UseCase.java': `package app;\n\nimport ports.Repository;\n\npublic class UseCase {\n  private final Repository repository;\n  public UseCase(Repository repository) { this.repository = repository; }\n  public void run() { repository.markCoreDeleted("review-1"); }\n}\n`,
      'src/test/java/app/UseCaseTest.java': `package app;\n\nimport static org.mockito.Mockito.doThrow;\nimport ports.Repository;\n\npublic class UseCaseTest {\n  private final Repository repository = null;\n  public void stubs() { doThrow(new RuntimeException()).when(repository).markCoreDeleted("review-1"); }\n}\n`,
    });

    await buildWorkspaceGraph(rootDir);

    const results = await findReferences(rootDir, {
      path: 'src/main/java/ports/Repository.java',
      symbol: 'markCoreDeleted',
      language: 'java',
      kind: 'method',
      reference_kinds: ['call'],
    });

    expect(results.map((item) => `${item.file.replace(rootDir + '/', '')}:${item.line}`).sort()).toEqual([
      'src/main/java/app/UseCase.java:8',
      'src/test/java/app/UseCaseTest.java:8',
    ]);
  });

  it('returns only graph-modeled Java interface relationship references', async () => {
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
      new Set(['implements', 'import', 'type_reference'])
    );
  });
});
