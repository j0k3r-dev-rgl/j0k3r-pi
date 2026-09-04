import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import type { GraphEdge, GraphNode, SubprojectGraphShard } from '../types.js';
import {
  createEdgeId,
  createFileNodeId,
  createSubprojectNodeId,
  createWorkspaceNodeId,
} from './graph-schema.js';

export function createLanguageGraphScaffold(
  projectRoot: string,
  subprojectId: string,
  subprojectRelativeRoot: string,
  markers: string[],
  languages: string[]
): { nodes: GraphNode[]; edges: GraphEdge[]; workspaceNodeId: string; subprojectNodeId: string } {
  const workspaceNodeId = createWorkspaceNodeId(projectRoot);
  const subprojectNodeId = createSubprojectNodeId(subprojectId);
  const nodes: GraphNode[] = [
    { id: workspaceNodeId, kind: 'workspace', name: 'workspace', root: '.' },
    { id: subprojectNodeId, kind: 'subproject', name: subprojectRelativeRoot, root: subprojectRelativeRoot, markers, languages },
  ];
  const edges: GraphEdge[] = [
    { id: createEdgeId('contains', workspaceNodeId, subprojectNodeId), kind: 'contains', from: workspaceNodeId, to: subprojectNodeId },
  ];
  return { nodes, edges, workspaceNodeId, subprojectNodeId };
}

export function ensureFileNode(
  nodes: GraphNode[],
  edges: GraphEdge[],
  fileNodeIds: Map<string, string>,
  fileNodes: Map<string, Extract<GraphNode, { kind: 'file' }>>,
  pendingFileStats: Array<Promise<void>>,
  subprojectNodeId: string,
  subprojectId: string,
  relativeFile: string,
  language: 'ts' | 'js' | 'java' | 'go',
  absoluteFile: string,
  entrypoint = false
): string {
  const existing = fileNodeIds.get(relativeFile);
  if (existing) {
    if (entrypoint) {
      const node = fileNodes.get(relativeFile);
      if (node) node.entrypoint = true;
    }
    return existing;
  }
  const fileNodeId = createFileNodeId(subprojectId, relativeFile);
  const fileNode: Extract<GraphNode, { kind: 'file' }> = {
    id: fileNodeId,
    kind: 'file',
    path: relativeFile,
    language,
    size: 0,
    entrypoint: entrypoint || undefined,
  };
  fileNodeIds.set(relativeFile, fileNodeId);
  fileNodes.set(relativeFile, fileNode);
  nodes.push(fileNode);
  edges.push({ id: createEdgeId('contains', subprojectNodeId, fileNodeId), kind: 'contains', from: subprojectNodeId, to: fileNodeId });
  pendingFileStats.push(
    stat(absoluteFile)
      .then((fileStat) => {
        fileNode.size = fileStat.size;
      })
      .catch(() => undefined)
  );
  return fileNodeId;
}

export function collectFileScopedNodeIds(shard: SubprojectGraphShard, files: Set<string>): Set<string> {
  const ids = new Set<string>();
  for (const node of shard.nodes) {
    if (node.kind === 'file' && files.has(node.path)) ids.add(node.id);
    if (node.kind === 'symbol' && files.has(node.file)) ids.add(node.id);
  }
  return ids;
}

export function hasStableUntouchedFiles(previous: SubprojectGraphShard, rebuilt: SubprojectGraphShard, changed: Set<string>): boolean {
  const previousFiles = previous.nodes.filter((node): node is Extract<GraphNode, { kind: 'file' }> => node.kind === 'file' && !changed.has(node.path));
  const rebuiltFileIds = new Set(rebuilt.nodes.filter((node): node is Extract<GraphNode, { kind: 'file' }> => node.kind === 'file' && !changed.has(node.path)).map((node) => node.id));
  for (const file of previousFiles) {
    if (!rebuiltFileIds.has(file.id)) return false;
  }
  return true;
}

export function hasSafeChangedFileTopology(previous: SubprojectGraphShard, rebuilt: SubprojectGraphShard, changed: Set<string>): boolean {
  const previousFiles = new Set(previous.nodes.filter((node): node is Extract<GraphNode, { kind: 'file' }> => node.kind === 'file').map((node) => node.path));
  const rebuiltFiles = new Set(rebuilt.nodes.filter((node): node is Extract<GraphNode, { kind: 'file' }> => node.kind === 'file').map((node) => node.path));
  const retainedChanged = new Set([...changed].filter((file) => previousFiles.has(file) && rebuiltFiles.has(file)));
  const deletedChanged = new Set([...changed].filter((file) => previousFiles.has(file) && !rebuiltFiles.has(file)));

  const previousRetained = collectFileScopedNodeIds(previous, retainedChanged);
  const rebuiltRetained = collectFileScopedNodeIds(rebuilt, retainedChanged);
  if (!sameStringSet(previousRetained, rebuiltRetained)) return false;

  const previousDeleted = collectFileScopedNodeIds(previous, deletedChanged);
  if (publicTopologyFingerprints(previous, deletedChanged).size > 0) return false;
  if (inboundFingerprints(previous, previousDeleted).size > 0) return false;

  const previousPublic = publicTopologyFingerprints(previous, retainedChanged);
  const rebuiltPublic = publicTopologyFingerprints(rebuilt, retainedChanged);
  if (!sameStringSet(previousPublic, rebuiltPublic)) return false;

  const previousRelationships = relationshipFingerprints(previous, previousRetained);
  const rebuiltRelationships = relationshipFingerprints(rebuilt, rebuiltRetained);
  if (!sameStringSet(previousRelationships, rebuiltRelationships)) return false;

  const previousInbound = inboundFingerprints(previous, previousRetained);
  const rebuiltInbound = inboundFingerprints(rebuilt, rebuiltRetained);
  return sameStringSet(previousInbound, rebuiltInbound);
}

export function publicTopologyFingerprints(shard: SubprojectGraphShard, files: Set<string>): Set<string> {
  const result = new Set<string>();
  for (const node of shard.nodes) {
    if (node.kind !== 'symbol' || !files.has(node.file)) continue;
    const topologySensitive = node.exported || node.declarationKind === 'interface' || node.declarationKind === 'interface_method' || node.declarationKind === 'property' || node.declarationKind === 'call_signature' || node.declarationKind === 'construct_signature' || node.declarationKind === 'index_signature' || node.declarationKind === 'type_alias';
    if (!topologySensitive) continue;
    result.add([node.id, node.language, node.symbolKind, node.name, node.owner ?? '', node.declarationKind ?? '', node.qualifiedName ?? '', node.signature ?? '', node.exportedName ?? ''].join('\u0000'));
  }
  return result;
}

export function relationshipFingerprints(shard: SubprojectGraphShard, scopedIds: Set<string>): Set<string> {
  const result = new Set<string>();
  for (const edge of shard.edges) {
    if (!scopedIds.has(edge.from)) continue;
    if (edge.kind === 'contains') continue;
    result.add(edgeTopologyFingerprint(edge));
  }
  return result;
}

export function inboundFingerprints(shard: SubprojectGraphShard, scopedIds: Set<string>): Set<string> {
  const result = new Set<string>();
  for (const edge of shard.edges) {
    if (scopedIds.has(edge.from) || !scopedIds.has(edge.to)) continue;
    if (edge.kind === 'contains') continue;
    result.add(edgeTopologyFingerprint(edge));
  }
  return result;
}

export function edgeTopologyFingerprint(edge: GraphEdge): string {
  return [edge.kind, edge.from, edge.to, edge.targetStatus ?? '', edge.resolution ?? '', edge.calledAs ?? '', edge.importSource ?? '', edge.externalName ?? '', edge.externalKind ?? '', edge.externalOwner ?? '', edge.reason ?? ''].join('\u0000');
}

export function sameStringSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) if (!b.has(item)) return false;
  return true;
}

export function createLogicalSymbolKey(language: 'ts' | 'js' | 'java' | 'go', subprojectId: string, file: string, owner: string | undefined, qualifiedName: string | undefined, declarationKind: string | undefined, signature: string | undefined): string {
  return [language, subprojectId, file, owner ?? '<root>', qualifiedName ?? '<anonymous>', declarationKind ?? 'unknown', sanitizePersistedSignature(signature) ?? ''].join('::');
}

export function createSnapshotSymbolId(symbolId: string, sourceHash: string, range: { startLine: number; startColumn: number; endLine: number; endColumn: number }): string {
  return createHash('sha256').update(`${symbolId}:${sourceHash}:${range.startLine}:${range.startColumn}:${range.endLine}:${range.endColumn}`).digest('hex');
}

export function pointOccurrenceRange(line: number, column: number) {
  return { startLine: line, startColumn: column, endLine: line, endColumn: column };
}

export function sanitizePersistedSignature(signature: string | undefined): string | undefined {
  return signature?.replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '$1<redacted>$1');
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
