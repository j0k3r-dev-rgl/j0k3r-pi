import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { CallTreeNode, FunctionCallTreeInput, FunctionCallTreeResult } from '../../types.js';
import { buildProjectIndex, type IndexedMethod, type ProjectIndex } from '../../core/project-index.js';
import { extractSignature } from './shared.js';
import { resolveJavaCallsForGraph, resolveJavaIndexRoot, type MethodCall, type ResolvedCall } from './function-call-tree.js';

interface ReverseEdge {
  caller: IndexedMethod;
  call: MethodCall;
  resolved: ResolvedCall;
}

export async function executeJavaReverseFunctionCallTree(
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
  const rootFile = resolve(cwd, input.path);
  const rootStat = await stat(rootFile).catch(() => undefined);
  const indexRoot = rootStat?.isDirectory() ? rootFile : await resolveJavaIndexRoot(rootFile);
  const index = await buildProjectIndex(indexRoot);

  const candidates = index.methods.filter(
    (method) => method.symbol === input.symbol && (rootStat?.isDirectory() || method.file === rootFile) && (!input.kind || input.kind === 'method')
  );

  if (candidates.length === 0) {
    return {
      status: 'not_found',
      message: `No method '${input.symbol}' found in ${input.path}`,
      details: { found: 0 },
    };
  }

  if (candidates.length > 1) {
    return {
      status: 'ambiguous',
      message:
        `Multiple methods named '${input.symbol}' found. Please disambiguate with kind or a more specific path:\n` +
        candidates.map((candidate) => `  - ${candidate.className}.${candidate.symbol} at ${candidate.file}:${candidate.line}`).join('\n'),
      details: {
        candidates: candidates.map((candidate) => ({
          className: candidate.className,
          symbol: candidate.symbol,
          file: candidate.file,
          line: candidate.line,
        })),
      },
    };
  }

  const rootMethod = candidates[0];
  return {
    status: 'ok',
    rootClassName: rootMethod.className,
    result: buildReverseCallTree({
      index,
      rootMethod,
      maxDepth: input.max_depth ?? 10,
    }),
  };
}

export function buildReverseCallTree(options: {
  index: ProjectIndex;
  rootMethod: IndexedMethod;
  maxDepth: number;
}): FunctionCallTreeResult {
  const reverseEdges = buildReverseEdgeMap(options.index);
  const root = buildReverseNode({
    method: options.rootMethod,
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

function buildReverseEdgeMap(index: ProjectIndex): Map<string, ReverseEdge[]> {
  const reverseEdges = new Map<string, ReverseEdge[]>();

  for (const caller of index.methods) {
    for (const resolvedCall of resolveJavaCallsForGraph(caller, index)) {
      if (!resolvedCall.targetMethod || !resolvedCall.resolved) continue;
      const key = methodKey(resolvedCall.targetMethod);
      const list = reverseEdges.get(key) ?? [];
      list.push({
        caller,
        call: resolvedCall.call,
        resolved: resolvedCall.resolved,
      });
      reverseEdges.set(key, list);
    }
  }

  return reverseEdges;
}

function buildReverseNode(options: {
  method: IndexedMethod;
  maxDepth: number;
  reverseEdges: Map<string, ReverseEdge[]>;
  depth: number;
  visited: Set<string>;
  inbound?: ReverseEdge;
}): CallTreeNode {
  const { method, maxDepth, reverseEdges, depth, visited, inbound } = options;
  const node: CallTreeNode = {
    file: method.file,
    symbol: method.symbol,
    kind: 'method',
    node_type: 'application',
    class: method.className,
    package: method.package,
    owner_kind: 'class',
    line: method.line,
    column: method.column,
    start_line: method.line,
    start_column: method.column,
    end_line: method.node.endPosition.row + 1,
    end_column: method.node.endPosition.column,
    signature: extractSignature(method.node),
    called_as: inbound?.call.callText,
    receiver_name: inbound?.call.object,
    receiver_type: inbound?.resolved.receiverType,
    call_line: inbound?.call.line,
    call_column: inbound?.call.column,
    is_application: true,
    is_external: false,
    source: 'application',
  };

  const key = methodKey(method);
  if (visited.has(key) || depth >= maxDepth) return node;
  visited.add(key);

  const callers = reverseEdges.get(key) ?? [];
  if (callers.length > 0) {
    node.callers = callers.map((edge) =>
      buildReverseNode({
        ...options,
        method: edge.caller,
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

function methodKey(method: IndexedMethod): string {
  return `${method.file}:${method.className}:${method.symbol}`;
}
