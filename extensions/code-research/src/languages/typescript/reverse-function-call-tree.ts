import { stat } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import type { CallTreeNode, FunctionCallTreeInput, FunctionCallTreeResult } from '../../types.js';
import { extractSignature, resolveTypeScriptProjectRoot } from './shared.js';
import {
  buildTypeScriptProjectIndex,
  extractCalls,
  resolveCall,
  type IndexedCallable,
  type ResolvedTarget,
  type TypeScriptProjectIndex,
} from './function-call-tree.js';

interface ReverseEdge {
  caller: IndexedCallable;
  callsite: { text: string; line: number; column: number; receiver?: string };
  resolved: ResolvedTarget;
}

export async function executeTypeScriptReverseFunctionCallTree(
  cwd: string,
  input: FunctionCallTreeInput
): Promise<
  | {
      status: 'ok';
      rootClassName: string;
      result: FunctionCallTreeResult;
    }
  | {
      status: 'not_found';
      message: string;
      details: { found: 0 };
    }
  | {
      status: 'ambiguous';
      message: string;
      details: { candidates: Array<{ className: string; symbol: string; file: string; line: number }> };
    }
> {
  const rootPath = resolve(cwd, input.path);
  const rootStat = await stat(rootPath).catch(() => undefined);
  const indexRoot = await resolveTypeScriptProjectRoot(rootPath, rootStat?.isDirectory() ?? false);
  const index = await buildTypeScriptProjectIndex(indexRoot);

  const candidates = index.callables.filter((callable) => {
    if (callable.symbol !== input.symbol) return false;
    if (!rootStat?.isDirectory() && callable.file !== rootPath) return false;
    if (input.kind && input.kind !== callable.kind) return false;
    return true;
  });

  if (candidates.length === 0) {
    return {
      status: 'not_found',
      message: `No callable '${input.symbol}' found in ${input.path}`,
      details: { found: 0 },
    };
  }

  if (candidates.length > 1) {
    return {
      status: 'ambiguous',
      message:
        `Multiple callables named '${input.symbol}' found. Please disambiguate with kind or a more specific path:\n` +
        candidates
          .map((candidate) => `  - ${formatOwner(candidate)}.${candidate.symbol} at ${candidate.file}:${candidate.line}`)
          .join('\n'),
      details: {
        candidates: candidates.map((candidate) => ({
          className: formatOwner(candidate),
          symbol: candidate.symbol,
          file: candidate.file,
          line: candidate.line,
        })),
      },
    };
  }

  const rootCallable = candidates[0];
  return {
    status: 'ok',
    rootClassName: formatOwner(rootCallable),
    result: buildReverseCallTree({
      index,
      callable: rootCallable,
      maxDepth: input.max_depth ?? 10,
    }),
  };
}

export function buildReverseCallTree(options: {
  index: TypeScriptProjectIndex;
  callable: IndexedCallable;
  maxDepth: number;
}): FunctionCallTreeResult {
  const reverseEdges = buildReverseEdgeMap(options.index);
  const root = buildReverseNode({
    index: options.index,
    callable: options.callable,
    maxDepth: options.maxDepth,
    reverseEdges,
    depth: 0,
    visited: new Set(),
  });

  const stats = {
    total_nodes: 0,
    application_nodes: 0,
    external_nodes: 0,
    max_depth_reached: 0,
  };

  countNodes(root, 0, stats);
  return { root, stats };
}

function buildReverseEdgeMap(index: TypeScriptProjectIndex): Map<string, ReverseEdge[]> {
  const reverseEdges = new Map<string, ReverseEdge[]>();

  for (const caller of index.callables) {
    for (const call of extractCalls(caller.node)) {
      const resolved = resolveCall(index, caller, call);
      if (!resolved.callable) continue;
      const key = callableKey(resolved.callable);
      const list = reverseEdges.get(key) ?? [];
      list.push({
        caller,
        callsite: { text: call.text, line: call.line, column: call.column, receiver: call.receiver },
        resolved,
      });
      reverseEdges.set(key, list);
    }
  }

  return reverseEdges;
}

function buildReverseNode(options: {
  index: TypeScriptProjectIndex;
  callable: IndexedCallable;
  maxDepth: number;
  reverseEdges: Map<string, ReverseEdge[]>;
  depth: number;
  visited: Set<string>;
  inbound?: ReverseEdge;
}): CallTreeNode {
  const { callable, maxDepth, reverseEdges, depth, visited, inbound } = options;
  const node: CallTreeNode = {
    file: callable.file,
    symbol: callable.symbol,
    kind: callable.kind,
    node_type: 'application',
    class: callable.ownerName,
    owner_kind: callable.ownerKind,
    line: callable.line,
    column: callable.column,
    start_line: callable.line,
    start_column: callable.column,
    end_line: callable.node.endPosition.row + 1,
    end_column: callable.node.endPosition.column,
    signature: extractSignature(callable.node),
    called_as: inbound?.callsite.text,
    receiver_name: inbound?.callsite.receiver,
    receiver_type: inbound?.resolved.receiverType,
    call_line: inbound?.callsite.line,
    call_column: inbound?.callsite.column,
    is_application: true,
    is_external: false,
    source: 'application',
  };

  const key = callableKey(callable);
  if (visited.has(key) || depth >= maxDepth) return node;
  visited.add(key);

  const callers = reverseEdges.get(key) ?? [];
  if (callers.length > 0) {
    node.callers = callers.map((edge) =>
      buildReverseNode({
        ...options,
        callable: edge.caller,
        depth: depth + 1,
        inbound: edge,
      })
    );
  }

  return node;
}

function countNodes(node: CallTreeNode, depth: number, stats: FunctionCallTreeResult['stats']): void {
  stats.total_nodes += 1;
  if (node.is_application) stats.application_nodes += 1;
  if (node.is_external) stats.external_nodes += 1;
  stats.max_depth_reached = Math.max(stats.max_depth_reached, depth);

  for (const caller of node.callers ?? []) {
    countNodes(caller, depth + 1, stats);
  }
}

function callableKey(callable: IndexedCallable): string {
  return `${callable.file}:${callable.ownerName ?? '<module>'}:${callable.kind}:${callable.symbol}`;
}

function formatOwner(callable: IndexedCallable): string {
  return callable.ownerName ?? basename(callable.file, extname(callable.file));
}
