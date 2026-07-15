import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { FindReferencesInput, ReferenceKind, ReferenceLocation } from '../../types.js';
import { buildProjectIndex, type IndexedClass, type IndexedMethod, type ProjectIndex } from '../../core/project-index.js';
import { resolveJavaCallsForGraph, resolveJavaIndexRoot } from './function-call-tree.js';

export async function findJavaReferences(cwd: string, input: FindReferencesInput): Promise<ReferenceLocation[]> {
  const rootFile = resolve(cwd, input.path);
  const rootStat = await stat(rootFile).catch(() => undefined);
  const indexRoot = rootStat?.isDirectory() ? rootFile : await resolveJavaIndexRoot(rootFile);
  const index = await buildProjectIndex(indexRoot);

  if (input.kind === 'method') {
    return await findMethodReferences(index, rootFile, rootStat?.isDirectory() ?? false, input);
  }

  if (input.kind === 'class' || input.kind === 'interface') {
    return findTypeReferences(index, rootFile, rootStat?.isDirectory() ?? false, input);
  }

  if (input.kind === 'variable') {
    return findVariableReferences(index, rootFile, rootStat?.isDirectory() ?? false, input);
  }

  return [];
}

async function findMethodReferences(index: ProjectIndex, rootFile: string, isDirectory: boolean, input: FindReferencesInput): Promise<ReferenceLocation[]> {
  const target = index.methods.find((method) => {
    if (method.symbol !== input.symbol) return false;
    if (!isDirectory && method.file !== rootFile) return false;
    return true;
  });
  if (!target) return [];

  const results: ReferenceLocation[] = [];
  const sourceCache = new Map<string, string>();
  const getSource = async (file: string) => {
    if (!sourceCache.has(file)) sourceCache.set(file, await readFile(file, 'utf8'));
    return sourceCache.get(file)!;
  };

  for (const caller of index.methods) {
    for (const resolvedCall of resolveJavaCallsForGraph(caller, index)) {
      if (!resolvedCall.targetMethod || !sameMethod(resolvedCall.targetMethod, target)) continue;
      results.push({
        file: caller.file,
        line: resolvedCall.call.line,
        column: resolvedCall.call.column,
        end_line: caller.node.endPosition.row + 1,
        end_column: caller.node.endPosition.column,
        symbol: target.symbol,
        kind: 'method',
        context_symbol: caller.symbol,
        context_kind: 'method',
        context_class: caller.className,
        owner_kind: 'class',
        reference_kind: 'call',
        called_as: resolvedCall.call.callText,
        receiver_name: resolvedCall.call.object,
        receiver_type: resolvedCall.resolved?.receiverType,
        is_application: true,
        source: 'application',
      });
    }

    const source = await getSource(caller.file);
    const lines = source.split('\n').slice(caller.line - 1, caller.node.endPosition.row + 1);
    for (let indexOffset = 0; indexOffset < lines.length; indexOffset++) {
      const line = lines[indexOffset];
      const lineNumber = caller.line + indexOffset;

      const callbackMatch = line.match(new RegExp(`->[^\n]*\\b${escapeRegExp(target.symbol)}\\s*\\(`));
      if (callbackMatch) {
        results.push({
          file: caller.file,
          line: lineNumber,
          column: callbackMatch.index ?? 0,
          end_line: caller.node.endPosition.row + 1,
          end_column: caller.node.endPosition.column,
          symbol: target.symbol,
          kind: 'method',
          context_symbol: caller.symbol,
          context_kind: 'method',
          context_class: caller.className,
          owner_kind: 'class',
          reference_kind: 'callback',
          called_as: callbackMatch[0],
          is_application: true,
          source: 'application',
        });
      }

      const methodReferenceMatch = line.match(new RegExp(`(?:this|${escapeRegExp(caller.className)})::${escapeRegExp(target.symbol)}\\b`));
      if (methodReferenceMatch) {
        results.push({
          file: caller.file,
          line: lineNumber,
          column: methodReferenceMatch.index ?? 0,
          end_line: caller.node.endPosition.row + 1,
          end_column: caller.node.endPosition.column,
          symbol: target.symbol,
          kind: 'method',
          context_symbol: caller.symbol,
          context_kind: 'method',
          context_class: caller.className,
          owner_kind: 'class',
          reference_kind: 'method_reference',
          called_as: methodReferenceMatch[0],
          is_application: true,
          source: 'application',
        });
      }
    }
  }

  return dedupeReferences(results);
}

async function findTypeReferences(index: ProjectIndex, rootFile: string, isDirectory: boolean, input: FindReferencesInput): Promise<ReferenceLocation[]> {
  const target = index.classes.find((klass) => {
    if (klass.className !== input.symbol) return false;
    if (!isDirectory && klass.file !== rootFile) return false;
    if (input.kind && klass.kind !== input.kind) return false;
    return true;
  });
  if (!target) return [];

  const sourceCache = new Map<string, string>();
  const getSource = async (file: string) => {
    if (!sourceCache.has(file)) sourceCache.set(file, await readFile(file, 'utf8'));
    return sourceCache.get(file)!;
  };

  const results: ReferenceLocation[] = [];

  for (const fileImports of index.imports.values()) {
    const imported = fileImports.imports.get(target.className);
    if (imported === target.fullName || (!imported && fileImports.package === target.package && fileImports.file !== target.file)) {
      const source = await getSource(fileImports.file);
      const match = findRegexPosition(source, new RegExp(`import\\s+${escapeRegExp(target.fullName)}\\s*;`));
      if (match) results.push(createRef(fileImports.file, input, 'import', match.line, match.column, index));
    }
  }

  for (const klass of index.classes) {
    if (klass.file === target.file && klass.className === target.className) continue;
    const klassSource = await getSource(klass.file);
    if (klass.extends?.some((value) => value === target.className || value === target.fullName)) {
      results.push(createRef(klass.file, input, 'extends', klass.line, klass.column, index, klass.className, klass.kind, buildJavaTypeRelationshipMetadata(klassSource, klass.line, 'extends', target.className)));
    }
    if (input.kind === 'interface' && klass.implements.some((value) => value === target.className || value === target.fullName)) {
      results.push(createRef(klass.file, input, 'implements', klass.line, klass.column, index, klass.className, klass.kind, buildJavaTypeRelationshipMetadata(klassSource, klass.line, 'implements', target.className)));
    }
  }

  if (input.kind === 'interface') {
    for (const fileImports of index.imports.values()) {
      const source = await getSource(fileImports.file);
      for (const match of findAllRegexPositions(source, new RegExp(`interface\\s+\\w+\\s+extends\\s+${escapeRegExp(target.className)}\\b`, 'g'))) {
        const context = index.classes.find((klass) => klass.file === fileImports.file && klass.line <= match.line);
        results.push(createRef(fileImports.file, input, 'extends', match.line, match.column, index, context?.className, context?.kind, buildJavaTypeRelationshipMetadata(source, match.line, 'extends', target.className)));
      }
    }
  }

  for (const field of index.fields) {
    if (field.file === target.file && field.className === target.className) continue;
    if (field.typeName === target.className || field.fullTypeName === target.fullName) {
      results.push(createRef(field.file, input, 'type_reference', field.line, field.column, index, field.className, 'class'));
    }
  }

  if (input.kind === 'class') {
    for (const fileImports of index.imports.values()) {
      const source = await getSource(fileImports.file);
      for (const match of findAllRegexPositions(source, new RegExp(`new\\s+${escapeRegExp(target.className)}(?:\\s*<[^>]*>)?\\s*\\(`, 'g'))) {
        results.push(createRef(fileImports.file, input, 'instantiate', match.line, match.column, index));
      }
    }
  }

  return dedupeReferences(results);
}

function createRef(
  file: string,
  input: FindReferencesInput,
  kind: ReferenceKind,
  line: number,
  column: number,
  index: ProjectIndex,
  contextSymbol?: string,
  contextKind?: IndexedClass['kind'],
  metadata?: Pick<ReferenceLocation, 'end_line' | 'end_column' | 'called_as'>
): ReferenceLocation {
  const contextClass = contextSymbol ?? index.classes.find((klass) => klass.file === file && klass.line <= line)?.className;
  return {
    file,
    line,
    column,
    symbol: input.symbol,
    kind: input.kind ?? 'unknown',
    context_symbol: contextSymbol,
    context_kind: contextKind === 'interface' ? 'interface' : contextKind ? 'class' : undefined,
    context_class: contextClass,
    owner_kind: contextKind === 'interface' ? 'interface' : 'class',
    reference_kind: kind,
    end_line: metadata?.end_line,
    end_column: metadata?.end_column,
    called_as: metadata?.called_as,
    is_application: true,
    source: 'application',
  };
}

function buildJavaTypeRelationshipMetadata(
  source: string,
  line: number,
  relationship: 'extends' | 'implements',
  targetName: string
): Pick<ReferenceLocation, 'end_line' | 'end_column' | 'called_as'> | undefined {
  const lineText = source.split('\n')[line - 1];
  if (!lineText) return undefined;
  const match = lineText.match(new RegExp(`\\b${relationship}\\s+[^\\{]*?\\b${escapeRegExp(targetName)}(?:\\b|\\s*<)`));
  if (!match || match.index === undefined) return undefined;
  const calledAs = match[0].trim().replace(/\s+</g, '<');
  return {
    end_line: line,
    end_column: match.index + match[0].length,
    called_as: calledAs,
  };
}

function sameMethod(a: IndexedMethod, b: IndexedMethod): boolean {
  return a.file === b.file && a.className === b.className && a.symbol === b.symbol;
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

async function findVariableReferences(index: ProjectIndex, rootFile: string, isDirectory: boolean, input: FindReferencesInput): Promise<ReferenceLocation[]> {
  const target = index.fields.find((field) => field.fieldName === input.symbol && (isDirectory || field.file === rootFile));
  if (!target) return [];

  const sourceCache = new Map<string, string>();
  const getSource = async (file: string) => {
    if (!sourceCache.has(file)) sourceCache.set(file, await readFile(file, 'utf8'));
    return sourceCache.get(file)!;
  };

  const references: ReferenceLocation[] = [];
  for (const method of index.methods) {
    const fieldOwner = resolveFieldOwnerForClass(index, method.qualifiedClassName, target.fieldName);
    if (!fieldOwner || fieldOwner.qualifiedClassName !== target.qualifiedClassName) continue;

    const source = await getSource(method.file);
    const lines = source.split('\n').slice(method.line - 1, method.node.endPosition.row + 1);
    for (let indexOffset = 0; indexOffset < lines.length; indexOffset++) {
      const line = lines[indexOffset];
      const lineNumber = method.line + indexOffset;
      if (!new RegExp(`(?:this\\.)?${escapeRegExp(input.symbol)}\\b`).test(line)) continue;
      if (new RegExp(`\\b(?:private|protected|public)\\s+\\w+\\s+${escapeRegExp(input.symbol)}\\b`).test(line)) continue;

      const writeMatch = line.match(new RegExp(`(?:this\\.)?${escapeRegExp(input.symbol)}\\b\\s*=`));
      if (writeMatch) {
        references.push({
          file: method.file,
          line: lineNumber,
          column: writeMatch.index ?? 0,
          end_line: method.node.endPosition.row + 1,
          end_column: method.node.endPosition.column,
          symbol: input.symbol,
          kind: 'variable',
          context_symbol: method.symbol,
          context_kind: 'method',
          context_class: method.className,
          owner_kind: 'class',
          reference_kind: 'write',
          is_application: true,
          source: 'application',
        });
      }

      const readMatch = line.match(new RegExp(`(?:return\\s+)?(?:this\\.)?${escapeRegExp(input.symbol)}\\b(?!\\s*=)`));
      if (readMatch && !(writeMatch && readMatch.index === writeMatch.index)) {
        references.push({
          file: method.file,
          line: lineNumber,
          column: readMatch.index ?? 0,
          end_line: method.node.endPosition.row + 1,
          end_column: method.node.endPosition.column,
          symbol: input.symbol,
          kind: 'variable',
          context_symbol: method.symbol,
          context_kind: 'method',
          context_class: method.className,
          owner_kind: 'class',
          reference_kind: 'read',
          is_application: true,
          source: 'application',
        });
      }
    }
  }

  return dedupeReferences(references);
}

function resolveFieldOwnerForClass(index: ProjectIndex, qualifiedClassName: string, fieldName: string) {
  const visited = new Set<string>();
  let current = qualifiedClassName;
  while (current && !visited.has(current)) {
    visited.add(current);
    const localField = index.fields.find((field) => field.qualifiedClassName === current && field.fieldName === fieldName);
    if (localField) return localField;
    const klass = index.classes.find((candidate) => candidate.fullName === current);
    const parent = klass?.extends[0];
    current = parent ?? '';
  }
  return undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
