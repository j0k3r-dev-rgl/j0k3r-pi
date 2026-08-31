import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  DeclarationKind,
  GraphEdge,
  GraphManifest,
  GraphNode,
  GoSymbolCoverage,
  JavaSymbolCoverage,
  SubprojectGraphShard,
  TypeScriptDeclarationKind,
  TypeScriptSymbolCoverage,
  WorkspaceGraphState,
} from '../types.js';
import { compareCanonicalPathStrings } from './shared.js';

export const WORKSPACE_GRAPH_SCHEMA_VERSION = 4;
export const WORKSPACE_GRAPH_BUILDER_MODEL_VERSION = 2;
export const WORKSPACE_GRAPH_BUILDER_FINGERPRINT = createWorkspaceGraphBuilderFingerprint();
export const WORKSPACE_GRAPH_CREATED_BY = 'pi-code-research-extension' as const;
export const TYPESCRIPT_SYMBOL_COVERAGE_MODEL_VERSION = 1 as const;
export const TYPESCRIPT_GRAMMAR_VERSION = '0.23.2' as const;
export const TYPESCRIPT_COMPILER_MODEL_VERSION = 'typescript@6.0.3' as const;
const MAX_SOURCE_COORDINATE = 10_000_000;
const MAX_PERSISTED_SIGNATURE_LENGTH = 64 * 1024;
const GRAPH_EDGE_KINDS = new Set(['contains', 'imports', 'calls', 'reads', 'implements', 'extends', 'permits']);

function shortHash(value: string): string {
  return createHash('sha1').update(value).digest('hex').slice(0, 12);
}

function createWorkspaceGraphBuilderFingerprint(): string {
  const hash = createHash('sha256');
  const extensionRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  for (const path of listBuilderFiles(extensionRoot)) {
    hash.update(relative(extensionRoot, path));
    hash.update('\0');
    hash.update(readFileSync(path));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function listBuilderFiles(root: string): string[] {
  const result: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir).sort()) {
      const path = join(dir, entry);
      const stats = statSync(path);
      if (stats.isDirectory()) {
        if (entry === 'tools' || entry === 'render' || entry === 'test' || entry === 'node_modules') continue;
        visit(path);
        continue;
      }
      if (stats.isFile() && /\.(ts|js)$/.test(entry)) result.push(path);
    }
  };
  visit(join(root, 'core'));
  visit(join(root, 'languages'));
  return result.sort();
}

export function createWorkspaceNodeId(projectRoot: string): string {
  return `workspace:${shortHash(projectRoot)}`;
}

export function createSubprojectId(root: string): string {
  return shortHash(root || '.');
}

export function createSubprojectNodeId(subprojectId: string): string {
  return `subproject:${subprojectId}`;
}

export function createFileNodeId(subprojectId: string, relativePath: string): string {
  return `file:${subprojectId}:${relativePath}`;
}

export function createSymbolNodeId(
  subprojectId: string,
  filePath: string,
  owner: string | undefined,
  symbol: string,
  line: number,
  column: number
): string {
  return `symbol:${subprojectId}:${filePath}:${owner ?? '<root>'}:${symbol}:${line}:${column}`;
}

export function createEdgeId(kind: string, from: string, to: string, suffix?: string): string {
  return `${kind}:${from}:${to}${suffix ? `:${suffix}` : ''}`;
}

export function isCompatibleGraphArtifact(value: any): boolean {
  return Boolean(
    value &&
      typeof value === 'object' &&
      value.schemaVersion === WORKSPACE_GRAPH_SCHEMA_VERSION &&
      value.builderModelVersion === WORKSPACE_GRAPH_BUILDER_MODEL_VERSION &&
      value.builderFingerprint === WORKSPACE_GRAPH_BUILDER_FINGERPRINT &&
      value.createdBy === WORKSPACE_GRAPH_CREATED_BY
  );
}

export function validateWorkspaceGraphState(value: any): value is WorkspaceGraphState {
  return isCompatibleGraphArtifact(value) && typeof value.status === 'string' && Array.isArray(value.subprojects);
}

export function validateGraphManifest(value: any): value is GraphManifest {
  return isCompatibleGraphArtifact(value) && typeof value.workspaceNodeId === 'string' && Array.isArray(value.subprojects);
}

export function validateSubprojectGraphShard(value: any): value is SubprojectGraphShard {
  if (!isCompatibleGraphArtifact(value) || typeof value.subprojectId !== 'string' || value.subprojectId.length === 0 || !Number.isSafeInteger(value.generation) || value.generation < 0 || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) return false;
  if (!value.nodes.every(isGraphNode) || !value.edges.every(isGraphEdge)) return false;
  const nodeIds = new Set<string>();
  for (const node of value.nodes as GraphNode[]) {
    if (nodeIds.has(node.id)) return false;
    nodeIds.add(node.id);
  }
  for (const edge of value.edges as GraphEdge[]) {
    if (!nodeIds.has(edge.from)) return false;
    if (!nodeIds.has(edge.to) && !edge.to.startsWith('external:')) return false;
  }
  const hasTypeScriptFiles = (value.nodes as GraphNode[]).some((node) => node.kind === 'file' && (node.language === 'ts' || node.language === 'js'));
  const hasGoFiles = (value.nodes as GraphNode[]).some((node) => node.kind === 'file' && node.language === 'go');
  if (hasTypeScriptFiles && value.typescriptSymbolCoverage === undefined) return false;
  if (hasGoFiles && value.goSymbolCoverage === undefined) return false;
  return validateTypeScriptSymbolCoverage(value.typescriptSymbolCoverage, value) && validateJavaSymbolCoverage(value.javaSymbolCoverage, value) && validateGoSymbolCoverage(value.goSymbolCoverage, value);
}

export function createBaseArtifact<T extends object>(artifact: T): T & { schemaVersion: number; builderModelVersion: number; builderFingerprint: string; createdBy: 'pi-code-research-extension' } {
  return {
    schemaVersion: WORKSPACE_GRAPH_SCHEMA_VERSION,
    builderModelVersion: WORKSPACE_GRAPH_BUILDER_MODEL_VERSION,
    builderFingerprint: WORKSPACE_GRAPH_BUILDER_FINGERPRINT,
    createdBy: WORKSPACE_GRAPH_CREATED_BY,
    ...artifact,
  };
}

export function isGraphNode(value: any): value is GraphNode {
  if (!value || typeof value.id !== 'string' || typeof value.kind !== 'string') return false;
  if (value.kind === 'workspace') return typeof value.name === 'string' && typeof value.root === 'string';
  if (value.kind === 'subproject') return typeof value.name === 'string' && typeof value.root === 'string' && Array.isArray(value.markers) && Array.isArray(value.languages);
  if (value.kind === 'file') return typeof value.path === 'string' && value.path.length > 0 && (value.language === 'java' || value.language === 'go' || value.language === 'ts' || value.language === 'js') && Number.isSafeInteger(value.size) && value.size >= 0;
  if (value.kind !== 'symbol') return false;
  return Boolean(
    typeof value.language === 'string' &&
      typeof value.symbolKind === 'string' &&
      typeof value.name === 'string' &&
      typeof value.file === 'string' &&
      isSourceRange(value.range) &&
      typeof value.exported === 'boolean' &&
      (value.owner === undefined || typeof value.owner === 'string') &&
      (value.ownerKind === undefined || typeof value.ownerKind === 'string') &&
      (value.signature === undefined || (typeof value.signature === 'string' && value.signature.length <= MAX_PERSISTED_SIGNATURE_LENGTH)) &&
      (value.declarationKind === undefined || isDeclarationKind(value.declarationKind)) &&
      (value.symbolId === undefined || isSha256(value.symbolId)) &&
      (value.logicalSymbolKey === undefined || (typeof value.logicalSymbolKey === 'string' && value.logicalSymbolKey.length > 0)) &&
      (value.snapshotSymbolId === undefined || isSha256(value.snapshotSymbolId)) &&
      (value.qualifiedName === undefined || (typeof value.qualifiedName === 'string' && value.qualifiedName.length > 0)) &&
      (value.relationshipId === undefined || typeof value.relationshipId === 'string') &&
      (value.sourceName === undefined || typeof value.sourceName === 'string') &&
      (value.exportedName === undefined || typeof value.exportedName === 'string') &&
      (value.anonymous === undefined || typeof value.anonymous === 'boolean') &&
      (value.dynamicName === undefined || typeof value.dynamicName === 'boolean') &&
      (value.modifiers === undefined || (Array.isArray(value.modifiers) && value.modifiers.every((modifier: unknown) => typeof modifier === 'string'))) &&
      (value.isDefinition === undefined || typeof value.isDefinition === 'boolean') &&
      (value.isImplementation === undefined || typeof value.isImplementation === 'boolean') &&
      (value.sourceHash === undefined || isSha256(value.sourceHash)) &&
      ((value.language !== 'ts' && value.language !== 'js' && value.language !== 'go') || (
        isDeclarationKind(value.declarationKind) &&
        isSha256(value.symbolId) &&
        typeof value.logicalSymbolKey === 'string' && value.logicalSymbolKey.length > 0 &&
        isSha256(value.snapshotSymbolId) &&
        typeof value.qualifiedName === 'string' && value.qualifiedName.length > 0 &&
        Array.isArray(value.modifiers) && value.modifiers.every((modifier: unknown) => typeof modifier === 'string') &&
        typeof value.isDefinition === 'boolean' &&
        typeof value.isImplementation === 'boolean' &&
        isSha256(value.sourceHash)
      ))
  );
}

export function isGraphEdge(value: any): value is GraphEdge {
  return Boolean(
    value &&
      typeof value.id === 'string' &&
      GRAPH_EDGE_KINDS.has(value.kind) &&
      typeof value.from === 'string' && value.from.length > 0 &&
      typeof value.to === 'string' && value.to.length > 0 &&
      (value.occurrenceRange === undefined || isSourceRange(value.occurrenceRange)) &&
      (value.targetStatus === undefined || ['resolved', 'ambiguous', 'external', 'unresolved'].includes(value.targetStatus)) &&
      (value.resolution === undefined || ['exact', 'heuristic', 'ambiguous', 'unresolved'].includes(value.resolution)) &&
      (value.callsite === undefined || isCallsite(value.callsite)) &&
      (value.importSource === undefined || typeof value.importSource === 'string') &&
      (value.external === undefined || typeof value.external === 'boolean') &&
      (value.externalName === undefined || typeof value.externalName === 'string') &&
      (value.externalKind === undefined || typeof value.externalKind === 'string') &&
      (value.externalOwner === undefined || typeof value.externalOwner === 'string') &&
      (value.externalOwnerKind === undefined || typeof value.externalOwnerKind === 'string') &&
      (value.externalSource === undefined || typeof value.externalSource === 'string') &&
      (value.targetRelationshipId === undefined || isSha256(value.targetRelationshipId)) &&
      (value.reason === undefined || typeof value.reason === 'string')
  );
}

function validateTypeScriptSymbolCoverage(value: unknown, shard: { nodes: GraphNode[]; generation: number }): value is TypeScriptSymbolCoverage | undefined {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object') return false;
  const coverage = value as TypeScriptSymbolCoverage;
  if (coverage.modelVersion !== TYPESCRIPT_SYMBOL_COVERAGE_MODEL_VERSION) return false;
  if (coverage.compilerModelVersion !== TYPESCRIPT_COMPILER_MODEL_VERSION) return false;
  if (!coverage.grammar || coverage.grammar.typescript !== TYPESCRIPT_GRAMMAR_VERSION || coverage.grammar.tsx !== TYPESCRIPT_GRAMMAR_VERSION) return false;
  if (coverage.generation !== shard.generation) return false;
  if (!Array.isArray(coverage.completeFiles) || !Array.isArray(coverage.skippedFiles) || !coverage.fileProofs || typeof coverage.fileProofs !== 'object') return false;
  const completeFiles = new Set<string>();
  const fileNodes = new Set(shard.nodes.filter((node): node is Extract<GraphNode, { kind: 'file' }> => node.kind === 'file' && (node.language === 'ts' || node.language === 'js')).map((node) => node.path));
  for (const file of coverage.completeFiles) {
    if (typeof file !== 'string' || file.length === 0 || completeFiles.has(file) || !fileNodes.has(file)) return false;
    completeFiles.add(file);
    const proof = coverage.fileProofs[file];
    if (!proof || !isSha256(proof.sourceHash) || !Number.isInteger(proof.symbolCount) || proof.symbolCount < 0) return false;
  }
  const skippedFiles = new Set<string>();
  const skippedReasons = new Set(['parse_error', 'input_unreadable', 'unsupported_language', 'unsupported_source']);
  for (const skipped of coverage.skippedFiles) {
    if (!skipped || typeof skipped.file !== 'string' || skipped.file.length === 0 || !skippedReasons.has(skipped.reason) || skippedFiles.has(skipped.file) || completeFiles.has(skipped.file)) return false;
    skippedFiles.add(skipped.file);
  }
  if ([...fileNodes].some((file) => !completeFiles.has(file) && !skippedFiles.has(file))) return false;
  for (const [file, proof] of Object.entries(coverage.fileProofs)) {
    if (!completeFiles.has(file)) return false;
    if (!proof || !isSha256(proof.sourceHash) || !Number.isInteger(proof.symbolCount) || proof.symbolCount < 0) return false;
  }
  const symbolsByFile = new Map<string, number>();
  for (const node of shard.nodes) {
    if (node.kind !== 'symbol' || (node.language !== 'ts' && node.language !== 'js')) continue;
    if (!node.declarationKind || !node.symbolId || !node.qualifiedName || !Array.isArray(node.modifiers) || typeof node.isDefinition !== 'boolean' || typeof node.isImplementation !== 'boolean' || !isSha256(node.sourceHash)) {
      return false;
    }
    symbolsByFile.set(node.file, (symbolsByFile.get(node.file) ?? 0) + 1);
  }
  for (const file of completeFiles) {
    if ((symbolsByFile.get(file) ?? 0) !== coverage.fileProofs[file].symbolCount) return false;
  }
  return true;
}

function validateJavaSymbolCoverage(value: unknown, shard: { nodes: GraphNode[]; generation: number }): value is JavaSymbolCoverage | undefined {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object') return false;
  const coverage = value as JavaSymbolCoverage;
  if (coverage.modelVersion !== 1) return false;
  if (coverage.grammar?.package !== 'tree-sitter-java' || coverage.grammar?.version !== '0.23.5') return false;
  if (coverage.generation !== shard.generation) return false;
  if (!Array.isArray(coverage.completeFiles) || !Array.isArray(coverage.skippedFiles) || !coverage.fileProofs || typeof coverage.fileProofs !== 'object') return false;

  const validFamilies = new Set(['compilation_unit', 'type', 'callable', 'member', 'binding', 'unknown']);
  const validUnsupportedForms = new Set(['anonymous_class_relationship_only', 'lambda_relationship_only', 'initializer_block', 'unnamed_pattern']);
  if (!isSortedUniqueStrings(coverage.completeFiles)) return false;
  const fileNodes = new Set(shard.nodes.filter((node): node is Extract<GraphNode, { kind: 'file' }> => node.kind === 'file' && node.language === 'java').map((node) => node.path));
  const completeFiles = new Set<string>();
  for (const file of coverage.completeFiles) {
    if (file.length === 0 || !fileNodes.has(file)) return false;
    completeFiles.add(file);
    const proof = coverage.fileProofs[file];
    if (!proof || !isSha256(proof.sourceHash) || !Number.isInteger(proof.symbolCount) || proof.symbolCount < 0 || !Number.isInteger(proof.relationshipScopeCount) || proof.relationshipScopeCount < 0 || !isSortedUniqueStrings(proof.observedFamilies, validFamilies) || !isSortedUniqueStrings(proof.unsupportedForms, validUnsupportedForms)) return false;
  }

  const skippedFiles = new Set<string>();
  const skippedReasons = new Set(['parse_error', 'input_unreadable', 'unsupported_source']);
  for (const skipped of coverage.skippedFiles) {
    if (!skipped || typeof skipped.file !== 'string' || skipped.file.length === 0 || !skippedReasons.has(skipped.reason) || skippedFiles.has(skipped.file) || completeFiles.has(skipped.file) || !fileNodes.has(skipped.file)) return false;
    skippedFiles.add(skipped.file);
  }
  if ([...fileNodes].some((file) => !completeFiles.has(file) && !skippedFiles.has(file))) return false;
  for (const [file, proof] of Object.entries(coverage.fileProofs)) {
    if (!completeFiles.has(file) || !proof || !isSha256(proof.sourceHash)) return false;
  }

  const symbolsByFile = new Map<string, number>();
  for (const node of shard.nodes) {
    if (node.kind !== 'symbol' || node.language !== 'java') continue;
    if (!node.declarationKind || !node.symbolId || !node.qualifiedName || !Array.isArray(node.modifiers) || typeof node.isDefinition !== 'boolean' || typeof node.isImplementation !== 'boolean' || !isSha256(node.sourceHash)) return false;
    const proof = coverage.fileProofs[node.file];
    if (!proof || node.sourceHash !== proof.sourceHash) return false;
    symbolsByFile.set(node.file, (symbolsByFile.get(node.file) ?? 0) + 1);
  }
  for (const file of completeFiles) {
    if ((symbolsByFile.get(file) ?? 0) !== coverage.fileProofs[file].symbolCount) return false;
  }

  const expectedSnapshotId = createHash('sha256')
    .update(coverage.completeFiles.map((file) => `${file}:${coverage.fileProofs[file].sourceHash}`).join('|'))
    .digest('hex');
  return coverage.sourceSnapshotId === expectedSnapshotId;
}

function validateGoSymbolCoverage(value: unknown, shard: { nodes: GraphNode[]; generation: number }): value is GoSymbolCoverage | undefined {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object') return false;
  const coverage = value as GoSymbolCoverage;
  if (coverage.modelVersion !== 1) return false;
  if (coverage.grammar?.package !== 'tree-sitter-go' || coverage.grammar?.version !== '0.23.3') return false;
  if (coverage.generation !== shard.generation) return false;
  if (!Array.isArray(coverage.completeFiles) || !Array.isArray(coverage.skippedFiles) || !coverage.fileProofs || typeof coverage.fileProofs !== 'object') return false;
  const fileNodes = new Set(shard.nodes.filter((node): node is Extract<GraphNode, { kind: 'file' }> => node.kind === 'file' && node.language === 'go').map((node) => node.path));
  const completeFiles = new Set<string>();
  for (const file of coverage.completeFiles) {
    if (typeof file !== 'string' || file.length === 0 || completeFiles.has(file) || !fileNodes.has(file)) return false;
    completeFiles.add(file);
    const proof = coverage.fileProofs[file];
    if (!proof || !isSha256(proof.sourceHash) || !Number.isInteger(proof.symbolCount) || proof.symbolCount < 0) return false;
  }
  const skippedFiles = new Set<string>();
  const skippedReasons = new Set(['parse_error', 'input_unreadable', 'unsupported_source']);
  for (const skipped of coverage.skippedFiles) {
    if (!skipped || typeof skipped.file !== 'string' || skipped.file.length === 0 || !skippedReasons.has(skipped.reason) || skippedFiles.has(skipped.file) || completeFiles.has(skipped.file) || !fileNodes.has(skipped.file)) return false;
    skippedFiles.add(skipped.file);
  }
  if ([...fileNodes].some((file) => !completeFiles.has(file) && !skippedFiles.has(file))) return false;
  const symbolsByFile = new Map<string, number>();
  for (const node of shard.nodes) {
    if (node.kind !== 'symbol' || node.language !== 'go') continue;
    if (!node.declarationKind || !node.symbolId || !node.qualifiedName || !Array.isArray(node.modifiers) || typeof node.isDefinition !== 'boolean' || typeof node.isImplementation !== 'boolean' || !isSha256(node.sourceHash)) return false;
    const proof = coverage.fileProofs[node.file];
    if (!proof || node.sourceHash !== proof.sourceHash) return false;
    symbolsByFile.set(node.file, (symbolsByFile.get(node.file) ?? 0) + 1);
  }
  for (const file of completeFiles) {
    if ((symbolsByFile.get(file) ?? 0) !== coverage.fileProofs[file].symbolCount) return false;
  }
  return true;
}

function isSortedUniqueStrings(values: unknown, allowed?: Set<string>): values is string[] {
  if (!Array.isArray(values)) return false;
  let previous: string | undefined;
  for (const value of values) {
    if (typeof value !== 'string' || (allowed && !allowed.has(value))) return false;
    if (previous !== undefined && compareCanonicalPathStrings(previous, value) >= 0) return false;
    previous = value;
  }
  return true;
}

function isDeclarationKind(value: string): value is DeclarationKind {
  return new Set<DeclarationKind>([
    'function','function_overload','callable_variable','variable','class','constructor','method','getter','setter','field','interface','interface_method','property','call_signature','construct_signature','index_signature','type_alias','enum','enum_member','namespace','module','import_alias','export_alias','object_method','object_property','assignment','commonjs_export','package','enum_constant','record','record_component','annotation','annotation_element','compact_constructor','parameter','receiver_parameter','lambda_parameter','local_variable','enhanced_for_variable','catch_parameter','resource_variable','pattern_variable','type_parameter','unknown',
  ]).has(value as DeclarationKind);
}

function isSourceRange(value: any): boolean {
  return Boolean(value && [value.startLine, value.startColumn, value.endLine, value.endColumn].every((part: unknown) => Number.isSafeInteger(part) && (part as number) >= 0 && (part as number) <= MAX_SOURCE_COORDINATE) && (value.endLine > value.startLine || (value.endLine === value.startLine && value.endColumn >= value.startColumn)));
}

function isCallsite(value: any): boolean {
  return Boolean(value && Number.isSafeInteger(value.line) && value.line > 0 && value.line <= MAX_SOURCE_COORDINATE && Number.isSafeInteger(value.column) && value.column >= 0 && value.column <= MAX_SOURCE_COORDINATE && value.text === undefined && (value.receiverName === undefined || typeof value.receiverName === 'string') && (value.receiverType === undefined || typeof value.receiverType === 'string'));
}

function isSha256(value: unknown): boolean {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}
