import { readFile } from 'node:fs/promises';
import { collectWorkspaceSourceFiles, isMissingFileError } from '../../core/source-policy.js';
import { getParserForFile, parseSource } from '../../core/parser.js';
import { normalizeGoTypeName, packagePathToName, unquoteGoString } from './shared.js';
import { extractGoSymbolRecords } from './symbol-extractor.js';
import type { DeclarationKind, SymbolKind } from '../../types.js';

export interface GoCallable {
  file: string;
  packageName: string;
  symbol: string;
  kind: 'function' | 'method';
  ownerName?: string;
  node: any;
  line: number;
  column: number;
  signature?: string;
  symbolId: string;
  relationshipId?: string;
  sourceHash: string;
}

export interface GoTypeInfo {
  file: string;
  packageName: string;
  name: string;
  kind: 'class' | 'interface';
  record: any;
  interfaceMethods: string[];
}

export interface GoIndexedFile {
  file: string;
  packageName: string;
  source: string;
  rootNode: any;
  imports: Map<string, string>;
}

export interface GoExplicitInterfaceAssertion {
  interfaceName: string;
  typeName: string;
  file: string;
}

export interface GoProjectIndex {
  rootDir: string;
  files: GoIndexedFile[];
  callables: GoCallable[];
  types: GoTypeInfo[];
  explicitAssertions: GoExplicitInterfaceAssertion[];
}

export interface GoExtractedCall {
  symbol: string;
  receiver?: string;
  text: string;
  line: number;
  column: number;
}

export async function buildGoProjectIndex(rootDir: string): Promise<GoProjectIndex> {
  const files = (await collectWorkspaceSourceFiles(rootDir)).filter((file) => file.endsWith('.go')).sort();
  const index: GoProjectIndex = { rootDir, files: [], callables: [], types: [], explicitAssertions: [] };

  for (const file of files) {
    let source: string;
    try {
      source = await readFile(file, 'utf8');
    } catch (error) {
      if (isMissingFileError(error)) continue;
      throw error;
    }
    const parser = getParserForFile(file, 'go');
    let tree: any;
    try {
      tree = parseSource(parser, source);
    } catch {
      continue;
    }
    (tree.rootNode as any).__filePath = file;
    (tree.rootNode as any).__source = source;
    const packageName = tree.rootNode.namedChildren?.find((child: any) => child.type === 'package_clause')?.namedChildren?.[0]?.text ?? '';
    const imports = indexImports(tree.rootNode);
    index.files.push({ file, packageName, source, rootNode: tree.rootNode, imports });

    const records = extractGoSymbolRecords({ filePath: file, source, rootNode: tree.rootNode });
    for (const record of records) {
      if (record.declarationKind === 'function' || record.declarationKind === 'method') {
        const callableNode = findCallableNode(tree.rootNode, record);
        if (!callableNode) continue;
        index.callables.push({
          file,
          packageName,
          symbol: record.name,
          kind: record.declarationKind,
          ownerName: record.owner,
          node: callableNode,
          line: record.declarationRange.startLine,
          column: record.declarationRange.startColumn,
          signature: record.signature,
          symbolId: record.symbolId,
          relationshipId: record.relationshipId,
          sourceHash: record.sourceHash,
        });
      }
      if (record.declarationKind === 'class' || record.declarationKind === 'interface') {
        const interfaceMethods = records.filter((candidate) => candidate.owner === record.name && candidate.declarationKind === 'method').map((candidate) => candidate.name);
        index.types.push({ file, packageName, name: record.name, kind: record.declarationKind, record, interfaceMethods });
      }
    }

    for (const match of source.matchAll(/var\s+_\s+(?:[A-Za-z_][\w]*\.)?([A-Za-z_][\w]*)\s*=\s*\(\*?([A-Za-z_][\w]*)\)\(nil\)/g)) {
      index.explicitAssertions.push({ interfaceName: match[1], typeName: match[2], file });
    }
  }

  return index;
}

export function extractCalls(callableNode: any): GoExtractedCall[] {
  const body = callableNode.childForFieldName?.('body');
  if (!body) return [];
  const calls: GoExtractedCall[] = [];

  function visit(node: any): void {
    if (!node?.isNamed) return;
    if (node.type === 'call_expression') {
      const functionNode = node.childForFieldName('function');
      if (functionNode?.type === 'identifier') {
        calls.push({ symbol: functionNode.text, text: node.text, line: node.startPosition.row + 1, column: node.startPosition.column });
        return;
      }
      if (functionNode?.type === 'selector_expression') {
        const receiver = functionNode.childForFieldName('operand')?.text;
        const symbol = functionNode.childForFieldName('field')?.text;
        if (receiver && symbol) {
          calls.push({ receiver, symbol, text: node.text, line: node.startPosition.row + 1, column: node.startPosition.column });
          return;
        }
      }
    }
    for (const child of node.children ?? []) visit(child);
  }

  visit(body);
  return calls;
}

export function resolveGoCall(index: GoProjectIndex, current: GoCallable, call: GoExtractedCall): { callable?: GoCallable; receiverType?: string; source: 'application' | 'library' | 'unknown'; reason?: string } {
  if (!call.receiver) {
    const target = index.callables.find((candidate) => candidate.packageName === current.packageName && !candidate.ownerName && candidate.symbol === call.symbol);
    return target ? { callable: target, source: 'application' } : { source: 'unknown', reason: 'package-level function not found in indexed package' };
  }

  const currentFile = index.files.find((file) => file.file === current.file);
  if (current.ownerName) {
    const receiverName = current.node.childForFieldName?.('receiver')?.namedChildren?.[0]?.childForFieldName?.('name')?.text;
    if (receiverName && call.receiver === receiverName) {
      const target = index.callables.find((candidate) => candidate.packageName === current.packageName && candidate.ownerName === current.ownerName && candidate.symbol === call.symbol);
      return target ? { callable: target, receiverType: current.ownerName, source: 'application' } : { source: 'unknown', receiverType: current.ownerName, reason: 'receiver method not found on indexed owner' };
    }
  }

  const receiverType = currentFile ? resolveReceiverType(currentFile, current, call.receiver) : undefined;
  if (receiverType) {
    const target = index.callables.find((candidate) => candidate.packageName === current.packageName && candidate.ownerName === receiverType && candidate.symbol === call.symbol);
    return target ? { callable: target, receiverType, source: 'application' } : { source: 'unknown', receiverType, reason: 'receiver method not found on indexed type' };
  }

  if (currentFile?.imports.has(call.receiver)) {
    return { source: 'library', reason: 'package-qualified or imported selector call' };
  }

  return { source: 'unknown', reason: 'could not resolve receiver type' };
}

export function findGoImplementations(index: GoProjectIndex, target: GoTypeInfo): GoTypeInfo[] {
  if (target.kind !== 'interface') return [];
  return index.types.filter((candidate) => {
    if (candidate.kind !== 'class') return false;
    const methodNames = new Set(index.callables.filter((callable) => callable.ownerName === candidate.name && callable.packageName === candidate.packageName).map((callable) => callable.symbol));
    const methodSetSatisfied = target.interfaceMethods.length > 0 && target.interfaceMethods.every((method) => methodNames.has(method));
    const asserted = index.explicitAssertions.some((assertion) => assertion.interfaceName === target.name && assertion.typeName === candidate.name);
    return methodSetSatisfied || asserted;
  });
}

function indexImports(rootNode: any): Map<string, string> {
  const imports = new Map<string, string>();
  for (const child of rootNode.namedChildren ?? []) {
    if (child.type !== 'import_declaration') continue;
    const specs = child.namedChildren?.filter((node: any) => node.type === 'import_spec') ?? [];
    const lists = child.namedChildren?.filter((node: any) => node.type === 'import_spec_list') ?? [];
    for (const list of lists) {
      for (const spec of list.namedChildren ?? []) if (spec.type === 'import_spec') specs.push(spec);
    }
    for (const spec of specs) {
      const path = unquoteGoString(spec.childForFieldName('path')?.text ?? '');
      if (!path) continue;
      const alias = spec.childForFieldName('name')?.text ?? packagePathToName(path);
      imports.set(alias, path);
    }
  }
  return imports;
}

function resolveReceiverType(file: GoIndexedFile, current: GoCallable, receiverName: string): string | undefined {
  const receiverNode = current.node.childForFieldName?.('receiver')?.namedChildren?.[0];
  const receiverParamName = receiverNode?.childForFieldName?.('name')?.text;
  const receiverParamType = normalizeGoTypeName(receiverNode?.childForFieldName?.('type')?.text);
  if (receiverParamName === receiverName && receiverParamType) return receiverParamType;

  const parameters = current.node.childForFieldName?.('parameters');
  for (const parameter of parameters?.namedChildren ?? []) {
    const typeName = normalizeGoTypeName(parameter.childForFieldName?.('type')?.text);
    for (const child of parameter.namedChildren ?? []) {
      if (child.parentFieldName === 'name' && child.text === receiverName && typeName) return typeName;
    }
  }

  const body = current.node.childForFieldName?.('body');
  let resolved: string | undefined;
  const visit = (node: any) => {
    if (resolved || !node?.isNamed) return;
    if (node.type === 'short_var_declaration') {
      const left = node.childForFieldName('left')?.namedChildren ?? [];
      const right = node.childForFieldName('right')?.namedChildren ?? [];
      left.forEach((nameNode: any, index: number) => {
        if (resolved || nameNode.text !== receiverName) return;
        const text = right[index]?.text ?? '';
        resolved = inferTypeFromExpression(text);
      });
    }
    if (node.type === 'var_declaration') {
      for (const spec of node.namedChildren ?? []) {
        if (spec.type !== 'var_spec') continue;
        const typeName = normalizeGoTypeName(spec.childForFieldName('type')?.text);
        const valueNodes = spec.childForFieldName('value')?.namedChildren ?? [];
        const names = spec.namedChildren?.filter((child: any) => child.parentFieldName === 'name') ?? [];
        names.forEach((nameNode: any, index: number) => {
          if (resolved || nameNode.text !== receiverName) return;
          resolved = typeName ?? inferTypeFromExpression(valueNodes[index]?.text ?? '');
        });
      }
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(body);
  return resolved;
}

function inferTypeFromExpression(text: string): string | undefined {
  const match = text.match(/^&?([A-Za-z_][\w]*)\s*\{/) ?? text.match(/^new\(([A-Za-z_][\w]*)\)/) ?? text.match(/^\(\*?([A-Za-z_][\w]*)\)/);
  return normalizeGoTypeName(match?.[1]);
}

function findCallableNode(rootNode: any, record: any): any {
  let found: any;
  const visit = (node: any) => {
    if (found || !node?.isNamed) return;
    if ((node.type === 'function_declaration' || node.type === 'method_declaration') && node.startPosition.row + 1 === record.declarationRange.startLine && node.startPosition.column === record.declarationRange.startColumn) {
      found = node;
      return;
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(rootNode);
  return found;
}
