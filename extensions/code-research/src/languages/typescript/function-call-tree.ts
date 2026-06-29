import { readFile, stat } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { getParser, parseSource } from '../../core/parser.js';
import type {
  CallSource,
  CallTreeNode,
  FunctionCallTreeInput,
  FunctionCallTreeResult,
  OwnerKind,
  SupportedLanguage,
} from '../../types.js';
import { collectWorkspaceSourceFiles } from '../../core/source-policy.js';
import {
  detectLanguage,
  extractSignature,
  isSupportedFile,
  loadTypeScriptProjectConfig,
  matchesTypeScriptPathAlias,
  resolveTypeScriptImportCandidates,
  resolveTypeScriptProjectRoot,
  type TypeScriptProjectConfig,
} from './shared.js';

type CallableKind = 'function' | 'method';

export interface IndexedCallable {
  file: string;
  language: Exclude<SupportedLanguage, 'auto'>;
  symbol: string;
  kind: CallableKind;
  ownerName?: string;
  ownerKind: OwnerKind;
  line: number;
  column: number;
  node: any;
  exportedName?: string;
}

export interface IndexedClass {
  file: string;
  language: Exclude<SupportedLanguage, 'auto'>;
  className: string;
  line: number;
  column: number;
  node: any;
  exportedName?: string;
}

export interface ImportBinding {
  localName: string;
  importedName: string;
  source: string;
  kind: 'named' | 'default' | 'namespace';
}

export interface IndexedFile {
  file: string;
  language: Exclude<SupportedLanguage, 'auto'>;
  rootNode: any;
  source: string;
  imports: Map<string, ImportBinding>;
}

export interface TypeScriptProjectIndex {
  projectRoot: string;
  projectConfig: TypeScriptProjectConfig;
  callables: IndexedCallable[];
  classes: IndexedClass[];
  files: Map<string, IndexedFile>;
}

export interface ExtractedCall {
  symbol: string;
  receiver?: string;
  receiverNodeType?: string;
  text: string;
  line: number;
  column: number;
}

export interface ResolvedTarget {
  callable?: IndexedCallable;
  className?: string;
  ownerKind?: OwnerKind;
  receiverType?: string;
  source: CallSource;
  reason?: string;
}

interface BuildNodeOptions {
  index: TypeScriptProjectIndex;
  callable: IndexedCallable;
  maxDepth: number;
  includeExternal: boolean;
  depth: number;
  visited: Set<string>;
  invocation?: ExtractedCall;
  resolved?: ResolvedTarget;
}

const SUPPORTED_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const EXCLUDED_DIRECTORY_NAMES = new Set([
  'node_modules',
  'build',
  'dist',
  'coverage',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.react-router',
  '.turbo',
  '.vite',
  '.cache',
  'out',
]);

export async function executeTypeScriptFunctionCallTree(
  cwd: string,
  input: FunctionCallTreeInput
): Promise<
  | {
      status: 'ok';
      rootClassName: string;
      result: FunctionCallTreeResult;
    }
  | {
      status: 'not_found';
      message: string;
      details: { found: 0 };
    }
  | {
      status: 'ambiguous';
      message: string;
      details: { candidates: Array<{ className: string; symbol: string; file: string; line: number }> };
    }
> {
  const rootPath = resolve(cwd, input.path);
  const rootStat = await stat(rootPath).catch(() => undefined);
  const indexRoot = await resolveTypeScriptProjectRoot(rootPath, rootStat?.isDirectory() ?? false);
  const index = await buildTypeScriptProjectIndex(indexRoot);

  const candidates = index.callables.filter((callable) => {
    if (callable.symbol !== input.symbol) return false;
    if (!rootStat?.isDirectory() && callable.file !== rootPath) return false;
    if (input.kind && input.kind !== callable.kind) return false;
    return true;
  });

  if (candidates.length === 0) {
    return {
      status: 'not_found',
      message: `No callable '${input.symbol}' found in ${input.path}`,
      details: { found: 0 },
    };
  }

  if (candidates.length > 1) {
    return {
      status: 'ambiguous',
      message:
        `Multiple callables named '${input.symbol}' found. Please disambiguate with kind or a more specific path:\n` +
        candidates
          .map((candidate) => `  - ${formatOwner(candidate)}.${candidate.symbol} at ${candidate.file}:${candidate.line}`)
          .join('\n'),
      details: {
        candidates: candidates.map((candidate) => ({
          className: formatOwner(candidate),
          symbol: candidate.symbol,
          file: candidate.file,
          line: candidate.line,
        })),
      },
    };
  }

  const rootCallable = candidates[0];
  return {
    status: 'ok',
    rootClassName: formatOwner(rootCallable),
    result: buildCallTree({
      index,
      callable: rootCallable,
      maxDepth: input.max_depth ?? 10,
      includeExternal: input.include_external ?? false,
    }),
  };
}

export function buildCallTree(options: {
  index: TypeScriptProjectIndex;
  callable: IndexedCallable;
  maxDepth: number;
  includeExternal: boolean;
}): FunctionCallTreeResult {
  const root = buildNode({
    ...options,
    depth: 0,
    visited: new Set(),
  });

  const stats = {
    total_nodes: 0,
    application_nodes: 0,
    external_nodes: 0,
    max_depth_reached: 0,
  };

  countNodes(root, 0, stats);
  return { root, stats };
}

export async function buildTypeScriptProjectIndex(rootDir: string): Promise<TypeScriptProjectIndex> {
  const index: TypeScriptProjectIndex = {
    projectRoot: rootDir,
    projectConfig: await loadTypeScriptProjectConfig(rootDir),
    callables: [],
    classes: [],
    files: new Map(),
  };

  const files = await collectSupportedFiles(rootDir);
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const language = detectLanguage(file, 'auto');
    const parser = getParser(language);

    let tree: any;
    try {
      tree = parseSource(parser, source);
    } catch {
      continue;
    }

    const indexedFile: IndexedFile = {
      file,
      language,
      rootNode: tree.rootNode,
      source,
      imports: new Map(),
    };

    indexImports(indexedFile);
    indexTopLevelDeclarations(indexedFile, index);
    index.files.set(file, indexedFile);
  }

  return index;
}

async function collectSupportedFiles(dir: string): Promise<string[]> {
  return (await collectWorkspaceSourceFiles(dir)).filter((file) => isSupportedFile(file));
}

function indexImports(file: IndexedFile): void {
  for (const child of file.rootNode.children) {
    if (child.type !== 'import_statement') continue;
    const sourceNode = child.childForFieldName('source');
    const source = stripQuotes(sourceNode?.text ?? '');
    const clause = child.children.find((node: any) => node.type === 'import_clause');
    if (!clause || !source) continue;

    for (const node of clause.children) {
      if (!node.isNamed) continue;

      if (node.type === 'identifier') {
        file.imports.set(node.text, {
          localName: node.text,
          importedName: 'default',
          source,
          kind: 'default',
        });
        continue;
      }

      if (node.type === 'named_imports') {
        for (const specifier of node.children) {
          if (!specifier.isNamed || specifier.type !== 'import_specifier') continue;
          const identifiers = specifier.children.filter((child: any) => child.type === 'identifier');
          const importedName = identifiers[0]?.text;
          const localName = identifiers[1]?.text ?? identifiers[0]?.text;
          if (!importedName || !localName) continue;
          file.imports.set(localName, {
            localName,
            importedName,
            source,
            kind: 'named',
          });
        }
        continue;
      }

      if (node.type === 'namespace_import') {
        const localNode = node.children.find((child: any) => child.type === 'identifier');
        if (!localNode) continue;
        file.imports.set(localNode.text, {
          localName: localNode.text,
          importedName: '*',
          source,
          kind: 'namespace',
        });
      }
    }
  }
}

function indexTopLevelDeclarations(file: IndexedFile, index: TypeScriptProjectIndex): void {
  const objectCallableBindings = collectTopLevelObjectCallableBindings(file.rootNode);

  for (const child of file.rootNode.children) {
    const exportInfo = extractExportInfo(child);
    const node = exportInfo.node;

    if (node.type === 'function_declaration') {
      const nameNode = node.childForFieldName('name');
      if (!nameNode) continue;
      index.callables.push({
        file: file.file,
        language: file.language,
        symbol: nameNode.text,
        kind: 'function',
        ownerKind: 'unknown',
        line: node.startPosition.row + 1,
        column: node.startPosition.column,
        node,
        exportedName: exportInfo.exported ? exportInfo.exportName ?? nameNode.text : undefined,
      });
      continue;
    }

    if (node.type === 'lexical_declaration' || node.type === 'variable_declaration') {
      const declarator = node.children.find((item: any) => item.type === 'variable_declarator');
      const nameNode = declarator?.childForFieldName('name');
      const valueNode = declarator?.childForFieldName('value');

      if (nameNode && valueNode && isCallableValueNode(valueNode)) {
        index.callables.push({
          file: file.file,
          language: file.language,
          symbol: normalizeIdentifier(nameNode.text),
          kind: 'function',
          ownerKind: 'unknown',
          line: node.startPosition.row + 1,
          column: node.startPosition.column,
          node,
          exportedName: exportInfo.exported ? exportInfo.exportName ?? normalizeIdentifier(nameNode.text) : undefined,
        });
        continue;
      }

      if (exportInfo.exported && declarator) {
        const destructuredBindings = extractDestructuredCallableBindings(declarator, objectCallableBindings);
        for (const binding of destructuredBindings) {
          index.callables.push({
            file: file.file,
            language: file.language,
            symbol: binding.symbol,
            kind: 'function',
            ownerKind: 'unknown',
            line: binding.node.startPosition.row + 1,
            column: binding.node.startPosition.column,
            node: binding.node,
            exportedName: binding.symbol,
          });
        }
      }
      continue;
    }

    if (node.type === 'class_declaration' || node.type === 'abstract_class_declaration') {
      const classNameNode = node.childForFieldName('name');
      if (!classNameNode) continue;
      const className = classNameNode.text;
      index.classes.push({
        file: file.file,
        language: file.language,
        className,
        line: node.startPosition.row + 1,
        column: node.startPosition.column,
        node,
        exportedName: exportInfo.exported ? exportInfo.exportName ?? className : undefined,
      });
      indexClassMembers(file, index, node, className);
    }
  }
}

function collectTopLevelObjectCallableBindings(rootNode: any): Map<string, Map<string, any>> {
  const bindings = new Map<string, Map<string, any>>();

  for (const child of rootNode.children) {
    if (child.type !== 'lexical_declaration' && child.type !== 'variable_declaration') continue;
    const declarator = child.children.find((item: any) => item.type === 'variable_declarator');
    const nameNode = declarator?.childForFieldName('name');
    const valueNode = declarator?.childForFieldName('value');
    if (!nameNode || !valueNode || valueNode.type !== 'object') continue;

    const properties = new Map<string, any>();
    for (const property of valueNode.children) {
      if (!property.isNamed || property.type !== 'pair') continue;
      const keyNode = property.childForFieldName('key') ?? property.children.find((item: any) => item.type === 'property_identifier' || item.type === 'string');
      const pairValueNode = property.childForFieldName('value') ?? property.children.find((item: any) => isCallableValueNode(item));
      if (!keyNode || !pairValueNode || !isCallableValueNode(pairValueNode)) continue;
      properties.set(stripQuotes(normalizeIdentifier(keyNode.text)), pairValueNode);
    }

    if (properties.size > 0) {
      bindings.set(normalizeIdentifier(nameNode.text), properties);
    }
  }

  return bindings;
}

function extractDestructuredCallableBindings(
  declarator: any,
  objectCallableBindings: Map<string, Map<string, any>>
): Array<{ symbol: string; node: any }> {
  const nameNode = declarator.childForFieldName('name');
  const valueNode = declarator.childForFieldName('value');
  if (!nameNode || nameNode.type !== 'object_pattern') {
    return [];
  }

  const sourceBindings = valueNode?.type === 'identifier'
    ? objectCallableBindings.get(normalizeIdentifier(valueNode.text))
    : undefined;

  const results: Array<{ symbol: string; node: any }> = [];
  for (const propertyNode of nameNode.children) {
    if (!propertyNode.isNamed) continue;

    if (propertyNode.type === 'shorthand_property_identifier_pattern') {
      const symbol = normalizeIdentifier(propertyNode.text);
      const callableNode = sourceBindings?.get(symbol) ?? propertyNode;
      if (symbol) results.push({ symbol, node: callableNode });
      continue;
    }

    if (propertyNode.type === 'pair_pattern') {
      const keyNode = propertyNode.childForFieldName('key');
      const valuePatternNode = propertyNode.childForFieldName('value');
      const symbol = normalizeIdentifier(valuePatternNode?.text ?? '');
      const sourceKey = stripQuotes(normalizeIdentifier(keyNode?.text ?? ''));
      const callableNode = sourceBindings?.get(sourceKey) ?? valuePatternNode ?? propertyNode;
      if (symbol) results.push({ symbol, node: callableNode });
    }
  }

  return results;
}

function indexClassMembers(file: IndexedFile, index: TypeScriptProjectIndex, classNode: any, className: string): void {
  const body = classNode.childForFieldName('body');
  if (!body) return;

  for (const child of body.children) {
    if (!child.isNamed) continue;

    if (child.type === 'method_definition') {
      const nameNode = child.childForFieldName('name');
      if (!nameNode) continue;
      index.callables.push({
        file: file.file,
        language: file.language,
        symbol: normalizeIdentifier(nameNode.text),
        kind: 'method',
        ownerName: className,
        ownerKind: 'class',
        line: child.startPosition.row + 1,
        column: child.startPosition.column,
        node: child,
      });
      continue;
    }

    if (child.type === 'public_field_definition' || child.type === 'field_definition') {
      const nameNode = child.childForFieldName('name');
      const valueNode = child.childForFieldName('value');
      if (!nameNode || !valueNode || !isCallableValueNode(valueNode)) continue;
      index.callables.push({
        file: file.file,
        language: file.language,
        symbol: normalizeIdentifier(nameNode.text),
        kind: 'method',
        ownerName: className,
        ownerKind: 'class',
        line: child.startPosition.row + 1,
        column: child.startPosition.column,
        node: child,
      });
    }
  }
}

function buildNode(options: BuildNodeOptions): CallTreeNode {
  const { index, callable, maxDepth, includeExternal, depth, visited, invocation, resolved } = options;
  const node: CallTreeNode = {
    file: callable.file,
    symbol: callable.symbol,
    kind: callable.kind,
    node_type: 'application',
    class: callable.ownerName,
    owner_kind: callable.ownerKind,
    line: callable.line,
    column: callable.column,
    start_line: callable.line,
    start_column: callable.column,
    end_line: callable.node.endPosition.row + 1,
    end_column: callable.node.endPosition.column,
    signature: extractSignature(callable.node),
    called_as: invocation?.text,
    receiver_name: invocation?.receiver,
    receiver_type: resolved?.receiverType,
    call_line: invocation?.line,
    call_column: invocation?.column,
    is_application: true,
    is_external: false,
    source: 'application',
  };

  const visitKey = `${callable.file}:${callable.ownerName ?? '<module>'}:${callable.kind}:${callable.symbol}`;
  if (visited.has(visitKey) || depth >= maxDepth) {
    return node;
  }
  visited.add(visitKey);

  const calls = extractCalls(callable.node);
  const children: CallTreeNode[] = [];

  for (const call of calls) {
    const target = resolveCall(index, callable, call);
    if (target.callable) {
      children.push(
        buildNode({
          index,
          callable: target.callable,
          maxDepth,
          includeExternal,
          depth: depth + 1,
          visited,
          invocation: call,
          resolved: target,
        })
      );
      continue;
    }

    if (includeExternal) {
      children.push(createExternalNode(call, target));
    }
  }

  if (children.length > 0) {
    node.children = children;
  }

  return node;
}

export function extractCalls(callableNode: any): ExtractedCall[] {
  const body = callableNode.childForFieldName('body') ?? callableNode.childForFieldName('value');
  if (!body) return [];

  const calls: ExtractedCall[] = [];

  function visit(node: any, nestedCallable = false): void {
    if (!node?.isNamed) return;

    if (nestedCallable && isNestedCallableBoundary(node)) {
      return;
    }

    if (node.type === 'call_expression') {
      const extracted = extractCall(node);
      if (extracted) calls.push(extracted);
      return;
    }

    for (const child of node.children) {
      visit(child, true);
    }
  }

  visit(body, false);
  return calls;
}

function extractCall(node: any): ExtractedCall | undefined {
  const functionNode = node.childForFieldName('function');
  if (!functionNode) return undefined;

  if (functionNode.type === 'identifier') {
    return {
      symbol: functionNode.text,
      text: node.text,
      line: node.startPosition.row + 1,
      column: node.startPosition.column,
    };
  }

  if (functionNode.type === 'member_expression') {
    const objectNode = functionNode.childForFieldName('object');
    const propertyNode = functionNode.childForFieldName('property');
    if (!objectNode || !propertyNode) return undefined;
    return {
      symbol: normalizeIdentifier(propertyNode.text),
      receiver: objectNode.text,
      receiverNodeType: objectNode.type,
      text: node.text,
      line: node.startPosition.row + 1,
      column: node.startPosition.column,
    };
  }

  return undefined;
}

export function resolveCall(index: TypeScriptProjectIndex, current: IndexedCallable, call: ExtractedCall): ResolvedTarget {
  const currentFile = index.files.get(current.file);
  if (!currentFile) {
    return { source: 'unknown', reason: 'current file is not indexed' };
  }

  if (!call.receiver) {
    if (current.ownerName) {
      const method = findCallable(index, {
        file: current.file,
        ownerName: current.ownerName,
        kind: 'method',
        symbol: call.symbol,
      });
      if (method) {
        return { callable: method, className: current.ownerName, ownerKind: 'class', source: 'application' };
      }
    }

    const localCallable = findCallable(index, {
      file: current.file,
      kind: 'function',
      symbol: call.symbol,
    });
    if (localCallable) {
      return { callable: localCallable, source: 'application' };
    }

    const imported = currentFile.imports.get(call.symbol);
    if (imported) {
      const importedCallable = resolveImportedCallable(index, current.file, imported);
      if (importedCallable) {
        return {
          callable: importedCallable,
          className: importedCallable.ownerName,
          ownerKind: importedCallable.ownerKind,
          source: 'application',
        };
      }
      return {
        source: classifyImportSource(imported.source, index.projectConfig),
        reason: `import '${imported.source}' does not resolve to an indexed callable`,
      };
    }

    return { source: 'unknown', reason: 'call without receiver not found in local module or imports' };
  }

  if (call.receiver === 'this' && current.ownerName) {
    const method = findCallable(index, {
      file: current.file,
      ownerName: current.ownerName,
      kind: 'method',
      symbol: call.symbol,
    });
    if (method) {
      return {
        callable: method,
        className: current.ownerName,
        ownerKind: 'class',
        receiverType: current.ownerName,
        source: 'application',
      };
    }
  }

  const receiverType = resolveReceiverType(index, current, call.receiver, call.receiverNodeType);
  if (receiverType) {
    const method = findCallable(index, {
      className: receiverType,
      kind: 'method',
      symbol: call.symbol,
    });
    if (method) {
      return {
        callable: method,
        className: receiverType,
        ownerKind: 'class',
        receiverType,
        source: 'application',
      };
    }

    return {
      className: receiverType,
      ownerKind: 'class',
      receiverType,
      source: 'unknown',
      reason: `receiver type '${receiverType}' does not expose an indexed method '${call.symbol}'`,
    };
  }

  const importBinding = currentFile.imports.get(call.receiver);
  if (importBinding?.kind === 'namespace') {
    const targetFile = resolveModuleFile(index, current.file, importBinding.source);
    if (targetFile) {
      const namespacedCallable = findCallable(index, {
        file: targetFile,
        exportedName: call.symbol,
      });
      if (namespacedCallable) {
        return {
          callable: namespacedCallable,
          className: namespacedCallable.ownerName,
          ownerKind: namespacedCallable.ownerKind,
          source: 'application',
        };
      }
    }
  }

  return { source: 'unknown', reason: 'could not resolve call receiver type' };
}

function resolveReceiverType(
  index: TypeScriptProjectIndex,
  current: IndexedCallable,
  receiver: string,
  receiverNodeType?: string
): string | undefined {
  if (receiverNodeType === 'new_expression' || receiver.trim().startsWith('new ')) {
    return extractClassNameFromNewExpression(receiver);
  }

  const parameterType = findParameterType(current.node, receiver);
  if (parameterType) {
    return resolveClassReference(index, current.file, parameterType);
  }

  const variableType = findLocalVariableType(index, current.file, current.node, receiver);
  if (variableType) {
    return variableType;
  }

  const importedClass = resolveClassReference(index, current.file, receiver);
  if (importedClass) {
    return importedClass;
  }

  return undefined;
}

function findParameterType(callableNode: any, name: string): string | undefined {
  const parameters = callableNode.childForFieldName('parameters');
  if (!parameters) return undefined;

  for (const child of parameters.children) {
    if (!child.isNamed) continue;
    const nameNode = child.childForFieldName('pattern') ?? child.childForFieldName('name') ?? child.children.find((node: any) => node.type === 'identifier');
    if (!nameNode || normalizeIdentifier(nameNode.text) !== name) continue;
    const typeNode = child.childForFieldName('type') ?? child.children.find((node: any) => node.type === 'type_annotation');
    const typeName = extractTypeName(typeNode?.text);
    if (typeName) return typeName;
  }

  return undefined;
}

function findLocalVariableType(
  index: TypeScriptProjectIndex,
  currentFile: string,
  callableNode: any,
  name: string
): string | undefined {
  const body = callableNode.childForFieldName('body') ?? callableNode.childForFieldName('value');
  if (!body) return undefined;

  let resolvedType: string | undefined;

  function visit(node: any): void {
    if (!node?.isNamed || resolvedType) return;
    if (isNestedCallableBoundary(node)) return;

    if (node.type === 'variable_declarator') {
      const nameNode = node.childForFieldName('name');
      if (normalizeIdentifier(nameNode?.text ?? '') !== name) {
        for (const child of node.children) visit(child);
        return;
      }

      const explicitType = extractTypeName(node.children.find((child: any) => child.type === 'type_annotation')?.text);
      if (explicitType) {
        resolvedType = resolveClassReference(index, currentFile, explicitType) ?? explicitType;
        return;
      }

      const valueNode = node.childForFieldName('value');
      if (!valueNode) return;

      if (valueNode.type === 'new_expression') {
        resolvedType = extractClassNameFromNewExpression(valueNode.text);
        return;
      }

      if (valueNode.type === 'identifier') {
        resolvedType = resolveClassReference(index, currentFile, valueNode.text);
      }

      return;
    }

    for (const child of node.children) visit(child);
  }

  for (const child of body.children) visit(child);
  return resolvedType;
}

function resolveClassReference(index: TypeScriptProjectIndex, currentFile: string, referenceName: string): string | undefined {
  const normalized = normalizeIdentifier(referenceName);
  const localClass = index.classes.find((item) => item.file === currentFile && item.className === normalized);
  if (localClass) return localClass.className;

  const file = index.files.get(currentFile);
  const imported = file?.imports.get(normalized);
  if (imported) {
    const targetClass = resolveImportedClass(index, currentFile, imported);
    if (targetClass) return targetClass.className;
  }

  const anyClass = index.classes.find((item) => item.className === normalized);
  return anyClass?.className;
}

function resolveImportedCallable(
  index: TypeScriptProjectIndex,
  currentFile: string,
  binding: ImportBinding
): IndexedCallable | undefined {
  const targetFile = resolveModuleFile(index, currentFile, binding.source);
  if (!targetFile) return undefined;

  if (binding.kind === 'namespace') return undefined;

  return findCallable(index, {
    file: targetFile,
    exportedName: binding.importedName,
  });
}

function resolveImportedClass(
  index: TypeScriptProjectIndex,
  currentFile: string,
  binding: ImportBinding
): IndexedClass | undefined {
  const targetFile = resolveModuleFile(index, currentFile, binding.source);
  if (!targetFile) return undefined;
  if (binding.kind === 'namespace') return undefined;
  return index.classes.find((item) => item.file === targetFile && item.exportedName === binding.importedName);
}

function resolveModuleFile(index: TypeScriptProjectIndex, currentFile: string, source: string): string | undefined {
  const candidates = resolveTypeScriptImportCandidates(currentFile, source, index.projectConfig);

  for (const candidate of candidates) {
    if (index.files.has(candidate)) return candidate;
  }

  return undefined;
}

function findCallable(
  index: TypeScriptProjectIndex,
  criteria: {
    file?: string;
    ownerName?: string;
    className?: string;
    kind?: CallableKind;
    symbol?: string;
    exportedName?: string;
  }
): IndexedCallable | undefined {
  return index.callables.find((item) => {
    if (criteria.file && item.file !== criteria.file) return false;
    if (criteria.ownerName && item.ownerName !== criteria.ownerName) return false;
    if (criteria.className && item.ownerName !== criteria.className) return false;
    if (criteria.kind && item.kind !== criteria.kind) return false;
    if (criteria.symbol && item.symbol !== criteria.symbol) return false;
    if (criteria.exportedName && item.exportedName !== criteria.exportedName) return false;
    return true;
  });
}

function createExternalNode(call: ExtractedCall, resolved: ResolvedTarget): CallTreeNode {
  return {
    symbol: call.symbol,
    kind: call.receiver ? 'method' : 'function',
    node_type: 'external',
    class: resolved.className,
    owner_kind: resolved.ownerKind ?? 'unknown',
    called_as: call.text,
    receiver_name: call.receiver,
    receiver_type: resolved.receiverType,
    line: call.line,
    column: call.column,
    call_line: call.line,
    call_column: call.column,
    is_application: false,
    is_external: true,
    source: resolved.source,
    reason: resolved.reason,
  };
}

function countNodes(
  node: CallTreeNode,
  depth: number,
  stats: { total_nodes: number; application_nodes: number; external_nodes: number; max_depth_reached: number }
): void {
  stats.total_nodes += 1;
  if (node.is_application) stats.application_nodes += 1;
  if (node.is_external) stats.external_nodes += 1;
  stats.max_depth_reached = Math.max(stats.max_depth_reached, depth);

  for (const child of node.children ?? []) {
    countNodes(child, depth + 1, stats);
  }
}

function extractExportInfo(node: any): { node: any; exported: boolean; exportName?: string } {
  if (node.type !== 'export_statement') {
    return { node, exported: false };
  }

  const declaration = node.children.find((child: any) => child.isNamed && child.type !== 'export' && child.type !== 'default');
  const isDefault = node.children.some((child: any) => child.type === 'default');
  return {
    node: declaration ?? node,
    exported: true,
    exportName: isDefault ? 'default' : undefined,
  };
}

function isCallableValueNode(node: any): boolean {
  return node.type === 'arrow_function' || node.type === 'function_expression' || node.type === 'function_declaration';
}

function isNestedCallableBoundary(node: any): boolean {
  return (
    node.type === 'function_declaration' ||
    node.type === 'function_expression' ||
    node.type === 'arrow_function' ||
    node.type === 'method_definition' ||
    node.type === 'class_declaration' ||
    node.type === 'abstract_class_declaration'
  );
}

function extractTypeName(typeText?: string): string | undefined {
  if (!typeText) return undefined;
  return typeText
    .replace(/^:\s*/, '')
    .replace(/<.*>/g, '')
    .split('|')[0]
    .trim()
    .split('.')
    .pop();
}

function extractClassNameFromNewExpression(expression: string): string | undefined {
  const match = expression.match(/^new\s+([A-Za-z_$][\w$]*)/);
  return match?.[1];
}

function normalizeIdentifier(value: string): string {
  return value.replace(/^#/, '');
}

function classifyImportSource(source: string, projectConfig: TypeScriptProjectConfig): CallSource {
  if (source.startsWith('.')) return 'unknown';
  if (matchesTypeScriptPathAlias(source, projectConfig)) return 'application';
  return 'library';
}

function stripQuotes(value: string): string {
  if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
    return value.slice(1, -1);
  }
  return value;
}

function formatOwner(callable: IndexedCallable): string {
  return callable.ownerName ?? basename(callable.file, extname(callable.file));
}
