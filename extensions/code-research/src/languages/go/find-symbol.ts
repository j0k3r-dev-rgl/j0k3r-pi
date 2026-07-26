import { extractGoSymbolRecords } from './symbol-extractor.js';
import { allowsGoCodePayload } from './symbol-model.js';
import type { SymbolKind, SupportedLanguage, SymbolLocation } from '../../types.js';
import type { CanonicalGoSymbolRecord } from './symbol-model.js';

export interface ExtractedSymbol {
  name: string;
  kind: SymbolKind;
  node: CanonicalGoSymbolRecord;
  isDefinition: boolean;
  isImplementation: boolean;
}

export function extractSymbols(rootNode: any): ExtractedSymbol[] {
  const filePath = rootNode?.__filePath ?? 'unknown.go';
  const source = rootNode?.__source ?? rootNode?.text ?? '';
  return extractGoSymbolRecords({ filePath, source, rootNode }).map((record) => ({
    name: record.name,
    kind: record.coarseKind,
    node: record,
    isDefinition: record.isDefinition,
    isImplementation: record.isImplementation,
  }));
}

export function findImplementationsOf(
  symbolName: string,
  files: Array<{ path: string; rootNode: any; language: Exclude<SupportedLanguage, 'auto'> }>
): SymbolLocation[] {
  const interfaces = new Map<string, Set<string>>();
  const methodsByOwner = new Map<string, CanonicalGoSymbolRecord[]>();
  const explicitAssertions: Array<{ interfaceName: string; typeName: string; file: string }> = [];
  const typeRecords: Array<{ file: string; record: CanonicalGoSymbolRecord }> = [];

  for (const file of files) {
    const source = file.rootNode?.__source ?? file.rootNode?.text ?? '';
    const records = extractGoSymbolRecords({ filePath: file.path, source, rootNode: file.rootNode });
    for (const record of records) {
      if (record.declarationKind === 'interface') interfaces.set(record.name, new Set());
      if (record.owner && record.declarationKind === 'method') {
        const values = methodsByOwner.get(record.owner) ?? [];
        values.push(record);
        methodsByOwner.set(record.owner, values);
      }
      if (record.declarationKind === 'class') typeRecords.push({ file: file.path, record });
    }
    for (const match of source.matchAll(/var\s+_\s+(?:[A-Za-z_][\w]*\.)?([A-Za-z_][\w]*)\s*=\s*\(\*?([A-Za-z_][\w]*)\)\(nil\)/g)) {
      explicitAssertions.push({ interfaceName: match[1], typeName: match[2], file: file.path });
    }
  }

  for (const file of files) {
    const source = file.rootNode?.__source ?? file.rootNode?.text ?? '';
    const records = extractGoSymbolRecords({ filePath: file.path, source, rootNode: file.rootNode });
    for (const record of records) {
      if (record.owner && record.declarationKind === 'method') {
        const methods = interfaces.get(record.owner);
        if (methods) methods.add(record.name);
      }
    }
  }

  const targetMethods = interfaces.get(symbolName) ?? new Set<string>();
  const locations: SymbolLocation[] = [];
  for (const typeRecord of typeRecords) {
    const ownerMethods = new Set((methodsByOwner.get(typeRecord.record.name) ?? []).map((method) => method.name));
    const methodSetSatisfied = targetMethods.size > 0 && [...targetMethods].every((method) => ownerMethods.has(method));
    const asserted = explicitAssertions.some((assertion) => assertion.interfaceName === symbolName && assertion.typeName === typeRecord.record.name);
    if (!methodSetSatisfied && !asserted) continue;
    locations.push(buildSymbolLocation(typeRecord.file, typeRecord.record.name, typeRecord.record.coarseKind, typeRecord.record, true, true));
  }
  return dedupeLocations(locations);
}

export function buildSymbolLocation(
  filePath: string,
  symbolName: string,
  kind: SymbolKind,
  node: any,
  isDefinition: boolean,
  isImplementation: boolean,
  includeSignature = false,
  includeCode = false,
  source?: string
): SymbolLocation {
  const record = node as CanonicalGoSymbolRecord;
  const location: SymbolLocation = {
    file: filePath,
    symbol: symbolName,
    kind,
    start_line: record.declarationRange.startLine,
    start_column: record.declarationRange.startColumn,
    end_line: record.declarationRange.endLine,
    end_column: record.declarationRange.endColumn,
    is_definition: isDefinition,
    is_implementation: isImplementation,
    declaration_kind: record.declarationKind,
    symbol_id: record.symbolId,
    owner: record.owner,
    qualified_name: record.qualifiedName,
    relationship_id: record.relationshipId,
    source_name: record.sourceName,
    exported_name: record.exportedName,
    anonymous: record.anonymous,
    dynamic_name: record.dynamicName,
    modifiers: record.modifiers,
  };
  if (includeSignature && record.signature) location.signature = record.signature;
  if (includeCode && source && record.codeRange && allowsGoCodePayload(record.declarationKind)) {
    location.code = extractCodeRange(source, record.codeRange.startLine, record.codeRange.startColumn, record.codeRange.endLine, record.codeRange.endColumn);
  }
  return location;
}

function extractCodeRange(source: string, startLine: number, startColumn: number, endLine: number, endColumn: number): string {
  const lines = source.split('\n');
  const slice = lines.slice(startLine - 1, endLine);
  if (slice.length === 0) return '';
  slice[0] = slice[0].slice(startColumn);
  slice[slice.length - 1] = slice[slice.length - 1].slice(0, endColumn);
  return slice.join('\n');
}

function dedupeLocations(locations: SymbolLocation[]): SymbolLocation[] {
  const byKey = new Map<string, SymbolLocation>();
  for (const location of locations) byKey.set(`${location.file}:${location.symbol}:${location.start_line}:${location.start_column}`, location);
  return [...byKey.values()].sort((a, b) => a.file.localeCompare(b.file) || a.start_line - b.start_line || a.start_column - b.start_column);
}
