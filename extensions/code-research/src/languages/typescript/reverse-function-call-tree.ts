import { stat } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import type { CallTreeNode, FunctionCallTreeInput, FunctionCallTreeResult } from '../../types.js';
import { extractSignature, resolveTypeScriptImportCandidates, resolveTypeScriptProjectRoot } from './shared.js';
import {
  buildTypeScriptProjectIndex,
  extractCalls,
  resolveCall,
  type IndexedCallable,
  type IndexedClass,
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

  for (const edge of [...buildTopLevelReverseEdges(index), ...buildReceiverHeuristicReverseEdges(index)]) {
    const key = callableKey(edge.resolved.callable!);
    const list = reverseEdges.get(key) ?? [];
    if (!list.some((existing) => reverseEdgeKey(existing) === reverseEdgeKey(edge))) list.push(edge);
    reverseEdges.set(key, list);
  }

  for (const caller of index.callables) {
    for (const call of extractCalls(caller.node)) {
      const resolved = resolveCall(index, caller, call);
      if (!resolved.callable) continue;
      const key = callableKey(resolved.callable);
      const list = reverseEdges.get(key) ?? [];
      const edge = {
        caller,
        callsite: { text: call.text, line: call.line, column: call.column, receiver: call.receiver },
        resolved,
      };
      if (!list.some((existing) => reverseEdgeKey(existing) === reverseEdgeKey(edge))) list.push(edge);
      reverseEdges.set(key, list);
    }
  }

  return reverseEdges;
}

function reverseEdgeKey(edge: ReverseEdge): string {
  return `${callableKey(edge.resolved.callable!)}::${callableKey(edge.caller)}::${edge.callsite.line}:${edge.callsite.column}`;
}

function buildTopLevelReverseEdges(index: TypeScriptProjectIndex): ReverseEdge[] {
  const edges: ReverseEdge[] = [];
  const topLevelCallers = new Map<string, IndexedCallable>();
  const getTopLevelCaller = (file: string): IndexedCallable => {
    const existing = topLevelCallers.get(file);
    if (existing) return existing;
    const indexedFile = index.files.get(file)!;
    const caller: IndexedCallable = {
      file,
      language: indexedFile.language,
      symbol: '<top-level>',
      kind: 'function',
      ownerKind: 'module',
      line: 1,
      column: 0,
      node: indexedFile.rootNode,
    };
    topLevelCallers.set(file, caller);
    return caller;
  };

  for (const target of index.callables.filter((callable) => callable.kind === 'function' && !callable.ownerName)) {
    for (const file of index.files.values()) {
      const localNames = new Set<string>();
      if (file.file === target.file) localNames.add(target.symbol);
      for (const binding of file.imports.values()) {
        const resolved = resolveImportedFunction(index, file.file, binding);
        if (resolved && callableKey(resolved) === callableKey(target)) localNames.add(binding.localName);
      }
      for (const localName of localNames) {
        const pattern = new RegExp(`\\b${escapeRegExp(localName)}\\s*\\(`, 'g');
        for (const match of findAllRegexPositions(file.source, pattern)) {
          if (isInsideIndexedCallable(index, file.file, match.line)) continue;
          edges.push({
            caller: getTopLevelCaller(file.file),
            callsite: { text: extractLineCallText(file.source, match.line, match.column), line: match.line, column: match.column },
            resolved: { callable: target, source: 'application' },
          });
        }
      }
    }
  }
  return edges;
}

function buildReceiverHeuristicReverseEdges(index: TypeScriptProjectIndex): ReverseEdge[] {
  const edges: ReverseEdge[] = [];
  const topLevelCallers = new Map<string, IndexedCallable>();
  const getTopLevelCaller = (file: string): IndexedCallable => {
    const existing = topLevelCallers.get(file);
    if (existing) return existing;
    const indexedFile = index.files.get(file)!;
    const caller: IndexedCallable = { file, language: indexedFile.language, symbol: '<top-level>', kind: 'function', ownerKind: 'module', line: 1, column: 0, node: indexedFile.rootNode };
    topLevelCallers.set(file, caller);
    return caller;
  };

  for (const target of index.callables.filter((callable) => callable.kind === 'method' && callable.ownerName)) {
    const ownerName = target.ownerName!;
    for (const file of index.files.values()) {
      const receivers = collectReceiversForClass(index, file, ownerName);
      for (const receiver of receivers) {
        const pattern = new RegExp(`\\b${escapeRegExp(receiver)}\\s*\\.\\s*${escapeRegExp(target.symbol)}\\s*\\(`, 'g');
        for (const match of findAllRegexPositions(file.source, pattern)) {
          const caller = findEnclosingCallable(index, file.file, match.line) ?? getTopLevelCaller(file.file);
          edges.push({
            caller,
            callsite: { text: extractLineCallText(file.source, match.line, match.column), line: match.line, column: match.column, receiver },
            resolved: { callable: target, className: ownerName, ownerKind: 'class', receiverType: ownerName, source: 'application' },
          });
        }
      }
    }
  }

  return edges;
}

function collectReceiversForClass(index: TypeScriptProjectIndex, file: { file: string; source: string; imports: Map<string, any> }, className: string): Set<string> {
  const receivers = new Set<string>();
  const localClassNames = new Set<string>([className]);
  for (const binding of file.imports.values()) {
    const resolved = resolveImportedClass(index, file.file, binding);
    if (resolved?.className === className) localClassNames.add(binding.localName);
  }
  for (const localClassName of localClassNames) {
    for (const match of file.source.matchAll(new RegExp(`\\b(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*(?::\\s*${escapeRegExp(localClassName)}\\b)?\\s*=\\s*[^;\n]*new\\s+${escapeRegExp(localClassName)}\\s*\\(`, 'g'))) {
      if (match[1]) receivers.add(match[1]);
    }
    for (const match of file.source.matchAll(new RegExp(`\\b(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*:\\s*${escapeRegExp(localClassName)}\\b`, 'g'))) {
      if (match[1]) receivers.add(match[1]);
    }
    for (const match of file.source.matchAll(new RegExp(`\\b([A-Za-z_$][\\w$]*)\\??\\s*:\\s*${escapeRegExp(localClassName)}\\b`, 'g'))) {
      if (match[1] && !['const', 'let', 'var'].includes(match[1])) receivers.add(match[1]);
    }
  }
  return receivers;
}

function findEnclosingCallable(index: TypeScriptProjectIndex, file: string, line: number): IndexedCallable | undefined {
  return index.callables.find((callable) => callable.file === file && callable.line <= line && callable.node.endPosition.row + 1 >= line);
}

function resolveImportedClass(index: TypeScriptProjectIndex, currentFile: string, binding: any): IndexedClass | undefined {
  if (binding.kind === 'namespace') return undefined;
  const candidates = resolveTypeScriptImportCandidates(currentFile, binding.source, index.projectConfig);
  const targetFile = candidates.find((candidate) => index.files.has(candidate));
  return targetFile ? index.classes.find((item) => item.file === targetFile && item.exportedName === binding.importedName) : undefined;
}

function resolveImportedFunction(index: TypeScriptProjectIndex, currentFile: string, binding: any): IndexedCallable | undefined {
  if (binding.kind === 'namespace') return undefined;
  const candidates = resolveTypeScriptImportCandidates(currentFile, binding.source, index.projectConfig);
  const targetFile = candidates.find((candidate) => index.files.has(candidate));
  return targetFile ? index.callables.find((item) => item.file === targetFile && item.exportedName === binding.importedName) : undefined;
}

function isInsideIndexedCallable(index: TypeScriptProjectIndex, file: string, line: number): boolean {
  return index.callables.some((callable) => callable.file === file && callable.line <= line && callable.node.endPosition.row + 1 >= line);
}

function findAllRegexPositions(source: string, pattern: RegExp): Array<{ line: number; column: number }> {
  const results: Array<{ line: number; column: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const prefix = source.slice(0, match.index);
    const lines = prefix.split('\n');
    results.push({ line: lines.length, column: lines[lines.length - 1].length });
  }
  return results;
}

function extractLineCallText(source: string, line: number, column: number): string {
  const lineText = source.split('\n')[line - 1] ?? '';
  return (lineText.slice(column).match(/^[^;\n]+/)?.[0] ?? '').trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
