import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { extractTypeScriptSymbols } from '../src/languages/typescript/symbol-extractor.js';
import { findSymbol, resolveFindSymbol } from '../src/core/find-symbol-resolver.js';
import { getSubprojectShardPath } from '../src/core/graph-persistence.js';
import { loadWorkspaceGraphState, writeWorkspaceGraphState } from '../src/core/workspace-state.js';
import { normalizeSymbolResults } from './helpers/typescript-symbol-parity.js';
import { buildWorkspaceGraph } from '../src/core/workspace-graph.js';
import { TYPESCRIPT_SYMBOL_CASES } from './fixtures/typescript-symbol-cases.js';

function normalized(records: ReturnType<typeof extractTypeScriptSymbols>) {
  return records.map((record) => ({ name: record.name, declarationKind: record.declarationKind, owner: record.owner, implementation: record.isImplementation }));
}

describe('TypeScript symbol syntax and graph parity', () => {
  for (const fixture of TYPESCRIPT_SYMBOL_CASES) {
    it(`extracts ${fixture.id}`, () => {
      const records = normalized(extractTypeScriptSymbols(fixture.file, fixture.source));
      for (const expected of fixture.expected) expect(records).toContainEqual(expect.objectContaining(expected));
    });
  }

  it('keeps every syntax fixture aligned across direct, fresh, stale, partial, and corrupt modes', async () => {
    for (const fixture of TYPESCRIPT_SYMBOL_CASES) {
      const root = await mkdtemp(join(tmpdir(), `pi-ts-symbol-modes-${fixture.id}-`));
      await mkdir(join(root, '.pi'), { recursive: true });
      const file = join(root, fixture.file);
      await writeFile(file, fixture.source);

      await writeFile(join(root, '.pi/code-research.json'), '{"graph":{"enable":false}}\n');
      const direct = await findSymbol(root, { path: file, symbol: '', language: 'ts', search_mode: 'contains' });

      await writeFile(join(root, '.pi/code-research.json'), '{"graph":{"enable":true}}\n');
      await buildWorkspaceGraph(root);
      const fresh = await resolveFindSymbol(root, { path: file, symbol: '', language: 'ts', search_mode: 'contains' });
      expect(normalizeSymbolResults(fresh.results)).toEqual(normalizeSymbolResults(direct));
      expect(fresh.diagnostics).toMatchObject({ source_mode: 'graph', graph_status: 'fresh', completeness: 'complete' });

      const state = await loadWorkspaceGraphState(root);
      expect(state.status).toBe('ok');
      if (state.status !== 'ok') continue;

      await writeWorkspaceGraphState(root, { ...state.data, status: 'stale' });
      const stale = await resolveFindSymbol(root, { path: file, symbol: '', language: 'ts', search_mode: 'contains' });
      expect(normalizeSymbolResults(stale.results)).toEqual(normalizeSymbolResults(direct));
      expect(stale.diagnostics).toMatchObject({ graph_status: 'stale', completeness: 'fallback' });

      await buildWorkspaceGraph(root);
      const freshState = await loadWorkspaceGraphState(root);
      expect(freshState.status).toBe('ok');
      if (freshState.status !== 'ok') continue;
      await writeWorkspaceGraphState(root, { ...freshState.data, status: 'partial' });
      const partial = await resolveFindSymbol(root, { path: file, symbol: '', language: 'ts', search_mode: 'contains' });
      expect(normalizeSymbolResults(partial.results)).toEqual(normalizeSymbolResults(direct));
      expect(partial.diagnostics).toMatchObject({ graph_status: 'partial', completeness: 'fallback' });

      await buildWorkspaceGraph(root);
      const rebuilt = await loadWorkspaceGraphState(root);
      expect(rebuilt.status).toBe('ok');
      if (rebuilt.status !== 'ok') continue;
      const shardPath = getSubprojectShardPath(root, rebuilt.data.subprojects[0].id);
      await writeFile(shardPath, '{corrupt', 'utf8');
      const corrupt = await resolveFindSymbol(root, { path: file, symbol: '', language: 'ts', search_mode: 'contains' });
      expect(normalizeSymbolResults(corrupt.results)).toEqual(normalizeSymbolResults(direct));
      expect(corrupt.diagnostics).toMatchObject({ graph_status: 'error', completeness: 'fallback', fallback_reason: 'shard_corrupt' });
    }
  });

  it('keeps direct and fresh-graph normalized results identical and ordered', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-ts-symbol-parity-'));
    await mkdir(join(root, '.pi'), { recursive: true });
    await writeFile(join(root, '.pi/code-research.json'), '{"graph":{"enable":false}}\n');
    const file = join(root, 'matrix.ts');
    await writeFile(file, TYPESCRIPT_SYMBOL_CASES.map((fixture) => fixture.source).join('\n'));
    const input = { path: file, symbol: '', language: 'ts' as const, search_mode: 'contains' as const };
    const direct = await findSymbol(root, input);
    await writeFile(join(root, '.pi/code-research.json'), '{"graph":{"enable":true}}\n');
    await buildWorkspaceGraph(root);
    const graph = await findSymbol(root, input);
    const pick = (values: typeof direct) => values.map(({ symbol, kind, declaration_kind, owner, qualified_name, start_line, start_column, is_definition, is_implementation }) => ({ symbol, kind, declaration_kind, owner, qualified_name, start_line, start_column, is_definition, is_implementation }));
    expect(pick(graph)).toEqual(pick(direct));
    expect(await findSymbol(root, input)).toEqual(graph);
  });

  it('applies the conjunctive filter and scope matrix identically in direct and fresh graph modes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-ts-symbol-filter-matrix-'));
    await mkdir(join(root, '.pi'), { recursive: true });
    await mkdir(join(root, 'src/nested'), { recursive: true });
    await writeFile(join(root, 'src/service.ts'), `export function fetchService() {}\nexport const fetchValue = 1;\n`);
    await writeFile(join(root, 'src/nested/other.tsx'), `export function fetchView() { return <div />; }\n`);
    await writeFile(join(root, 'src/ignored.js'), `export function fetchIgnored() {}\n`);

    const queries = [
      { path: 'src/service.ts', scope: 'file' as const, symbol: 'fetchService', search_mode: 'exact' as const, kind: 'function' as const, declaration_kind: 'function' as const, language: 'ts' as const },
      { path: 'src', scope: 'directory' as const, glob: '*.tsx', symbol: 'fetch', search_mode: 'prefix' as const, language: 'ts' as const },
      { path: 'src', scope: 'directory' as const, glob: '*.ts', symbol: 'Value', search_mode: 'contains' as const, kind: 'variable' as const, declaration_kind: 'variable' as const, language: 'ts' as const },
    ];

    await writeFile(join(root, '.pi/code-research.json'), '{"graph":{"enable":false}}\n');
    const direct = await Promise.all(queries.map((query) => resolveFindSymbol(root, query)));
    await writeFile(join(root, '.pi/code-research.json'), '{"graph":{"enable":true}}\n');
    await buildWorkspaceGraph(root);
    const graph = await Promise.all(queries.map((query) => resolveFindSymbol(root, query)));
    expect(graph.map((resolution) => normalizeSymbolResults(resolution.results))).toEqual(direct.map((resolution) => normalizeSymbolResults(resolution.results)));
    expect(graph.map((resolution) => resolution.diagnostics.completeness)).toEqual(['complete', 'complete', 'complete']);
  });

  it('reports diagnostics for empty direct results', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-ts-symbol-diagnostics-'));
    const file = join(root, 'empty.ts');
    await writeFile(file, 'export const present = 1;\n');
    const resolution = await resolveFindSymbol(root, { path: file, symbol: 'absent', language: 'ts' });
    expect(resolution.results).toEqual([]);
    expect(resolution.diagnostics).toMatchObject({ source_mode: 'direct', completeness: 'fallback', scanned_files_count: 1, skipped_files_count: 0, unreadable_shards_count: 0 });
    expect(resolution.diagnostics.fallback_reason).not.toBeNull();
  });

  it('keeps fixture documentation synchronized with parser coverage cases and public constants', async () => {
    const coverageDoc = await readFile(new URL('../docs/typescript-symbol-coverage-v1.md', import.meta.url), 'utf8');
    const contractDoc = await readFile(new URL('../docs/typescript-symbol-contract-v1.md', import.meta.url), 'utf8');
    const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
    for (const fixture of TYPESCRIPT_SYMBOL_CASES) expect(coverageDoc).toContain(fixture.id);
    for (const family of ['Functions', 'Callable bindings', 'Classes', 'Class members', 'Interfaces', 'Type declarations', 'Aliases and exports', 'Objects', 'Assignments', 'Destructuring', 'TSX', 'Declaration merging', 'Anonymous/computed names']) expect(coverageDoc).toContain(family);
    for (const reason of ['graph_disabled', 'graph_missing', 'graph_stale', 'graph_partial', 'graph_incompatible', 'graph_read_error', 'shard_missing', 'shard_unreadable', 'shard_incompatible', 'snapshot_mismatch', 'coverage_unproven', 'parse_error', 'input_unreadable']) expect(contractDoc).toContain(reason);
    expect(coverageDoc).toContain('0.23.2');
    expect(contractDoc).toContain('schema is version 2');
    expect(readme).toContain('docs/typescript-symbol-contract-v1.md');
    expect(readme).toContain('docs/typescript-symbol-coverage-v1.md');
    expect(coverageDoc).toContain('framework/HOC call-result callable inference');
    expect(coverageDoc).toContain('anonymous object literals without a stable bound owner');
  });

  it('keeps same-name owners, overloads, and accessors distinct', () => {
    const source = `class A { get value() { return 1 } set value(v: number) {} run(): void; run() {} } class B { run() {} }`;
    const records = extractTypeScriptSymbols('identity.ts', source);
    expect(records.filter((record) => record.name === 'run')).toHaveLength(3);
    expect(new Set(records.filter((record) => record.name === 'run').map((record) => record.symbolId)).size).toBe(3);
    const accessors = records.filter((record) => record.name === 'value');
    expect(accessors).toHaveLength(2);
    expect(accessors[0].relationshipId).toBe(accessors[1].relationshipId);
  });
});
