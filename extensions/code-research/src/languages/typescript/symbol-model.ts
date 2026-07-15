import { createHash } from 'node:crypto';
import type { SourceRange, SymbolKind, TypeScriptDeclarationKind } from '../../types.js';

export interface CanonicalTypeScriptSymbolRecord {
  name: string;
  qualifiedName: string;
  owner?: string;
  ownerChain: string[];
  declarationKind: TypeScriptDeclarationKind;
  coarseKind: SymbolKind;
  sourceName?: string;
  exportedName?: string;
  anonymous?: boolean;
  dynamicName?: boolean;
  modifiers: string[];
  declarationRange: SourceRange;
  codeRange?: SourceRange;
  isDefinition: boolean;
  isImplementation: boolean;
  discriminator: string;
  relationshipId?: string;
  signature?: string;
  symbolId: string;
  sourceHash: string;
}

export const EXECUTABLE_DECLARATION_KINDS = new Set<TypeScriptDeclarationKind>([
  'function',
  'callable_variable',
  'constructor',
  'method',
  'getter',
  'setter',
  'object_method',
]);

export function declarationKindToCoarseKind(kind: TypeScriptDeclarationKind): SymbolKind {
  switch (kind) {
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

export function createRelationshipId(file: string, ownerChain: string[], name: string, family: string): string {
  return hashParts([file, ...ownerChain, name, family]);
}

export function createTypeScriptSymbolId(input: {
  sourceHash: string;
  file: string;
  ownerChain: string[];
  declarationKind: TypeScriptDeclarationKind;
  name: string;
  declarationRange: SourceRange;
  discriminator: string;
}): string {
  const { sourceHash, file, ownerChain, declarationKind, name, declarationRange, discriminator } = input;
  return hashParts([
    sourceHash,
    file,
    ...ownerChain,
    declarationKind,
    name,
    `${declarationRange.startLine}:${declarationRange.startColumn}:${declarationRange.endLine}:${declarationRange.endColumn}`,
    discriminator,
  ]);
}

export function compareCanonicalSymbols(a: CanonicalTypeScriptSymbolRecord, b: CanonicalTypeScriptSymbolRecord): number {
  return (
    compareText(a.declarationRange.startLine, b.declarationRange.startLine) ||
    compareText(a.declarationRange.startColumn, b.declarationRange.startColumn) ||
    compareText(a.declarationKind, b.declarationKind) ||
    compareText(a.qualifiedName, b.qualifiedName) ||
    compareText(a.discriminator, b.discriminator) ||
    compareText(a.symbolId, b.symbolId)
  );
}

export function allowsCodePayload(kind: TypeScriptDeclarationKind | undefined): boolean {
  return Boolean(kind && EXECUTABLE_DECLARATION_KINDS.has(kind));
}

function compareText(a: string | number, b: string | number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function hashParts(parts: string[]): string {
  const hash = createHash('sha256');
  for (const part of parts) {
    hash.update(String(part).length.toString(16));
    hash.update(':');
    hash.update(String(part));
    hash.update('|');
  }
  return hash.digest('hex');
}
