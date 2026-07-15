import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateJavaSymbolCorpus, generateTypeScriptSymbolCorpus } from '../../scripts/typescript-symbol-corpus.js';
import { median, normalizeSymbolResults, percentile } from '../helpers/typescript-symbol-parity.js';

describe('symbol benchmark infrastructure', () => {
  it('generates the normative medium TypeScript corpus deterministically', async () => {
    const a = await mkdtemp(join(tmpdir(), 'pi-ts-corpus-a-'));
    const b = await mkdtemp(join(tmpdir(), 'pi-ts-corpus-b-'));
    const first = await generateTypeScriptSymbolCorpus(a, 'medium');
    const second = await generateTypeScriptSymbolCorpus(b, 'medium');
    expect(first.fileCount).toBe(1000);
    expect(first.symbolCount).toBeGreaterThanOrEqual(25000);
    expect(second).toEqual(first);
    expect(await readFile(join(a, 'file-42.ts'), 'utf8')).toBe(await readFile(join(b, 'file-42.ts'), 'utf8'));
  }, 30_000);

  it('generates the normative medium Java corpus deterministically', async () => {
    const a = await mkdtemp(join(tmpdir(), 'pi-java-corpus-a-'));
    const b = await mkdtemp(join(tmpdir(), 'pi-java-corpus-b-'));
    const first = await generateJavaSymbolCorpus(a, 'medium');
    const second = await generateJavaSymbolCorpus(b, 'medium');
    expect(first.fileCount).toBe(1000);
    expect(first.symbolCount).toBe(25_002);
    expect(first.familyCounts).toEqual({
      compilation_unit: 1_000,
      type: 4_990,
      callable: 6_986,
      member: 6_038,
      binding: 5_988,
    });
    expect(second).toEqual(first);
    expect(await readFile(join(a, 'file-42.java'), 'utf8')).toBe(await readFile(join(b, 'file-42.java'), 'utf8'));
  }, 30_000);

  it('normalizes results and computes deterministic median/p95', () => {
    expect(median([5, 1, 4, 2, 3])).toBe(3);
    expect(percentile(Array.from({ length: 20 }, (_, index) => index + 1), 0.95)).toBe(19);
    expect(normalizeSymbolResults([{ file: 'a\\b.ts', symbol: 'x', kind: 'variable', start_line: 1, start_column: 0, end_line: 1, end_column: 1, is_definition: true, is_implementation: true }])[0].file).toBe('a/b.ts');
  });
});
