import { basename, extname, resolve } from 'node:path';
import type {
  CallTreeNode,
  FunctionCallTreeInput,
  FunctionCallTreeResult,
  GraphLookupPolicy,
  GraphManifest,
  GraphNode,
  SubprojectGraphShard,
  WorkspaceGraphState,
} from '../types.js';
import { readSubprojectGraphShard } from './graph-persistence.js';

export async function queryReverseFunctionCallTreeFromGraph(options: {
  cwd: string;
  input: FunctionCallTreeInput;
  state: WorkspaceGraphState;
  manifest: GraphManifest;
  policy: GraphLookupPolicy;
}): Promise<{ rootClassName: string; result: FunctionCallTreeResult } | undefined> {
  const { cwd, input, state, manifest, policy } = options;
  if (state.status === 'partial' || state.status === 'missing' || state.status === 'incompatible' || state.status === 'errored' || state.status === 'refreshing') {
    return undefined;
  }
  if (state.status === 'stale' && !policy.allowStale) return undefined;

  const shards = await Promise.all(
    manifest.subprojects.map(async (subproject) => {
      const shard = await readSubprojectGraphShard(cwd, subproject.id);
      return shard.status === 'ok' ? shard.data : undefined;
    })
  );

  const allShards = shards.filter(Boolean) as SubprojectGraphShard[];
  const targetPath = resolve(cwd, input.path);
  const relativeTarget = targetPath.startsWith(cwd) ? targetPath.slice(cwd.length + 1).replace(/\\/g, '/') : input.path.replace(/\\/g, '/');

  const symbols = allShards.flatMap((shard) => shard.nodes.filter((node): node is Extract<GraphNode, { kind: 'symbol' }> => node.kind === 'symbol'));
  const targetCandidates = symbols.filter((node) => {
    if (node.name !== input.symbol) return false;
    if (input.kind && node.symbolKind !== input.kind) return false;
    return node.file === relativeTarget || node.file.endsWith(`/${relativeTarget}`) || relativeTarget.endsWith(node.file);
  });

  const target = targetCandidates[0] ?? symbols.find((node) => node.name === input.symbol && (!input.kind || node.symbolKind === input.kind));
  if (!target) return undefined;

  const nodeById = new Map<string, GraphNode>(symbols.map((node) => [node.id, node]));
  for (const shard of allShards) {
    for (const node of shard.nodes) nodeById.set(node.id, node);
  }
  const allEdges = allShards.flatMap((shard) => shard.edges);

  const root = buildReverseTree(target.id, nodeById, allEdges, input.max_depth ?? 10, 0, new Set());
  if (!root) return undefined;
  const resultRoot = input.compacted ? compactTree(root) : root;
  const stats = { total_nodes: 0, application_nodes: 0, external_nodes: 0, max_depth_reached: 0 };
  countNodes(resultRoot, 0, stats);

  return {
    rootClassName: target.owner ? target.owner : basename(target.file, extname(target.file)),
    result: { root: resultRoot, stats },
  };
}

function buildReverseTree(
  nodeId: string,
  nodeById: Map<string, GraphNode>,
  edges: SubprojectGraphShard['edges'],
  maxDepth: number,
  depth: number,
  visited: Set<string>
): CallTreeNode | undefined {
  const node = nodeById.get(nodeId);
  if (!node || node.kind !== 'symbol') return undefined;

  const result: CallTreeNode = {
    file: node.file,
    symbol: node.name,
    kind: node.symbolKind,
    node_type: 'application',
    class: node.owner,
    owner_kind: node.ownerKind ?? 'unknown',
    line: node.range.startLine,
    column: node.range.startColumn,
    start_line: node.range.startLine,
    start_column: node.range.startColumn,
    end_line: node.range.endLine,
    end_column: node.range.endColumn,
    signature: node.signature,
    is_application: true,
    is_external: false,
    source: 'application',
  };

  const visitKey = `${node.id}`;
  if (visited.has(visitKey) || depth >= maxDepth) return result;
  visited.add(visitKey);

  const callerEdges = edges.filter((edge) => edge.kind === 'calls' && edge.to === node.id);
  const callers: CallTreeNode[] = [];
  for (const edge of callerEdges) {
    const caller = nodeById.get(edge.from);
    if (caller?.kind !== 'symbol') continue;
    const callerNode = buildReverseTree(caller.id, nodeById, edges, maxDepth, depth + 1, visited);
    if (!callerNode) continue;
    callerNode.called_as = edge.callsite?.text;
    callerNode.receiver_name = edge.callsite?.receiverName;
    callerNode.receiver_type = edge.callsite?.receiverType;
    callerNode.call_line = edge.callsite?.line;
    callerNode.call_column = edge.callsite?.column;
    callers.push(callerNode);
  }

  if (callers.length > 0) result.callers = callers;
  return result;
}

function compactTree(node: CallTreeNode): CallTreeNode {
  if (!node.callers?.length) return node;
  return { ...node, callers: node.callers.map(compactTree) };
}

function countNodes(node: CallTreeNode, depth: number, stats: FunctionCallTreeResult['stats']): void {
  stats.total_nodes += 1;
  if (node.is_application) stats.application_nodes += 1;
  if (node.is_external) stats.external_nodes += 1;
  stats.max_depth_reached = Math.max(stats.max_depth_reached, depth);
  for (const caller of node.callers ?? []) countNodes(caller, depth + 1, stats);
}
