import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { CallTreeNode, FunctionCallTreeInput, FunctionCallTreeResult } from '../../types.js';
import { buildGoProjectIndex, extractCalls, resolveGoCall, type GoCallable, type GoProjectIndex } from './workspace-graph.js';

export async function executeGoFunctionCallTree(
  cwd: string,
  input: FunctionCallTreeInput
): Promise<
  | { status: 'ok'; rootClassName: string; result: FunctionCallTreeResult }
  | { status: 'not_found'; message: string; details: { found: 0 } }
  | { status: 'ambiguous'; message: string; details: { candidates: Array<{ className: string; symbol: string; file: string; line: number }> } }
> {
  const rootPath = resolve(cwd, input.path);
  const rootStat = await stat(rootPath).catch(() => undefined);
  const index = await buildGoProjectIndex(rootStat?.isDirectory() ? rootPath : resolve(rootPath, '..'));
  const candidates = index.callables.filter((callable) => callable.symbol === input.symbol && (!input.kind || input.kind === callable.kind) && (rootStat?.isDirectory() || callable.file === rootPath));
  if (candidates.length === 0) return { status: 'not_found', message: `No Go callable '${input.symbol}' found in ${input.path}`, details: { found: 0 } };
  if (candidates.length > 1) {
    return { status: 'ambiguous', message: `Multiple Go callables named '${input.symbol}' found.`, details: { candidates: candidates.map((candidate) => ({ className: candidate.ownerName ?? '<package>', symbol: candidate.symbol, file: candidate.file, line: candidate.line })) } };
  }
  const root = buildNode(index, candidates[0], input.max_depth ?? 10, input.include_external ?? false, 0, new Set());
  const stats = { total_nodes: 0, application_nodes: 0, external_nodes: 0, max_depth_reached: 0 };
  countNodes(root, 0, stats);
  return { status: 'ok', rootClassName: candidates[0].ownerName ?? candidates[0].packageName, result: { root, stats } };
}

export function buildGoCallTree(index: GoProjectIndex, rootCallable: GoCallable, maxDepth: number, includeExternal: boolean): FunctionCallTreeResult {
  const root = buildNode(index, rootCallable, maxDepth, includeExternal, 0, new Set());
  const stats = { total_nodes: 0, application_nodes: 0, external_nodes: 0, max_depth_reached: 0 };
  countNodes(root, 0, stats);
  return { root, stats };
}

function buildNode(index: GoProjectIndex, callable: GoCallable, maxDepth: number, includeExternal: boolean, depth: number, visited: Set<string>): CallTreeNode {
  const node: CallTreeNode = {
    file: callable.file,
    symbol: callable.symbol,
    kind: callable.kind === 'function' ? 'function' : 'method',
    node_type: 'application',
    class: callable.ownerName,
    package: callable.packageName,
    owner_kind: callable.ownerName ? 'class' : 'module',
    line: callable.line,
    column: callable.column,
    start_line: callable.line,
    start_column: callable.column,
    end_line: callable.node.endPosition.row + 1,
    end_column: callable.node.endPosition.column,
    signature: callable.signature,
    is_application: true,
    is_external: false,
    source: 'application',
  };
  if (visited.has(callable.symbolId) || depth >= maxDepth) return node;
  visited.add(callable.symbolId);
  const children: CallTreeNode[] = [];
  for (const call of extractCalls(callable.node)) {
    const resolved = resolveGoCall(index, callable, call);
    if (resolved.callable) {
      const child = buildNode(index, resolved.callable, maxDepth, includeExternal, depth + 1, visited);
      child.called_as = call.text;
      child.receiver_name = call.receiver;
      child.receiver_type = resolved.receiverType;
      child.call_line = call.line;
      child.call_column = call.column;
      children.push(child);
    } else if (includeExternal) {
      children.push({ symbol: call.symbol, kind: call.receiver ? 'method' : 'function', node_type: 'external', called_as: call.text, receiver_name: call.receiver, receiver_type: resolved.receiverType, call_line: call.line, call_column: call.column, is_application: false, is_external: true, source: resolved.source, reason: resolved.reason });
    }
  }
  if (children.length > 0) node.children = children;
  return node;
}

function countNodes(node: CallTreeNode, depth: number, stats: FunctionCallTreeResult['stats']): void {
  stats.total_nodes += 1;
  if (node.is_application) stats.application_nodes += 1;
  if (node.is_external) stats.external_nodes += 1;
  stats.max_depth_reached = Math.max(stats.max_depth_reached, depth);
  for (const child of node.children ?? []) countNodes(child, depth + 1, stats);
}
