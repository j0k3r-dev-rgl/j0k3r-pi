import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { CallTreeNode, FunctionCallTreeInput, FunctionCallTreeResult, ReferenceLocation } from '../types.js';
import { executeJavaReverseFunctionCallTree } from '../languages/java/reverse-function-call-tree.js';
import { executeGoReverseFunctionCallTree } from '../languages/go/reverse-function-call-tree.js';
import { executeTypeScriptReverseFunctionCallTree } from '../languages/typescript/reverse-function-call-tree.js';
import { loadCodeResearchConfig } from '../config.js';
import { readWorkspaceGraphManifest, readWorkspaceGraphState } from './graph-persistence.js';
import { evaluateGraphUsability } from './graph-policy.js';
import { queryReverseFunctionCallTreeFromGraph } from './reverse-graph-queries.js';
import { resolveFindReferences } from './find-references-resolver.js';
import { findTypeScriptReferences } from '../languages/typescript/find-references.js';

export type ReverseFunctionCallTreeExecutionResult =
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
    };

export async function executeReverseFunctionCallTree(
  cwd: string,
  input: FunctionCallTreeInput
): Promise<ReverseFunctionCallTreeExecutionResult> {
  const graphResult = await tryGraphBackedReverseFunctionCallTree(cwd, input);
  if (graphResult) {
    if (input.language !== 'ts' && input.language !== 'js') {
      return { status: 'ok', ...graphResult };
    }
    const referenceBacked = await tryReferenceBackedReverseFunctionCallTree(cwd, input, graphResult.result);
    if (referenceBacked) return { status: 'ok', rootClassName: graphResult.rootClassName, result: referenceBacked };
    return { status: 'ok', ...graphResult };
  }

  const language = input.language ?? 'java';

  switch (language) {
    case 'java':
      return executeJavaReverseFunctionCallTree(cwd, input);
    case 'ts':
    case 'js': {
      const direct = await executeTypeScriptReverseFunctionCallTree(cwd, input);
      if (direct.status !== 'ok') return direct;
      const interfaceOwner = await getInterfaceMethodOwner(cwd, input);
      if (hasIncomingCallers(direct.result) && !interfaceOwner) return direct;
      const referenceBacked = await tryReferenceBackedReverseFunctionCallTree(cwd, input, direct.result);
      return referenceBacked ? { ...direct, result: referenceBacked } : direct;
    }
    case 'go':
      return executeGoReverseFunctionCallTree(cwd, input as any);
    case 'auto':
      throw new Error('reverse_function_call_tree does not support auto language detection yet');
    default:
      throw new Error(`Unsupported language: ${language}`);
  }
}

function hasIncomingCallers(result: FunctionCallTreeResult): boolean {
  return Array.isArray(result.root.callers) && result.root.callers.length > 0;
}

async function tryReferenceBackedReverseFunctionCallTree(cwd: string, input: FunctionCallTreeInput, graphResult: FunctionCallTreeResult): Promise<FunctionCallTreeResult | undefined> {
  const interfaceOwner = await getInterfaceMethodOwner(cwd, input);
  const referenceInput = {
    path: input.path,
    symbol: input.symbol,
    language: input.language,
    kind: input.kind as any,
    reference_kinds: ['call' as const],
  };
  const references = input.language === 'ts' || input.language === 'js'
    ? await findTypeScriptReferences(cwd, referenceInput).catch(() => [] as ReferenceLocation[])
    : await resolveFindReferences(cwd, referenceInput).then((result) => result.results).catch(() => [] as ReferenceLocation[]);
  const usableReferences = interfaceOwner
    ? references.filter((reference) => reference.reason === 'receiver-type-contract-method' && (!reference.receiver_type || reference.receiver_type === interfaceOwner))
    : references;
  const existingCallers = interfaceOwner
    ? (graphResult.root.callers ?? []).filter((caller) => caller.reason === 'receiver-type-contract-method' && (!caller.receiver_type || caller.receiver_type === interfaceOwner))
    : (graphResult.root.callers ?? []);
  if (usableReferences.length === 0 && existingCallers.length === 0) return undefined;
  const callers = mergeCallerNodes([...existingCallers, ...usableReferences.map(referenceToCallerNode)], cwd);
  const result: FunctionCallTreeResult = {
    root: { ...graphResult.root, callers },
    stats: { total_nodes: 1 + callers.length, application_nodes: 1 + callers.length, external_nodes: 0, max_depth_reached: callers.length > 0 ? 1 : 0 },
  };
  return result;
}

async function getInterfaceMethodOwner(cwd: string, input: FunctionCallTreeInput): Promise<string | undefined> {
  if (input.kind !== 'method') return undefined;
  const source = await readFile(resolve(cwd, input.path), 'utf8').catch(() => '');
  const match = source.match(new RegExp(`interface\\s+([A-Za-z_$][\\w$]*)[^{]*{[\\s\\S]*?\\b${escapeRegExp(input.symbol)}\\s*\\(`));
  return match?.[1];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function referenceToCallerNode(reference: ReferenceLocation): CallTreeNode {
  return {
    file: reference.file,
    symbol: reference.context_symbol ?? '<top-level>',
    kind: reference.context_kind ?? 'function',
    node_type: 'application',
    class: reference.context_class,
    owner_kind: reference.owner_kind ?? 'module',
    line: reference.line,
    column: reference.column,
    start_line: reference.line,
    start_column: reference.column,
    end_line: reference.end_line ?? reference.line,
    end_column: reference.end_column ?? reference.column,
    called_as: reference.called_as,
    receiver_name: reference.receiver_name,
    receiver_type: reference.receiver_type,
    call_line: reference.line,
    call_column: reference.column,
    is_application: true,
    is_external: false,
    source: 'application',
    reason: reference.reason,
  };
}

function mergeCallerNodes(callers: CallTreeNode[], cwd: string): CallTreeNode[] {
  const byKey = new Map<string, CallTreeNode>();
  for (const caller of callers) {
    const key = [normalizeCallerFile(caller.file, cwd), caller.symbol, caller.class].join('::');
    const existing = byKey.get(key);
    if (!existing || callerMetadataScore(caller) > callerMetadataScore(existing)) byKey.set(key, caller);
  }
  return [...byKey.values()];
}

function normalizeCallerFile(file: string | undefined, cwd: string): string | undefined {
  if (!file) return file;
  const normalized = file.replace(/\\/g, '/');
  const normalizedCwd = cwd.replace(/\\/g, '/').replace(/\/$/, '');
  return normalized.startsWith(`${normalizedCwd}/`) ? normalized.slice(normalizedCwd.length + 1) : normalized;
}

function callerMetadataScore(caller: CallTreeNode): number {
  return [caller.receiver_name, caller.receiver_type, caller.called_as, caller.reason, caller.end_line, caller.end_column].filter((value) => value !== undefined && value !== '').length + ((caller.callers?.length ?? 0) * 2);
}

async function tryGraphBackedReverseFunctionCallTree(cwd: string, input: FunctionCallTreeInput) {
  const config = await loadCodeResearchConfig(cwd);
  if (!config.graph.enable) return undefined;

  const state = await readWorkspaceGraphState(cwd);
  const manifest = await readWorkspaceGraphManifest(cwd);
  const decision = evaluateGraphUsability({
    graphEnabled: true,
    query: 'reverse_function_call_tree',
    stateReadStatus: state.status,
    manifestReadStatus: manifest.status,
    stateStatus: state.status === 'ok' ? state.data.status : undefined,
    language: input.language,
    targetPath: input.path,
  });
  if (!decision.usable || state.status !== 'ok' || manifest.status !== 'ok') return undefined;

  return queryReverseFunctionCallTreeFromGraph({
    cwd,
    input,
    state: state.data,
    manifest: manifest.data,
    policy: { allowStale: false },
  });
}
