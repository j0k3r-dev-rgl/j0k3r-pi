import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { FindReferencesInput, ReferenceLocation, ReferenceKind } from '../../types.js';
import {
  buildTypeScriptProjectIndex,
  extractCalls,
  resolveCall,
  resolveExportedCallable,
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
    const variableReferences = await findVariableReferences(index, rootPath, rootStat?.isDirectory() ?? false, input);
    if (variableReferences.length > 0) return variableReferences;
    return findTypeAliasReferences(index, rootPath, rootStat?.isDirectory() ?? false, input);
  }

  const isDirectory = rootStat?.isDirectory() ?? false;
  const results: ReferenceLocation[] = [];
  results.push(...await findCallableReferences(index, rootPath, isDirectory, { ...input, kind: 'function' }));
  results.push(...await findCallableReferences(index, rootPath, isDirectory, { ...input, kind: 'method' }));
  results.push(...await findTypeLikeReferences(index, rootPath, isDirectory, { ...input, kind: 'class' }));
  results.push(...await findTypeLikeReferences(index, rootPath, isDirectory, { ...input, kind: 'interface' }));
  results.push(...await findVariableReferences(index, rootPath, isDirectory, { ...input, kind: 'variable' }));
  return dedupeReferences(results);
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
  if (!target) {
    if (input.kind === 'method' && !isDirectory) return findInterfaceMethodReferencesBySource(index, rootPath, input);
    return [];
  }

  const results: ReferenceLocation[] = [];
  if (isJsxLikeFile(target.file)) {
    for (const file of index.files.values()) {
      if (!matchesRequestedLanguage(file.language, input.language)) continue;
      const localNames = new Set<string>();
      if (file.file === target.file) localNames.add(target.symbol);

      for (const binding of file.imports.values()) {
        const targetImport = resolveTypeScriptImportCandidates(file.file, binding.source, index.projectConfig).find((candidate) => index.files.has(candidate));
        if (!targetImport) continue;
        const exported = binding.importedName === 'default'
          ? resolveExportedCallable(index, targetImport, 'default')
          : resolveExportedCallable(index, targetImport, binding.importedName) ?? resolveExportedCallable(index, targetImport, target.symbol);
        if (!exported || !sameCallable(exported, target)) continue;

        localNames.add(binding.localName);
        const match = findRegexPosition(file.source, new RegExp(`\\b${escapeRegExp(binding.localName)}\\b`));
        if (match) results.push(createRef(file.file, input, 'import', match.line, match.column, file.source, index));
      }

      for (const localName of localNames) {
        const jsxTagPattern = new RegExp(`<\\s*${escapeRegExp(localName)}(?:\\s|/|>)`, 'g');
        for (const match of findAllRegexPositions(file.source, jsxTagPattern)) {
          results.push(createRef(file.file, input, 'read', match.line, match.column, file.source, index));
        }
      }
    }
  }

  for (const topLevelReference of findTopLevelCallableReferences(index, target, input)) {
    results.push(topLevelReference);
  }

  if (target.kind === 'method' && target.ownerName) {
    for (const receiverReference of findMethodReferencesByReceiverHeuristic(index, target, input)) {
      results.push(receiverReference);
    }
    for (const typedReceiverReference of findMethodReferencesByTypedReceivers(index, target, input)) {
      results.push(typedReceiverReference);
    }
  }

  for (const caller of index.callables) {
    if (!matchesRequestedLanguage(caller.language, input.language)) continue;
    const aliasNames = collectCallableAliases(caller, target.symbol);

    for (const call of extractCalls(caller.node, { includeNestedCallableBodies: true })) {
      const resolved = resolveCall(index, caller, call);
      if (resolved.callable && sameCallable(resolved.callable, target)) {
        results.push(createCallableReference(caller, target, call.line, call.column, 'call', call.text, resolved.receiverType, call.receiver, (resolved as any).reason));
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
        results.push(createCallableReference(caller, target, callback.line, callback.column, 'callback', callback.text, resolved.receiverType, callback.receiver, (resolved as any).reason));
      }
    }
  }

  return dedupeReferences(results);
}

function findTopLevelCallableReferences(index: TypeScriptProjectIndex, target: IndexedCallable, input: FindReferencesInput): ReferenceLocation[] {
  if (target.kind !== 'function') return [];
  const results: ReferenceLocation[] = [];
  for (const file of index.files.values()) {
    if (!matchesRequestedLanguage(file.language, input.language)) continue;
    const localNames = collectCallableAliasesForFile(index, file, target);
    if (file.file === target.file) localNames.add(target.symbol);
    for (const localName of localNames) {
      const pattern = new RegExp(`\\b${escapeRegExp(localName)}\\s*\\(`, 'g');
      for (const match of findAllRegexPositions(file.source, pattern)) {
        if (findContext(index, file.file, match.line)) continue;
        results.push({
          file: file.file,
          line: match.line,
          column: match.column,
          symbol: target.symbol,
          kind: target.kind,
          context_symbol: '<top-level>',
          context_kind: 'function',
          owner_kind: 'module',
          reference_kind: 'call',
          called_as: extractCallText(file.source, match.line, match.column),
          is_application: true,
          source: 'application',
        });
      }
    }
  }
  return results;
}

function findMethodReferencesByReceiverHeuristic(index: TypeScriptProjectIndex, target: IndexedCallable, input: FindReferencesInput): ReferenceLocation[] {
  const ownerName = target.ownerName;
  if (!ownerName) return [];
  const results: ReferenceLocation[] = [];
  for (const file of index.files.values()) {
    if (!matchesRequestedLanguage(file.language, input.language)) continue;
    const receiverNames = collectReceiversForClass(index, file, ownerName);
    if (receiverNames.size === 0) continue;
    for (const receiver of receiverNames) {
      const pattern = new RegExp(`\\b${escapeRegExp(receiver)}\\s*\\.\\s*${escapeRegExp(target.symbol)}\\s*\\(`, 'g');
      for (const match of findAllRegexPositions(file.source, pattern)) {
        const context = findContext(index, file.file, match.line);
        results.push({
          file: file.file,
          line: match.line,
          column: match.column,
          end_line: match.line,
          end_column: match.column + extractCallText(file.source, match.line, match.column).length,
          symbol: target.symbol,
          kind: 'method',
          context_symbol: context?.symbol ?? '<top-level>',
          context_kind: context?.kind ?? 'function',
          context_class: context?.className,
          owner_kind: context?.ownerKind ?? 'module',
          reference_kind: 'call',
          called_as: extractCallText(file.source, match.line, match.column),
          receiver_name: receiver,
          receiver_type: ownerName,
          is_application: true,
          source: 'application',
        });
      }
    }
  }
  return results;
}

function findInterfaceMethodReferencesBySource(index: TypeScriptProjectIndex, rootPath: string, input: FindReferencesInput): ReferenceLocation[] {
  const file = index.files.get(rootPath);
  if (!file) return [];
  const interfaceMatch = file.source.match(new RegExp(`interface\\s+([A-Za-z_$][\\w$]*)[^{]*{[\\s\\S]*?\\b${escapeRegExp(input.symbol)}\\s*\\(`));
  const ownerName = interfaceMatch?.[1];
  if (!ownerName) return [];
  return findMethodReferencesByTypedReceiverTargets(index, input, input.symbol, [{ ownerName, ownerFile: rootPath, reason: 'receiver-type-contract-method' }]);
}

function findMethodReferencesByTypedReceivers(index: TypeScriptProjectIndex, target: IndexedCallable, input: FindReferencesInput): ReferenceLocation[] {
  const ownerName = target.ownerName;
  if (!ownerName) return [];

  const receiverTargets: Array<{ ownerName: string; ownerFile?: string; reason: string }> = [
    { ownerName, ownerFile: target.file, reason: 'receiver-type-contract-method' },
  ];

  {
    for (const interfaceName of collectImplementedInterfaceNames(index, target)) {
      receiverTargets.push({ ownerName: interfaceName, reason: 'ambiguous-interface-implementation' });
    }
    for (const structural of index.callables) {
      if (structural === target) continue;
      if (structural.kind !== 'method' || structural.symbol !== target.symbol || !structural.ownerName) continue;
      if (structural.ownerName === ownerName) continue;
      if (receiverTargets.some((candidate) => candidate.ownerName === structural.ownerName)) continue;
      receiverTargets.push({ ownerName: structural.ownerName, ownerFile: structural.file, reason: 'structural-implementation' });
    }
  }

  for (const receiverType of collectTypedReceiverTypesForMethod(index, target.symbol)) {
    if (receiverType === ownerName || receiverTargets.some((candidate) => candidate.ownerName === receiverType)) continue;
    const hasMatchingOwner = index.callables.some((callable) => callable.kind === 'method' && callable.symbol === target.symbol && callable.ownerName === receiverType);
    receiverTargets.push({
      ownerName: receiverType,
      reason: hasMatchingOwner ? 'structural-implementation' : 'ambiguous-interface-implementation',
    });
  }

  return findMethodReferencesByTypedReceiverTargets(index, input, target.symbol, receiverTargets);
}

function collectTypedReceiverTypesForMethod(index: TypeScriptProjectIndex, methodName: string): Set<string> {
  const types = new Set<string>();
  for (const file of index.files.values()) {
    const declarations = new Map<string, string>();
    for (const match of file.source.matchAll(/\b([A-Za-z_$][\w$]*)\??\s*:\s*([A-Za-z_$][\w$]*)\b/g)) {
      if (match[1] && match[2]) {
        declarations.set(match[1], match[2]);
        declarations.set(`this.${match[1]}`, match[2]);
      }
    }
    for (const [receiver, receiverType] of declarations) {
      const receiverPattern = receiver.includes('.') ? escapeRegExp(receiver) : `(?<![.\\w$])${escapeRegExp(receiver)}`;
      if (new RegExp(`${receiverPattern}\\s*\\.\\s*${escapeRegExp(methodName)}\\s*\\(`).test(file.source)) types.add(receiverType);
    }
  }
  return types;
}

function findMethodReferencesByTypedReceiverTargets(
  index: TypeScriptProjectIndex,
  input: FindReferencesInput,
  methodName: string,
  receiverTargets: Array<{ ownerName: string; ownerFile?: string; reason: string }>
): ReferenceLocation[] {
  const results: ReferenceLocation[] = [];
  for (const file of index.files.values()) {
    if (!matchesRequestedLanguage(file.language, input.language)) continue;
    for (const receiverTarget of receiverTargets) {
      const receivers = collectTypedReceiversForType(index, file, receiverTarget.ownerName, receiverTarget.ownerFile);
      for (const propertyReference of findObjectLiteralMethodReferences(index, file, input, methodName, receiverTarget)) {
        results.push(propertyReference);
      }
      for (const receiver of receivers) {
        const receiverPattern = receiver.includes('.') ? escapeRegExp(receiver) : `(?<![.\\w$])${escapeRegExp(receiver)}`;
        const pattern = new RegExp(`${receiverPattern}\\s*\\.\\s*${escapeRegExp(methodName)}\\s*\\(`, 'g');
        for (const match of findAllRegexPositions(file.source, pattern)) {
          const context = findContext(index, file.file, match.line);
          results.push({
            file: file.file,
            line: match.line,
            column: match.column,
            end_line: match.line,
            end_column: match.column + extractCallText(file.source, match.line, match.column).length,
            symbol: input.symbol,
            kind: 'method',
            context_symbol: context?.symbol ?? '<top-level>',
            context_kind: context?.kind ?? 'function',
            context_class: context?.className,
            owner_kind: context?.ownerKind ?? 'module',
            reference_kind: 'call',
            called_as: extractCallText(file.source, match.line, match.column),
            receiver_name: receiver,
            receiver_type: receiverTarget.ownerName,
            is_application: true,
            source: 'application',
            reason: receiverTarget.reason,
          });
        }
      }
    }
  }
  return results;
}

function findObjectLiteralMethodReferences(
  index: TypeScriptProjectIndex,
  file: { file: string; source: string; imports: Map<string, any> },
  input: FindReferencesInput,
  methodName: string,
  receiverTarget: { ownerName: string; ownerFile?: string; reason: string }
): ReferenceLocation[] {
  const results: ReferenceLocation[] = [];
  const localTypeNames = collectLocalTypeNames(index, file, receiverTarget.ownerName, receiverTarget.ownerFile);
  for (const localTypeName of localTypeNames) {
    const objectPattern = new RegExp(`(?:const|let|var)\\s+[A-Za-z_$][\\w$]*\\s*:\\s*${escapeRegExp(localTypeName)}\\b\\s*=\\s*\\{[\\s\\S]*?\\b${escapeRegExp(methodName)}\\s*(?::|\\()`, 'g');
    for (const match of findAllRegexPositions(file.source, objectPattern)) {
      const context = findContext(index, file.file, match.line);
      const calledAs = extractCallText(file.source, match.line, match.column);
      results.push({
        file: file.file,
        line: match.line,
        column: match.column,
        end_line: match.line,
        end_column: match.column + calledAs.length,
        symbol: input.symbol,
        kind: 'method',
        context_symbol: context?.symbol ?? '<top-level>',
        context_kind: context?.kind ?? 'function',
        context_class: context?.className,
        owner_kind: context?.ownerKind ?? 'module',
        reference_kind: 'method_reference',
        called_as: calledAs,
        receiver_type: receiverTarget.ownerName,
        is_application: true,
        source: 'application',
        reason: `object-literal implementation of ${receiverTarget.ownerName}`,
      });
    }
  }
  return results;
}

function collectImplementedInterfaceNames(index: TypeScriptProjectIndex, target: IndexedCallable): string[] {
  if (!target.ownerName) return [];
  const file = index.files.get(target.file);
  if (!file) return [];
  const classPattern = new RegExp(`class\\s+${escapeRegExp(target.ownerName)}[^{}]*\\bimplements\\s+([^{}]+?)(?:\\{|$)`, 'm');
  const match = file.source.match(classPattern);
  if (!match?.[1]) return [];
  return match[1]
    .split(',')
    .map((item) => item.trim().replace(/<.*$/, '').split(/\s+/)[0])
    .filter(Boolean);
}

function collectTypedReceiversForType(
  index: TypeScriptProjectIndex,
  file: { file: string; source: string; imports: Map<string, any> },
  typeName: string,
  typeFile?: string
): Set<string> {
  const receivers = new Set<string>();
  const localTypeNames = collectLocalTypeNames(index, file, typeName, typeFile);

  for (const localTypeName of localTypeNames) {
    const typePattern = new RegExp(`\\b([A-Za-z_$][\\w$]*)\\??\\s*:\\s*${escapeRegExp(localTypeName)}\\b`, 'g');
    for (const match of file.source.matchAll(typePattern)) {
      const receiver = match[1];
      if (!receiver || ['const', 'let', 'var', 'function'].includes(receiver)) continue;
      receivers.add(receiver);
      receivers.add(`this.${receiver}`);
    }
  }
  return receivers;
}

function collectLocalTypeNames(
  index: TypeScriptProjectIndex,
  file: { file: string; imports: Map<string, any> },
  typeName: string,
  typeFile?: string
): Set<string> {
  const localTypeNames = new Set<string>([typeName]);
  for (const binding of file.imports.values()) {
    const candidates = resolveTypeScriptImportCandidates(file.file, binding.source, index.projectConfig);
    const targetFile = candidates.find((candidate) => index.files.has(candidate));
    if (binding.importedName === typeName && (!typeFile || targetFile === typeFile)) localTypeNames.add(binding.localName);
  }
  return localTypeNames;
}

function collectCallableAliasesForFile(index: TypeScriptProjectIndex, file: { file: string; imports: Map<string, any> }, target: IndexedCallable): Set<string> {
  const localNames = new Set<string>();
  for (const binding of file.imports.values()) {
    const resolved = binding.importedName === 'default'
      ? resolveImportedCallable(index, file.file, binding)
      : resolveImportedCallable(index, file.file, binding) ?? undefined;
    if (resolved && sameCallable(resolved, target)) localNames.add(binding.localName);
  }
  return localNames;
}

function resolveImportedCallable(index: TypeScriptProjectIndex, currentFile: string, binding: any): IndexedCallable | undefined {
  if (binding.kind === 'namespace') return undefined;
  const targetFile = resolveTypeScriptImportCandidates(currentFile, binding.source, index.projectConfig).find((candidate) => index.files.has(candidate));
  if (!targetFile) return undefined;
  return resolveExportedCallable(index, targetFile, binding.importedName);
}

function resolveImportedClass(index: TypeScriptProjectIndex, currentFile: string, binding: any): IndexedClass | undefined {
  if (binding.kind === 'namespace') return undefined;
  const targetFile = resolveTypeScriptImportCandidates(currentFile, binding.source, index.projectConfig).find((candidate) => index.files.has(candidate));
  if (!targetFile) return undefined;
  return index.classes.find((item) => item.file === targetFile && item.exportedName === binding.importedName);
}

function collectReceiversForClass(index: TypeScriptProjectIndex, file: { file: string; source: string; imports: Map<string, any> }, className: string): Set<string> {
  const receivers = new Set<string>();
  const localClassNames = new Set<string>([className]);
  for (const binding of file.imports.values()) {
    const resolved = resolveImportedClass(index, file.file, binding);
    if (resolved?.className === className) localClassNames.add(binding.localName);
  }
  for (const localClassName of localClassNames) {
    for (const match of file.source.matchAll(new RegExp(`\\b(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*(?::\\s*${escapeRegExp(localClassName)}\\b)?\\s*=\\s*[^;\n]*new\\s+${escapeRegExp(localClassName)}\\s*\\(`, 'g'))) {
      if (match[1]) receivers.add(match[1]);
    }
    for (const match of file.source.matchAll(new RegExp(`\\b(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*:\\s*${escapeRegExp(localClassName)}\\b`, 'g'))) {
      if (match[1]) receivers.add(match[1]);
    }
    for (const match of file.source.matchAll(new RegExp(`\\b([A-Za-z_$][\\w$]*)\\??\\s*:\\s*${escapeRegExp(localClassName)}\\b`, 'g'))) {
      if (match[1] && !['const', 'let', 'var'].includes(match[1])) receivers.add(match[1]);
    }
  }
  return receivers;
}

function extractCallText(source: string, line: number, column: number): string {
  const lineText = source.split('\n')[line - 1] ?? '';
  const tail = lineText.slice(column);
  const match = tail.match(/^[^;\n]+/);
  return (match?.[0] ?? tail).trim();
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

      for (const match of findAllRegexPositions(file.source, new RegExp(`\\bas\\s+${escapeRegExp(localName)}\\b`, 'g'))) {
        references.push(createRef(file.file, input, 'type_reference', match.line, match.column, file.source, index));
      }
      for (const match of findAllRegexPositions(file.source, new RegExp(`<\\s*${escapeRegExp(localName)}\\s*>`, 'g'))) {
        references.push(createRef(file.file, input, 'type_reference', match.line, match.column, file.source, index));
      }
    }
  }

  return dedupeReferences(references);
}

function isJsxLikeFile(filePath: string): boolean {
  return /\.[jt]sx$/i.test(filePath);
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
  receiverName?: string,
  reason?: string
): ReferenceLocation {
  return {
    file: caller.file,
    line,
    column,
    end_line: line,
    end_column: column + text.length,
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
    reason,
  };
}

function collectCallableAliases(caller: IndexedCallable, targetSymbol: string): Set<string> {
  const body = caller.node.childForFieldName('body') ?? caller.node.childForFieldName('value');
  if (!body?.text) return new Set();

  const aliases = new Set<string>();
  const aliasPattern = new RegExp(`\\b(?:const|let|var)\\s+(\\w+)\\s*=\\s*${escapeRegExp(targetSymbol)}\\b`, 'g');
  let match: RegExpExecArray | null;
  while ((match = aliasPattern.exec(body.text)) !== null) {
    if (!match[1]) continue;
    if (isCallableResultAliasInitializer(body.text, aliasPattern.lastIndex)) continue;
    aliases.add(match[1]);
  }
  return aliases;
}

function isCallableResultAliasInitializer(source: string, targetEndOffset: number): boolean {
  const tail = source.slice(targetEndOffset);
  return /^\s*(?:\?\.)?\s*\(/.test(tail);
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
  const byKey = new Map<string, ReferenceLocation>();
  for (const item of references) {
    const key = `${item.file}:${item.line}:${item.column}:${item.reference_kind}:${item.context_symbol ?? ''}:${item.called_as ?? ''}`;
    const existing = byKey.get(key);
    if (!existing || referenceMetadataScore(item) > referenceMetadataScore(existing)) {
      byKey.set(key, item);
    }
  }
  return [...byKey.values()];
}

function referenceMetadataScore(item: ReferenceLocation): number {
  return [
    item.receiver_name,
    item.receiver_type,
    item.context_class,
    item.called_as,
    item.reason,
    item.end_line,
    item.end_column,
  ].filter((value) => value !== undefined && value !== '').length;
}

async function findVariableReferences(
  index: TypeScriptProjectIndex,
  rootPath: string,
  isDirectory: boolean,
  input: FindReferencesInput
): Promise<ReferenceLocation[]> {
  const targetFiles = [...index.files.values()].filter((file) => (isDirectory || file.file === rootPath) && matchesRequestedLanguage(file.language, input.language));
  const declarationPattern = new RegExp(`\\b(?:export\\s+)?(?:let|const|var)\\s+${escapeRegExp(input.symbol)}\\b`);
  const declarationFiles = new Set(targetFiles.filter((file) => declarationPattern.test(file.source)).map((file) => file.file));
  if (declarationFiles.size === 0) return [];

  const references: ReferenceLocation[] = [];
  for (const file of index.files.values()) {
    if (!matchesRequestedLanguage(file.language, input.language)) continue;
    const localNames = new Set<string>();
    if (declarationFiles.has(file.file)) localNames.add(input.symbol);

    for (const binding of file.imports.values()) {
      const targetImport = resolveTypeScriptImportCandidates(file.file, binding.source, index.projectConfig).find((candidate) => declarationFiles.has(candidate));
      if (targetImport && (binding.importedName === input.symbol || binding.localName === input.symbol)) {
        localNames.add(binding.localName);
        const match = findRegexPosition(file.source, new RegExp(`\\b${escapeRegExp(binding.localName)}\\b`));
        if (match) references.push(createRef(file.file, input, 'import', match.line, match.column, file.source, index));
      }
    }

    if (localNames.size === 0) continue;
    const lines = file.source.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*import\b/.test(line)) continue;
      for (const localName of localNames) {
        const symbolPattern = new RegExp(`\\b${escapeRegExp(localName)}\\b`, 'g');
        let match: RegExpExecArray | null;
        while ((match = symbolPattern.exec(line)) !== null) {
          if (declarationPattern.test(line) && localName === input.symbol) continue;
          const assignmentTail = line.slice(match.index + localName.length);
          const kind: ReferenceKind = /^\s*=/.test(assignmentTail) ? 'write' : 'read';
          references.push(createRef(file.file, input, kind, i + 1, match.index, file.source, index));
        }
      }
    }
  }

  return dedupeReferences(references);
}

async function findTypeAliasReferences(
  index: TypeScriptProjectIndex,
  rootPath: string,
  isDirectory: boolean,
  input: FindReferencesInput
): Promise<ReferenceLocation[]> {
  const targetFiles = [...index.files.values()].filter((file) => (isDirectory || file.file === rootPath) && matchesRequestedLanguage(file.language, input.language));
  const declarationPattern = new RegExp(`\\b(?:export\\s+)?type\\s+${escapeRegExp(input.symbol)}\\b`);
  const declarationFiles = new Set(targetFiles.filter((file) => declarationPattern.test(file.source)).map((file) => file.file));
  if (declarationFiles.size === 0) return [];

  const references: ReferenceLocation[] = [];
  for (const file of index.files.values()) {
    if (!matchesRequestedLanguage(file.language, input.language)) continue;
    const localNames = new Set<string>();
    if (declarationFiles.has(file.file)) localNames.add(input.symbol);

    for (const binding of file.imports.values()) {
      const targetImport = resolveTypeScriptImportCandidates(file.file, binding.source, index.projectConfig).find((candidate) => declarationFiles.has(candidate));
      if (targetImport && (binding.importedName === input.symbol || binding.localName === input.symbol)) {
        localNames.add(binding.localName);
        const match = findRegexPosition(file.source, new RegExp(`\\b${escapeRegExp(binding.localName)}\\b`));
        if (match) references.push(createRef(file.file, input, 'import', match.line, match.column, file.source, index));
      }
    }

    if (localNames.size === 0) continue;
    const lines = file.source.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*import\b/.test(line)) continue;
      for (const localName of localNames) {
        const symbolPattern = new RegExp(`\\b${escapeRegExp(localName)}\\b`, 'g');
        let match: RegExpExecArray | null;
        while ((match = symbolPattern.exec(line)) !== null) {
          if (declarationPattern.test(line) && localName === input.symbol) continue;
          references.push(createRef(file.file, input, 'read', i + 1, match.index, file.source, index));
        }
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
