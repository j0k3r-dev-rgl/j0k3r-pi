import { resolve } from 'node:path';
import type { FindReferencesInput, GraphLookupPolicy, GraphManifest, GraphNode, ReferenceLocation, WorkspaceGraphState } from '../types.js';
import { readSubprojectGraphShard } from './graph-persistence.js';
import { GRAPH_REFERENCE_KINDS } from './graph-policy.js';

export async function queryReferencesFromGraph(options: {
  cwd: string;
  input: FindReferencesInput;
  state: WorkspaceGraphState;
  manifest: GraphManifest;
  policy: GraphLookupPolicy;
}): Promise<ReferenceLocation[] | undefined> {
  const { cwd, input, state, manifest, policy } = options;
  if (state.status === 'partial' || state.status === 'missing' || state.status === 'incompatible' || state.status === 'errored' || state.status === 'refreshing') return undefined;
  if (state.status === 'stale' && !policy.allowStale) return undefined;

  const shards = await Promise.all(
    manifest.subprojects.map(async (subproject) => {
      const shard = await readSubprojectGraphShard(cwd, subproject.id);
      return shard.status === 'ok' ? shard.data : undefined;
    })
  );

  const allShards = shards.filter(Boolean);
  if (allShards.length === 0) return undefined;

  const targetPath = resolve(cwd, input.path);
  const relativeTarget = targetPath.startsWith(cwd) ? targetPath.slice(cwd.length + 1).replace(/\\/g, '/') : input.path.replace(/\\/g, '/');
  const allNodes = allShards.flatMap((shard) => shard!.nodes);
  const allEdges = allShards.flatMap((shard) => shard!.edges);
  const symbolNodes = allNodes.filter((node): node is Extract<(typeof allNodes)[number], { kind: 'symbol' }> => node.kind === 'symbol');

  const target = symbolNodes.find((node) => {
    if (node.name !== input.symbol) return false;
    if (input.kind && node.symbolKind !== input.kind) return false;
    return node.file === relativeTarget || node.file.endsWith(`/${relativeTarget}`) || relativeTarget.endsWith(node.file);
  });
  if (!target) return undefined;

  const nodeById = new Map<string, GraphNode>(allNodes.map((node) => [node.id, node]));
  const references: ReferenceLocation[] = [];

  for (const edge of allEdges) {
    if (!(edge.kind === 'calls' || edge.kind === 'implements' || edge.kind === 'extends')) continue;
    const matchesTarget = edge.to === target.id || ((edge.kind === 'implements' || edge.kind === 'extends') && edge.to === `external:java:${target.name}`);
    if (!matchesTarget) continue;
    const fromNode = nodeById.get(edge.from);
    if (!fromNode || fromNode.kind !== 'symbol') continue;

    references.push({
      file: resolve(cwd, fromNode.file),
      line: edge.callsite?.line ?? fromNode.range.startLine,
      column: edge.callsite?.column ?? fromNode.range.startColumn,
      end_line: fromNode.range.endLine,
      end_column: fromNode.range.endColumn,
      symbol: target.name,
      kind: target.symbolKind,
      context_symbol: fromNode.name,
      context_kind: fromNode.symbolKind,
      context_class: fromNode.owner,
      owner_kind: fromNode.ownerKind ?? 'unknown',
      reference_kind: edge.kind === 'calls' ? 'call' : edge.kind === 'implements' ? 'implements' : 'extends',
      called_as: edge.callsite?.text,
      receiver_name: edge.callsite?.receiverName,
      receiver_type: edge.callsite?.receiverType,
      is_application: true,
      source: 'application',
      reason: edge.reason,
    });
  }

  return references;
}
