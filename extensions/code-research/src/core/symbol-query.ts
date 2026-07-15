import type { CanonicalSymbolRecord, DeclarationKind, SearchMode, SearchScope, SymbolKind } from '../types.js';
import { compareCanonicalSymbols } from '../languages/typescript/symbol-model.js';

export function matchesCanonicalSymbol(
  record: CanonicalSymbolRecord,
  query: string,
  mode: SearchMode,
  kind?: SymbolKind,
  declarationKind?: DeclarationKind,
  scope: SearchScope = 'file'
): boolean {
  if (kind && record.coarseKind !== kind) return false;
  if (declarationKind && record.declarationKind !== declarationKind) return false;
  if (!matchesInclusion(record, mode, scope, declarationKind)) return false;
  const values = [record.name, record.qualifiedName];
  return values.some((value) => matchesQuery(value, query, mode));
}

export function reconcileSymbolRecords<T extends CanonicalSymbolRecord>(records: T[]): T[] {
  const map = new Map<string, T>();
  for (const record of records) map.set(record.symbolId, record);
  return [...map.values()].sort(compareCanonicalSymbols as (a: T, b: T) => number);
}

function matchesInclusion(record: CanonicalSymbolRecord, mode: SearchMode, scope: SearchScope, declarationKind?: DeclarationKind): boolean {
  switch (record.queryInclusion ?? 'default') {
    case 'relationship_only':
      return false;
    case 'compilation_unit':
      return mode === 'exact' || declarationKind === record.declarationKind;
    case 'local_binding':
      if (mode === 'exact') return true;
      if (scope === 'file') return true;
      return declarationKind === record.declarationKind;
    case 'default':
    default:
      return true;
  }
}

function matchesQuery(name: string, query: string, mode: SearchMode): boolean {
  switch (mode) {
    case 'prefix':
      return name.startsWith(query);
    case 'contains':
      return name.includes(query);
    case 'exact':
    default:
      return name === query;
  }
}
