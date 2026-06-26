import { extractSignature } from './shared.js';
import type { SymbolKind, SupportedLanguage, SymbolLocation } from '../../types.js';

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
  node: any;
  isDefinition: boolean;
  isImplementation: boolean;
}

export function extractSymbols(rootNode: any): ExtractedSymbol[] {
  const symbols: ExtractedSymbol[] = [];
  const seen = new Set<string>();
  const objectCallableBindings = collectTopLevelObjectCallableBindings(rootNode);

  function pushSymbol(symbol: ExtractedSymbol) {
    const key = `${symbol.name}:${symbol.kind}:${symbol.node.startIndex}:${symbol.node.endIndex}`;
    if (seen.has(key)) return;
    seen.add(key);
    symbols.push(symbol);
  }

  function visit(node: any) {
    if (node.isNamed) {
      const destructuredSymbols = extractDestructuredSymbols(node, objectCallableBindings);
      for (const symbol of destructuredSymbols) {
        pushSymbol(symbol);
      }

      const kind = nodeKindToSymbolKind(node.type);
      if (kind !== 'unknown') {
        const name = getNameNode(node);
        if (name) {
          pushSymbol({
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

function collectTopLevelObjectCallableBindings(rootNode: any): Map<string, Map<string, any>> {
  const bindings = new Map<string, Map<string, any>>();

  for (const child of rootNode.children) {
    if (child.type !== 'lexical_declaration' && child.type !== 'variable_declaration') continue;
    const declarator = child.children.find((c: any) => c.type === 'variable_declarator');
    const nameNode = declarator?.childForFieldName('name');
    const valueNode = declarator?.childForFieldName('value');
    if (!nameNode || !valueNode || valueNode.type !== 'object') continue;

    const properties = new Map<string, any>();
    for (const property of valueNode.children) {
      if (!property.isNamed || property.type !== 'pair') continue;
      const keyNode = property.childForFieldName('key') ?? property.children.find((c: any) => c.type === 'property_identifier' || c.type === 'string');
      const propertyValueNode = property.childForFieldName('value') ?? property.children.find((c: any) => isCallableNode(c));
      if (!keyNode || !propertyValueNode || !isCallableNode(propertyValueNode)) continue;
      properties.set(normalizeSymbolText(keyNode.text), propertyValueNode);
    }

    if (properties.size > 0) {
      bindings.set(normalizeSymbolText(nameNode.text), properties);
    }
  }

  return bindings;
}

function extractDestructuredSymbols(
  node: any,
  objectCallableBindings: Map<string, Map<string, any>>
): ExtractedSymbol[] {
  if (node.type !== 'lexical_declaration' && node.type !== 'variable_declaration') return [];

  const declarator = node.children.find((c: any) => c.type === 'variable_declarator');
  const nameNode = declarator?.childForFieldName('name');
  const valueNode = declarator?.childForFieldName('value');
  if (!declarator || !nameNode || nameNode.type !== 'object_pattern') return [];

  const sourceBindings = valueNode?.type === 'identifier'
    ? objectCallableBindings.get(normalizeSymbolText(valueNode.text))
    : undefined;

  const symbols: ExtractedSymbol[] = [];
  for (const child of nameNode.children) {
    if (!child.isNamed) continue;

    if (child.type === 'shorthand_property_identifier_pattern') {
      const symbolName = normalizeSymbolText(child.text);
      const callableNode = sourceBindings?.get(symbolName);
      if (callableNode) {
        symbols.push({
          name: symbolName,
          kind: 'function',
          node: callableNode,
          isDefinition: true,
          isImplementation: true,
        });
      } else {
        symbols.push({
          name: symbolName,
          kind: 'variable',
          node: child,
          isDefinition: true,
          isImplementation: true,
        });
      }
      continue;
    }

    if (child.type === 'pair_pattern') {
      const keyNode = child.childForFieldName('key');
      const valuePatternNode = child.childForFieldName('value');
      const symbolName = normalizeSymbolText(valuePatternNode?.text ?? '');
      const sourceKey = normalizeSymbolText(keyNode?.text ?? '');
      if (!symbolName) continue;
      const callableNode = sourceBindings?.get(sourceKey);
      if (callableNode) {
        symbols.push({
          name: symbolName,
          kind: 'function',
          node: callableNode,
          isDefinition: true,
          isImplementation: true,
        });
      } else {
        symbols.push({
          name: symbolName,
          kind: 'variable',
          node: valuePatternNode ?? child,
          isDefinition: true,
          isImplementation: true,
        });
      }
    }
  }

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
    isCallableNode(node) ||
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
    type === 'class_declaration' ||
    type === 'abstract_class_declaration' ||
    type === 'function_expression' ||
    type === 'arrow_function' ||
    (type === 'lexical_declaration' && isVariableWithFunctionValue(node)) ||
    (type === 'variable_declaration' && isVariableWithFunctionValue(node))
  );
}

function isCallableNode(node: any): boolean {
  return node?.type === 'arrow_function' || node?.type === 'function_expression' || node?.type === 'function_declaration';
}

function normalizeSymbolText(text: string): string {
  return text.replace(/^#/, '').replace(/^['"]|['"]$/g, '');
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

function implementsInterface(classNode: any, interfaceName: string): boolean {
  const heritage = classNode.children.find((c: any) => c.type === 'class_heritage');
  if (!heritage) return false;

  const implementsClause = heritage.children.find((c: any) => c.type === 'implements_clause');
  if (!implementsClause) return false;

  return implementsClause.children.some(
    (c: any) => c.type === 'type_identifier' && c.text === interfaceName
  );
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
