import { readFile, readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { getParser, parseSource } from './parser.js';

export interface IndexedMethod {
  file: string;
  package: string;
  className: string;
  symbol: string;
  returnType?: string;
  fullReturnType?: string;
  line: number;
  column: number;
  node: any;
}

export interface IndexedField {
  file: string;
  package: string;
  className: string;
  fieldName: string;
  typeName: string;
  fullTypeName?: string;
  line: number;
  column: number;
}

export interface IndexedClass {
  file: string;
  package: string;
  className: string;
  fullName: string;
  kind: 'class' | 'interface';
  implements: string[];
  line: number;
  column: number;
}

export interface FileImports {
  file: string;
  package: string;
  imports: Map<string, string>;
  wildcardImports: string[];
}

export interface ProjectIndex {
  methods: IndexedMethod[];
  fields: IndexedField[];
  classes: IndexedClass[];
  imports: Map<string, FileImports>;
}

export async function buildProjectIndex(rootDir: string): Promise<ProjectIndex> {
  const index: ProjectIndex = {
    methods: [],
    fields: [],
    classes: [],
    imports: new Map(),
  };

  const javaFiles = await collectJavaFiles(rootDir);

  for (const file of javaFiles) {
    const source = await readFile(file, 'utf8');
    const parser = getParser('java');
    const tree = parseSource(parser, source);
    indexFile(file, tree.rootNode, index);
  }

  return index;
}

async function collectJavaFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      files.push(...(await collectJavaFiles(fullPath)));
    } else if (entry.isFile() && extname(fullPath).toLowerCase() === '.java') {
      files.push(fullPath);
    }
  }

  return files;
}

function indexFile(file: string, rootNode: any, index: ProjectIndex): void {
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

    if (node.type === 'class_declaration' || node.type === 'interface_declaration') {
      const classNameNode = node.childForFieldName('name');
      if (classNameNode) {
        const className = classNameNode.text;
        index.classes.push({
          file,
          package: packageName,
          className,
          fullName: packageName ? `${packageName}.${className}` : className,
          kind: node.type === 'interface_declaration' ? 'interface' : 'class',
          implements: extractImplementedTypes(node),
          line: node.startPosition.row + 1,
          column: node.startPosition.column,
        });

        indexClassMembers(file, packageName, className, node, fileImports, index);
      }
    }

    for (const child of node.children) {
      visit(child);
    }
  }

  visit(rootNode);
  index.imports.set(file, fileImports);
}

function indexClassMembers(
  file: string,
  packageName: string,
  className: string,
  classNode: any,
  fileImports: FileImports,
  index: ProjectIndex
): void {
  const body = classNode.childForFieldName('body');
  if (!body) return;

  function visit(node: any) {
    if (!node.isNamed) return;

    if (node.type === 'field_declaration') {
      const typeNode = node.childForFieldName('type');
      const typeName = normalizeTypeName(typeNode?.text);
      if (typeName) {
        for (const child of node.children) {
          if (child.type !== 'variable_declarator') continue;
          const nameNode = child.childForFieldName('name');
          if (!nameNode) continue;
          index.fields.push({
            file,
            package: packageName,
            className,
            fieldName: nameNode.text,
            typeName,
            fullTypeName: resolveFullTypeName(typeName, packageName, fileImports),
            line: node.startPosition.row + 1,
            column: node.startPosition.column,
          });
        }
      }
    }

    if (node.type === 'method_declaration' || node.type === 'constructor_declaration') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        const methodTypeNode = node.type === 'method_declaration' ? node.childForFieldName('type') : undefined;
        const returnType = normalizeTypeName(methodTypeNode?.text);
        index.methods.push({
          file,
          package: packageName,
          className,
          symbol: nameNode.text,
          returnType: returnType || undefined,
          fullReturnType: returnType ? resolveFullTypeName(returnType, packageName, fileImports) : undefined,
          line: node.startPosition.row + 1,
          column: node.startPosition.column,
          node,
        });
      }
    }

    if (node.type === 'class_declaration' || node.type === 'interface_declaration') return;

    for (const child of node.children) {
      visit(child);
    }
  }

  visit(body);
}

function extractQualifiedName(node: any): string {
  const namedChild = node.children.find(
    (child: any) => child.isNamed && child.type !== 'asterisk'
  );
  return namedChild?.text ?? '';
}

function extractImplementedTypes(classNode: any): string[] {
  const interfacesNode = classNode.childForFieldName('interfaces');
  if (!interfacesNode) return [];

  const result: string[] = [];

  function visit(node: any) {
    if (!node?.isNamed) return;
    if (
      node.type === 'type_identifier' ||
      node.type === 'generic_type' ||
      node.type === 'scoped_type_identifier'
    ) {
      result.push(normalizeTypeName(node.text));
      return;
    }
    for (const child of node.children) {
      visit(child);
    }
  }

  visit(interfacesNode);
  return [...new Set(result.filter(Boolean))];
}

function normalizeTypeName(typeText?: string): string {
  if (!typeText) return '';
  const withoutGenerics = typeText.replace(/<.*>/g, '');
  const lastSegment = withoutGenerics.split('.').pop() ?? withoutGenerics;
  return lastSegment.trim();
}

function resolveFullTypeName(typeName: string, packageName: string, fileImports: FileImports): string | undefined {
  const imported = fileImports.imports.get(typeName);
  if (imported) return imported;
  if (packageName) return `${packageName}.${typeName}`;
  return typeName;
}
