import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { FindReferencesInput, ReferenceLocation, ReferenceKind } from '../../types.js';
import {
  buildTypeScriptProjectIndex,
  extractCalls,
  resolveCall,
  type IndexedCallable,
  type IndexedClass,
  type TypeScriptProjectIndex,
} from './function-call-tree.js';
import { resolveTypeScriptImportCandidates, resolveTypeScriptProjectRoot } from './shared.js';

export async function findTypeScriptReferences(cwd: string, input: FindReferencesInput): Promise<ReferenceLocation[]> {
  const rootPath = resolve(cwd, input.path);
  const rootStat = await stat(rootPath).catch(() => undefined);
  const indexRoot = await resolveTypeScriptProjectRoot(rootPath, rootStat?.isDirectory() ?? false);
  const index = await buildTypeScriptProjectIndex(indexRoot);

  if (input.kind === 'function' || input.kind === 'method') {
    return findCallableReferences(index, rootPath, rootStat?.isDirectory() ?? false, input);
  }

  if (input.kind === 'class' || input.kind === 'interface') {
    return findTypeLikeReferences(index, rootPath, rootStat?.isDirectory() ?? false, input);
  }

  if (input.kind === 'variable') {
    return findVariableReferences(index, rootPath, rootStat?.isDirectory() ?? false, input);
  }

  return [];
}

async function findCallableReferences(
  index: TypeScriptProjectIndex,
  rootPath: string,
  isDirectory: boolean,
  input: FindReferencesInput
): Promise<ReferenceLocation[]> {
  const target = index.callables.find((callable) => {
    if (callable.symbol !== input.symbol) return false;
    if (!isDirectory && callable.file !== rootPath) return false;
    if (input.kind && input.kind !== callable.kind) return false;
    return true;
  });
  if (!target) return [];

  const results: ReferenceLocation[] = [];
  for (const caller of index.callables) {
    if (!matchesRequestedLanguage(caller.language, input.language)) continue;
    const aliasNames = collectCallableAliases(caller, target.symbol);

    for (const call of extractCalls(caller.node, { includeNestedCallableBodies: true })) {
      const resolved = resolveCall(index, caller, call);
      if (resolved.callable && sameCallable(resolved.callable, target)) {
        results.push(createCallableReference(caller, target, call.line, call.column, 'call', call.text, resolved.receiverType, call.receiver));
        continue;
      }

      if (!call.receiver && aliasNames.has(call.symbol)) {
        results.push(createCallableReference(caller, target, call.line, call.column, 'call', call.text));
      }
    }

    for (const callback of extractCallbackArguments(caller.node)) {
      if (callback.receiver) continue;
      if (callback.symbol === target.symbol || aliasNames.has(callback.symbol)) {
        results.push(createCallableReference(caller, target, callback.line, callback.column, 'callback', callback.text));
        continue;
      }

      const resolved = resolveCall(index, caller, {
        symbol: callback.symbol,
        receiver: callback.receiver,
        receiverNodeType: callback.receiverNodeType,
        text: callback.text,
        line: callback.line,
        column: callback.column,
      });
      if (resolved.callable && sameCallable(resolved.callable, target)) {
        results.push(createCallableReference(caller, target, callback.line, callback.column, 'callback', callback.text, resolved.receiverType, callback.receiver));
      }
    }
  }

  return dedupeReferences(results);
}

async function findTypeLikeReferences(
  index: TypeScriptProjectIndex,
  rootPath: string,
  isDirectory: boolean,
  input: FindReferencesInput
): Promise<ReferenceLocation[]> {
  const references: ReferenceLocation[] = [];
  const candidateClass = index.classes.find((item) => item.className === input.symbol && (isDirectory || item.file === rootPath));
  const targetFile = candidateClass?.file ?? rootPath;

  for (const file of index.files.values()) {
    if (!matchesRequestedLanguage(file.language, input.language)) continue;
    const localNames = new Set<string>();
    if (file.file === targetFile) localNames.add(input.symbol);

    for (const binding of file.imports.values()) {
      const targetImport = resolveTypeScriptImportCandidates(file.file, binding.source, index.projectConfig).find((candidate) => index.files.has(candidate));
      if (targetImport === targetFile && (binding.importedName === input.symbol || binding.localName === input.symbol)) {
        localNames.add(binding.localName);
        const match = findRegexPosition(file.source, new RegExp(`\\b${escapeRegExp(binding.localName)}\\b`));
        if (match) references.push(createRef(file.file, input, 'import', match.line, match.column, file.source, index));
      }
    }

    for (const localName of localNames) {
      if (input.kind === 'class') {
        for (const match of findAllRegexPositions(file.source, new RegExp(`new\\s+${escapeRegExp(localName)}\\s*\\(`, 'g'))) {
          references.push(createRef(file.file, input, 'instantiate', match.line, match.column, file.source, index));
        }
      }

      for (const match of findAllRegexPositions(file.source, new RegExp(`extends\\s+${escapeRegExp(localName)}\\b`, 'g'))) {
        references.push(createRef(file.file, input, 'extends', match.line, match.column, file.source, index));
      }

      if (input.kind === 'interface') {
        for (const match of findAllRegexPositions(file.source, new RegExp(`implements[^\\n{]*\\b${escapeRegExp(localName)}\\b`, 'g'))) {
          references.push(createRef(file.file, input, 'implements', match.line, match.column, file.source, index));
        }
      }

      for (const match of findAllRegexPositions(file.source, new RegExp(`:\\s*${escapeRegExp(localName)}\\b`, 'g'))) {
        references.push(createRef(file.file, input, 'type_reference', match.line, match.column, file.source, index));
      }
    }
  }

  return dedupeReferences(references);
}

function createRef(
  filePath: string,
  input: FindReferencesInput,
  kind: ReferenceKind,
  line: number,
  column: number,
  source: string,
  index: TypeScriptProjectIndex
): ReferenceLocation {
  const context = findContext(index, filePath, line);
  const endLine = context?.endLine ?? line;
  const endColumn = context?.endColumn ?? source.split('\n')[line - 1]?.length ?? column;
  return {
    file: filePath,
    line,
    column,
    end_line: endLine,
    end_column: endColumn,
    symbol: input.symbol,
    kind: input.kind ?? 'unknown',
    context_symbol: context?.symbol,
    context_kind: context?.kind,
    context_class: context?.className,
    owner_kind: context?.ownerKind ?? 'unknown',
    reference_kind: kind,
    is_application: true,
    source: 'application',
  };
}

function findContext(index: TypeScriptProjectIndex, filePath: string, line: number) {
  const callable = index.callables.find((item) => item.file === filePath && item.line <= line && item.node.endPosition.row + 1 >= line);
  if (callable) {
    return {
      symbol: callable.symbol,
      kind: callable.kind,
      className: callable.ownerName,
      ownerKind: callable.ownerKind,
      endLine: callable.node.endPosition.row + 1,
      endColumn: callable.node.endPosition.column,
    };
  }
  const klass = index.classes.find((item) => item.file === filePath && item.line <= line && item.node.endPosition.row + 1 >= line);
  if (klass) {
    return {
      symbol: klass.className,
      kind: 'class' as const,
      className: klass.className,
      ownerKind: 'class' as const,
      endLine: klass.node.endPosition.row + 1,
      endColumn: klass.node.endPosition.column,
    };
  }
  return undefined;
}

function sameCallable(a: IndexedCallable, b: IndexedCallable): boolean {
  return a.file === b.file && a.symbol === b.symbol && a.kind === b.kind && a.ownerName === b.ownerName;
}

function createCallableReference(
  caller: IndexedCallable,
  target: IndexedCallable,
  line: number,
  column: number,
  kind: 'call' | 'callback',
  text: string,
  receiverType?: string,
  receiverName?: string
): ReferenceLocation {
  return {
    file: caller.file,
    line,
    column,
    end_line: caller.node.endPosition.row + 1,
    end_column: caller.node.endPosition.column,
    symbol: target.symbol,
    kind: target.kind,
    context_symbol: caller.symbol,
    context_kind: caller.kind,
    context_class: caller.ownerName,
    owner_kind: caller.ownerKind,
    reference_kind: kind,
    called_as: text,
    receiver_name: receiverName,
    receiver_type: receiverType,
    is_application: true,
    source: 'application',
  };
}

function collectCallableAliases(caller: IndexedCallable, targetSymbol: string): Set<string> {
  const body = caller.node.childForFieldName('body') ?? caller.node.childForFieldName('value');
  if (!body?.text) return new Set();

  const aliases = new Set<string>();
  const aliasPattern = new RegExp(`\\b(?:const|let|var)\\s+(\\w+)\\s*=\\s*${escapeRegExp(targetSymbol)}\\b`, 'g');
  let match: RegExpExecArray | null;
  while ((match = aliasPattern.exec(body.text)) !== null) {
    if (match[1]) aliases.add(match[1]);
  }
  return aliases;
}

function extractCallbackArguments(callableNode: any): Array<{ symbol: string; receiver?: string; receiverNodeType?: string; text: string; line: number; column: number }> {
  const body = callableNode.childForFieldName('body') ?? callableNode.childForFieldName('value');
  if (!body) return [];

  const callbacks: Array<{ symbol: string; receiver?: string; receiverNodeType?: string; text: string; line: number; column: number }> = [];

  function visit(node: any, nestedCallable = false): void {
    if (!node?.isNamed) return;
    if (nestedCallable && isNestedCallableBoundary(node)) return;

    if (node.type === 'call_expression') {
      const argsNode = node.childForFieldName('arguments') ?? node.children.find((child: any) => child.type === 'arguments');
      if (argsNode) {
        for (const arg of argsNode.namedChildren ?? []) {
          if (arg.type === 'identifier') {
            callbacks.push({
              symbol: arg.text,
              text: arg.text,
              line: arg.startPosition.row + 1,
              column: arg.startPosition.column,
            });
          }
        }
      }
    }

    for (const child of node.children) {
      visit(child, true);
    }
  }

  visit(body, false);
  return callbacks;
}

function isNestedCallableBoundary(node: any): boolean {
  return node.type === 'function_declaration'
    || node.type === 'function_expression'
    || node.type === 'arrow_function'
    || node.type === 'method_definition';
}

function findRegexPosition(source: string, pattern: RegExp) {
  const match = pattern.exec(source);
  if (!match || match.index === undefined) return undefined;
  return offsetToLineColumn(source, match.index);
}

function findAllRegexPositions(source: string, pattern: RegExp) {
  const results: Array<{ line: number; column: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    results.push(offsetToLineColumn(source, match.index));
  }
  return results;
}

function offsetToLineColumn(source: string, offset: number) {
  const prefix = source.slice(0, offset);
  const lines = prefix.split('\n');
  return { line: lines.length, column: lines[lines.length - 1].length };
}

function dedupeReferences(references: ReferenceLocation[]): ReferenceLocation[] {
  const seen = new Set<string>();
  return references.filter((item) => {
    const key = `${item.file}:${item.line}:${item.column}:${item.reference_kind}:${item.context_symbol ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function findVariableReferences(
  index: TypeScriptProjectIndex,
  rootPath: string,
  isDirectory: boolean,
  input: FindReferencesInput
): Promise<ReferenceLocation[]> {
  const targetFiles = [...index.files.values()].filter((file) => (isDirectory || file.file === rootPath) && matchesRequestedLanguage(file.language, input.language));
  const declarationExists = targetFiles.some((file) => new RegExp(`\\b(?:export\\s+)?(?:let|const|var)\\s+${escapeRegExp(input.symbol)}\\b`).test(file.source));
  if (!declarationExists) return [];

  const references: ReferenceLocation[] = [];
  for (const file of index.files.values()) {
    if (!matchesRequestedLanguage(file.language, input.language)) continue;
    const lines = file.source.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!new RegExp(`\\b${escapeRegExp(input.symbol)}\\b`).test(line)) continue;
      if (new RegExp(`\\b(?:export\\s+)?(?:let|const|var)\\s+${escapeRegExp(input.symbol)}\\b`).test(line)) continue;

      const context = findContext(index, file.file, i + 1);
      if (!context) continue;

      const writeMatch = line.match(new RegExp(`\\b${escapeRegExp(input.symbol)}\\b\\s*=`));
      if (writeMatch) {
        references.push(createRef(file.file, input, 'write', i + 1, writeMatch.index ?? 0, file.source, index));
      }

      const readMatch = line.match(new RegExp(`(?:return\\s+)?\\b${escapeRegExp(input.symbol)}\\b(?!\\s*=)`));
      if (readMatch && !(writeMatch && readMatch.index === writeMatch.index)) {
        references.push(createRef(file.file, input, 'read', i + 1, readMatch.index ?? 0, file.source, index));
      }
    }
  }

  return dedupeReferences(references);
}

function matchesRequestedLanguage(indexedLanguage: string, requestedLanguage: FindReferencesInput['language']): boolean {
  if (!requestedLanguage || requestedLanguage === 'auto') return true;
  return indexedLanguage === requestedLanguage;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
