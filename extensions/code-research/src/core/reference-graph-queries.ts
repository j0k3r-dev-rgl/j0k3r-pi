import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { FindReferencesInput, GraphEdge, GraphLookupPolicy, GraphManifest, GraphNode, ReferenceLocation, WorkspaceGraphState } from '../types.js';
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
      const shard = await readSubprojectGraphShard(cwd, subproject.id, { generation: subproject.generation });
      return shard.status === 'ok' ? shard.data : undefined;
    })
  );

  const allShards = shards.filter(Boolean);
  if (allShards.length === 0) return undefined;

  const targetPath = resolve(cwd, input.path);
  const targetStat = await stat(targetPath).catch(() => undefined);
  const targetIsDirectory = input.scope === 'directory' || targetStat?.isDirectory() === true;
  const relativeTarget = (targetPath.startsWith(cwd) ? targetPath.slice(cwd.length + 1).replace(/\\/g, '/') : input.path.replace(/\\/g, '/')).replace(/\/$/, '');
  const allNodes = allShards.flatMap((shard) => shard!.nodes);
  const allEdges = allShards.flatMap((shard) => shard!.edges);
  const symbolNodes = allNodes.filter((node): node is Extract<(typeof allNodes)[number], { kind: 'symbol' }> => node.kind === 'symbol' && matchesLanguage(node.language, input.language));

  const targets = symbolNodes.filter((node) => {
    if (node.name !== input.symbol) return false;
    if (input.kind && node.symbolKind !== input.kind) return false;
    return matchesTargetFile(node.file, relativeTarget, targetIsDirectory);
  });
  if (targets.length === 0) return [];
  const target = targets[0];
  const targetIds = new Set(targets.map((node) => node.id));
  const targetRelationshipIds = new Set(targets.map((node) => node.relationshipId).filter((value): value is string => Boolean(value)));
  const interfaceMethodTargets = targets.filter((node) => node.symbolKind === 'method' && node.ownerKind === 'interface');

  const nodeById = new Map<string, GraphNode>(allNodes.map((node) => [node.id, node]));
  const references: ReferenceLocation[] = [];
  const sourceCache = new Map<string, string>();

  const requestedKinds = new Set(input.reference_kinds ?? []);
  for (const edge of allEdges) {
    if (!(edge.kind === 'imports' || edge.kind === 'calls' || edge.kind === 'reads' || edge.kind === 'implements' || edge.kind === 'extends')) continue;
    const referenceKind = graphEdgeReferenceKind(edge);
    if (requestedKinds.size > 0 && !requestedKinds.has(referenceKind)) continue;
    const toNode = nodeById.get(edge.to);
    const matchesTarget =
      targetIds.has(edge.to) ||
      ((edge.kind === 'implements' || edge.kind === 'extends') && targets.some((candidate) => edge.to === `external:java:${candidate.name}` || edge.to === `external:java:${candidate.qualifiedName ?? candidate.name}`)) ||
      (edge.kind === 'calls' && edge.targetRelationshipId !== undefined && targetRelationshipIds.has(edge.targetRelationshipId)) ||
      (edge.kind === 'calls' && toNode?.kind === 'symbol' && interfaceMethodTargets.some((candidate) => toNode.name === candidate.name && receiverMatchesInterface(edge.callsite?.receiverType, candidate.owner)));
    if (!matchesTarget) continue;
    const fromNode = nodeById.get(edge.from);
    if (!fromNode || (fromNode.kind !== 'symbol' && fromNode.kind !== 'file')) continue;

    const isTypeRelationship = referenceKind === 'extends' || referenceKind === 'implements';
    const sourceFile = resolve(cwd, fromNode.kind === 'file' ? fromNode.path : fromNode.file);
    const fallbackRange = fromNode.kind === 'symbol' ? fromNode.range : { startLine: 1, startColumn: 0, endLine: 1, endColumn: 0 };
    const relationshipMetadata = isTypeRelationship
      ? edge.calledAs && edge.occurrenceRange
        ? { end_line: edge.occurrenceRange.endLine, end_column: edge.occurrenceRange.endColumn, called_as: edge.calledAs }
        : await getJavaTypeRelationshipMetadata(sourceCache, sourceFile, fallbackRange.startLine, referenceKind, target.name).catch(() => undefined)
      : undefined;
    const line = isTypeRelationship ? edge.occurrenceRange?.startLine ?? fallbackRange.startLine : edge.callsite?.line ?? edge.occurrenceRange?.startLine ?? fallbackRange.startLine;
    const column = isTypeRelationship
      ? 0
      : referenceKind === 'instantiate' && edge.calledAs?.startsWith('new ')
        ? Math.max(0, (edge.occurrenceRange?.startColumn ?? fallbackRange.startColumn) - 4)
        : edge.callsite?.column ?? edge.occurrenceRange?.startColumn ?? fallbackRange.startColumn;
    const calledAs = isTypeRelationship
      ? relationshipMetadata?.called_as
      : referenceKind === 'instantiate'
        ? undefined
        : edge.calledAs ?? (edge.callsite as { text?: string } | undefined)?.text ?? (target.symbolKind === 'method'
          ? await getCallExpressionText(sourceCache, sourceFile, line, column, target.name).catch(() => undefined)
          : undefined);
    references.push({
      file: sourceFile,
      line,
      column,
      end_line: isTypeRelationship ? relationshipMetadata?.end_line : edge.occurrenceRange?.endLine ?? fallbackRange.endLine,
      end_column: isTypeRelationship ? relationshipMetadata?.end_column : edge.occurrenceRange?.endColumn ?? fallbackRange.endColumn,
      symbol: target.name,
      kind: target.symbolKind,
      context_symbol: fromNode.kind === 'symbol' ? fromNode.name : undefined,
      context_kind: fromNode.kind === 'symbol' ? fromNode.symbolKind : undefined,
      context_class: fromNode.kind === 'symbol' ? (isTypeRelationship ? fromNode.name : fromNode.owner) : undefined,
      owner_kind: fromNode.kind === 'symbol' ? (isTypeRelationship ? (fromNode.symbolKind === 'interface' ? 'interface' : 'class') : fromNode.ownerKind ?? 'unknown') : 'unknown',
      reference_kind: referenceKind,
      called_as: calledAs,
      receiver_name: edge.callsite?.receiverName,
      receiver_type: edge.callsite?.receiverType,
      is_application: true,
      source: 'application',
      reason: edge.reason,
    });
  }

  return references;
}

function graphEdgeReferenceKind(edge: GraphEdge): ReferenceLocation['reference_kind'] {
  if (edge.kind === 'calls') return 'call';
  if (edge.kind === 'imports') return 'import';
  if (edge.kind === 'implements') return 'implements';
  if (edge.kind === 'extends') return 'extends';
  if (edge.reason === 'java_type_reference') return 'type_reference';
  if (edge.reason === 'java_instantiate') return 'instantiate';
  return 'read';
}

async function getJavaTypeRelationshipMetadata(
  sourceCache: Map<string, string>,
  file: string,
  line: number,
  relationship: 'extends' | 'implements',
  targetName: string
): Promise<Pick<ReferenceLocation, 'end_line' | 'end_column' | 'called_as'> | undefined> {
  if (!sourceCache.has(file)) sourceCache.set(file, await readFile(file, 'utf8'));
  const lineText = sourceCache.get(file)?.split('\n')[line - 1];
  if (!lineText) return undefined;
  const match = lineText.match(new RegExp(`\\b${relationship}\\s+[^\\{]*?\\b${escapeRegExp(targetName)}(?:\\b|\\s*<)`));
  if (!match || match.index === undefined) return undefined;
  return {
    end_line: line,
    end_column: match.index + match[0].length,
    called_as: match[0].trim().replace(/\s+</g, '<'),
  };
}

async function getCallExpressionText(
  sourceCache: Map<string, string>,
  file: string,
  line: number,
  column: number,
  targetName: string
): Promise<string | undefined> {
  if (!sourceCache.has(file)) sourceCache.set(file, await readFile(file, 'utf8'));
  const lineText = sourceCache.get(file)?.split('\n')[line - 1];
  if (!lineText) return undefined;

  const searchStart = Math.max(0, column - targetName.length - 8);
  let symbolStart = lineText.indexOf(targetName, searchStart);
  if (symbolStart < 0) symbolStart = lineText.indexOf(targetName);
  if (symbolStart < 0) return undefined;

  let start = symbolStart;
  while (start > 0 && /[A-Za-z0-9_$?.]/.test(lineText[start - 1] ?? '')) start -= 1;

  const openParen = lineText.indexOf('(', symbolStart + targetName.length);
  if (openParen < 0) return lineText.slice(start, symbolStart + targetName.length).trim();

  let depth = 0;
  for (let index = openParen; index < lineText.length; index += 1) {
    const char = lineText[index];
    if (char === '(') depth += 1;
    if (char === ')') {
      depth -= 1;
      if (depth === 0) return lineText.slice(start, index + 1).trim();
    }
  }
  return lineText.slice(start).trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function receiverMatchesInterface(receiverType: string | undefined, interfaceOwner: string | undefined): boolean {
  if (!receiverType || !interfaceOwner) return false;
  return receiverType === interfaceOwner || receiverType === simpleName(interfaceOwner);
}

function simpleName(value: string): string {
  return value.split('.').pop() ?? value;
}

function matchesTargetFile(nodeFile: string, relativeTarget: string, targetIsDirectory: boolean): boolean {
  const normalizedNodeFile = nodeFile.replace(/\\/g, '/');
  const normalizedTarget = relativeTarget.replace(/\\/g, '/').replace(/\/$/, '');
  if (targetIsDirectory) {
    return normalizedNodeFile === normalizedTarget || normalizedNodeFile.startsWith(`${normalizedTarget}/`);
  }
  return normalizedNodeFile === normalizedTarget || normalizedNodeFile.endsWith(`/${normalizedTarget}`) || normalizedTarget.endsWith(normalizedNodeFile);
}

function matchesLanguage(nodeLanguage: string, inputLanguage: FindReferencesInput['language']): boolean {
  return !inputLanguage || inputLanguage === 'auto' || nodeLanguage === inputLanguage;
}
