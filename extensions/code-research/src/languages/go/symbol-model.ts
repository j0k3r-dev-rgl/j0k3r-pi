import { createHash } from 'node:crypto';
import type { DeclarationKind, SourceRange, SymbolKind } from '../../types.js';

export interface CanonicalGoSymbolRecord {
  name: string;
  qualifiedName: string;
  owner?: string;
  ownerChain: string[];
  declarationKind: DeclarationKind;
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

export function goDeclarationKindToCoarseKind(kind: DeclarationKind): SymbolKind {
  switch (kind) {
    case 'function':
      return 'function';
    case 'class':
      return 'class';
    case 'interface':
      return 'interface';
    case 'method':
    case 'interface_method':
      return 'method';
    case 'field':
    case 'variable':
    case 'package':
      return 'variable';
    default:
      return 'unknown';
  }
}

export function createGoRelationshipId(file: string, ownerChain: string[], name: string, family: string): string {
  return hashParts([file, ...ownerChain, name, family]);
}

export function createGoSymbolId(input: {
  sourceHash: string;
  file: string;
  ownerChain: string[];
  declarationKind: DeclarationKind;
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

export function allowsGoCodePayload(kind: DeclarationKind | undefined): boolean {
  return kind === 'function' || kind === 'method';
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
