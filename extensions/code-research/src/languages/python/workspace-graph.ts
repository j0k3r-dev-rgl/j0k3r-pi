import { readFile } from 'node:fs/promises';
import { getParser, parseSource } from '../../core/parser.js';
import { collectWorkspaceSourceFiles, isMissingFileError } from '../../core/source-policy.js';
import type { OwnerKind, SymbolKind } from '../../types.js';

export interface IndexedPythonSymbol {
  file: string;
  symbol: string;
  kind: SymbolKind;
  ownerName?: string;
  ownerKind: OwnerKind;
  line: number;
  column: number;
  node: any;
  signature?: string;
  exported: boolean;
  entrypoint?: boolean;
}

export interface IndexedPythonEntrypoint {
  file: string;
  symbol: string;
  line: number;
  column: number;
  text: string;
  reason: 'python __main__ guard direct call' | 'python __main__ guard wrapper argument' | 'python __main__ module';
}

export interface PythonProjectIndex {
  files: Set<string>;
  symbols: IndexedPythonSymbol[];
  entrypoints: IndexedPythonEntrypoint[];
  entrypointFiles: Set<string>;
}

export async function buildPythonProjectIndex(rootDir: string): Promise<PythonProjectIndex> {
  const index: PythonProjectIndex = { files: new Set(), symbols: [], entrypoints: [], entrypointFiles: new Set() };
  const pythonFiles = (await collectWorkspaceSourceFiles(rootDir)).filter((file) => file.endsWith('.py'));
  const parser = getParser('py');

  for (const file of pythonFiles) {
    let source: string;
    try {
      source = await readFile(file, 'utf8');
    } catch (error) {
      if (isMissingFileError(error)) continue;
      throw error;
    }
    const tree = parseSource(parser, source);
    indexPythonFile(file, tree.rootNode, index);
  }

  return index;
}

function indexPythonFile(file: string, rootNode: any, index: PythonProjectIndex): void {
  index.files.add(file);

  if (file.endsWith('__main__.py')) {
    index.entrypointFiles.add(file);
  }

  function visit(node: any, ownerName?: string) {
    if (!node?.isNamed) return;

    if (node.type === 'class_definition') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        index.symbols.push({
          file,
          symbol: nameNode.text,
          kind: 'class',
          ownerKind: 'unknown',
          line: node.startPosition.row + 1,
          column: node.startPosition.column,
          node,
          signature: extractPythonSignature(node),
          exported: isExportedPythonName(nameNode.text),
        });
        const body = node.childForFieldName('body');
        if (body) visitClassBody(file, body, nameNode.text, index);
      }
      return;
    }

    if (node.type === 'function_definition') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        index.symbols.push({
          file,
          symbol: nameNode.text,
          kind: ownerName ? 'method' : 'function',
          ownerName,
          ownerKind: ownerName ? 'class' : 'unknown',
          line: node.startPosition.row + 1,
          column: node.startPosition.column,
          node,
          signature: extractPythonSignature(node),
          exported: isExportedPythonName(nameNode.text),
        });
      }
      return;
    }

    if (!ownerName) {
      const assignmentName = getTopLevelAssignmentName(node);
      if (assignmentName) {
        index.symbols.push({
          file,
          symbol: assignmentName,
          kind: 'variable',
          ownerKind: 'unknown',
          line: node.startPosition.row + 1,
          column: node.startPosition.column,
          node,
          exported: isExportedPythonName(assignmentName),
        });
        return;
      }
    }

    for (const child of node.children) visit(child, ownerName);
  }

  visit(rootNode);
  extractMainGuardEntrypoints(file, rootNode, index);
  markEntrypointSymbols(index);
}

function visitClassBody(file: string, bodyNode: any, className: string, index: PythonProjectIndex): void {
  for (const child of bodyNode.children) {
    if (!child?.isNamed) continue;
    if (child.type !== 'function_definition') continue;
    const nameNode = child.childForFieldName('name');
    if (!nameNode) continue;
    index.symbols.push({
      file,
      symbol: nameNode.text,
      kind: 'method',
      ownerName: className,
      ownerKind: 'class',
      line: child.startPosition.row + 1,
      column: child.startPosition.column,
      node: child,
      signature: extractPythonSignature(child),
      exported: isExportedPythonName(nameNode.text),
    });
  }
}

function getTopLevelAssignmentName(node: any): string | undefined {
  if (node.type !== 'assignment' && node.type !== 'typed_assignment') return undefined;
  const left = node.childForFieldName('left');
  if (left?.type === 'identifier') return left.text;
  const name = node.children.find((child: any) => child?.type === 'identifier');
  return name?.text;
}

function extractPythonSignature(node: any): string | undefined {
  const text = node.text;
  const firstLine = text.split('\n')[0]?.trimEnd();
  return firstLine || undefined;
}

function extractMainGuardEntrypoints(file: string, rootNode: any, index: PythonProjectIndex): void {
  function visit(node: any) {
    if (!node?.isNamed) return;
    if (node.type === 'if_statement' && isMainGuard(node)) {
      const body = node.childForFieldName('consequence') ?? node.children.find((child: any) => child?.type === 'block');
      if (body) extractEntrypointCallsFromBlock(file, body, index);
      return;
    }
    for (const child of node.children) visit(child);
  }

  visit(rootNode);
}

function isMainGuard(ifNode: any): boolean {
  const condition = ifNode.childForFieldName('condition') ?? ifNode.children.find((child: any) => child?.isNamed && child.type !== 'block');
  const text = condition?.text?.replace(/\s+/g, '') ?? '';
  return text === '__name__=="__main__"' || text === "__name__=='__main__'";
}

function extractEntrypointCallsFromBlock(file: string, blockNode: any, index: PythonProjectIndex): void {
  for (const statement of blockNode.children) {
    if (!statement?.isNamed) continue;
    const call = statement.type === 'expression_statement'
      ? statement.children.find((child: any) => child?.type === 'call')
      : statement.type === 'call'
        ? statement
        : undefined;
    if (!call) continue;

    const directName = getDirectCallName(call);
    if (directName) {
      index.entrypoints.push({
        file,
        symbol: directName,
        line: statement.startPosition.row + 1,
        column: statement.startPosition.column,
        text: statement.text,
        reason: 'python __main__ guard direct call',
      });
      continue;
    }

    const wrapperArgument = getWrapperCallableArgument(call);
    if (wrapperArgument) {
      index.entrypoints.push({
        file,
        symbol: wrapperArgument,
        line: statement.startPosition.row + 1,
        column: statement.startPosition.column,
        text: statement.text,
        reason: 'python __main__ guard wrapper argument',
      });
    }
  }
}

function getDirectCallName(callNode: any): string | undefined {
  const functionNode = callNode.childForFieldName('function');
  return functionNode?.type === 'identifier' ? functionNode.text : undefined;
}

function getWrapperCallableArgument(callNode: any): string | undefined {
  const functionNode = callNode.childForFieldName('function');
  if (!functionNode || functionNode.type === 'identifier') return undefined;
  const argumentsNode = callNode.childForFieldName('arguments') ?? callNode.children.find((child: any) => child?.type === 'argument_list');
  if (!argumentsNode) return undefined;
  const firstIdentifier = argumentsNode.children.find((child: any) => child?.type === 'identifier');
  return firstIdentifier?.text;
}

function markEntrypointSymbols(index: PythonProjectIndex): void {
  for (const symbol of index.symbols) {
    if (index.entrypointFiles.has(symbol.file)) {
      symbol.entrypoint = true;
      continue;
    }
    if (index.entrypoints.some((entrypoint) => entrypoint.file === symbol.file && entrypoint.symbol === symbol.symbol)) {
      symbol.entrypoint = true;
    }
  }
}

function isExportedPythonName(name: string): boolean {
  return !name.startsWith('_');
}
