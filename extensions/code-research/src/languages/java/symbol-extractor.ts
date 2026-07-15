import { createHash } from 'node:crypto';
import type {
  CanonicalJavaSymbolRecord,
  JavaDeclarationFamily,
  JavaDeclarationKind,
  JavaExtractionResult,
  JavaUnsupportedFormCode,
  SourceRange,
  SymbolQueryInclusion,
} from '../../types.js';
import {
  allowsJavaCodePayload,
  buildQualifiedName,
  collectJavaModifiers,
  createJavaRelationshipId,
  createJavaSymbolId,
  javaDeclarationKindToCoarseKind,
  javaFamilyForDeclarationKind,
  queryInclusionForJavaDeclarationKind,
  sanitizeJavaSignature,
  isJavaImplementation,
} from './symbol-model.js';

interface Context {
  filePath: string;
  source: string;
  sourceHash: string;
  results: CanonicalJavaSymbolRecord[];
  relationshipScopes: Array<{ id: string; ownerChain: string[]; kind: 'anonymous_class' | 'lambda'; range: SourceRange }>;
  observedFamilies: Set<JavaDeclarationFamily>;
  unsupportedForms: Set<JavaUnsupportedFormCode>;
  ownerChain: string[];
}

export function extractJavaSymbolRecords(input: { filePath: string; source: string; rootNode?: any }): JavaExtractionResult {
  const ctx: Context = {
    filePath: input.filePath.replace(/\\/g, '/'),
    source: input.source,
    sourceHash: createHash('sha256').update(input.source).digest('hex'),
    results: [],
    relationshipScopes: [],
    observedFamilies: new Set(),
    unsupportedForms: new Set(),
    ownerChain: [],
  };
  const rootNode = input.rootNode;
  if (rootNode) visit(rootNode, ctx);
  return {
    sourceHash: ctx.sourceHash,
    records: ctx.results,
    relationshipScopes: ctx.relationshipScopes,
    observedFamilies: [...ctx.observedFamilies].sort(),
    unsupportedForms: [...ctx.unsupportedForms].sort(),
  };
}

function visit(node: any, ctx: Context): void {
  if (!node?.isNamed) return;

  switch (node.type) {
    case 'package_declaration':
      emitPackage(node, ctx);
      break;
    case 'module_declaration':
      emitNamed(node, ctx, 'module', getQualifiedNameNode(node)?.text ?? '');
      break;
    case 'class_declaration':
      emitType(node, ctx, 'class');
      return;
    case 'interface_declaration':
      emitType(node, ctx, 'interface');
      return;
    case 'enum_declaration':
      emitType(node, ctx, 'enum');
      return;
    case 'record_declaration':
      emitType(node, ctx, 'record');
      return;
    case 'annotation_type_declaration':
      emitType(node, ctx, 'annotation');
      return;
    case 'method_declaration':
      emitMethod(node, ctx);
      return;
    case 'constructor_declaration':
      emitConstructor(node, ctx, 'constructor');
      return;
    case 'compact_constructor_declaration':
      emitConstructor(node, ctx, 'compact_constructor');
      return;
    case 'annotation_type_element_declaration':
      emitAnnotationElement(node, ctx);
      return;
    case 'field_declaration':
    case 'constant_declaration':
      emitVariableDeclarators(node, ctx, 'field');
      break;
    case 'local_variable_declaration':
      emitVariableDeclarators(node, ctx, 'local_variable');
      break;
    case 'formal_parameter':
      if (node.parent?.type === 'formal_parameters' && node.parent?.parent?.type === 'record_declaration') break;
      emitFormalParameter(node, ctx, 'parameter');
      break;
    case 'spread_parameter':
      emitFormalParameter(node, ctx, 'parameter');
      break;
    case 'receiver_parameter':
      emitReceiverParameter(node, ctx);
      break;
    case 'type_parameter':
      emitTypeParameter(node, ctx);
      break;
    case 'enum_constant':
      emitEnumConstant(node, ctx);
      return;
    case 'enhanced_for_statement':
      emitEnhancedForVariable(node, ctx);
      break;
    case 'catch_formal_parameter':
      emitCatchParameter(node, ctx);
      break;
    case 'resource':
      emitResource(node, ctx);
      break;
    case 'type_pattern':
      emitPatternVariable(node, ctx);
      break;
    case 'instanceof_expression':
      emitInstanceofPatternVariable(node, ctx);
      break;
    case 'record_pattern':
      emitRecordPatternVariables(node, ctx);
      break;
    case 'lambda_expression':
      emitLambdaParameters(node, ctx);
      return;
    case 'object_creation_expression':
      if (node.children?.some((child: any) => child.type === 'class_body')) {
        ctx.unsupportedForms.add('anonymous_class_relationship_only');
        ctx.relationshipScopes.push({
          id: syntheticScopeId('anonymous', node, ctx),
          ownerChain: [...ctx.ownerChain],
          kind: 'anonymous_class',
          range: rangeFor(node),
        });
      }
      break;
    case 'static_initializer':
      ctx.unsupportedForms.add('initializer_block');
      break;
    case 'underscore_pattern':
      ctx.unsupportedForms.add('unnamed_pattern');
      break;
  }

  for (const child of node.children ?? []) visit(child, ctx);
}

function emitPackage(node: any, ctx: Context): void {
  const name = getQualifiedNameNode(node)?.text ?? '';
  if (!name) return;
  emitRecord(ctx, {
    name,
    declarationKind: 'package',
    node,
    declarationRange: rangeFor(getQualifiedNameNode(node) ?? node),
    signature: sanitizeJavaSignature(node.text),
    queryInclusion: 'compilation_unit',
  });
  ctx.ownerChain = name.split('.');
}

function emitType(node: any, ctx: Context, kind: Extract<JavaDeclarationKind, 'class' | 'interface' | 'enum' | 'record' | 'annotation'>): void {
  const nameNode = node.childForFieldName?.('name');
  if (!nameNode?.text) return;
  const record = emitNamed(node, ctx, kind, nameNode.text);
  const previousOwner = ctx.ownerChain;
  ctx.ownerChain = [...ctx.ownerChain, nameNode.text];
  if (kind === 'record') {
    const parameters = node.childForFieldName?.('parameters');
    for (const child of parameters?.children ?? []) {
      if (child.type === 'formal_parameter') emitFormalParameter(child, ctx, 'record_component');
    }
  }
  for (const child of node.children ?? []) {
    if (child === nameNode) continue;
    visit(child, ctx);
  }
  ctx.ownerChain = previousOwner;
  if (record) ctx.observedFamilies.add(javaFamilyForDeclarationKind(kind));
}

function emitMethod(node: any, ctx: Context): void {
  const nameNode = node.childForFieldName?.('name');
  if (!nameNode?.text) return;
  const modifiers = collectJavaModifiers(node);
  const declarationRange = rangeFor(nameNode, node.childForFieldName?.('body') ?? findChild(node, 'block') ?? undefined, true);
  const params = parameterSignature(node.childForFieldName?.('parameters'));
  const prefix = modifiers.length > 0 ? `${modifiers.join(' ')} ` : '';
  emitRecord(ctx, {
    name: nameNode.text,
    declarationKind: 'method',
    node,
    declarationRange,
    codeRange: allowsJavaCodePayload('method', Boolean(node.childForFieldName?.('body'))) ? rangeFor(node) : undefined,
    signature: sanitizeJavaSignature(`${prefix}${typeText(node.childForFieldName?.('type'))} ${nameNode.text}${params}${throwsSuffix(node)}`.trim()),
    sourceName: nameNode.text,
    modifiers,
    relationshipId: createJavaRelationshipId(ctx.filePath, ctx.ownerChain, nameNode.text, 'method'),
    discriminator: `${nameNode.text}${params}`,
  });
  const previousOwner = ctx.ownerChain;
  ctx.ownerChain = [...ctx.ownerChain, nameNode.text];
  for (const child of node.children ?? []) visit(child, ctx);
  ctx.ownerChain = previousOwner;
}

function emitConstructor(node: any, ctx: Context, kind: 'constructor' | 'compact_constructor'): void {
  const nameNode = node.childForFieldName?.('name');
  if (!nameNode?.text) return;
  const params = kind === 'compact_constructor' ? '()' : parameterSignature(node.childForFieldName?.('parameters'));
  const modifiers = collectJavaModifiers(node);
  const prefix = modifiers.length > 0 ? `${modifiers.join(' ')} ` : '';
  emitRecord(ctx, {
    name: nameNode.text,
    declarationKind: kind,
    node,
    declarationRange: rangeFor(nameNode, node.childForFieldName?.('body') ?? findChild(node, 'constructor_body') ?? undefined, true),
    codeRange: rangeFor(node),
    signature: sanitizeJavaSignature(`${prefix}${nameNode.text}${params}${throwsSuffix(node)}`),
    sourceName: nameNode.text,
    modifiers,
    relationshipId: createJavaRelationshipId(ctx.filePath, ctx.ownerChain, nameNode.text, 'constructor'),
    discriminator: `${kind}:${params}`,
  });
  const previousOwner = ctx.ownerChain;
  ctx.ownerChain = [...ctx.ownerChain, nameNode.text];
  for (const child of node.children ?? []) visit(child, ctx);
  ctx.ownerChain = previousOwner;
}

function emitAnnotationElement(node: any, ctx: Context): void {
  const nameNode = node.childForFieldName?.('name');
  if (!nameNode?.text) return;
  const modifiers = collectJavaModifiers(node);
  const prefix = modifiers.length > 0 ? `${modifiers.join(' ')} ` : '';
  emitRecord(ctx, {
    name: nameNode.text,
    declarationKind: 'annotation_element',
    node,
    declarationRange: rangeFor(nameNode, findChild(node, 'default_value') ?? undefined, true),
    signature: sanitizeJavaSignature(`${prefix}${typeText(node.childForFieldName?.('type'))} ${nameNode.text}()`),
    sourceName: nameNode.text,
    modifiers,
    relationshipId: createJavaRelationshipId(ctx.filePath, ctx.ownerChain, nameNode.text, 'annotation_element'),
  });
}

function emitEnumConstant(node: any, ctx: Context): void {
  const nameNode = node.childForFieldName?.('name');
  if (!nameNode?.text) return;
  emitRecord(ctx, {
    name: nameNode.text,
    declarationKind: 'enum_constant',
    node,
    declarationRange: rangeFor(nameNode),
    codeRange: rangeFor(node),
    signature: sanitizeJavaSignature(node.text.split('{')[0]?.trim()),
    sourceName: nameNode.text,
    relationshipId: createJavaRelationshipId(ctx.filePath, ctx.ownerChain, nameNode.text, 'enum_constant'),
  });
  if (node.children?.some((child: any) => child.type === 'class_body')) {
    ctx.relationshipScopes.push({
      id: syntheticScopeId('enum_constant_body', node, ctx),
      ownerChain: [...ctx.ownerChain, nameNode.text],
      kind: 'anonymous_class',
      range: rangeFor(node),
    });
  }
}

function emitVariableDeclarators(node: any, ctx: Context, kind: 'field' | 'local_variable'): void {
  const declarators = (node.children ?? []).filter((child: any) => child.type === 'variable_declarator');
  declarators.forEach((declarator: any, index: number) => {
    const nameNode = declarator.childForFieldName?.('name');
    if (!nameNode?.text) return;
    const hasInitializer = Boolean(declarator.childForFieldName?.('value'));
    emitRecord(ctx, {
      name: nameNode.text,
      declarationKind: kind,
      node,
      declarationRange: rangeFor(nameNode),
      codeRange: hasInitializer ? rangeFor(declarator) : undefined,
      signature: sanitizeJavaSignature(`${typeText(node.childForFieldName?.('type'))} ${nameNode.text}`),
      sourceName: nameNode.text,
      modifiers: collectJavaModifiers(node),
      queryInclusion: kind === 'field' ? 'default' : 'local_binding',
      discriminator: `${kind}:${index}:${typeText(node.childForFieldName?.('type'))}`,
      hasInitializer,
    });
  });
}

function emitFormalParameter(node: any, ctx: Context, kind: 'parameter' | 'record_component'): void {
  const nameNode = node.childForFieldName?.('name');
  if (!nameNode?.text) return;
  emitRecord(ctx, {
    name: nameNode.text,
    declarationKind: kind,
    node,
    declarationRange: rangeFor(nameNode),
    signature: sanitizeJavaSignature(`${typeText(node.childForFieldName?.('type'))} ${nameNode.text}`),
    sourceName: nameNode.text,
    modifiers: collectJavaModifiers(node),
    queryInclusion: kind === 'record_component' ? 'default' : 'local_binding',
  });
}

function emitReceiverParameter(node: any, ctx: Context): void {
  const name = node.text.includes('this') ? node.text.trim().split(/\s+/).at(-1) ?? 'this' : 'this';
  emitRecord(ctx, {
    name,
    declarationKind: 'receiver_parameter',
    node,
    declarationRange: rangeFor(node),
    signature: sanitizeJavaSignature(node.text),
    sourceName: name,
    queryInclusion: 'local_binding',
  });
}

function emitTypeParameter(node: any, ctx: Context): void {
  const nameNode = node.childForFieldName?.('name') ?? findChild(node, 'type_identifier') ?? findChild(node, 'identifier');
  if (!nameNode?.text) return;
  emitRecord(ctx, {
    name: nameNode.text,
    declarationKind: 'type_parameter',
    node,
    declarationRange: rangeFor(nameNode),
    signature: sanitizeJavaSignature(node.text),
    sourceName: nameNode.text,
    queryInclusion: 'local_binding',
  });
}

function emitEnhancedForVariable(node: any, ctx: Context): void {
  const nameNode = node.childForFieldName?.('name');
  if (!nameNode?.text) return;
  emitRecord(ctx, {
    name: nameNode.text,
    declarationKind: 'enhanced_for_variable',
    node,
    declarationRange: rangeFor(nameNode),
    signature: sanitizeJavaSignature(`${typeText(node.childForFieldName?.('type'))} ${nameNode.text}`),
    sourceName: nameNode.text,
    queryInclusion: 'local_binding',
  });
}

function emitCatchParameter(node: any, ctx: Context): void {
  const nameNode = node.childForFieldName?.('name');
  if (!nameNode?.text) return;
  emitRecord(ctx, {
    name: nameNode.text,
    declarationKind: 'catch_parameter',
    node,
    declarationRange: rangeFor(nameNode),
    signature: sanitizeJavaSignature(node.text),
    sourceName: nameNode.text,
    queryInclusion: 'local_binding',
  });
}

function emitResource(node: any, ctx: Context): void {
  const nameNode = node.childForFieldName?.('name');
  if (!nameNode?.text) return;
  emitRecord(ctx, {
    name: nameNode.text,
    declarationKind: 'resource_variable',
    node,
    declarationRange: rangeFor(nameNode),
    codeRange: node.childForFieldName?.('value') ? rangeFor(node) : undefined,
    signature: sanitizeJavaSignature(`${typeText(node.childForFieldName?.('type'))} ${nameNode.text}`),
    sourceName: nameNode.text,
    queryInclusion: 'local_binding',
    hasInitializer: Boolean(node.childForFieldName?.('value')),
  });
}

function emitPatternVariable(node: any, ctx: Context): void {
  const nameNode = node.childForFieldName?.('name') ?? findChild(node, 'identifier');
  if (!nameNode?.text || nameNode.text === '_') {
    ctx.unsupportedForms.add('unnamed_pattern');
    return;
  }
  emitRecord(ctx, {
    name: nameNode.text,
    declarationKind: 'pattern_variable',
    node,
    declarationRange: rangeFor(nameNode),
    signature: sanitizeJavaSignature(node.text),
    sourceName: nameNode.text,
    queryInclusion: 'local_binding',
    hasInitializer: true,
  });
}

function emitInstanceofPatternVariable(node: any, ctx: Context): void {
  const nameNode = node.childForFieldName?.('name');
  if (!nameNode?.text || nameNode.text === '_') return;
  emitRecord(ctx, {
    name: nameNode.text,
    declarationKind: 'pattern_variable',
    node,
    declarationRange: rangeFor(nameNode),
    signature: sanitizeJavaSignature(node.text),
    sourceName: nameNode.text,
    queryInclusion: 'local_binding',
    hasInitializer: true,
  });
}

function emitRecordPatternVariables(node: any, ctx: Context): void {
  for (const child of node.children ?? []) {
    if (child.type === 'type_pattern') emitPatternVariable(child, ctx);
  }
}

function emitLambdaParameters(node: any, ctx: Context): void {
  const lambdaId = syntheticScopeId('lambda', node, ctx);
  ctx.relationshipScopes.push({ id: lambdaId, ownerChain: [...ctx.ownerChain], kind: 'lambda', range: rangeFor(node) });
  ctx.unsupportedForms.add('lambda_relationship_only');
  const previousOwner = ctx.ownerChain;
  ctx.ownerChain = [...ctx.ownerChain, `<lambda@${node.startPosition.row + 1}:${node.startPosition.column}>`];
  const parameters = node.childForFieldName?.('parameters');
  const candidates = parameters
    ? parameters.type === 'identifier' || parameters.type === 'formal_parameter' || parameters.type === 'spread_parameter' || parameters.type === 'inferred_parameters'
      ? [parameters]
      : parameters.children ?? []
    : node.children ?? [];
  for (const child of candidates) {
    if (child.type === 'identifier') {
      emitRecord(ctx, {
        name: child.text,
        declarationKind: 'lambda_parameter',
        node: child,
        declarationRange: rangeFor(child),
        signature: child.text,
        sourceName: child.text,
        queryInclusion: 'local_binding',
      });
    } else if (child.type === 'formal_parameter' || child.type === 'spread_parameter') {
      const nameNode = child.childForFieldName?.('name');
      if (!nameNode?.text) continue;
      emitRecord(ctx, {
        name: nameNode.text,
        declarationKind: 'lambda_parameter',
        node: child,
        declarationRange: rangeFor(nameNode),
        signature: sanitizeJavaSignature(child.text),
        sourceName: nameNode.text,
        queryInclusion: 'local_binding',
      });
    } else if (child.type === 'inferred_parameters') {
      for (const inferred of child.children ?? []) {
        if (inferred.type !== 'identifier') continue;
        emitRecord(ctx, {
          name: inferred.text,
          declarationKind: 'lambda_parameter',
          node: inferred,
          declarationRange: rangeFor(inferred),
          signature: inferred.text,
          sourceName: inferred.text,
          queryInclusion: 'local_binding',
        });
      }
    }
  }
  for (const child of node.children ?? []) {
    if (child === parameters) continue;
    visit(child, ctx);
  }
  ctx.ownerChain = previousOwner;
}

function emitNamed(node: any, ctx: Context, declarationKind: JavaDeclarationKind, name: string) {
  if (!name) return undefined;
  return emitRecord(ctx, {
    name,
    declarationKind,
    node,
    declarationRange: rangeFor(node.childForFieldName?.('name') ?? node),
    signature: sanitizeJavaSignature(node.text.split('{')[0]?.trim()),
    sourceName: name,
    modifiers: collectJavaModifiers(node),
    queryInclusion: declarationKind === 'package' || declarationKind === 'module' ? 'compilation_unit' : 'default',
  });
}

function emitRecord(
  ctx: Context,
  input: {
    name: string;
    declarationKind: JavaDeclarationKind;
    node: any;
    declarationRange: SourceRange;
    codeRange?: SourceRange;
    signature?: string;
    sourceName?: string;
    modifiers?: string[];
    relationshipId?: string;
    discriminator?: string;
    queryInclusion?: SymbolQueryInclusion;
    hasInitializer?: boolean;
  }
): CanonicalJavaSymbolRecord {
  const modifiers = input.modifiers ?? [];
  const declarationKind = input.declarationKind;
  const relationshipId = input.relationshipId ?? (declarationKind === 'method' || declarationKind === 'constructor' || declarationKind === 'compact_constructor' ? createJavaRelationshipId(ctx.filePath, ctx.ownerChain, input.name, declarationKind) : undefined);
  const discriminator = input.discriminator ?? `${declarationKind}:${input.declarationRange.startLine}:${input.declarationRange.startColumn}`;
  const record: CanonicalJavaSymbolRecord = {
    name: input.name,
    qualifiedName: buildQualifiedName(ctx.ownerChain, input.name),
    owner: ctx.ownerChain.at(-1),
    ownerChain: [...ctx.ownerChain],
    declarationKind,
    coarseKind: javaDeclarationKindToCoarseKind(declarationKind),
    sourceName: input.sourceName,
    modifiers,
    declarationRange: input.declarationRange,
    codeRange: input.codeRange,
    isDefinition: true,
    isImplementation: isJavaImplementation(declarationKind, input.node, modifiers, input.hasInitializer),
    discriminator,
    relationshipId,
    signature: input.signature,
    symbolId: createJavaSymbolId({
      sourceHash: ctx.sourceHash,
      file: ctx.filePath,
      ownerChain: ctx.ownerChain,
      declarationKind,
      name: input.name,
      declarationRange: input.declarationRange,
      discriminator,
    }),
    sourceHash: ctx.sourceHash,
    queryInclusion: queryInclusionForJavaDeclarationKind(declarationKind),
    javaFamily: javaFamilyForDeclarationKind(declarationKind),
  };
  ctx.results.push(record);
  ctx.observedFamilies.add(record.javaFamily);
  return record;
}

function getQualifiedNameNode(node: any): any | undefined {
  return (node.children ?? []).find((child: any) => child.isNamed && ['identifier', 'scoped_identifier', 'scoped_type_identifier'].includes(child.type));
}

function typeText(node: any): string {
  return String(node?.text ?? '').trim();
}

function throwsSuffix(node: any): string {
  const throwsNode = node.childForFieldName?.('throws') ?? findChild(node, 'throws');
  return throwsNode ? ` throws ${throwsNode.text.replace(/^throws\s+/, '')}` : '';
}

function parameterSignature(node: any): string {
  return node?.text ? node.text : '()';
}

function findChild(node: any, type: string): any | undefined {
  return (node.children ?? []).find((child: any) => child.type === type);
}

function rangeFor(nameNode: any, bodyNode?: any, headerOnly = false): SourceRange {
  const startNode = nameNode ?? bodyNode;
  const start = startNode?.startPosition ?? nameNode?.startPosition;
  const endSource = headerOnly && bodyNode ? bodyNode.startPosition : (bodyNode?.endPosition ?? nameNode?.endPosition ?? start);
  return {
    startLine: (start?.row ?? 0) + 1,
    startColumn: start?.column ?? 0,
    endLine: (endSource?.row ?? start?.row ?? 0) + 1,
    endColumn: endSource?.column ?? start?.column ?? 0,
  };
}

function syntheticScopeId(prefix: string, node: any, ctx: Context): string {
  return createHash('sha256')
    .update(`${ctx.sourceHash}|${ctx.filePath}|${ctx.ownerChain.join('.')}|${prefix}|${node.startPosition.row + 1}:${node.startPosition.column}`)
    .digest('hex');
}
