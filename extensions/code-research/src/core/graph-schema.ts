import { createHash } from 'node:crypto';
import type { GraphEdge, GraphManifest, GraphNode, SubprojectGraphShard, WorkspaceGraphState } from '../types.js';

export const WORKSPACE_GRAPH_SCHEMA_VERSION = 1;
export const WORKSPACE_GRAPH_CREATED_BY = 'pi-code-research-extension' as const;

function shortHash(value: string): string {
  return createHash('sha1').update(value).digest('hex').slice(0, 12);
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
  return isCompatibleGraphArtifact(value) && typeof value.subprojectId === 'string' && Array.isArray(value.nodes) && Array.isArray(value.edges);
}

export function createBaseArtifact<T extends object>(artifact: T): T & { schemaVersion: number; createdBy: 'pi-code-research-extension' } {
  return {
    schemaVersion: WORKSPACE_GRAPH_SCHEMA_VERSION,
    createdBy: WORKSPACE_GRAPH_CREATED_BY,
    ...artifact,
  };
}

export function isGraphNode(value: any): value is GraphNode {
  return Boolean(value && typeof value.id === 'string' && typeof value.kind === 'string');
}

export function isGraphEdge(value: any): value is GraphEdge {
  return Boolean(value && typeof value.id === 'string' && typeof value.kind === 'string' && typeof value.from === 'string' && typeof value.to === 'string');
}
