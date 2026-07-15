import { createHash } from 'node:crypto';
import type {
  CanonicalJavaSymbolRecord,
  DeclarationKind,
  JavaDeclarationFamily,
  JavaDeclarationKind,
  SourceRange,
  SymbolKind,
  SymbolQueryInclusion,
} from '../../types.js';

export const JAVA_EXECUTABLE_DECLARATION_KINDS = new Set<JavaDeclarationKind>([
  'method',
  'constructor',
  'compact_constructor',
]);

export const JAVA_MODIFIER_ALLOWLIST = new Set([
  'public',
  'protected',
  'private',
  'abstract',
  'static',
  'final',
  'sealed',
  'non-sealed',
  'native',
  'synchronized',
  'transient',
  'volatile',
  'strictfp',
  'default',
]);

export function javaDeclarationKindToCoarseKind(kind: DeclarationKind): SymbolKind {
  switch (kind) {
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

export function javaFamilyForDeclarationKind(kind: JavaDeclarationKind): JavaDeclarationFamily {
  switch (kind) {
    case 'package':
    case 'module':
      return 'compilation_unit';
    case 'class':
    case 'interface':
    case 'enum':
    case 'record':
    case 'annotation':
      return 'type';
    case 'method':
    case 'constructor':
    case 'compact_constructor':
    case 'annotation_element':
      return 'callable';
    case 'field':
    case 'enum_constant':
    case 'record_component':
      return 'member';
    case 'parameter':
    case 'receiver_parameter':
    case 'lambda_parameter':
    case 'local_variable':
    case 'enhanced_for_variable':
    case 'catch_parameter':
    case 'resource_variable':
    case 'pattern_variable':
    case 'type_parameter':
      return 'binding';
    default:
      return 'unknown';
  }
}

export function allowsJavaCodePayload(kind: JavaDeclarationKind | undefined, hasCodeRange = true): boolean {
  return Boolean(kind && hasCodeRange && JAVA_EXECUTABLE_DECLARATION_KINDS.has(kind));
}

export function queryInclusionForJavaDeclarationKind(kind: DeclarationKind): SymbolQueryInclusion {
  switch (kind) {
    case 'package':
    case 'module':
      return 'compilation_unit';
    case 'parameter':
    case 'receiver_parameter':
    case 'lambda_parameter':
    case 'local_variable':
    case 'enhanced_for_variable':
    case 'catch_parameter':
    case 'resource_variable':
    case 'pattern_variable':
    case 'type_parameter':
      return 'local_binding';
    default:
      return 'default';
  }
}

export function createJavaRelationshipId(file: string, ownerChain: string[], name: string, family: string): string {
  return hashParts([file, ...ownerChain, name, family]);
}

export function createJavaSymbolId(input: {
  sourceHash: string;
  file: string;
  ownerChain: string[];
  declarationKind: JavaDeclarationKind;
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

export function compareJavaSymbols(a: CanonicalJavaSymbolRecord, b: CanonicalJavaSymbolRecord): number {
  return (
    compareText(a.declarationRange.startLine, b.declarationRange.startLine) ||
    compareText(a.declarationRange.startColumn, b.declarationRange.startColumn) ||
    compareText(a.declarationKind, b.declarationKind) ||
    compareText(a.qualifiedName, b.qualifiedName) ||
    compareText(a.discriminator, b.discriminator) ||
    compareText(a.symbolId, b.symbolId)
  );
}

export function sanitizeJavaSignature(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value
    .replace(/\s+/g, ' ')
    .replace(/=\s*[^,)]+/g, '')
    .replace(/\{[\s\S]*$/g, '')
    .trim();
}

export function collectJavaModifiers(node: any): string[] {
  const modifiers = node.childForFieldName?.('modifiers') ?? (node.children ?? []).find((child: any) => child.type === 'modifiers');
  if (!modifiers) return [];
  const values = new Set<string>();
  for (const child of modifiers.children ?? []) {
    const text = String(child.text ?? '').trim();
    if (JAVA_MODIFIER_ALLOWLIST.has(text)) values.add(text);
  }
  return [...values];
}

export function isJavaImplementation(kind: JavaDeclarationKind, node: any, modifiers: string[], hasInitializer = false): boolean {
  switch (kind) {
    case 'class':
    case 'record':
    case 'enum':
    case 'annotation':
    case 'enum_constant':
      return true;
    case 'interface':
    case 'annotation_element':
    case 'record_component':
    case 'package':
    case 'module':
    case 'type_parameter':
      return false;
    case 'method':
      return Boolean(node.childForFieldName?.('body')) && !modifiers.includes('abstract') && !modifiers.includes('native');
    case 'constructor':
    case 'compact_constructor':
      return Boolean(node.childForFieldName?.('body') || node.children?.some((child: any) => child.type === 'constructor_body'));
    case 'field':
    case 'local_variable':
    case 'resource_variable':
    case 'enhanced_for_variable':
    case 'pattern_variable':
      return hasInitializer;
    case 'parameter':
    case 'receiver_parameter':
    case 'lambda_parameter':
    case 'catch_parameter':
      return false;
    default:
      return false;
  }
}

export function buildQualifiedName(ownerChain: string[], name: string): string {
  return [...ownerChain, name].join('.');
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
