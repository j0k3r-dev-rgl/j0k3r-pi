import { readFile, stat } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { CallNodeType, CallSource, CallTreeNode, FunctionCallTreeInput, FunctionCallTreeResult, OwnerKind } from '../../types.js';
import { buildProjectIndex } from '../../core/project-index.js';
import { extractSignature } from './shared.js';
import type {
  FileImports,
  IndexedClass,
  IndexedField,
  IndexedMethod,
  ProjectIndex,
} from '../../core/project-index.js';

export interface BuildCallTreeOptions {
  rootFile: string;
  rootMethod: IndexedMethod;
  index: ProjectIndex;
  maxDepth: number;
  includeExternal: boolean;
  compacted?: boolean;
  currentDepth?: number;
  visited?: Set<string>;
}

interface CallbackInfo {
  kind: 'lambda' | 'method_reference' | 'anonymous_class';
  text: string;
  calls: MethodCall[];
}

export interface MethodCall {
  methodName: string;
  object?: string;
  objectNodeType?: string;
  callText: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  callbacks?: CallbackInfo[];
}

export interface ResolvedCall {
  className: string;
  isExternal: boolean;
  source: CallSource;
  ownerKind: OwnerKind;
  receiverType?: string;
  reason?: string;
  resolution?: 'exact' | 'source_heuristic' | 'overload_ambiguous';
  targetRelationshipId?: string;
  targetMethod?: IndexedMethod;
}

export interface ResolvedJavaGraphCall {
  call: MethodCall;
  resolved?: ResolvedCall;
  targetMethod?: IndexedMethod;
}

interface ObjectTypeResolution {
  typeName: string;
  fullTypeName?: string;
  genericTypeName?: string;
  genericFullTypeName?: string;
}

interface JavaArgumentInfo {
  raw: string;
  category: 'string' | 'char' | 'boolean' | 'numeric' | 'null' | 'object_creation' | 'identifier' | 'unknown';
  objectType?: string;
}

interface JavaMethodScopeTypeIndex {
  parameters: Map<string, string>;
  locals: Map<string, string>;
}

interface JavaLookupIndex {
  classesByFullName: Map<string, IndexedClass>;
  classesByFile: Map<string, IndexedClass[]>;
  classesByPackage: Map<string, IndexedClass[]>;
  classesBySuffix: Map<string, IndexedClass[]>;
  fieldsByClassAndName: Map<string, IndexedField>;
  methodsByClassAndSymbol: Map<string, IndexedMethod[]>;
  methodsByClassNameAndSymbol: Map<string, IndexedMethod[]>;
  implementationsByInterfaceSymbolId: Map<string, IndexedClass[]>;
}

const javaLookupIndexes = new WeakMap<ProjectIndex, JavaLookupIndex>();
const javaMethodScopeTypes = new WeakMap<IndexedMethod, JavaMethodScopeTypeIndex>();

function getJavaLookupIndex(index: ProjectIndex): JavaLookupIndex {
  const cached = javaLookupIndexes.get(index);
  if (cached) return cached;

  const lookup: JavaLookupIndex = {
    classesByFullName: new Map(),
    classesByFile: new Map(),
    classesByPackage: new Map(),
    classesBySuffix: new Map(),
    fieldsByClassAndName: new Map(),
    methodsByClassAndSymbol: new Map(),
    methodsByClassNameAndSymbol: new Map(),
    implementationsByInterfaceSymbolId: new Map(),
  };

  const push = <T>(map: Map<string, T[]>, key: string, value: T) => {
    const current = map.get(key);
    if (current) current.push(value);
    else map.set(key, [value]);
  };

  for (const klass of index.classes) {
    lookup.classesByFullName.set(klass.fullName, klass);
    push(lookup.classesByFile, klass.file, klass);
    push(lookup.classesByPackage, klass.package, klass);
    push(lookup.classesBySuffix, klass.className, klass);
    const parts = klass.fullName.split('.');
    for (let index = 1; index < parts.length; index++) {
      push(lookup.classesBySuffix, parts.slice(index).join('.'), klass);
    }
  }

  for (const field of index.fields) {
    lookup.fieldsByClassAndName.set(`${field.qualifiedClassName}\0${field.fieldName}`, field);
  }

  for (const method of index.methods) {
    push(lookup.methodsByClassAndSymbol, `${method.qualifiedClassName}\0${method.symbol}`, method);
    push(lookup.methodsByClassNameAndSymbol, `${method.className}\0${method.symbol}`, method);
  }

  javaLookupIndexes.set(index, lookup);
  return lookup;
}

export async function resolveJavaIndexRoot(filePath: string): Promise<string> {
  const fileDir = dirname(filePath);
  const conventionalProjectRoot = findConventionalJavaProjectRoot(fileDir);
  if (conventionalProjectRoot) return conventionalProjectRoot;

  const source = await readFile(filePath, 'utf8').catch(() => '');
  const packageMatch = source.match(/^\s*package\s+([\w.]+)\s*;/m);
  if (!packageMatch) {
    return fileDir;
  }

  const segments = packageMatch[1].split('.').filter(Boolean).length;
  let current = fileDir;
  for (let i = 0; i < segments; i++) {
    current = dirname(current);
  }
  return current;
}

function findConventionalJavaProjectRoot(fileDir: string): string | undefined {
  const normalized = fileDir.split(sep).join('/');
  const markers = ['/src/main/java', '/src/test/java'];
  for (const marker of markers) {
    const index = normalized.indexOf(marker);
    if (index !== -1) return normalized.slice(0, index) || sep;
  }
  return undefined;
}

export async function executeJavaFunctionCallTree(
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
  const rootFile = resolve(cwd, input.path);
  const rootStat = await stat(rootFile).catch(() => undefined);
  const indexRoot = rootStat?.isDirectory() ? rootFile : await resolveJavaIndexRoot(rootFile);
  const index = await buildProjectIndex(indexRoot);

  const candidates = index.methods.filter(
    (method) => method.symbol === input.symbol && (rootStat?.isDirectory() || method.file === rootFile)
  );

  if (candidates.length === 0) {
    return {
      status: 'not_found',
      message: `No method '${input.symbol}' found in ${input.path}`,
      details: { found: 0 },
    };
  }

  if (candidates.length > 1) {
    return {
      status: 'ambiguous',
      message:
        `Multiple methods named '${input.symbol}' found. Please disambiguate with kind or a more specific path:\n` +
        candidates.map((candidate) => `  - ${candidate.className}.${candidate.symbol} at ${candidate.file}:${candidate.line}`).join('\n'),
      details: {
        candidates: candidates.map((candidate) => ({
          className: candidate.className,
          symbol: candidate.symbol,
          file: candidate.file,
          line: candidate.line,
        })),
      },
    };
  }

  const rootMethod = candidates[0];
  return {
    status: 'ok',
    rootClassName: rootMethod.className,
    result: buildCallTree({
      rootFile,
      rootMethod,
      index,
      maxDepth: input.max_depth ?? 10,
      includeExternal: input.include_external ?? false,
      compacted: input.compacted ?? false,
    }),
  };
}

export function buildCallTree(options: BuildCallTreeOptions): FunctionCallTreeResult {
  const {
    rootFile: _rootFile,
    rootMethod,
    index,
    maxDepth,
    includeExternal,
    compacted = false,
    currentDepth = 0,
    visited = new Set(),
  } = options;

  const rootNode = buildNode(rootMethod, index, maxDepth, includeExternal, currentDepth, visited);
  const resultRoot = compacted ? compactNodeTree(rootNode) : rootNode;

  const stats = {
    total_nodes: 0,
    application_nodes: 0,
    external_nodes: 0,
    max_depth_reached: 0,
  };

  countNodes(resultRoot, 0, stats);
  return { root: resultRoot, stats };
}

function buildNode(
  method: IndexedMethod,
  index: ProjectIndex,
  maxDepth: number,
  includeExternal: boolean,
  depth: number,
  visited: Set<string>,
  invocation?: { call: MethodCall; resolved: ResolvedCall }
): CallTreeNode {
  const ownerClass = findClassByQualifiedName(method.qualifiedClassName, index);
  const node: CallTreeNode = {
    file: method.file,
    symbol: method.symbol,
    kind: 'method',
    node_type: 'application',
    class: method.className,
    package: method.package,
    owner_kind: ownerClass?.kind === 'interface' ? 'interface' : 'class',
    line: method.line,
    column: method.column,
    start_line: method.line,
    start_column: method.column,
    end_line: method.node.endPosition.row + 1,
    end_column: method.node.endPosition.column,
    signature: extractSignature(method.node),
    is_application: true,
    is_external: false,
    source: 'application',
  };

  if (invocation) {
    node.called_as = invocation.call.callText;
    node.receiver_name = invocation.call.object;
    node.receiver_type = invocation.resolved.receiverType;
    node.call_line = invocation.call.line;
    node.call_column = invocation.call.column;
  }

  const visitKey = method.symbolId;
  if (visited.has(visitKey) || depth >= maxDepth) {
    return node;
  }
  visited.add(visitKey);

  const invocationCallbackChildren = invocation
    ? buildCallbackChildren(method, invocation.call.callbacks ?? [], index, maxDepth, includeExternal, depth, visited)
    : [];

  const calls = extractMethodCalls(method.node);
  const methodChildren = buildChildrenFromCalls(method, calls, index, maxDepth, includeExternal, depth, visited);
  const children = [...invocationCallbackChildren, ...methodChildren];

  if (children.length > 0) {
    node.children = children;
  }

  return node;
}

function buildChildrenFromCalls(
  currentMethod: IndexedMethod,
  calls: MethodCall[],
  index: ProjectIndex,
  maxDepth: number,
  includeExternal: boolean,
  depth: number,
  visited: Set<string>
): CallTreeNode[] {
  const children: CallTreeNode[] = [];

  for (const { call, resolved, targetMethod } of resolveJavaCallsForGraph(currentMethod, index, calls)) {
    if (!resolved) {
      if (includeExternal) {
        children.push(createExternalNode(currentMethod, call, 'unknown', undefined, undefined, index, maxDepth, includeExternal, depth, visited));
      }
      continue;
    }

    if (resolved.isExternal || !targetMethod) {
      if (includeExternal) {
        children.push(createExternalNode(currentMethod, call, resolved.source, resolved.reason, resolved, index, maxDepth, includeExternal, depth, visited));
      }
      continue;
    }

    children.push(buildNode(targetMethod, index, maxDepth, includeExternal, depth + 1, visited, { call, resolved }));
  }

  return children;
}

function extractMethodCalls(methodNode: any): MethodCall[] {
  const calls: MethodCall[] = [];

  function visit(node: any) {
    if (!node.isNamed) return;

    if (node.type === 'method_invocation') {
      const nameNode = node.childForFieldName('name');
      const objectNode = node.childForFieldName('object');
      if (nameNode) {
        calls.push({
          methodName: nameNode.text,
          object: objectNode ? objectNode.text : undefined,
          objectNodeType: objectNode ? objectNode.type : undefined,
          callText: node.text,
          line: node.startPosition.row + 1,
          column: node.startPosition.column,
          endLine: node.endPosition.row + 1,
          endColumn: node.endPosition.column,
          callbacks: extractCallbacks(node),
        });
      }
      for (const child of node.children) {
        if (child === nameNode || isJavaCallbackNode(child)) continue;
        visit(child);
      }
      return;
    }

    if (isJavaCallbackNode(node)) return;

    for (const child of node.children) {
      visit(child);
    }
  }

  const body = methodNode.childForFieldName('body');
  if (body) visit(body);
  return calls;
}

function extractCallbacks(methodInvocationNode: any): CallbackInfo[] {
  const callbacks: CallbackInfo[] = [];

  function visit(node: any) {
    if (!node?.isNamed) return;

    if (node.type === 'lambda_expression') {
      callbacks.push({
        kind: 'lambda',
        text: node.text,
        calls: extractMethodCallsFromNode(node),
      });
      return;
    }

    if (node.type === 'method_reference') {
      callbacks.push({
        kind: 'method_reference',
        text: node.text,
        calls: [],
      });
      return;
    }

    for (const child of node.children) {
      visit(child);
    }
  }

  for (const child of methodInvocationNode.children) {
    visit(child);
  }

  return callbacks;
}

function extractMethodCallsFromNode(rootNode: any): MethodCall[] {
  const calls: MethodCall[] = [];

  function visit(node: any) {
    if (!node?.isNamed) return;

    if (node.type === 'method_invocation') {
      const nameNode = node.childForFieldName('name');
      const objectNode = node.childForFieldName('object');
      if (nameNode) {
        calls.push({
          methodName: nameNode.text,
          object: objectNode ? objectNode.text : undefined,
          objectNodeType: objectNode ? objectNode.type : undefined,
          callText: node.text,
          line: node.startPosition.row + 1,
          column: node.startPosition.column,
          endLine: node.endPosition.row + 1,
          endColumn: node.endPosition.column,
          callbacks: extractCallbacks(node),
        });
      }
      for (const child of node.children) {
        if (child === nameNode) continue;
        visit(child);
      }
      return;
    }

    for (const child of node.children) {
      visit(child);
    }
  }

  visit(rootNode);
  return calls;
}

function isJavaCallbackNode(node: any): boolean {
  return node?.type === 'lambda_expression' || node?.type === 'method_reference' || (node?.type === 'object_creation_expression' && /\{[\s\S]*\}/.test(node.text));
}

export function resolveJavaCallsForGraph(
  currentMethod: IndexedMethod,
  index: ProjectIndex,
  calls: MethodCall[] = extractMethodCalls(currentMethod.node)
): ResolvedJavaGraphCall[] {
  return calls.map((call) => {
    const resolved = resolveCall(currentMethod, call, index);
    return { call, resolved, targetMethod: resolved?.targetMethod };
  });
}

function resolveCall(currentMethod: IndexedMethod, call: MethodCall, index: ProjectIndex): ResolvedCall | undefined {
  const fileImports = index.imports.get(currentMethod.file);

  if (!call.object || call.object === 'this') {
    const selection = selectMethodCandidate(
      getJavaLookupIndex(index).methodsByClassAndSymbol.get(`${currentMethod.qualifiedClassName}\0${call.methodName}`) ?? [],
      call
    );
    if (selection.targetMethod) {
      return {
        className: selection.targetMethod.className,
        isExternal: false,
        source: 'application',
        ownerKind: 'class',
        resolution: selection.resolution,
        reason: selection.reason,
        targetRelationshipId: selection.targetMethod.relationshipId,
        targetMethod: selection.targetMethod,
      };
    }
    if (selection.ambiguousRelationshipId) {
      return {
        className: currentMethod.className,
        isExternal: true,
        source: 'application',
        ownerKind: 'class',
        resolution: 'overload_ambiguous',
        reason: selection.reason,
        targetRelationshipId: selection.ambiguousRelationshipId,
      };
    }
    return {
      className: currentMethod.className,
      isExternal: true,
      source: 'language',
      ownerKind: 'unknown',
      reason: 'method without receiver not found in current application class',
    };
  }

  const objectType = resolveObjectType(currentMethod, call.object, call.objectNodeType, index);
  if (!objectType) {
    return {
      className: call.object,
      isExternal: true,
      source: classifyExpressionSource(call.object, fileImports),
      ownerKind: 'unknown',
      reason: 'could not resolve object type',
    };
  }

  return resolveTypeToCallTarget(objectType, call, index, fileImports);
}

function resolveObjectType(
  currentMethod: IndexedMethod,
  objectName: string,
  objectNodeType: string | undefined,
  index: ProjectIndex
): ObjectTypeResolution | undefined {
  if (objectNodeType === 'object_creation_expression' || objectName.trim().startsWith('new ')) {
    return resolveObjectCreationType(currentMethod.file, objectName, index);
  }

  if (objectNodeType === 'method_invocation' || looksLikeMethodInvocation(objectName)) {
    return resolveInvocationExpressionType(currentMethod, objectName, index);
  }

  if (looksLikeStaticFieldAccess(objectName)) {
    const ownerType = objectName.split('.').slice(0, -1).join('.');
    return {
      typeName: simpleName(ownerType),
      fullTypeName: resolveTypeInFile(currentMethod.file, ownerType, index),
    };
  }

  const normalizedObject = normalizeObjectName(objectName);

  const scopedType = resolveMethodScopedType(currentMethod, normalizedObject, index);
  if (scopedType) return scopedType;

  const field = findFieldInIndex(currentMethod.qualifiedClassName, normalizedObject, index);
  if (field) {
    return {
      typeName: field.typeName,
      fullTypeName: field.fullTypeName,
    };
  }

  const fileImports = index.imports.get(currentMethod.file);
  const imported = fileImports?.imports.get(normalizedObject.split('.')[0] ?? normalizedObject);
  if (imported) {
    const suffix = normalizedObject.includes('.') ? `.${normalizedObject.split('.').slice(1).join('.')}` : '';
    return { typeName: simpleName(normalizedObject), fullTypeName: `${imported}${suffix}` };
  }

  if (normalizedObject[0] === normalizedObject[0]?.toUpperCase()) {
    return {
      typeName: simpleName(normalizedObject),
      fullTypeName: resolveTypeInFile(currentMethod.file, normalizedObject, index),
    };
  }

  return undefined;
}

function resolveMethodScopedType(
  currentMethod: IndexedMethod,
  objectName: string,
  index: ProjectIndex
): ObjectTypeResolution | undefined {
  const scopeTypes = getJavaMethodScopeTypes(currentMethod);
  const parameterType = scopeTypes.parameters.get(objectName);
  if (parameterType) {
    return {
      typeName: simpleName(parameterType),
      fullTypeName: resolveTypeInFile(currentMethod.file, parameterType, index),
    };
  }

  const localType = scopeTypes.locals.get(objectName);
  if (localType) {
    return {
      typeName: simpleName(localType),
      fullTypeName: resolveTypeInFile(currentMethod.file, localType, index),
    };
  }

  return undefined;
}

function resolveObjectCreationType(
  file: string,
  expression: string,
  index: ProjectIndex
): ObjectTypeResolution | undefined {
  const match = expression.match(/^new\s+([A-Za-z_$][\w$.]*)\s*</) ?? expression.match(/^new\s+([A-Za-z_$][\w$.]*)\s*\(/);
  const scopedType = normalizeScopedTypeName(match?.[1]);
  if (!scopedType) return undefined;
  const fullTypeName = resolveTypeInFile(file, scopedType, index);
  return {
    typeName: simpleName(scopedType),
    fullTypeName,
  };
}

function resolveInvocationExpressionType(
  currentMethod: IndexedMethod,
  expression: string,
  index: ProjectIndex
): ObjectTypeResolution | undefined {
  const mockWrapped = unwrapMockitoReceiverInvocation(expression);
  if (mockWrapped) return resolveObjectType(currentMethod, mockWrapped, inferExpressionNodeType(mockWrapped), index);

  const invocation = splitInvocationExpression(expression);
  if (!invocation) return undefined;

  const baseType = resolveObjectType(currentMethod, invocation.baseExpression, inferExpressionNodeType(invocation.baseExpression), index);
  if (!baseType) return undefined;

  const applicationMethodSelection = selectMethodCandidate(findMethodsForType(baseType, invocation.methodName, index), {
    methodName: invocation.methodName,
    callText: expression,
  });
  const applicationMethod = applicationMethodSelection.targetMethod;
  if (applicationMethod?.returnType) {
    const genericTypeName = extractFirstGenericType(applicationMethod.node.childForFieldName('type')?.text);
    return {
      typeName: applicationMethod.returnType,
      fullTypeName: applicationMethod.fullReturnType ?? resolveTypeInFile(applicationMethod.file, applicationMethod.returnType, index),
      genericTypeName,
      genericFullTypeName: genericTypeName ? resolveTypeInFile(applicationMethod.file, genericTypeName, index) : undefined,
    };
  }

  const heuristicType = resolveKnownInvocationReturnType(baseType, invocation.methodName, currentMethod.file, index);
  if (heuristicType) {
    return heuristicType;
  }

  return resolveFluentReceiverType(baseType, invocation.methodName);
}

function getJavaMethodScopeTypes(method: IndexedMethod): JavaMethodScopeTypeIndex {
  const cached = javaMethodScopeTypes.get(method);
  if (cached) return cached;

  const scopeTypes: JavaMethodScopeTypeIndex = { parameters: new Map(), locals: new Map() };
  const parameters = method.node.childForFieldName('parameters');
  if (parameters) {
    for (const child of parameters.children) {
      if (child.type !== 'formal_parameter') continue;
      const nameNode = child.childForFieldName('name');
      const typeNode = child.childForFieldName('type');
      const typeName = normalizeScopedTypeName(typeNode?.text);
      if (nameNode?.text && typeName) scopeTypes.parameters.set(nameNode.text, typeName);
    }
  }

  const body = method.node.childForFieldName('body');
  const visit = (node: any) => {
    if (!node.isNamed) return;

    if (node.type === 'local_variable_declaration') {
      const typeNode = node.childForFieldName('type');
      const typeName = normalizeScopedTypeName(typeNode?.text);
      for (const child of node.children) {
        if (child.type !== 'variable_declarator') continue;
        const nameNode = child.childForFieldName('name');
        if (nameNode?.text && !scopeTypes.locals.has(nameNode.text)) {
          const resolvedType = typeName === 'var' ? inferLocalVariableTypeFromInitializer(child) : typeName;
          if (resolvedType) scopeTypes.locals.set(nameNode.text, resolvedType);
        }
      }
    }

    for (const child of node.children) {
      visit(child);
    }
  };
  if (body) visit(body);

  javaMethodScopeTypes.set(method, scopeTypes);
  return scopeTypes;
}

function inferLocalVariableTypeFromInitializer(variableDeclarator: any): string | undefined {
  const valueNode = variableDeclarator.childForFieldName('value');
  if (!valueNode) return undefined;
  if (valueNode.type === 'object_creation_expression') {
    const typeNode = valueNode.childForFieldName('type');
    return normalizeScopedTypeName(typeNode?.text) ?? normalizeScopedTypeName(valueNode.text.match(/^new\s+([A-Za-z_$][\w$.]*)/)?.[1]);
  }
  return normalizeScopedTypeName(valueNode.text.match(/^new\s+([A-Za-z_$][\w$.]*)/)?.[1]);
}

function resolveTypeToCallTarget(
  objectType: ObjectTypeResolution,
  call: MethodCall,
  index: ProjectIndex,
  fileImports?: FileImports
): ResolvedCall {
  const classRecord = findClassInIndex(objectType, index);
  if (classRecord) {
    if (classRecord.kind === 'interface') {
      const implementations = findInterfaceImplementations(classRecord, index).filter((candidate) =>
        Boolean(selectMethodCandidate(getJavaLookupIndex(index).methodsByClassAndSymbol.get(`${candidate.fullName}\0${call.methodName}`) ?? [], call).targetMethod)
      );

      if (implementations.length === 1) {
        const selection = selectMethodCandidate(getJavaLookupIndex(index).methodsByClassAndSymbol.get(`${implementations[0].fullName}\0${call.methodName}`) ?? [], call);
        if (selection.targetMethod) {
          return {
            className: selection.targetMethod.className,
            isExternal: false,
            source: 'application',
            ownerKind: 'class',
            receiverType: classRecord.className,
            reason: selection.reason ?? `resolved via interface ${classRecord.className}`,
            resolution: selection.resolution,
            targetRelationshipId: selection.targetMethod.relationshipId,
            targetMethod: selection.targetMethod,
          };
        }
      }

      if (implementations.length > 1) {
        const candidates = implementations.flatMap((candidate) =>
          getJavaLookupIndex(index).methodsByClassAndSymbol.get(`${candidate.fullName}\0${call.methodName}`) ?? []
        );
        const selection = selectMethodCandidate(candidates, call);
        if (selection.targetMethod) {
          return {
            className: selection.targetMethod.className,
            isExternal: false,
            source: 'application',
            ownerKind: 'class',
            receiverType: classRecord.className,
            reason: selection.reason ?? `resolved via interface ${classRecord.className}`,
            resolution: selection.resolution,
            targetRelationshipId: selection.targetMethod.relationshipId,
            targetMethod: selection.targetMethod,
          };
        }
        return {
          className: classRecord.className,
          isExternal: true,
          source: 'unknown',
          ownerKind: 'interface',
          receiverType: classRecord.className,
          reason: selection.reason ?? `multiple application implementations found for interface ${classRecord.className}`,
          resolution: selection.resolution,
          targetRelationshipId: selection.ambiguousRelationshipId,
        };
      }
    }

    const selection = selectMethodCandidate(getJavaLookupIndex(index).methodsByClassAndSymbol.get(`${classRecord.fullName}\0${call.methodName}`) ?? [], call);
    if (selection.targetMethod) {
      return {
        className: selection.targetMethod.className,
        isExternal: false,
        source: 'application',
        ownerKind: classRecord.kind === 'interface' ? 'interface' : 'class',
        receiverType: classRecord.className,
        reason: selection.reason,
        resolution: selection.resolution,
        targetRelationshipId: selection.targetMethod.relationshipId,
        targetMethod: selection.targetMethod,
      };
    }
    if (selection.ambiguousRelationshipId) {
      return {
        className: classRecord.className,
        isExternal: true,
        source: 'application',
        ownerKind: classRecord.kind === 'interface' ? 'interface' : 'class',
        receiverType: classRecord.className,
        reason: selection.reason,
        resolution: 'overload_ambiguous',
        targetRelationshipId: selection.ambiguousRelationshipId,
      };
    }

    if (classRecord.kind !== 'interface') {
      return {
        className: classRecord.className,
        isExternal: true,
        source: 'application',
        ownerKind: 'class',
        receiverType: classRecord.className,
        reason: `application class ${classRecord.className} does not declare method ${call.methodName}`,
      };
    }
  }

  const directSelection = selectMethodCandidate(findMethodsForType(objectType, call.methodName, index), call);
  if (directSelection.targetMethod) {
    return {
      className: directSelection.targetMethod.className,
      isExternal: false,
      source: 'application',
      ownerKind: 'class',
      receiverType: objectType.typeName,
      reason: directSelection.reason,
      resolution: directSelection.resolution,
      targetRelationshipId: directSelection.targetMethod.relationshipId,
      targetMethod: directSelection.targetMethod,
    };
  }
  if (directSelection.ambiguousRelationshipId) {
    return {
      className: objectType.typeName,
      isExternal: true,
      source: 'application',
      ownerKind: 'class',
      receiverType: objectType.typeName,
      reason: directSelection.reason,
      resolution: 'overload_ambiguous',
      targetRelationshipId: directSelection.ambiguousRelationshipId,
    };
  }

  const fullTypeName = objectType.fullTypeName ?? fileImports?.imports.get(objectType.typeName);
  if (fullTypeName) {
    if (isFrameworkPackage(fullTypeName)) {
      return {
        className: objectType.typeName,
        isExternal: true,
        source: 'framework',
        ownerKind: 'class',
        receiverType: objectType.typeName,
        reason: `framework type: ${fullTypeName}`,
      };
    }
    if (isLanguagePackage(fullTypeName)) {
      return {
        className: objectType.typeName,
        isExternal: true,
        source: 'language',
        ownerKind: 'class',
        receiverType: objectType.typeName,
        reason: `language type: ${fullTypeName}`,
      };
    }
  }

  return {
    className: objectType.typeName,
    isExternal: true,
    source: 'library',
    ownerKind: 'class',
    receiverType: objectType.typeName,
    reason: 'not found in application index',
  };
}

function resolveTypeInFile(file: string, typeName: string, index: ProjectIndex): string | undefined {
  const normalizedType = normalizeScopedTypeName(typeName);
  if (!normalizedType) return undefined;

  const fileImports = index.imports.get(file);
  const topLevel = normalizedType.split('.')[0] ?? normalizedType;
  const imported = fileImports?.imports.get(topLevel);
  if (imported) {
    const suffix = normalizedType === topLevel ? '' : `.${normalizedType.slice(topLevel.length + 1)}`;
    return `${imported}${suffix}`;
  }

  const lookup = getJavaLookupIndex(index);
  const sameFileType = lookup.classesByFile.get(file)?.find((candidate) => candidate.fullName === normalizedType || candidate.fullName.endsWith(`.${normalizedType}`));
  if (sameFileType) return sameFileType.fullName;

  const currentPackage = fileImports?.package;
  const samePackageClass = lookup.classesByPackage.get(currentPackage ?? '')?.find((candidate) => candidate.fullName === `${currentPackage}.${normalizedType}` || candidate.fullName.endsWith(`.${normalizedType}`));
  if (samePackageClass) return samePackageClass.fullName;

  const uniqueSuffixMatch = lookup.classesBySuffix.get(normalizedType) ?? [];
  if (uniqueSuffixMatch.length === 1) return uniqueSuffixMatch[0].fullName;

  return currentPackage ? `${currentPackage}.${normalizedType}` : normalizedType;
}

function findFieldInIndex(qualifiedClassName: string, fieldName: string, index: ProjectIndex): IndexedField | undefined {
  return getJavaLookupIndex(index).fieldsByClassAndName.get(`${qualifiedClassName}\0${fieldName}`);
}

function findClassByQualifiedName(fullName: string, index: ProjectIndex): IndexedClass | undefined {
  return getJavaLookupIndex(index).classesByFullName.get(fullName);
}

function findClassInIndex(objectType: ObjectTypeResolution, index: ProjectIndex): IndexedClass | undefined {
  const lookup = getJavaLookupIndex(index);
  if (objectType.fullTypeName) {
    const exact = lookup.classesByFullName.get(objectType.fullTypeName);
    if (exact) return exact;
  }
  const matches = [
    ...(lookup.classesBySuffix.get(objectType.typeName) ?? []),
    ...(objectType.fullTypeName ? lookup.classesBySuffix.get(objectType.fullTypeName) ?? [] : []),
  ].filter((candidate, index, self) => self.findIndex((item) => item.symbolId === candidate.symbolId) === index);
  return matches.length === 1 ? matches[0] : matches.find((candidate) => candidate.fullName === objectType.fullTypeName) ?? matches[0];
}

function findMethodsForType(objectType: ObjectTypeResolution, methodName: string, index: ProjectIndex): IndexedMethod[] {
  const lookup = getJavaLookupIndex(index);
  const byFullName = objectType.fullTypeName ? lookup.methodsByClassAndSymbol.get(`${objectType.fullTypeName}\0${methodName}`) ?? [] : [];
  const bySimpleName = lookup.methodsByClassNameAndSymbol.get(`${objectType.typeName}\0${methodName}`) ?? [];
  if (!objectType.fullTypeName) return bySimpleName;
  return [...byFullName, ...bySimpleName].filter((method, index, self) => self.findIndex((item) => item.symbolId === method.symbolId) === index);
}

function findInterfaceImplementations(target: IndexedClass, index: ProjectIndex): IndexedClass[] {
  const lookup = getJavaLookupIndex(index);
  const cached = lookup.implementationsByInterfaceSymbolId.get(target.symbolId);
  if (cached) return cached;
  const implementations = index.classes.filter((candidate) => {
    if (candidate.kind !== 'class' && candidate.kind !== 'record' && candidate.kind !== 'enum') return false;
    return candidate.implements.some((implemented) => implemented === target.fullName || simpleName(implemented) === target.className);
  });
  lookup.implementationsByInterfaceSymbolId.set(target.symbolId, implementations);
  return implementations;
}

function selectMethodCandidate(
  candidates: IndexedMethod[],
  call: Pick<MethodCall, 'callText' | 'methodName'>
): {
  targetMethod?: IndexedMethod;
  resolution?: 'exact' | 'source_heuristic';
  reason?: string;
  ambiguousRelationshipId?: string;
} {
  if (candidates.length === 0) return {};
  if (candidates.length === 1) return { targetMethod: candidates[0], resolution: 'exact' };

  const argumentInfo = parseCallArguments(call.callText);
  const arityMatches = candidates.filter((candidate) => methodAcceptsArity(candidate, argumentInfo.length));
  if (arityMatches.length === 1) {
    return { targetMethod: arityMatches[0], resolution: 'source_heuristic', reason: 'matched overload by argument count' };
  }

  const narrowedByArity = arityMatches.length > 0 ? arityMatches : candidates;
  const categoryMatches = narrowedByArity.filter((candidate) => methodMatchesArgumentCategories(candidate, argumentInfo));
  if (categoryMatches.length === 1) {
    return { targetMethod: categoryMatches[0], resolution: 'source_heuristic', reason: 'matched overload by syntax-only argument categories' };
  }

  const ambiguousCandidates = categoryMatches.length > 0 ? categoryMatches : narrowedByArity;
  const ambiguousRelationshipId = ambiguousCandidates[0]?.relationshipId;
  return {
    ambiguousRelationshipId,
    reason: `overload_ambiguous:${call.methodName}`,
  };
}

function parseCallArguments(callText: string): JavaArgumentInfo[] {
  const start = callText.indexOf('(');
  const end = callText.lastIndexOf(')');
  if (start === -1 || end === -1 || end <= start + 1) return [];
  const rawArgs = splitTopLevelArguments(callText.slice(start + 1, end));
  return rawArgs
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((raw) => {
      const category = classifyArgument(raw);
      const objectType = category === 'object_creation'
        ? raw.match(/^new\s+([A-Za-z_$][\w$.]*)\s*(?:<|\()/)?.[1]?.split('.').pop()
        : undefined;
      return { raw, category, objectType };
    });
}

function splitTopLevelArguments(value: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  let inString: 'single' | 'double' | undefined;
  let escaped = false;

  for (const char of value) {
    current += char;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (inString) {
      if ((inString === 'single' && char === '\'') || (inString === 'double' && char === '"')) inString = undefined;
      continue;
    }
    if (char === '\'') {
      inString = 'single';
      continue;
    }
    if (char === '"') {
      inString = 'double';
      continue;
    }
    if (char === '(' || char === '[' || char === '{' || char === '<') {
      depth++;
      continue;
    }
    if (char === ')' || char === ']' || char === '}' || char === '>') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (char === ',' && depth === 0) {
      parts.push(current.slice(0, -1));
      current = '';
    }
  }

  if (current.trim()) parts.push(current);
  return parts;
}

function classifyArgument(raw: string): JavaArgumentInfo['category'] {
  if (/^"(?:\\.|[^"])*"$/s.test(raw)) return 'string';
  if (/^'(?:\\.|[^'])+'$/s.test(raw)) return 'char';
  if (/^(true|false)$/.test(raw)) return 'boolean';
  if (/^null$/.test(raw)) return 'null';
  if (/^new\s+[A-Za-z_$]/.test(raw)) return 'object_creation';
  if (/^[+-]?(?:\d[\d_]*)(?:\.\d[\d_]*)?(?:[dDfFlL])?$/.test(raw)) return 'numeric';
  if (/^[A-Za-z_$][\w$.]*$/.test(raw)) return 'identifier';
  return 'unknown';
}

function methodAcceptsArity(candidate: IndexedMethod, argCount: number): boolean {
  if (candidate.varargs) return argCount >= Math.max(0, candidate.arity - 1);
  return candidate.arity === argCount;
}

function methodMatchesArgumentCategories(candidate: IndexedMethod, args: JavaArgumentInfo[]): boolean {
  if (!methodAcceptsArity(candidate, args.length)) return false;
  if (args.length === 0) return true;

  for (let i = 0; i < args.length; i++) {
    const parameterType = candidate.normalizedParameterTypes[Math.min(i, candidate.normalizedParameterTypes.length - 1)] ?? 'Object';
    if (!argumentCategoryMatchesParameter(args[i], parameterType)) return false;
  }
  return true;
}

function argumentCategoryMatchesParameter(argument: JavaArgumentInfo, parameterType: string): boolean {
  const normalizedType = parameterType.replace(/\[\]$/, '');
  const { category } = argument;
  if (category === 'unknown' || category === 'identifier') return true;
  if (category === 'object_creation') return normalizedType === 'Object' || argument.objectType === normalizedType;
  if (category === 'null') return !isPrimitiveType(normalizedType);
  if (category === 'string') return ['String', 'CharSequence', 'Object'].includes(normalizedType);
  if (category === 'char') return ['char', 'Character', 'Object'].includes(normalizedType);
  if (category === 'boolean') return ['boolean', 'Boolean', 'Object'].includes(normalizedType);
  if (category === 'numeric') return ['byte', 'short', 'int', 'long', 'float', 'double', 'Byte', 'Short', 'Integer', 'Long', 'Float', 'Double', 'Number', 'Object'].includes(normalizedType);
  return true;
}

function isPrimitiveType(typeName: string): boolean {
  return ['byte', 'short', 'int', 'long', 'float', 'double', 'boolean', 'char'].includes(typeName);
}

function normalizeObjectName(objectName: string): string {
  const trimmed = objectName.trim();
  if (/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(trimmed)) return trimmed;

  const lastIdentifier = trimmed.match(/([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*$/);
  return lastIdentifier?.[1] ?? trimmed;
}

function normalizeScopedTypeName(typeText?: string): string {
  if (!typeText) return '';
  return typeText.replace(/<[^<>]*>/g, '').replace(/\[\]/g, '').replace(/\.\.\./g, '').trim();
}

function simpleName(fullName: string): string {
  return fullName.split('.').pop() ?? fullName;
}

function extractFirstGenericType(typeText?: string): string | undefined {
  if (!typeText) return undefined;
  const match = typeText.match(/<\s*([A-Za-z_$][\w$.]*)/);
  return match ? simpleName(normalizeScopedTypeName(match[1])) : undefined;
}

function unwrapMockitoReceiverInvocation(expression: string): string | undefined {
  const trimmed = expression.trim();
  const match = trimmed.match(/^(?:[A-Za-z_$][\w$]*\.)?([A-Za-z_$][\w$]*)\s*\(([\s\S]*)\)$/);
  if (!match || (match[1] !== 'verify' && match[1] !== 'when')) return undefined;
  const args = splitTopLevelArguments(match[2]);
  if (match[1] === 'verify') return args[0]?.trim();
  return args.length === 1 ? args[0].trim() : undefined;
}

function looksLikeMethodInvocation(expression: string): boolean {
  return expression.includes('(') && expression.endsWith(')');
}

function looksLikeStaticFieldAccess(expression: string): boolean {
  return /^[A-Z][A-Za-z0-9_$.]*\.[A-Z0-9_$]+$/.test(expression.trim());
}

function inferExpressionNodeType(expression: string): string | undefined {
  const trimmed = expression.trim();
  if (trimmed.startsWith('new ')) return 'object_creation_expression';
  if (looksLikeMethodInvocation(trimmed)) return 'method_invocation';
  return undefined;
}

function splitInvocationExpression(expression: string): { baseExpression: string; methodName: string } | undefined {
  const trimmed = expression.trim();
  if (!trimmed.endsWith(')')) return undefined;

  let depth = 0;
  let openParen = -1;
  for (let i = trimmed.length - 1; i >= 0; i--) {
    const char = trimmed[i];
    if (char === ')') depth++;
    else if (char === '(') {
      depth--;
      if (depth === 0) {
        openParen = i;
        break;
      }
    }
  }
  if (openParen === -1) return undefined;

  const methodEnd = openParen;
  let methodStart = methodEnd - 1;
  while (methodStart >= 0 && /[A-Za-z0-9_$]/.test(trimmed[methodStart])) {
    methodStart--;
  }
  const methodName = trimmed.slice(methodStart + 1, methodEnd);
  const dotIndex = methodStart;
  if (!methodName || dotIndex < 0 || trimmed[dotIndex] !== '.') return undefined;

  return {
    baseExpression: trimmed.slice(0, dotIndex),
    methodName,
  };
}

function resolveKnownInvocationReturnType(
  baseType: ObjectTypeResolution,
  methodName: string,
  file: string,
  index: ProjectIndex
): ObjectTypeResolution | undefined {
  if (baseType.typeName === 'HttpServletRequest' && methodName === 'getHeader') {
    return { typeName: 'String', fullTypeName: 'java.lang.String' };
  }

  if (baseType.typeName === 'DecodedJWT' && methodName === 'getClaim') {
    return { typeName: 'Claim', fullTypeName: resolveTypeInFile(file, 'Claim', index) ?? 'com.auth0.jwt.interfaces.Claim' };
  }

  if (baseType.typeName === 'Claim' && methodName === 'asString') {
    return { typeName: 'String', fullTypeName: 'java.lang.String' };
  }

  if (baseType.typeName === 'Optional' && methodName === 'orElseThrow' && baseType.genericTypeName) {
    return {
      typeName: baseType.genericTypeName,
      fullTypeName: baseType.genericFullTypeName ?? resolveTypeInFile(file, baseType.genericTypeName, index),
    };
  }

  return undefined;
}

function resolveFluentReceiverType(
  baseType: ObjectTypeResolution,
  methodName: string
): ObjectTypeResolution | undefined {
  const fluentMethods = new Set(['set', 'and', 'or', 'withIssuer', 'withExpiresAt', 'withClaim', 'withSubject', 'append', 'withValue', 'addField']);
  if (!fluentMethods.has(methodName)) return undefined;
  return baseType;
}

function detectCallbackKind(callText: string): 'lambda' | 'method_reference' | 'anonymous_class' | undefined {
  if (callText.includes('->')) return 'lambda';
  if (callText.includes('::')) return 'method_reference';
  if (/new\s+[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{/.test(callText)) return 'anonymous_class';
  return undefined;
}

function classifyExpressionSource(expression: string, fileImports?: FileImports): CallSource {
  const normalizedObject = normalizeObjectName(expression);
  const imported = fileImports?.imports.get(simpleName(normalizedObject));
  if (imported) {
    if (isFrameworkPackage(imported)) return 'framework';
    if (isLanguagePackage(imported)) return 'language';
    return 'library';
  }
  return 'unknown';
}

function isFrameworkPackage(fullName: string): boolean {
  const frameworkPrefixes = [
    'org.springframework',
    'jakarta',
    'javax',
    'lombok',
    'org.apache',
    'com.fasterxml',
    'io.swagger',
    'org.hibernate',
    'org.slf4j',
  ];
  return frameworkPrefixes.some((prefix) => fullName.startsWith(prefix));
}

function isLanguagePackage(fullName: string): boolean {
  return fullName.startsWith('java.') || fullName.startsWith('sun.') || fullName.startsWith('jdk.');
}

function createExternalNode(
  currentMethod: IndexedMethod,
  call: MethodCall,
  source: CallSource,
  reason: string | undefined,
  resolved: ResolvedCall | undefined,
  index: ProjectIndex,
  maxDepth: number,
  includeExternal: boolean,
  depth: number,
  visited: Set<string>
): CallTreeNode {
  const node: CallTreeNode = {
    symbol: call.methodName,
    kind: 'method',
    node_type: classifyExternalNodeType(call, source),
    called_as: call.callText,
    is_application: false,
    is_external: true,
    source,
  };

  if (resolved?.receiverType) {
    node.receiver_type = resolved.receiverType;
  }

  const callbackKind = detectCallbackKind(call.callText);
  if (callbackKind) {
    node.has_callback = true;
    node.callback_kind = callbackKind;
  }

  if (reason) {
    node.reason = reason;
  }

  const callbackChildren = buildCallbackChildren(currentMethod, call.callbacks ?? [], index, maxDepth, includeExternal, depth, visited);
  if (callbackChildren.length > 0) {
    node.children = callbackChildren;
  }

  return node;
}

function buildCallbackChildren(
  currentMethod: IndexedMethod,
  callbacks: CallbackInfo[],
  index: ProjectIndex,
  maxDepth: number,
  includeExternal: boolean,
  depth: number,
  visited: Set<string>
): CallTreeNode[] {
  const nodes: CallTreeNode[] = [];

  for (const callback of callbacks) {
    const callbackCallChildren = buildChildrenFromCalls(currentMethod, callback.calls, index, maxDepth, includeExternal, depth + 1, visited);
    if (callbackCallChildren.length === 0) {
      continue;
    }

    nodes.push({
      symbol: '<callback>',
      kind: 'function',
      node_type: 'callback',
      called_as: callback.text,
      has_callback: true,
      callback_kind: callback.kind,
      is_application: false,
      is_external: true,
      source: 'unknown',
      children: callbackCallChildren,
    });
  }

  return nodes;
}

function classifyExternalNodeType(call: MethodCall, source: CallSource): CallNodeType {
  if (source === 'framework') return 'framework';
  if (call.methodName === '<callback>') return 'callback';
  if (looksLikeDataAccess(call)) return 'data_access';
  if (looksLikeFluentChain(call)) return 'fluent_chain';
  return 'external';
}

function looksLikeDataAccess(call: MethodCall): boolean {
  if (call.callbacks && call.callbacks.length > 0) return false;
  if (!call.object) return false;
  if (!/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\.[A-Za-z_$][\w$]*\(\)$/.test(call.callText.replace(/\s+/g, ''))) {
    return false;
  }
  if (/^(get|set|with|build|stream|map|flatMap|filter|collect|forEach|orElseThrow|toList)$/.test(call.methodName)) {
    return false;
  }
  if (/^(is|has)[A-Z_]/.test(call.methodName) || /^[a-z][A-Za-z0-9_]*$/.test(call.methodName)) {
    return true;
  }
  return false;
}

function looksLikeFluentChain(call: MethodCall): boolean {
  const compact = call.callText.replace(/\s+/g, '');
  return compact.includes(').') || compact.includes('().');
}

function compactNodeTree(node: CallTreeNode): CallTreeNode {
  const compactedChildren = node.children?.map(compactNodeTree);
  const nextNode: CallTreeNode = compactedChildren ? { ...node, children: compactedChildren } : { ...node };

  if (!compactedChildren || compactedChildren.length === 0) {
    return nextNode;
  }

  nextNode.children = compactDataAccessSiblings(compactedChildren);
  return nextNode;
}

function compactDataAccessSiblings(children: CallTreeNode[]): CallTreeNode[] {
  const compacted: CallTreeNode[] = [];
  let group: CallTreeNode[] = [];

  const flush = () => {
    if (group.length === 0) return;
    if (group.length === 1) {
      compacted.push(group[0]);
    } else {
      compacted.push({
        symbol: '<data_access_group>',
        kind: 'function',
        node_type: 'data_access',
        called_as: group.map((node) => node.called_as ?? node.symbol).join(', '),
        is_application: false,
        is_external: true,
        source: 'unknown',
      });
    }
    group = [];
  };

  for (const child of children) {
    if (child.node_type === 'data_access') {
      group.push(child);
      continue;
    }
    flush();
    compacted.push(child);
  }

  flush();
  return compacted;
}

function countNodes(
  node: CallTreeNode,
  depth: number,
  stats: FunctionCallTreeResult['stats']
): void {
  stats.total_nodes++;
  if (node.is_application) {
    stats.application_nodes++;
  } else {
    stats.external_nodes++;
  }
  stats.max_depth_reached = Math.max(stats.max_depth_reached, depth);

  if (node.children) {
    for (const child of node.children) {
      countNodes(child, depth + 1, stats);
    }
  }
}
