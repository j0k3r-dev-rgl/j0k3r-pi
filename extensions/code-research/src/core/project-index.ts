import { readFile } from 'node:fs/promises';
import { extractJavaSymbolRecords } from '../languages/java/symbol-extractor.js';
import type { CanonicalJavaSymbolRecord, JavaDeclarationKind, JavaExtractionResult } from '../types.js';
import { getParser, parseSource } from './parser.js';
import { collectWorkspaceSourceFiles, isMissingFileError } from './source-policy.js';

export interface IndexedMethod {
  file: string;
  package: string;
  className: string;
  qualifiedClassName: string;
  symbol: string;
  qualifiedName: string;
  ownerChain: string[];
  returnType?: string;
  fullReturnType?: string;
  declarationKind: 'method' | 'constructor' | 'compact_constructor' | 'annotation_element';
  normalizedParameterTypes: string[];
  arity: number;
  varargs: boolean;
  symbolId: string;
  relationshipId?: string;
  line: number;
  column: number;
  node: any;
}

export interface IndexedField {
  file: string;
  package: string;
  className: string;
  qualifiedClassName: string;
  fieldName: string;
  qualifiedName: string;
  typeName: string;
  fullTypeName?: string;
  symbolId: string;
  line: number;
  column: number;
  typeLine: number;
  typeColumn: number;
  typeEndLine: number;
  typeEndColumn: number;
}

export interface IndexedClass {
  file: string;
  package: string;
  className: string;
  fullName: string;
  kind: 'class' | 'interface' | 'enum' | 'record' | 'annotation';
  ownerChain: string[];
  symbolId: string;
  implements: string[];
  extends: string[];
  permits: string[];
  line: number;
  column: number;
}

export interface FileImports {
  file: string;
  package: string;
  imports: Map<string, string>;
  wildcardImports: string[];
}

export interface IndexedJavaTypeReference {
  file: string;
  targetSymbolId: string;
  contextSymbolId?: string;
  contextClassName?: string;
  contextKind?: IndexedClass['kind'];
  referenceKind: 'import' | 'type_reference' | 'instantiate' | 'read';
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  calledAs?: string;
  importSource?: string;
}

export interface IndexedJavaFile {
  file: string;
  package: string;
  source: string;
  rootNode: any;
  extraction: JavaExtractionResult;
}

export interface ProjectIndex {
  methods: IndexedMethod[];
  fields: IndexedField[];
  classes: IndexedClass[];
  imports: Map<string, FileImports>;
  files: IndexedJavaFile[];
  typeReferences: IndexedJavaTypeReference[];
}

export async function buildProjectIndex(rootDir: string): Promise<ProjectIndex> {
  const index: ProjectIndex = {
    methods: [],
    fields: [],
    classes: [],
    imports: new Map(),
    files: [],
    typeReferences: [],
  };

  const javaFiles = (await collectWorkspaceSourceFiles(rootDir)).filter((file) => file.endsWith('.java'));

  for (const file of javaFiles) {
    let source: string;
    try {
      source = await readFile(file, 'utf8');
    } catch (error) {
      if (isMissingFileError(error)) continue;
      throw error;
    }
    const parser = getParser('java');
    const tree = parseSource(parser, source);
    const extraction = extractJavaSymbolRecords({ filePath: file, source, rootNode: tree.rootNode });
    indexFile(file, source, tree.rootNode, extraction, index);
  }

  index.typeReferences = collectJavaTypeReferences(index);
  return index;
}

function indexFile(file: string, source: string, rootNode: any, extraction: JavaExtractionResult, index: ProjectIndex): void {
  const fileImports: FileImports = {
    file,
    package: '',
    imports: new Map(),
    wildcardImports: [],
  };

  let packageName = '';

  function visit(node: any) {
    if (!node.isNamed) return;

    if (node.type === 'package_declaration') {
      packageName = extractQualifiedName(node);
      fileImports.package = packageName;
    }

    if (node.type === 'import_declaration') {
      const fullName = extractQualifiedName(node);
      const isWildcard = node.text.includes('*');
      if (fullName) {
        if (isWildcard) {
          fileImports.wildcardImports.push(fullName.replace(/\.\*$/, ''));
        } else {
          const simpleName = fullName.split('.').pop() ?? fullName;
          fileImports.imports.set(simpleName, fullName);
        }
      }
    }

    if (isIndexedTypeNode(node)) {
      const classNameNode = node.childForFieldName('name');
      if (classNameNode) {
        const className = classNameNode.text;
        const classRecord = findMatchingRecord(extraction.records, {
          declarationKinds: ['class', 'interface', 'enum', 'record', 'annotation'],
          name: className,
          line: classNameNode.startPosition.row + 1,
        });
        if (classRecord) {
          index.classes.push({
            file,
            package: packageName,
            className,
            fullName: classRecord.qualifiedName,
            kind: declarationKindToClassKind(classRecord.declarationKind),
            ownerChain: classRecord.ownerChain,
            symbolId: classRecord.symbolId,
            implements: extractTypeList(node.childForFieldName('interfaces'), packageName, fileImports, extraction.records),
            extends: extractTypeList(node.childForFieldName('superclass'), packageName, fileImports, extraction.records),
            permits: extractTypeList(node.childForFieldName('permits'), packageName, fileImports, extraction.records),
            line: node.startPosition.row + 1,
            column: node.startPosition.column,
          });

          indexClassMembers(file, packageName, className, classRecord, node, fileImports, extraction, index);
        }
      }
    }

    for (const child of node.children) visit(child);
  }

  visit(rootNode);
  index.imports.set(file, fileImports);
  index.files.push({ file, package: packageName, source, rootNode, extraction });
}

function indexClassMembers(
  file: string,
  packageName: string,
  className: string,
  classRecord: CanonicalJavaSymbolRecord,
  classNode: any,
  fileImports: FileImports,
  extraction: JavaExtractionResult,
  index: ProjectIndex
): void {
  const body = classNode.childForFieldName('body');
  if (!body) return;

  function visit(node: any) {
    if (!node.isNamed) return;

    if (node.type === 'field_declaration') {
      const typeNode = node.childForFieldName('type');
      const typeName = normalizeSimpleTypeName(typeNode?.text);
      const ownerChain = [...classRecord.ownerChain, className];
      if (typeName) {
        for (const child of node.children) {
          if (child.type !== 'variable_declarator') continue;
          const nameNode = child.childForFieldName('name');
          if (!nameNode) continue;
          const fieldRecord = findMatchingRecord(extraction.records, {
            declarationKinds: ['field'],
            name: nameNode.text,
            ownerChain,
            line: child.startPosition.row + 1,
          });
          if (!fieldRecord) continue;
          index.fields.push({
            file,
            package: packageName,
            className,
            qualifiedClassName: classRecord.qualifiedName,
            fieldName: nameNode.text,
            qualifiedName: fieldRecord.qualifiedName,
            typeName,
            fullTypeName: resolveTypeReference(file, typeNode?.text, packageName, fileImports, extraction.records),
            symbolId: fieldRecord.symbolId,
            line: child.startPosition.row + 1,
            column: child.startPosition.column,
            typeLine: typeNode.startPosition.row + 1,
            typeColumn: typeNode.startPosition.column,
            typeEndLine: typeNode.endPosition.row + 1,
            typeEndColumn: typeNode.endPosition.column,
          });
        }
      }
    }

    if (node.type === 'method_declaration' || node.type === 'constructor_declaration' || node.type === 'compact_constructor_declaration') {
      const nameNode = node.childForFieldName('name');
      const methodName = nameNode?.text ?? className;
      const ownerChain = [...classRecord.ownerChain, className];
      const methodRecord = findMatchingRecord(extraction.records, {
        declarationKinds: ['method', 'constructor', 'compact_constructor', 'annotation_element'],
        name: methodName,
        ownerChain,
        line: nameNode?.startPosition.row + 1,
      });
      if (methodRecord) {
        const methodTypeNode = node.type === 'method_declaration' ? node.childForFieldName('type') : undefined;
        const returnType = normalizeSimpleTypeName(methodTypeNode?.text);
        const parameterInfo = extractMethodParameterInfo(node);
        index.methods.push({
          file,
          package: packageName,
          className,
          qualifiedClassName: classRecord.qualifiedName,
          symbol: methodName,
          qualifiedName: methodRecord.qualifiedName,
          ownerChain: methodRecord.ownerChain,
          returnType: returnType || undefined,
          fullReturnType: returnType ? resolveTypeReference(file, methodTypeNode?.text, packageName, fileImports, extraction.records) : undefined,
          declarationKind: methodRecord.declarationKind as IndexedMethod['declarationKind'],
          normalizedParameterTypes: parameterInfo.parameterTypes,
          arity: parameterInfo.arity,
          varargs: parameterInfo.varargs,
          symbolId: methodRecord.symbolId,
          relationshipId: methodRecord.relationshipId,
          line: node.startPosition.row + 1,
          column: node.startPosition.column,
          node,
        });
      }
    }

    if (isIndexedTypeNode(node)) return;
    for (const child of node.children) visit(child);
  }

  visit(body);
}

function isIndexedTypeNode(node: any): boolean {
  return (
    node.type === 'class_declaration' ||
    node.type === 'interface_declaration' ||
    node.type === 'enum_declaration' ||
    node.type === 'record_declaration' ||
    node.type === 'annotation_type_declaration'
  );
}

function declarationKindToClassKind(kind: JavaDeclarationKind): IndexedClass['kind'] {
  switch (kind) {
    case 'interface':
      return 'interface';
    case 'enum':
      return 'enum';
    case 'record':
      return 'record';
    case 'annotation':
      return 'annotation';
    default:
      return 'class';
  }
}

function findMatchingRecord(
  records: CanonicalJavaSymbolRecord[],
  options: { declarationKinds: JavaDeclarationKind[]; name: string; ownerChain?: string[]; line: number }
): CanonicalJavaSymbolRecord | undefined {
  return records.find((record) => {
    if (!options.declarationKinds.includes(record.declarationKind)) return false;
    if (record.name !== options.name) return false;
    if (record.declarationRange.startLine !== options.line) return false;
    if (!options.ownerChain) return true;
    return arraysEqual(record.ownerChain, options.ownerChain);
  });
}

function extractQualifiedName(node: any): string {
  const namedChild = node.children.find((child: any) => child.isNamed && child.type !== 'asterisk');
  return namedChild?.text ?? '';
}

function extractTypeList(
  rootNode: any,
  packageName: string,
  fileImports: FileImports,
  records: CanonicalJavaSymbolRecord[]
): string[] {
  if (!rootNode) return [];
  const result: string[] = [];
  function visit(node: any) {
    if (!node?.isNamed) return;
    if (node.type === 'type_identifier' || node.type === 'generic_type' || node.type === 'scoped_type_identifier') {
      const resolved = resolveTypeReference('', node.text, packageName, fileImports, records);
      result.push(resolved ?? normalizeScopedTypeName(node.text));
      return;
    }
    for (const child of node.children) visit(child);
  }
  visit(rootNode);
  return [...new Set(result.filter(Boolean))];
}

function extractMethodParameterInfo(node: any): { parameterTypes: string[]; arity: number; varargs: boolean } {
  const parametersNode = node.childForFieldName('parameters');
  if (!parametersNode) return { parameterTypes: [], arity: 0, varargs: false };

  const parameterTypes: string[] = [];
  let varargs = false;
  for (const child of parametersNode.children ?? []) {
    if (!child?.isNamed) continue;
    if (child.type !== 'formal_parameter' && child.type !== 'spread_parameter') continue;
    const typeNode = child.childForFieldName('type');
    parameterTypes.push(normalizeSimpleTypeName(typeNode?.text));
    if (child.type === 'spread_parameter' || child.text.includes('...')) varargs = true;
  }

  return { parameterTypes, arity: parameterTypes.length, varargs };
}

function normalizeSimpleTypeName(typeText?: string): string {
  if (!typeText) return '';
  const withoutAnnotations = typeText.replace(/@[A-Za-z_$][\w$.]*(?:\([^)]*\))?\s*/g, '');
  const withoutGenerics = withoutAnnotations.replace(/<[^<>]*>/g, '');
  const withoutArrays = withoutGenerics.replace(/\[\]/g, '').replace(/\.\.\./g, '');
  const lastSegment = withoutArrays.split('.').pop() ?? withoutArrays;
  return lastSegment.trim();
}

function normalizeScopedTypeName(typeText?: string): string {
  if (!typeText) return '';
  return typeText.replace(/<[^<>]*>/g, '').replace(/\[\]/g, '').trim();
}

function resolveTypeReference(
  file: string,
  typeText: string | undefined,
  packageName: string,
  fileImports: FileImports,
  records: CanonicalJavaSymbolRecord[]
): string | undefined {
  const scopedType = normalizeScopedTypeName(typeText);
  if (!scopedType) return undefined;

  const topLevel = scopedType.split('.')[0] ?? scopedType;
  const imported = fileImports.imports.get(topLevel);
  if (imported) {
    const suffix = scopedType === topLevel ? '' : `.${scopedType.slice(topLevel.length + 1)}`;
    return `${imported}${suffix}`;
  }

  const fileTypeRecord = records.find(
    (record) =>
      (record.declarationKind === 'class' ||
        record.declarationKind === 'interface' ||
        record.declarationKind === 'enum' ||
        record.declarationKind === 'record' ||
        record.declarationKind === 'annotation') &&
      (record.qualifiedName === scopedType || record.qualifiedName.endsWith(`.${scopedType}`))
  );
  if (fileTypeRecord) return fileTypeRecord.qualifiedName;

  if (packageName) return `${packageName}.${scopedType}`;
  return scopedType;
}

function collectJavaTypeReferences(index: ProjectIndex): IndexedJavaTypeReference[] {
  const results: IndexedJavaTypeReference[] = [];
  for (const target of index.classes) {
    for (const file of index.files) {
      if (file.file === target.file) continue;
      const fileImports = index.imports.get(file.file);
      if (!fileImports) continue;
      const imported = fileImports.imports.get(target.className);
      if (imported === target.fullName) {
        const position = findRegexPosition(file.source, new RegExp(`import\\s+${escapeRegExp(target.fullName)}\\s*;`));
        if (position) {
          results.push({
            file: file.file,
            targetSymbolId: target.symbolId,
            referenceKind: 'import',
            line: position.line,
            column: position.column,
            endLine: position.line,
            endColumn: position.column + `import ${target.fullName};`.length,
            calledAs: `import ${target.fullName};`,
            importSource: target.fullName,
          });
        }
      }
      for (const field of index.fields) {
        if (field.file !== file.file || !(field.typeName === target.className || field.fullTypeName === target.fullName)) continue;
        const contextClass = index.classes.find((klass) => klass.file === field.file && klass.className === field.className);
        results.push({
          file: field.file,
          targetSymbolId: target.symbolId,
          contextSymbolId: contextClass?.symbolId,
          contextClassName: field.className,
          contextKind: 'class',
          referenceKind: 'type_reference',
          line: field.typeLine,
          column: field.typeColumn,
          endLine: field.typeEndLine,
          endColumn: field.typeEndColumn,
          calledAs: field.typeName,
        });
      }
      collectSemanticReferencesForTarget(file, target, fileImports, index, results);
    }
  }
  return dedupeTypeReferences(results);
}

function collectSemanticReferencesForTarget(
  file: IndexedJavaFile,
  target: IndexedClass,
  fileImports: FileImports,
  index: ProjectIndex,
  results: IndexedJavaTypeReference[]
): void {
  function visit(node: any, ancestors: any[] = []) {
    if (!node?.isNamed) return;
    if (node.type === 'import_declaration') return;

    const parent = ancestors[ancestors.length - 1];
    if (isIndexedTypeNodeName(node, parent)) return;

    if ((node.type === 'method_invocation' || node.type === 'field_access') && javaTypeTextMatchesTarget(node.childForFieldName('object')?.text, target, fileImports)) {
      pushAstReference(file.file, target, index, results, 'read', node, ancestors, node.text);
    }

    if (node.type === 'object_creation_expression') {
      const typeNode = node.childForFieldName('type') ?? node.children?.find((child: any) => child.type === 'type_identifier' || child.type === 'generic_type' || child.type === 'scoped_type_identifier');
      if (javaTypeTextMatchesTarget(typeNode?.text, target, fileImports)) {
        pushAstReference(file.file, target, index, results, 'instantiate', typeNode ?? node, ancestors, node.text);
      }
    }

    if (
      (node.type === 'type_identifier' || node.type === 'scoped_type_identifier') &&
      !isInsideJavaObjectCreation(ancestors) &&
      !isJavaRelationshipTypeNode(ancestors) &&
      !isAlreadyIndexedSimpleFieldType(node, ancestors) &&
      javaTypeTextMatchesTarget(node.text, target, fileImports)
    ) {
      pushAstReference(file.file, target, index, results, 'type_reference', node, ancestors, node.text);
    }

    for (const child of node.children ?? []) visit(child, [...ancestors, node]);
  }
  visit(file.rootNode);
}

function pushAstReference(
  file: string,
  target: IndexedClass,
  index: ProjectIndex,
  results: IndexedJavaTypeReference[],
  referenceKind: IndexedJavaTypeReference['referenceKind'],
  node: any,
  ancestors: any[],
  calledAs?: string
): void {
  const line = node.startPosition.row + 1;
  const methodContext = index.methods.find((method) => method.file === file && method.line <= line && method.node.endPosition.row + 1 >= line);
  const contextClass = methodContext ? undefined : index.classes.find((klass) => klass.file === file && klass.line <= line);
  results.push({
    file,
    targetSymbolId: target.symbolId,
    contextSymbolId: methodContext?.symbolId ?? contextClass?.symbolId,
    contextClassName: methodContext?.className ?? contextClass?.className,
    contextKind: methodContext ? 'class' : contextClass?.kind,
    referenceKind,
    line,
    column: node.startPosition.column,
    endLine: node.endPosition.row + 1,
    endColumn: node.endPosition.column,
    calledAs,
  });
}

function isIndexedTypeNodeName(node: any, parent?: any): boolean {
  if (!parent || !isIndexedTypeNode(parent)) return false;
  return parent.childForFieldName('name') === node;
}

function isInsideJavaObjectCreation(ancestors: any[]): boolean {
  return ancestors.some((ancestor) => ancestor.type === 'object_creation_expression');
}

function isJavaRelationshipTypeNode(ancestors: any[]): boolean {
  return ancestors.some((ancestor) => ancestor.type === 'superclass' || ancestor.type === 'super_interfaces' || ancestor.type === 'extends_interfaces');
}

function isAlreadyIndexedSimpleFieldType(node: any, ancestors: any[]): boolean {
  const fieldDeclaration = [...ancestors].reverse().find((ancestor: any) => ancestor.type === 'field_declaration');
  if (!fieldDeclaration) return false;
  const typeNode = fieldDeclaration.childForFieldName('type');
  if (!typeNode) return false;
  return typeNode === node && !/[<.]/.test(node.text);
}

function javaTypeTextMatchesTarget(typeText: string | undefined, target: IndexedClass, fileImports?: FileImports): boolean {
  if (!typeText) return false;
  const normalized = typeText.replace(/@[A-Za-z_$][\w$.]*(?:\([^)]*\))?\s*/g, '').replace(/<[^<>]*>/g, '').replace(/\[\]/g, '').replace(/\.\.\./g, '').trim();
  if (normalized === target.fullName) return true;
  if (normalized.endsWith(`.${target.className}`)) return normalized === target.fullName;
  if (normalized !== target.className) return false;
  const imported = fileImports?.imports.get(target.className);
  if (imported) return imported === target.fullName;
  return fileImports?.package === target.package;
}

function findRegexPosition(source: string, pattern: RegExp): { line: number; column: number } | undefined {
  const match = pattern.exec(source);
  if (!match || match.index === undefined) return undefined;
  const prefix = source.slice(0, match.index);
  const lines = prefix.split('\n');
  return { line: lines.length, column: lines[lines.length - 1].length };
}

function dedupeTypeReferences(references: IndexedJavaTypeReference[]): IndexedJavaTypeReference[] {
  const seen = new Set<string>();
  return references.filter((item) => {
    const key = [item.file, item.targetSymbolId, item.contextSymbolId ?? '', item.referenceKind, item.line, item.column, item.endLine, item.endColumn].join(':');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
