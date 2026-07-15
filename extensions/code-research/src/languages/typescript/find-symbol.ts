import ts from 'typescript';
import { extractSignature } from './shared.js';
import { extractTypeScriptSymbols } from './symbol-extractor.js';
import { allowsCodePayload } from './symbol-model.js';
import type { CanonicalTypeScriptSymbolRecord } from './symbol-model.js';
import type { SymbolKind, SupportedLanguage, SymbolLocation } from '../../types.js';

export interface ExtractedSymbol {
  name: string;
  kind: SymbolKind;
  node: CanonicalTypeScriptSymbolRecord;
  isDefinition: boolean;
  isImplementation: boolean;
}

export function nodeKindToSymbolKind(nodeType: string): SymbolKind {
  switch (nodeType) {
    case 'function':
    case 'function_overload':
    case 'callable_variable':
      return 'function';
    case 'class':
      return 'class';
    case 'constructor':
    case 'method':
    case 'getter':
    case 'setter':
    case 'interface_method':
    case 'object_method':
      return 'method';
    case 'interface':
      return 'interface';
    case 'variable':
    case 'field':
    case 'property':
    case 'call_signature':
    case 'construct_signature':
    case 'index_signature':
    case 'type_alias':
    case 'enum':
    case 'enum_member':
    case 'namespace':
    case 'module':
    case 'import_alias':
    case 'export_alias':
    case 'object_property':
    case 'assignment':
    case 'commonjs_export':
      return 'variable';
    default:
      return 'unknown';
  }
}

export function extractSymbols(rootNode: any): ExtractedSymbol[] {
  const sourceFile = rootNode as ts.SourceFile;
  const records = extractTypeScriptSymbols(sourceFile.fileName, sourceFile.text);
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
    const sourceFile = file.rootNode as ts.SourceFile;
    const text = sourceFile.text;
    if (!text.includes(`implements ${symbolName}`)) continue;
    const records = extractTypeScriptSymbols(file.path, text);
    for (const record of records) {
      if (record.declarationKind !== 'class') continue;
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
  const record = node as CanonicalTypeScriptSymbolRecord;
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

  if (includeSignature && record.signature) {
    location.signature = record.signature;
  }

  if (includeCode && source && record.codeRange && allowsCodePayload(record.declarationKind)) {
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
