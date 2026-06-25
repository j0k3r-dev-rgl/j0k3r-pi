import { extname, basename } from 'node:path';
import type { SymbolKind, SupportedLanguage, SymbolLocation } from '../types.js';

export function detectLanguage(filePath: string, explicit: SupportedLanguage): Exclude<SupportedLanguage, 'auto'> {
  if (explicit !== 'auto') return explicit;

  const ext = extname(filePath).toLowerCase();
  if (ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs') return 'js';
  return 'ts';
}

export function isSupportedFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext);
}

export function nodeKindToSymbolKind(nodeType: string): SymbolKind {
  switch (nodeType) {
    case 'function_declaration':
    case 'function_expression':
    case 'arrow_function':
      return 'function';
    case 'method_definition':
    case 'method_signature':
    case 'abstract_method_signature':
      return 'method';
    case 'class_declaration':
    case 'abstract_class_declaration':
      return 'class';
    case 'interface_declaration':
      return 'interface';
    case 'type_alias_declaration':
      return 'variable';
    case 'lexical_declaration':
    case 'variable_declaration':
      return 'variable';
    default:
      return 'unknown';
  }
}

export interface ExtractedSymbol {
  name: string;
  kind: SymbolKind;
  node: any; // SyntaxNode
  isDefinition: boolean;
  isImplementation: boolean;
}

export function extractSymbols(rootNode: any): ExtractedSymbol[] {
  const symbols: ExtractedSymbol[] = [];

  function visit(node: any) {
    if (node.isNamed) {
      const kind = nodeKindToSymbolKind(node.type);
      if (kind !== 'unknown') {
        const name = getNameNode(node);
        if (name) {
          symbols.push({
            name: name.text,
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

function getNameNode(node: any): { text: string; node: any } | undefined {
  let child: any | undefined;

  switch (node.type) {
    case 'function_declaration':
    case 'function_expression':
      child = node.childForFieldName('name');
      break;
    case 'arrow_function':
      // Arrow functions in variable declarations use variable_declarator name
      return undefined;
    case 'method_definition':
    case 'method_signature':
    case 'abstract_method_signature':
      child = node.childForFieldName('name');
      break;
    case 'class_declaration':
    case 'abstract_class_declaration':
    case 'interface_declaration':
      child = node.childForFieldName('name');
      break;
    case 'type_alias_declaration':
      child = node.children.find((c: any) => c.type === 'type_identifier');
      break;
    case 'variable_declarator':
      child = node.childForFieldName('name');
      break;
    case 'lexical_declaration':
    case 'variable_declaration': {
      const declarator = node.children.find((c: any) => c.type === 'variable_declarator');
      child = declarator ? declarator.childForFieldName('name') : undefined;
      break;
    }
    default:
      return undefined;
  }

  if (!child) return undefined;

  const text = child.type === 'private_property_identifier'
    ? child.text.replace(/^#/, '')
    : child.text;

  return { text, node: child };
}

function isDefinitionNode(node: any): boolean {
  const type = node.type;
  return (
    type === 'interface_declaration' ||
    type === 'method_signature' ||
    type === 'method_definition' ||
    type === 'class_declaration' ||
    type === 'abstract_class_declaration' ||
    type === 'type_alias_declaration' ||
    type === 'function_declaration' ||
    (type === 'lexical_declaration' && isVariableWithFunctionValue(node)) ||
    (type === 'variable_declaration' && isVariableWithFunctionValue(node))
  );
}

function isImplementationNode(node: any): boolean {
  const type = node.type;
  return (
    type === 'method_definition' ||
    type === 'abstract_method_signature' ||
    type === 'function_declaration' ||
    (type === 'class_declaration') ||
    type === 'abstract_class_declaration' ||
    type === 'function_expression' ||
    type === 'arrow_function' ||
    (type === 'lexical_declaration' && isVariableWithFunctionValue(node)) ||
    (type === 'variable_declaration' && isVariableWithFunctionValue(node))
  );
}

function isVariableWithFunctionValue(node: any): boolean {
  const declarator = node.children.find((c: any) => c.type === 'variable_declarator');
  if (!declarator) return false;
  const value = declarator.childForFieldName('value');
  if (!value) return false;
  return (
    value.type === 'arrow_function' ||
    value.type === 'function_expression' ||
    value.type === 'function_declaration'
  );
}

function hasClassImplements(node: any): boolean {
  const heritage = node.children.find((c: any) => c.type === 'class_heritage');
  if (!heritage) return false;
  return heritage.children.some((c: any) => c.type === 'implements_clause');
}

export function findImplementationsOf(
  symbolName: string,
  files: Array<{ path: string; rootNode: any; language: Exclude<SupportedLanguage, 'auto'> }>
): SymbolLocation[] {
  const locations: SymbolLocation[] = [];

  for (const file of files) {
    function visit(node: any) {
      if (node.isNamed) {
        if (
          node.type === 'class_declaration' &&
          hasClassImplements(node) &&
          implementsInterface(node, symbolName)
        ) {
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

function implementsInterface(classNode: any, interfaceName: string): boolean {
  const heritage = classNode.children.find((c: any) => c.type === 'class_heritage');
  if (!heritage) return false;

  const implementsClause = heritage.children.find((c: any) => c.type === 'implements_clause');
  if (!implementsClause) return false;

  return implementsClause.children.some(
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
  const bodyTypes = new Set([
    'statement_block',
    'class_body',
    'interface_body',
    'object',
  ]);

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

  // Sort and merge overlapping ranges
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

  // Build signature replacing bodies with " ... "
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
