import { createHash } from 'node:crypto';
import ts from 'typescript';
import type { SourceRange, TypeScriptDeclarationKind } from '../../types.js';
import { declarationKindToCoarseKind, createRelationshipId, createTypeScriptSymbolId, type CanonicalTypeScriptSymbolRecord } from './symbol-model.js';
import { DEFAULT_CALLABLE_WRAPPERS, isCallableTypeScriptValue } from './callable-policy.js';

interface Context {
  filePath: string;
  sourceFile: ts.SourceFile;
  sourceHash: string;
  results: CanonicalTypeScriptSymbolRecord[];
  ownerChain: string[];
  objectCallableBindings: Map<string, Set<string>>;
}

export function extractTypeScriptSymbols(filePath: string, source: string, scriptKind?: ts.ScriptKind): CanonicalTypeScriptSymbolRecord[] {
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, scriptKind ?? inferScriptKind(filePath));
  const ctx: Context = {
    filePath,
    sourceFile,
    sourceHash: createHash('sha256').update(source).digest('hex'),
    results: [],
    ownerChain: [],
    objectCallableBindings: collectTopLevelObjectCallableBindings(sourceFile),
  };

  visitNode(sourceFile, ctx);
  return ctx.results;
}

function visitNode(node: ts.Node, ctx: Context, inheritedModifiers?: readonly ts.ModifierLike[]) {
  if (ts.isFunctionDeclaration(node)) {
    pushFunctionLike(node, ctx, inheritedModifiers);
  } else if (ts.isVariableStatement(node)) {
    for (const declaration of node.declarationList.declarations) {
      emitVariableDeclaration(declaration, ctx, ts.canHaveModifiers(node) ? ts.getModifiers(node) ?? undefined : undefined);
    }
  } else if (ts.isClassDeclaration(node)) {
    pushClass(node, ctx, inheritedModifiers);
  } else if (ts.isInterfaceDeclaration(node)) {
    pushInterface(node, ctx);
  } else if (ts.isTypeAliasDeclaration(node)) {
    pushTypeAlias(node, ctx);
  } else if (ts.isEnumDeclaration(node)) {
    pushEnum(node, ctx);
  } else if (ts.isModuleDeclaration(node)) {
    pushModule(node, ctx);
  } else if (ts.isImportDeclaration(node)) {
    pushImportAliases(node, ctx);
  } else if (ts.isExportDeclaration(node)) {
    pushExportAliases(node, ctx);
  } else if (ts.isExpressionStatement(node)) {
    pushAssignmentExpression(node.expression, ctx);
  }

  ts.forEachChild(node, (child) => {
    if (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isModuleDeclaration(node) || isNamedObjectProperty(node)) return;
    visitNode(child, ctx, inheritedModifiers);
  });
}

function pushFunctionLike(node: ts.FunctionDeclaration, ctx: Context, modifiers?: readonly ts.ModifierLike[]) {
  const exportedName = hasDefaultModifier(node) ? 'default' : undefined;
  const anonymous = !node.name;
  const name = node.name?.text ?? 'default';
  const declarationKind: TypeScriptDeclarationKind = node.body ? 'function' : 'function_overload';
  pushNamedNode(node, ctx, declarationKind, true, Boolean(node.body), name, exportedName, anonymous, undefined, modifiers, node.name);
}

function pushClass(node: ts.ClassDeclaration, ctx: Context, modifiers?: readonly ts.ModifierLike[]) {
  const exportedName = hasDefaultModifier(node) ? 'default' : undefined;
  const name = node.name?.text ?? 'default';
  const anonymous = !node.name;
  const classRecord = pushNamedNode(node, ctx, 'class', true, !hasAmbientModifier(node), name, exportedName, anonymous, undefined, modifiers, node.name);
  const nextOwner = [...ctx.ownerChain, name];
  for (const member of node.members) {
    if (ts.isConstructorDeclaration(member)) {
      pushMember(member, ctx, nextOwner, 'constructor', 'constructor');
      continue;
    }
    if (ts.isMethodDeclaration(member)) {
      pushMember(member, ctx, nextOwner, 'method', getPropertyNameText(member.name), Boolean(member.body));
      continue;
    }
    if (ts.isGetAccessorDeclaration(member)) {
      pushMember(member, ctx, nextOwner, 'getter', getPropertyNameText(member.name));
      continue;
    }
    if (ts.isSetAccessorDeclaration(member)) {
      pushMember(member, ctx, nextOwner, 'setter', getPropertyNameText(member.name));
      continue;
    }
    if (ts.isPropertyDeclaration(member)) {
      const kind = isCallableTypeScriptValue(member.initializer ?? undefined, DEFAULT_CALLABLE_WRAPPERS) ? 'callable_variable' : 'field';
      pushMember(member, ctx, nextOwner, kind, getPropertyNameText(member.name), Boolean(member.initializer) && !hasAmbientModifier(member));
    }
  }
  if (classRecord) classRecord.signature = node.getText(ctx.sourceFile).split('{')[0].trim();
}

function pushInterface(node: ts.InterfaceDeclaration, ctx: Context) {
  pushNamedNode(node, ctx, 'interface', true, false, node.name.text, undefined, false, undefined, ts.getModifiers(node) ?? undefined, node.name);
  const nextOwner = [...ctx.ownerChain, node.name.text];
  for (const member of node.members) {
    if (ts.isMethodSignature(member)) pushMember(member, ctx, nextOwner, 'interface_method', getPropertyNameText(member.name), false);
    else if (ts.isPropertySignature(member)) pushMember(member, ctx, nextOwner, 'property', getPropertyNameText(member.name), false);
    else if (ts.isCallSignatureDeclaration(member)) pushSyntheticMember(member, ctx, nextOwner, 'call_signature', 'call');
    else if (ts.isConstructSignatureDeclaration(member)) pushSyntheticMember(member, ctx, nextOwner, 'construct_signature', 'new');
    else if (ts.isIndexSignatureDeclaration(member)) pushSyntheticMember(member, ctx, nextOwner, 'index_signature', '[index]');
  }
}

function pushTypeAlias(node: ts.TypeAliasDeclaration, ctx: Context) {
  pushNamedNode(node, ctx, 'type_alias', true, false, node.name.text, undefined, false, undefined, ts.getModifiers(node) ?? undefined, node.name);
  if (!ts.isTypeLiteralNode(node.type)) return;
  const nextOwner = [...ctx.ownerChain, node.name.text];
  for (const member of node.type.members) {
    if (ts.isMethodSignature(member)) pushMember(member, ctx, nextOwner, 'interface_method', getPropertyNameText(member.name), false);
    else if (ts.isPropertySignature(member)) pushMember(member, ctx, nextOwner, 'property', getPropertyNameText(member.name), false);
    else if (ts.isCallSignatureDeclaration(member)) pushSyntheticMember(member, ctx, nextOwner, 'call_signature', 'call');
    else if (ts.isConstructSignatureDeclaration(member)) pushSyntheticMember(member, ctx, nextOwner, 'construct_signature', 'new');
    else if (ts.isIndexSignatureDeclaration(member)) pushSyntheticMember(member, ctx, nextOwner, 'index_signature', '[index]');
  }
}

function pushEnum(node: ts.EnumDeclaration, ctx: Context) {
  pushNamedNode(node, ctx, 'enum', true, !hasAmbientModifier(node), node.name.text, undefined, false, undefined, ts.getModifiers(node) ?? undefined, node.name);
  const nextOwner = [...ctx.ownerChain, node.name.text];
  for (const member of node.members) {
    const name = getPropertyNameText(member.name);
    if (!name) continue;
    pushRecord(ctx, name, nextOwner, 'enum_member', true, !hasAmbientModifier(node), member, {
      relationshipId: createRelationshipId(relativeFile(ctx), nextOwner, name, 'enum'),
      signature: member.getText(ctx.sourceFile),
      sourceName: member.name.getText(ctx.sourceFile),
      dynamicName: ts.isComputedPropertyName(member.name) && !isLiteralPropertyName(member.name.expression),
      modifiers: [],
      declarationRange: rangeFor(member),
      codeRange: rangeFor(member),
    });
  }
}

function pushModule(node: ts.ModuleDeclaration, ctx: Context) {
  const name = node.name.getText(ctx.sourceFile).replace(/^['"]|['"]$/g, '');
  const kind: TypeScriptDeclarationKind = ts.isStringLiteral(node.name) ? 'module' : 'namespace';
  pushNamedNode(node, ctx, kind, true, !hasAmbientModifier(node), name, undefined, false, ts.isStringLiteral(node.name), ts.getModifiers(node) ?? undefined, node.name);
  if (node.body && ts.isModuleBlock(node.body)) {
    const previous = ctx.ownerChain;
    ctx.ownerChain = [...ctx.ownerChain, name];
    for (const statement of node.body.statements) visitNode(statement, ctx);
    ctx.ownerChain = previous;
  }
}

function pushImportAliases(node: ts.ImportDeclaration, ctx: Context) {
  const clause = node.importClause;
  if (!clause) return;
  if (clause.name) pushNamedNode(node, ctx, 'import_alias', true, false, clause.name.text, undefined, false, undefined, ts.getModifiers(node) ?? undefined, clause.name);
  if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
    pushNamedNode(node, ctx, 'import_alias', true, false, clause.namedBindings.name.text, undefined, false, undefined, ts.getModifiers(node) ?? undefined, clause.namedBindings.name);
  }
  if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
    for (const element of clause.namedBindings.elements) {
      pushNamedNode(node, ctx, 'import_alias', true, false, element.name.text, undefined, false, undefined, ts.getModifiers(node) ?? undefined, element.name);
    }
  }
}

function pushExportAliases(node: ts.ExportDeclaration, ctx: Context) {
  if (!node.exportClause || !ts.isNamedExports(node.exportClause)) return;
  for (const element of node.exportClause.elements) {
    pushNamedNode(node, ctx, 'export_alias', true, false, element.name.text, element.name.text, false, undefined, ts.getModifiers(node) ?? undefined, element.name);
  }
}

function pushAssignmentExpression(node: ts.Expression, ctx: Context) {
  if (!ts.isBinaryExpression(node) || node.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return;
  const left = node.left.getText(ctx.sourceFile);
  const isCommonJs = left === 'module.exports' || left.startsWith('exports.') || left.startsWith('module.exports.');
  const stableName = ts.isIdentifier(node.left)
    ? node.left.text
    : ts.isPropertyAccessExpression(node.left)
      ? node.left.name.text
      : ts.isElementAccessExpression(node.left) && node.left.argumentExpression
        ? normalizeComputedName(node.left.argumentExpression)
        : undefined;
  if (!stableName && left !== 'module.exports') return;
  const name = left === 'module.exports' ? left : stableName!;
  pushRecord(ctx, name, ctx.ownerChain, isCommonJs ? 'commonjs_export' : 'assignment', true, true, node, {
    declarationRange: rangeFor(node),
    codeRange: rangeFor(node),
    signature: node.getText(ctx.sourceFile),
    modifiers: [],
    sourceName: left,
    exportedName: isCommonJs ? (left === 'module.exports' ? 'default' : name) : undefined,
  });

  if (left === 'module.exports' && ts.isObjectLiteralExpression(unwrap(node.right))) {
    const object = unwrap(node.right) as ts.ObjectLiteralExpression;
    for (const property of object.properties) {
      const propertyName = 'name' in property ? getPropertyNameText(property.name) : undefined;
      if (!propertyName) continue;
      pushRecord(ctx, propertyName, [...ctx.ownerChain, 'module.exports'], 'commonjs_export', true, true, property, {
        declarationRange: rangeFor(property), codeRange: rangeFor(property), signature: property.getText(ctx.sourceFile),
        modifiers: [], sourceName: property.name?.getText(ctx.sourceFile), exportedName: propertyName,
      });
    }
  }
}

function emitVariableDeclaration(node: ts.VariableDeclaration, ctx: Context, modifiers?: readonly ts.ModifierLike[]) {
  const exportedName = hasDefaultModifier(node.parent.parent.parent) ? 'default' : undefined;
  const kind = isCallableTypeScriptValue(node.initializer ?? undefined, DEFAULT_CALLABLE_WRAPPERS) ? 'callable_variable' : 'variable';
  emitBindingName(node.name, ctx, kind, Boolean(node.initializer), modifiers, exportedName, node.initializer);
}

function emitBindingName(
  name: ts.BindingName,
  ctx: Context,
  declarationKind: TypeScriptDeclarationKind,
  isImplementation: boolean,
  modifiers?: readonly ts.ModifierLike[],
  exportedName?: string,
  initializer?: ts.Expression
) {
  if (ts.isIdentifier(name)) {
    pushNamedNode(name.parent, ctx, declarationKind, true, isImplementation, name.text, exportedName, false, undefined, modifiers, name, variableStatementForBinding(name));
    if (initializer && ts.isObjectLiteralExpression(unwrap(initializer))) {
      const nextOwner = [...ctx.ownerChain, name.text];
      const objectLiteral = unwrap(initializer);
      if (!ts.isObjectLiteralExpression(objectLiteral)) return;
      for (const property of objectLiteral.properties) {
        if (ts.isMethodDeclaration(property)) pushMember(property, ctx, nextOwner, 'object_method', getPropertyNameText(property.name), true);
        else if (ts.isPropertyAssignment(property)) {
          const propName = getPropertyNameText(property.name);
          if (propName) pushMember(property, ctx, nextOwner, 'object_property', propName, Boolean(property.initializer));
        } else if (ts.isShorthandPropertyAssignment(property)) {
          pushMember(property, ctx, nextOwner, 'object_property', property.name.text, true);
        }
      }
    }
    return;
  }
  if (ts.isObjectBindingPattern(name)) {
    const unwrappedInitializer = initializer ? unwrap(initializer) : undefined;
    const sourceBindings = unwrappedInitializer && ts.isIdentifier(unwrappedInitializer) ? ctx.objectCallableBindings.get(unwrappedInitializer.text) : undefined;
    for (const element of name.elements) {
      const sourceKey = element.propertyName ? getBindingPropertyName(element.propertyName) : element.name.getText(ctx.sourceFile);
      const nextKind = sourceBindings?.has(sourceKey) ? 'callable_variable' : declarationKind;
      emitBindingName(element.name, ctx, nextKind, isImplementation, modifiers, exportedName, initializer);
    }
    return;
  }
  if (ts.isArrayBindingPattern(name)) {
    for (const element of name.elements) {
      if (ts.isBindingElement(element)) emitBindingName(element.name, ctx, declarationKind, isImplementation, modifiers, exportedName, initializer);
    }
  }
}

function pushMember(node: ts.Node & { name?: ts.PropertyName }, ctx: Context, ownerChain: string[], declarationKind: TypeScriptDeclarationKind, name?: string, isImplementation = true) {
  if (!name) return;
  pushRecord(ctx, name, ownerChain, declarationKind, true, isImplementation, node, {
    declarationRange: rangeFor(node),
    codeRange: rangeFor(node),
    signature: node.getText(ctx.sourceFile).split('{')[0].trim(),
    relationshipId: relationshipFamilyForMember(declarationKind) ? createRelationshipId(relativeFile(ctx), ownerChain, name, relationshipFamilyForMember(declarationKind)!) : undefined,
    sourceName: node.name ? node.name.getText(ctx.sourceFile) : undefined,
    dynamicName: Boolean(node.name && ts.isComputedPropertyName(node.name) && !isLiteralPropertyName(node.name.expression)),
    modifiers: collectMemberModifiers(node),
  });
}

function relationshipFamilyForMember(declarationKind: TypeScriptDeclarationKind): string | undefined {
  if (declarationKind === 'getter' || declarationKind === 'setter') return 'accessor';
  if (declarationKind === 'method' || declarationKind === 'interface_method' || declarationKind === 'object_method') return 'method';
  if (declarationKind === 'constructor') return 'constructor';
  return undefined;
}

function pushSyntheticMember(node: ts.Node, ctx: Context, ownerChain: string[], declarationKind: TypeScriptDeclarationKind, name: string) {
  pushRecord(ctx, name, ownerChain, declarationKind, true, false, node, {
    declarationRange: rangeFor(node),
    codeRange: rangeFor(node),
    signature: node.getText(ctx.sourceFile),
    modifiers: collectModifiers(node),
  });
}

function pushNamedNode(
  node: ts.Node,
  ctx: Context,
  declarationKind: TypeScriptDeclarationKind,
  isDefinition: boolean,
  isImplementation: boolean,
  name: string,
  exportedName?: string,
  anonymous?: boolean,
  dynamicName?: boolean,
  modifiers?: readonly ts.ModifierLike[],
  explicitNameNode?: ts.Node,
  codeNode?: ts.Node
) {
  const targetNode = explicitNameNode ?? node;
  return pushRecord(ctx, name, ctx.ownerChain, declarationKind, isDefinition, isImplementation, node, {
    declarationRange: rangeFor(node, targetNode),
    codeRange: rangeFor(codeNode ?? node),
    signature: node.getText(ctx.sourceFile).split('{')[0].trim(),
    exportedName,
    anonymous,
    dynamicName,
    sourceName: explicitNameNode ? explicitNameNode.getText(ctx.sourceFile) : undefined,
    modifiers: collectModifierTexts(modifiers),
  });
}

function pushRecord(
  ctx: Context,
  name: string,
  ownerChain: string[],
  declarationKind: TypeScriptDeclarationKind,
  isDefinition: boolean,
  isImplementation: boolean,
  node: ts.Node,
  extra: {
    declarationRange: SourceRange;
    codeRange?: SourceRange;
    signature?: string;
    relationshipId?: string;
    sourceName?: string;
    exportedName?: string;
    anonymous?: boolean;
    dynamicName?: boolean;
    modifiers: string[];
  }
) {
  const qualifiedName = [...ownerChain, name].join('.');
  const symbolId = createTypeScriptSymbolId({
    sourceHash: ctx.sourceHash,
    file: relativeFile(ctx),
    ownerChain,
    declarationKind,
    name,
    declarationRange: extra.declarationRange,
    discriminator: `${declarationKind}:${extra.declarationRange.startLine}:${extra.declarationRange.startColumn}`,
  });
  const record: CanonicalTypeScriptSymbolRecord = {
    name,
    qualifiedName,
    owner: ownerChain.at(-1),
    ownerChain: [...ownerChain],
    declarationKind,
    coarseKind: declarationKindToCoarseKind(declarationKind),
    sourceName: extra.sourceName,
    exportedName: extra.exportedName,
    anonymous: extra.anonymous,
    dynamicName: extra.dynamicName,
    modifiers: extra.modifiers,
    declarationRange: extra.declarationRange,
    codeRange: extra.codeRange,
    isDefinition,
    isImplementation,
    discriminator: `${declarationKind}:${extra.declarationRange.startLine}:${extra.declarationRange.startColumn}`,
    relationshipId: extra.relationshipId,
    signature: extra.signature,
    symbolId,
    sourceHash: ctx.sourceHash,
  };
  ctx.results.push(record);
  return record;
}

function rangeFor(node: ts.Node, startNode?: ts.Node): SourceRange {
  const sourceFile = node.getSourceFile();
  const start = ts.getLineAndCharacterOfPosition(sourceFile, (startNode ?? node).getStart(sourceFile));
  const end = ts.getLineAndCharacterOfPosition(sourceFile, node.getEnd());
  return {
    startLine: start.line + 1,
    startColumn: start.character,
    endLine: end.line + 1,
    endColumn: end.character,
  };
}

function collectModifiers(node: ts.Node): string[] {
  return collectModifierTexts(ts.canHaveModifiers(node) ? ts.getModifiers(node) ?? undefined : undefined);
}

function collectMemberModifiers(node: ts.Node & { name?: ts.PropertyName }): string[] {
  const modifiers = collectModifiers(node);
  if (node.name && ts.isPrivateIdentifier(node.name) && !modifiers.includes('private')) modifiers.push('private');
  return modifiers;
}

function collectModifierTexts(modifiers: readonly ts.ModifierLike[] | undefined): string[] {
  if (!modifiers) return [];
  const values = modifiers.map((modifier) => modifier.getText()).filter(Boolean);
  return Array.from(new Set(values));
}

function hasDefaultModifier(node: ts.Node | undefined): boolean {
  const modifiers = node && ts.canHaveModifiers(node) ? ts.getModifiers(node) ?? [] : [];
  return modifiers.some((modifier: ts.Modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword);
}

function hasAmbientModifier(node: ts.Node | undefined): boolean {
  const modifiers = node && ts.canHaveModifiers(node) ? ts.getModifiers(node) ?? [] : [];
  return modifiers.some((modifier: ts.Modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword);
}

function getPropertyNameText(name: ts.PropertyName | undefined): string | undefined {
  if (!name) return undefined;
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return normalizePropertyName(name.getText());
  if (ts.isComputedPropertyName(name)) return normalizeComputedName(name.expression);
  return undefined;
}

function normalizePropertyName(text: string): string {
  return text.replace(/^#/, '').replace(/^['"]|['"]$/g, '');
}

function normalizeComputedName(expression: ts.Expression): string {
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression) || ts.isNumericLiteral(expression)) {
    return normalizePropertyName(expression.getText());
  }
  return `[${expression.getText()}]`;
}

function isLiteralPropertyName(expression: ts.Expression): boolean {
  return ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression) || ts.isNumericLiteral(expression);
}

function inferScriptKind(filePath: string): ts.ScriptKind {
  if (filePath.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (filePath.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (filePath.endsWith('.js') || filePath.endsWith('.mjs') || filePath.endsWith('.cjs')) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function relativeFile(ctx: Context): string {
  return ctx.filePath.replace(/\\/g, '/');
}

function unwrap(expression: ts.Expression): ts.Expression {
  while (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isNonNullExpression(expression)
  ) {
    expression = expression.expression;
  }
  return expression;
}

function isNamedObjectProperty(node: ts.Node): boolean {
  return ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node) || ts.isMethodDeclaration(node);
}

function collectTopLevelObjectCallableBindings(sourceFile: ts.SourceFile): Map<string, Set<string>> {
  const bindings = new Map<string, Set<string>>();
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue;
      const initializer = declaration.initializer && unwrap(declaration.initializer);
      if (!initializer || !ts.isObjectLiteralExpression(initializer)) continue;
      const callableKeys = new Set<string>();
      for (const property of initializer.properties) {
        if (ts.isMethodDeclaration(property)) {
          const name = getPropertyNameText(property.name);
          if (name) callableKeys.add(name);
        } else if (ts.isPropertyAssignment(property)) {
          const name = getPropertyNameText(property.name);
          if (name && isCallableTypeScriptValue(property.initializer, DEFAULT_CALLABLE_WRAPPERS)) callableKeys.add(name);
        } else if (ts.isShorthandPropertyAssignment(property)) {
          callableKeys.add(property.name.text);
        }
      }
      if (callableKeys.size > 0) bindings.set(declaration.name.text, callableKeys);
    }
  }
  return bindings;
}

function variableStatementForBinding(name: ts.BindingName): ts.Node | undefined {
  const variableDeclaration = name.parent;
  const declarationList = variableDeclaration?.parent;
  const statement = declarationList?.parent;
  return statement && ts.isVariableStatement(statement) ? statement : undefined;
}

function getBindingPropertyName(name: ts.PropertyName): string {
  return getPropertyNameText(name) ?? name.getText();
}
