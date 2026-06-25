import { readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { CallSource, CallTreeNode, FunctionCallTreeInput, FunctionCallTreeResult } from '../../types.js';
import { buildProjectIndex } from '../../core/project-index.js';
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
  currentDepth?: number;
  visited?: Set<string>;
}

interface MethodCall {
  methodName: string;
  object?: string;
  line: number;
  column: number;
}

interface ResolvedCall {
  className: string;
  isExternal: boolean;
  source: CallSource;
  reason?: string;
}

interface ObjectTypeResolution {
  typeName: string;
  fullTypeName?: string;
}

export async function resolveJavaIndexRoot(filePath: string): Promise<string> {
  const fileDir = dirname(filePath);
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
    currentDepth = 0,
    visited = new Set(),
  } = options;

  const rootNode = buildNode(rootMethod, index, maxDepth, includeExternal, currentDepth, visited);

  const stats = {
    total_nodes: 0,
    application_nodes: 0,
    external_nodes: 0,
    max_depth_reached: 0,
  };

  countNodes(rootNode, 0, stats);
  return { root: rootNode, stats };
}

function buildNode(
  method: IndexedMethod,
  index: ProjectIndex,
  maxDepth: number,
  includeExternal: boolean,
  depth: number,
  visited: Set<string>
): CallTreeNode {
  const node: CallTreeNode = {
    file: method.file,
    symbol: method.symbol,
    kind: 'method',
    class: method.className,
    package: method.package,
    line: method.line,
    column: method.column,
    is_application: true,
    is_external: false,
    source: 'application',
  };

  const visitKey = `${method.file}:${method.className}:${method.symbol}`;
  if (visited.has(visitKey) || depth >= maxDepth) {
    return node;
  }
  visited.add(visitKey);

  const calls = extractMethodCalls(method.node);
  const children: CallTreeNode[] = [];

  for (const call of calls) {
    const resolved = resolveCall(method, call, index);
    if (!resolved) {
      if (includeExternal) {
        children.push(createExternalNode(call, 'unknown'));
      }
      continue;
    }

    if (resolved.isExternal) {
      if (includeExternal) {
        children.push(createExternalNode(call, resolved.source, resolved.reason));
      }
      continue;
    }

    const targetMethod = findMethodInIndex(resolved.className, call.methodName, index);
    if (targetMethod) {
      children.push(buildNode(targetMethod, index, maxDepth, includeExternal, depth + 1, visited));
    } else if (includeExternal) {
      children.push(createExternalNode(call, resolved.source, resolved.reason));
    }
  }

  if (children.length > 0) {
    node.children = children;
  }

  return node;
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
          line: node.startPosition.row + 1,
          column: node.startPosition.column,
        });
      }
      return;
    }

    for (const child of node.children) {
      visit(child);
    }
  }

  const body = methodNode.childForFieldName('body');
  if (body) visit(body);
  return calls;
}

function resolveCall(currentMethod: IndexedMethod, call: MethodCall, index: ProjectIndex): ResolvedCall | undefined {
  const fileImports = index.imports.get(currentMethod.file);

  if (!call.object || call.object === 'this') {
    if (findMethodInIndex(currentMethod.className, call.methodName, index)) {
      return { className: currentMethod.className, isExternal: false, source: 'application' };
    }
    return {
      className: currentMethod.className,
      isExternal: true,
      source: 'language',
      reason: 'method without receiver not found in current application class',
    };
  }

  const objectType = resolveObjectType(currentMethod, call.object, index);
  if (!objectType) {
    return {
      className: call.object,
      isExternal: true,
      source: classifyExpressionSource(call.object, fileImports),
      reason: 'could not resolve object type',
    };
  }

  return resolveTypeToCallTarget(objectType, call.methodName, index, fileImports);
}

function resolveObjectType(
  currentMethod: IndexedMethod,
  objectName: string,
  index: ProjectIndex
): ObjectTypeResolution | undefined {
  const normalizedObject = normalizeObjectName(objectName);

  const scopedType = resolveMethodScopedType(currentMethod, normalizedObject, index);
  if (scopedType) return scopedType;

  const field = findFieldInIndex(currentMethod.className, normalizedObject, index);
  if (field) {
    return {
      typeName: field.typeName,
      fullTypeName: field.fullTypeName,
    };
  }

  const fileImports = index.imports.get(currentMethod.file);
  const imported = fileImports?.imports.get(normalizedObject);
  if (imported) {
    return { typeName: simpleName(imported), fullTypeName: imported };
  }

  if (normalizedObject[0] === normalizedObject[0]?.toUpperCase()) {
    return {
      typeName: normalizedObject,
      fullTypeName: fileImports?.imports.get(normalizedObject),
    };
  }

  return undefined;
}

function resolveMethodScopedType(
  currentMethod: IndexedMethod,
  objectName: string,
  index: ProjectIndex
): ObjectTypeResolution | undefined {
  const parameterType = findParameterType(currentMethod.node, objectName);
  if (parameterType) {
    return {
      typeName: parameterType,
      fullTypeName: resolveTypeInFile(currentMethod.file, parameterType, index),
    };
  }

  const localType = findLocalVariableType(currentMethod.node, objectName);
  if (localType) {
    return {
      typeName: localType,
      fullTypeName: resolveTypeInFile(currentMethod.file, localType, index),
    };
  }

  return undefined;
}

function findParameterType(methodNode: any, parameterName: string): string | undefined {
  const parameters = methodNode.childForFieldName('parameters');
  if (!parameters) return undefined;

  for (const child of parameters.children) {
    if (child.type !== 'formal_parameter') continue;
    const nameNode = child.childForFieldName('name');
    if (!nameNode || nameNode.text !== parameterName) continue;
    const typeNode = child.childForFieldName('type');
    return normalizeTypeName(typeNode?.text);
  }

  return undefined;
}

function findLocalVariableType(methodNode: any, variableName: string): string | undefined {
  const body = methodNode.childForFieldName('body');
  if (!body) return undefined;

  let found: string | undefined;

  function visit(node: any) {
    if (found || !node.isNamed) return;

    if (node.type === 'local_variable_declaration') {
      const typeNode = node.childForFieldName('type');
      const typeName = normalizeTypeName(typeNode?.text);
      for (const child of node.children) {
        if (child.type !== 'variable_declarator') continue;
        const nameNode = child.childForFieldName('name');
        if (nameNode?.text === variableName) {
          found = typeName;
          return;
        }
      }
    }

    for (const child of node.children) {
      visit(child);
    }
  }

  visit(body);
  return found;
}

function resolveTypeToCallTarget(
  objectType: ObjectTypeResolution,
  methodName: string,
  index: ProjectIndex,
  fileImports?: FileImports
): ResolvedCall {
  const classRecord = findClassInIndex(objectType, index);
  if (classRecord) {
    if (classRecord.kind === 'interface') {
      const implementations = findInterfaceImplementations(classRecord, index).filter((candidate) =>
        Boolean(findMethodInIndex(candidate.className, methodName, index))
      );

      if (implementations.length === 1) {
        return {
          className: implementations[0].className,
          isExternal: false,
          source: 'application',
          reason: `resolved via interface ${classRecord.className}`,
        };
      }

      if (implementations.length > 1) {
        return {
          className: classRecord.className,
          isExternal: true,
          source: 'unknown',
          reason: `multiple application implementations found for interface ${classRecord.className}`,
        };
      }
    }

    const directMethod = findMethodInIndex(classRecord.className, methodName, index);
    if (directMethod) {
      return { className: directMethod.className, isExternal: false, source: 'application' };
    }

    if (classRecord.kind === 'class') {
      return {
        className: classRecord.className,
        isExternal: true,
        source: 'application',
        reason: `application class ${classRecord.className} does not declare method ${methodName}`,
      };
    }
  }

  const directMethod = findMethodInIndex(objectType.typeName, methodName, index);
  if (directMethod) {
    return { className: directMethod.className, isExternal: false, source: 'application' };
  }

  const fullTypeName = objectType.fullTypeName ?? fileImports?.imports.get(objectType.typeName);
  if (fullTypeName) {
    if (isFrameworkPackage(fullTypeName)) {
      return {
        className: objectType.typeName,
        isExternal: true,
        source: 'framework',
        reason: `framework type: ${fullTypeName}`,
      };
    }
    if (isLanguagePackage(fullTypeName)) {
      return {
        className: objectType.typeName,
        isExternal: true,
        source: 'language',
        reason: `language type: ${fullTypeName}`,
      };
    }
  }

  return {
    className: objectType.typeName,
    isExternal: true,
    source: 'library',
    reason: 'not found in application index',
  };
}

function resolveTypeInFile(file: string, typeName: string, index: ProjectIndex): string | undefined {
  const fileImports = index.imports.get(file);
  const imported = fileImports?.imports.get(typeName);
  if (imported) return imported;

  const currentPackage = fileImports?.package;
  const samePackageClass = index.classes.find((candidate) =>
    candidate.className === typeName && candidate.package === currentPackage
  );
  if (samePackageClass) return samePackageClass.fullName;

  return undefined;
}

function findFieldInIndex(className: string, fieldName: string, index: ProjectIndex): IndexedField | undefined {
  return index.fields.find((field) => field.className === className && field.fieldName === fieldName);
}

function findMethodInIndex(className: string, methodName: string, index: ProjectIndex): IndexedMethod | undefined {
  return index.methods.find((method) => method.className === className && method.symbol === methodName);
}

function findClassInIndex(objectType: ObjectTypeResolution, index: ProjectIndex): IndexedClass | undefined {
  return index.classes.find((candidate) => {
    if (candidate.className === objectType.typeName) return true;
    if (objectType.fullTypeName && candidate.fullName === objectType.fullTypeName) return true;
    return false;
  });
}

function findInterfaceImplementations(target: IndexedClass, index: ProjectIndex): IndexedClass[] {
  return index.classes.filter((candidate) => {
    if (candidate.kind !== 'class') return false;
    return candidate.implements.some((implemented) =>
      implemented === target.className || implemented === target.fullName || simpleName(implemented) === target.className
    );
  });
}

function normalizeObjectName(objectName: string): string {
  const trimmed = objectName.trim();
  if (/^[A-Za-z_$][\w$]*$/.test(trimmed)) return trimmed;

  const lastIdentifier = trimmed.match(/([A-Za-z_$][\w$]*)\s*$/);
  return lastIdentifier?.[1] ?? trimmed;
}

function normalizeTypeName(typeText?: string): string {
  if (!typeText) return '';
  const withoutGenerics = typeText.replace(/<.*>/g, '');
  const lastSegment = withoutGenerics.split('.').pop() ?? withoutGenerics;
  return lastSegment.trim();
}

function simpleName(fullName: string): string {
  return fullName.split('.').pop() ?? fullName;
}

function classifyExpressionSource(expression: string, fileImports?: FileImports): CallSource {
  const normalizedObject = normalizeObjectName(expression);
  const imported = fileImports?.imports.get(normalizedObject);
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

function createExternalNode(call: MethodCall, source: CallSource, reason?: string): CallTreeNode {
  return {
    symbol: call.methodName,
    kind: 'method',
    line: call.line,
    column: call.column,
    is_application: false,
    is_external: true,
    source,
    reason,
  };
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
