import { extname } from 'node:path';
import type { SymbolKind, SupportedLanguage, SymbolLocation } from '../types.js';

export function detectLanguage(filePath: string, explicit: SupportedLanguage): Exclude<SupportedLanguage, 'auto'> {
  if (explicit !== 'auto') return explicit;

  const ext = extname(filePath).toLowerCase();
  if (ext === '.java') return 'java';
  throw new Error(`Cannot auto-detect language for ${filePath}`);
}

export function isSupportedFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return ext === '.java';
}

export function nodeKindToSymbolKind(nodeType: string): SymbolKind {
  switch (nodeType) {
    case 'method_declaration':
    case 'constructor_declaration':
      return 'method';
    case 'class_declaration':
      return 'class';
    case 'interface_declaration':
      return 'interface';
    case 'field_declaration':
      return 'variable';
    default:
      return 'unknown';
  }
}

export interface ExtractedSymbol {
  name: string;
  kind: SymbolKind;
  node: any;
  isDefinition: boolean;
  isImplementation: boolean;
}

export function extractSymbols(rootNode: any): ExtractedSymbol[] {
  const symbols: ExtractedSymbol[] = [];

  function visit(node: any) {
    if (node.isNamed) {
      const kind = nodeKindToSymbolKind(node.type);
      if (kind !== 'unknown') {
        const nameNode = getNameNode(node);
        if (nameNode) {
          symbols.push({
            name: nameNode.text,
            kind,
            node,
            isDefinition: isDefinitionNode(node),
            isImplementation: isImplementationNode(node),
          });
        }
      }
    }

    for (const child of node.children) {
      visit(child);
    }
  }

  visit(rootNode);
  return symbols;
}

function getNameNode(node: any): any | undefined {
  switch (node.type) {
    case 'method_declaration':
    case 'constructor_declaration':
    case 'class_declaration':
    case 'interface_declaration':
      return node.childForFieldName('name');
    case 'field_declaration': {
      const declarator = node.children.find((c: any) => c.type === 'variable_declarator');
      return declarator ? declarator.childForFieldName('name') : undefined;
    }
    default:
      return undefined;
  }
}

function isDefinitionNode(node: any): boolean {
  const type = node.type;
  return (
    type === 'interface_declaration' ||
    type === 'method_declaration' ||
    type === 'constructor_declaration' ||
    type === 'class_declaration' ||
    type === 'field_declaration'
  );
}

function isImplementationNode(node: any): boolean {
  const type = node.type;
  return (
    type === 'method_declaration' ||
    type === 'constructor_declaration' ||
    type === 'class_declaration' ||
    type === 'field_declaration'
  );
}

export function findImplementationsOf(
  symbolName: string,
  files: Array<{ path: string; rootNode: any; language: Exclude<SupportedLanguage, 'auto'> }>
): SymbolLocation[] {
  const locations: SymbolLocation[] = [];

  for (const file of files) {
    function visit(node: any) {
      if (node.isNamed && node.type === 'class_declaration') {
        const interfaces = node.childForFieldName('interfaces');
        if (interfaces && implementsInterface(interfaces, symbolName)) {
          const nameNode = node.childForFieldName('name');
          if (nameNode) {
            locations.push(buildSymbolLocation(file.path, nameNode.text, 'class', node, true, true));
          }
        }
      }

      for (const child of node.children) {
        visit(child);
      }
    }

    visit(file.rootNode);
  }

  return locations;
}

function implementsInterface(interfacesNode: any, interfaceName: string): boolean {
  const typeList = interfacesNode.children.find((c: any) => c.type === 'type_list');
  if (!typeList) return false;

  return typeList.children.some(
    (c: any) => c.type === 'type_identifier' && c.text === interfaceName
  );
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
  const location: SymbolLocation = {
    file: filePath,
    symbol: symbolName,
    kind,
    start_line: node.startPosition.row + 1,
    start_column: node.startPosition.column,
    end_line: node.endPosition.row + 1,
    end_column: node.endPosition.column,
    is_definition: isDefinition,
    is_implementation: isImplementation,
  };

  if (includeSignature) {
    location.signature = extractSignature(node);
  }

  if (includeCode && source) {
    location.code = node.text;
  }

  return location;
}

function extractSignature(node: any): string {
  const bodyTypes = new Set(['block', 'constructor_body', 'interface_body', 'class_body']);

  interface Range {
    start: number;
    end: number;
  }

  const ranges: Range[] = [];

  function collect(n: any) {
    if (bodyTypes.has(n.type)) {
      ranges.push({ start: n.startIndex, end: n.endIndex });
      return;
    }
    for (const child of n.children) {
      collect(child);
    }
  }

  collect(node);

  ranges.sort((a, b) => a.start - b.start);
  const merged: Range[] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push(range);
    }
  }

  let result = '';
  let last = node.startIndex;
  for (const range of merged) {
    result += node.text.slice(last - node.startIndex, range.start - node.startIndex);
    result += ' ... ';
    last = range.end;
  }
  result += node.text.slice(last - node.startIndex);

  return result.replace(/\s+/g, ' ').trim();
}
