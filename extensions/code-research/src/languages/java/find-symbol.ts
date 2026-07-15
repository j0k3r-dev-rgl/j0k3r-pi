import { extractSignature } from './shared.js';
import { extractJavaSymbolRecords } from './symbol-extractor.js';
import { allowsJavaCodePayload } from './symbol-model.js';
import type { CanonicalJavaSymbolRecord, SymbolKind, SupportedLanguage, SymbolLocation } from '../../types.js';

export interface ExtractedSymbol {
  name: string;
  kind: SymbolKind;
  node: CanonicalJavaSymbolRecord;
  isDefinition: boolean;
  isImplementation: boolean;
}

export function nodeKindToSymbolKind(nodeType: string): SymbolKind {
  switch (nodeType) {
    case 'class':
    case 'record':
    case 'enum':
    case 'annotation':
      return 'class';
    case 'interface':
      return 'interface';
    case 'method':
    case 'constructor':
    case 'compact_constructor':
    case 'annotation_element':
      return 'method';
    case 'package':
    case 'module':
    case 'enum_constant':
    case 'record_component':
    case 'field':
    case 'parameter':
    case 'receiver_parameter':
    case 'lambda_parameter':
    case 'local_variable':
    case 'enhanced_for_variable':
    case 'catch_parameter':
    case 'resource_variable':
    case 'pattern_variable':
    case 'type_parameter':
      return 'variable';
    default:
      return 'unknown';
  }
}

export function extractSymbols(rootNode: any): ExtractedSymbol[] {
  const filePath = rootNode?.__filePath ?? rootNode?.filePath ?? 'unknown.java';
  const source = rootNode?.__source ?? rootNode?.text ?? '';
  const records = extractJavaSymbolRecords({ filePath, source, rootNode }).records;
  return records.map((record) => ({
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
  const locations: SymbolLocation[] = [];
  for (const file of files) {
    const source = file.rootNode?.__source ?? file.rootNode?.text ?? '';
    const records = extractJavaSymbolRecords({ filePath: file.path, source, rootNode: file.rootNode }).records;
    for (const record of records) {
      if (record.declarationKind !== 'class' && record.declarationKind !== 'record') continue;
      if (!record.signature?.includes(`implements ${symbolName}`)) continue;
      locations.push(buildSymbolLocation(file.path, record.name, record.coarseKind, record, true, true));
    }
  }
  return locations;
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
  const record = node as CanonicalJavaSymbolRecord;
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
    anonymous: record.anonymous,
    dynamic_name: record.dynamicName,
    modifiers: record.modifiers,
  };

  if (includeSignature && record.signature) location.signature = record.signature;
  if (includeCode && source && record.codeRange && allowsJavaCodePayload(record.declarationKind, true)) {
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

export { extractSignature };
