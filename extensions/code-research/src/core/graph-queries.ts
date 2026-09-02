import { stat } from 'node:fs/promises';
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

export async function queryFunctionCallTreeFromGraph(options: {
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

  const targetPath = resolve(cwd, input.path);
  const targetStat = await stat(targetPath).catch(() => undefined);
  const targetIsDirectory = targetStat?.isDirectory() === true;
  const relativeTarget = (targetPath.startsWith(cwd) ? targetPath.slice(cwd.length + 1).replace(/\\/g, '/') : input.path.replace(/\\/g, '/')).replace(/\/$/, '');

  const scopedSubprojects = selectScopedSubprojects(manifest, relativeTarget);
  const shards = await Promise.all(
    scopedSubprojects.map(async (subproject) => {
      const shard = await readSubprojectGraphShard(cwd, subproject.id, { generation: subproject.generation });
      return shard.status === 'ok' ? shard.data : undefined;
    })
  );

  const allShards = shards.filter(Boolean) as SubprojectGraphShard[];

  const symbols = allShards.flatMap((shard) => shard.nodes.filter((node): node is Extract<GraphNode, { kind: 'symbol' }> => node.kind === 'symbol' && matchesLanguage(node.language, input.language)));
  const targetCandidates = symbols.filter((node) => {
    if (node.name !== input.symbol) return false;
    if (input.kind && node.symbolKind !== input.kind) return false;
    return matchesTargetFile(node.file, relativeTarget, targetIsDirectory);
  });

  const target = targetCandidates[0];
  if (!target) return undefined;

  const nodeById = new Map<string, GraphNode>(symbols.map((node) => [node.id, node]));
  for (const shard of allShards) {
    for (const node of shard.nodes) nodeById.set(node.id, node);
  }
  const allEdges = allShards.flatMap((shard) => shard.edges);

  const root = buildTree(target.id, nodeById, allEdges, input.max_depth ?? 10, input.include_external ?? false, 0, new Set());
  if (!root) return undefined;
  const resultRoot = input.compacted ? compactTree(root) : root;
  const stats = { total_nodes: 0, application_nodes: 0, external_nodes: 0, max_depth_reached: 0 };
  countNodes(resultRoot, 0, stats);

  return {
    rootClassName: target.owner ? target.owner : basename(target.file, extname(target.file)),
    result: { root: resultRoot, stats },
  };
}

function buildTree(
  nodeId: string,
  nodeById: Map<string, GraphNode>,
  edges: SubprojectGraphShard['edges'],
  maxDepth: number,
  includeExternal: boolean,
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

  const callEdges = edges.filter((edge) => edge.kind === 'calls' && edge.from === node.id);
  const children: CallTreeNode[] = [];
  for (const edge of callEdges) {
    const target = nodeById.get(edge.to);
    if (target?.kind === 'symbol') {
      const child = buildTree(edge.to, nodeById, edges, maxDepth, includeExternal, depth + 1, visited);
      if (child) {
        child.receiver_name = edge.callsite?.receiverName;
        child.receiver_type = edge.callsite?.receiverType;
        child.call_line = edge.callsite?.line;
        child.call_column = edge.callsite?.column;
        children.push(child);
      }
      continue;
    }

    if (includeExternal && edge.externalName) {
      children.push({
        symbol: edge.externalName,
        kind: edge.externalKind ?? 'function',
        node_type: edge.externalSource === 'framework' ? 'framework' : 'external',
        class: edge.externalOwner,
        owner_kind: edge.externalOwnerKind ?? 'unknown',
        receiver_name: edge.callsite?.receiverName,
        receiver_type: edge.callsite?.receiverType,
        call_line: edge.callsite?.line,
        call_column: edge.callsite?.column,
        is_application: false,
        is_external: true,
        source: edge.externalSource ?? 'unknown',
        reason: edge.reason,
      });
    }
  }

  if (children.length > 0) result.children = dedupeCallTreeNodes(children);
  return result;
}

function compactTree(node: CallTreeNode): CallTreeNode {
  if (!node.children?.length) return node;
  return { ...node, children: node.children.map(compactTree) };
}

function countNodes(node: CallTreeNode, depth: number, stats: FunctionCallTreeResult['stats']): void {
  stats.total_nodes += 1;
  if (node.is_application) stats.application_nodes += 1;
  if (node.is_external) stats.external_nodes += 1;
  stats.max_depth_reached = Math.max(stats.max_depth_reached, depth);
  for (const child of node.children ?? []) countNodes(child, depth + 1, stats);
}

function dedupeCallTreeNodes(nodes: CallTreeNode[]): CallTreeNode[] {
  const selected = new Map<string, CallTreeNode>();
  for (const node of nodes) {
    const key = [node.file ?? '', node.class ?? '', node.symbol, node.call_line ?? node.line ?? '', node.call_column ?? node.column ?? '', node.receiver_name ?? '', node.receiver_type ?? ''].join('\u0000');
    if (!selected.has(key)) selected.set(key, node);
  }
  return [...selected.values()];
}

function selectScopedSubprojects(manifest: GraphManifest, relativeTarget: string): GraphManifest['subprojects'] {
  const target = relativeTarget.replace(/\\/g, '/').replace(/^\.\/$/, '.').replace(/\/$/, '') || '.';
  if (target === '.') return nonOverlappingSubprojects(manifest.subprojects);
  const containing = manifest.subprojects.filter((subproject) => subprojectContainsPath(subproject.root, target));
  if (containing.length === 0) return nonOverlappingSubprojects(manifest.subprojects);
  const deepestLength = Math.max(...containing.map((subproject) => subproject.root === '.' ? 0 : subproject.root.length));
  return containing.filter((subproject) => (subproject.root === '.' ? 0 : subproject.root.length) === deepestLength);
}

function nonOverlappingSubprojects(subprojects: GraphManifest['subprojects']): GraphManifest['subprojects'] {
  return subprojects.filter((candidate) => !subprojects.some((other) => other !== candidate && subprojectContainsPath(candidate.root, other.root)));
}

function subprojectContainsPath(root: string, target: string): boolean {
  const normalizedRoot = root.replace(/\\/g, '/').replace(/\/$/, '') || '.';
  const normalizedTarget = target.replace(/\\/g, '/').replace(/\/$/, '') || '.';
  if (normalizedRoot === '.') return true;
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}/`);
}

function matchesLanguage(nodeLanguage: string, inputLanguage: FunctionCallTreeInput['language']): boolean {
  return !inputLanguage || inputLanguage === 'auto' || nodeLanguage === inputLanguage;
}

function matchesTargetFile(nodeFile: string, relativeTarget: string, targetIsDirectory: boolean): boolean {
  const normalizedNodeFile = nodeFile.replace(/\\/g, '/');
  const normalizedTarget = relativeTarget.replace(/\\/g, '/').replace(/\/$/, '');
  if (targetIsDirectory) return normalizedNodeFile === normalizedTarget || normalizedNodeFile.startsWith(`${normalizedTarget}/`);
  return normalizedNodeFile === normalizedTarget || normalizedNodeFile.endsWith(`/${normalizedTarget}`) || normalizedTarget.endsWith(normalizedNodeFile);
}
