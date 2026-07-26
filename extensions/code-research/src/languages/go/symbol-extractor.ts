import type { DeclarationKind, SourceRange } from '../../types.js';
import { extractSignature, normalizeGoTypeName, sha256 } from './shared.js';
import { CanonicalGoSymbolRecord, createGoRelationshipId, createGoSymbolId, goDeclarationKindToCoarseKind } from './symbol-model.js';

export function extractGoSymbolRecords(input: { filePath: string; source: string; rootNode: any }): CanonicalGoSymbolRecord[] {
  const { filePath, source, rootNode } = input;
  const sourceHash = sha256(source);
  const records: CanonicalGoSymbolRecord[] = [];

  function pushRecord(node: any, name: string, declarationKind: DeclarationKind, ownerChain: string[], options?: { owner?: string; sourceName?: string; signature?: string; isImplementation?: boolean; relationshipId?: string }) {
    const declarationRange = toRange(node);
    const owner = options?.owner;
    const qualifiedName = [...ownerChain, name].join('.');
    const discriminator = `${declarationKind}:${declarationRange.startLine}:${declarationRange.startColumn}`;
    records.push({
      name,
      qualifiedName,
      owner,
      ownerChain,
      declarationKind,
      coarseKind: goDeclarationKindToCoarseKind(declarationKind),
      sourceName: options?.sourceName,
      modifiers: isExported(name) ? ['exported'] : [],
      declarationRange,
      codeRange: declarationKind === 'function' || declarationKind === 'method' ? declarationRange : undefined,
      isDefinition: true,
      isImplementation: options?.isImplementation ?? (declarationKind !== 'interface' && declarationKind !== 'interface_method' && declarationKind !== 'package'),
      discriminator,
      relationshipId: options?.relationshipId,
      signature: options?.signature,
      symbolId: createGoSymbolId({ sourceHash, file: filePath, ownerChain, declarationKind, name, declarationRange, discriminator }),
      sourceHash,
    });
  }

  for (const child of rootNode.namedChildren ?? []) {
    if (child.type === 'package_clause') {
      const pkg = child.namedChildren?.[0]?.text;
      if (pkg) pushRecord(child, pkg, 'package', [], { signature: child.text, isImplementation: false });
      continue;
    }

    if (child.type === 'function_declaration') {
      const name = child.childForFieldName('name')?.text;
      if (name) pushRecord(child, name, 'function', [], { signature: extractSignature(child), isImplementation: Boolean(child.childForFieldName('body')) });
      continue;
    }

    if (child.type === 'method_declaration') {
      const name = child.childForFieldName('name')?.text;
      const receiverType = extractReceiverType(child.childForFieldName('receiver'));
      if (name && receiverType) {
        pushRecord(child, name, 'method', [receiverType], {
          owner: receiverType,
          signature: extractSignature(child),
          isImplementation: Boolean(child.childForFieldName('body')),
          relationshipId: createGoRelationshipId(filePath, [receiverType], name, 'method'),
        });
      }
      continue;
    }

    if (child.type === 'type_declaration') {
      for (const spec of child.namedChildren ?? []) {
        if (spec.type !== 'type_spec' && spec.type !== 'type_alias') continue;
        const name = spec.childForFieldName('name')?.text;
        const typeNode = spec.childForFieldName('type');
        if (!name || !typeNode) continue;
        const declarationKind: DeclarationKind = typeNode.type === 'interface_type' ? 'interface' : 'class';
        pushRecord(spec, name, declarationKind, [], { signature: extractSignature(spec) });
        if (typeNode.type === 'interface_type') {
          for (const methodElem of typeNode.namedChildren ?? []) {
            if (methodElem.type !== 'method_elem') continue;
            const methodName = methodElem.childForFieldName('name')?.text;
            if (!methodName) continue;
            pushRecord(methodElem, methodName, 'method', [name], {
              owner: name,
              signature: extractSignature(methodElem),
              isImplementation: false,
              relationshipId: createGoRelationshipId(filePath, [name], methodName, 'interface-method'),
            });
          }
        }
      }
      continue;
    }

    if (child.type === 'var_declaration' || child.type === 'const_declaration') {
      for (const spec of descendantSpecs(child)) {
        const names = fieldNodes(spec, 'name').map((node) => node.text).filter(Boolean);
        for (const name of names) {
          pushRecord(spec, name, 'variable', [], { signature: spec.text });
        }
      }
    }
  }

  return records.sort((a, b) => a.declarationRange.startLine - b.declarationRange.startLine || a.declarationRange.startColumn - b.declarationRange.startColumn || a.qualifiedName.localeCompare(b.qualifiedName));
}

function descendantSpecs(node: any): any[] {
  const specs: any[] = [];
  const visit = (current: any) => {
    if (!current?.isNamed) return;
    if (current.type === 'var_spec' || current.type === 'const_spec') {
      specs.push(current);
      return;
    }
    for (const child of current.namedChildren ?? []) visit(child);
  };
  visit(node);
  return specs;
}

function fieldNodes(node: any, field: string): any[] {
  const result: any[] = [];
  for (const child of node.namedChildren ?? []) {
    if (child.parentFieldName === field) result.push(child);
  }
  return result;
}

function extractReceiverType(receiverNode: any): string | undefined {
  if (!receiverNode) return undefined;
  const parameter = receiverNode.namedChildren?.find((child: any) => child.type === 'parameter_declaration' || child.type === 'variadic_parameter_declaration');
  return normalizeGoTypeName(parameter?.childForFieldName('type')?.text);
}

function toRange(node: any): SourceRange {
  return {
    startLine: node.startPosition.row + 1,
    startColumn: node.startPosition.column,
    endLine: node.endPosition.row + 1,
    endColumn: node.endPosition.column,
  };
}

function isExported(name: string): boolean {
  return /^[A-Z]/.test(name);
}
