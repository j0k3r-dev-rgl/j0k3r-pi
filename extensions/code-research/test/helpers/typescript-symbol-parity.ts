import type { SymbolLocation } from '../../src/types.js';

export function normalizeSymbolResults(results: SymbolLocation[]) {
  return results.map(({ file, symbol, kind, declaration_kind, owner, qualified_name, start_line, start_column, end_line, end_column, is_definition, is_implementation }) => ({
    file: file.replace(/\\/g, '/'), symbol, kind, declaration_kind, owner, qualified_name,
    start_line, start_column, end_line, end_column, is_definition, is_implementation,
  }));
}

export function percentile(values: number[], quantile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)];
}

export function median(values: number[]): number {
  return percentile(values, 0.5);
}
