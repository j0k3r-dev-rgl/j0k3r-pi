import { readFile, stat } from 'node:fs/promises';
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
    if (!(edge.kind === 'calls' || edge.kind === 'reads' || edge.kind === 'implements' || edge.kind === 'extends')) continue;
    const referenceKind = edge.kind === 'calls' ? 'call' : edge.kind === 'reads' ? 'read' : edge.kind === 'implements' ? 'implements' : 'extends';
    if (requestedKinds.size > 0 && !requestedKinds.has(referenceKind)) continue;
    const toNode = nodeById.get(edge.to);
    const matchesTarget =
      targetIds.has(edge.to) ||
      ((edge.kind === 'implements' || edge.kind === 'extends') && targets.some((candidate) => edge.to === `external:java:${candidate.name}` || edge.to === `external:java:${candidate.qualifiedName ?? candidate.name}`)) ||
      (edge.kind === 'calls' && edge.targetRelationshipId !== undefined && targetRelationshipIds.has(edge.targetRelationshipId)) ||
      (edge.kind === 'calls' && toNode?.kind === 'symbol' && interfaceMethodTargets.some((candidate) => toNode.name === candidate.name && receiverMatchesInterface(edge.callsite?.receiverType, candidate.owner)));
    if (!matchesTarget) continue;
    const fromNode = nodeById.get(edge.from);
    if (!fromNode || fromNode.kind !== 'symbol') continue;

    const isTypeRelationship = referenceKind === 'extends' || referenceKind === 'implements';
    const sourceFile = resolve(cwd, fromNode.file);
    const relationshipMetadata = isTypeRelationship
      ? await getJavaTypeRelationshipMetadata(sourceCache, sourceFile, fromNode.range.startLine, referenceKind, target.name)
      : undefined;
    references.push({
      file: sourceFile,
      line: isTypeRelationship ? fromNode.range.startLine : edge.callsite?.line ?? fromNode.range.startLine,
      column: isTypeRelationship ? 0 : edge.callsite?.column ?? fromNode.range.startColumn,
      end_line: isTypeRelationship ? relationshipMetadata?.end_line : fromNode.range.endLine,
      end_column: isTypeRelationship ? relationshipMetadata?.end_column : fromNode.range.endColumn,
      symbol: target.name,
      kind: target.symbolKind,
      context_symbol: fromNode.name,
      context_kind: fromNode.symbolKind,
      context_class: isTypeRelationship ? fromNode.name : fromNode.owner,
      owner_kind: isTypeRelationship ? (fromNode.symbolKind === 'interface' ? 'interface' : 'class') : fromNode.ownerKind ?? 'unknown',
      reference_kind: referenceKind,
      called_as: isTypeRelationship ? relationshipMetadata?.called_as : undefined,
      receiver_name: edge.callsite?.receiverName,
      receiver_type: edge.callsite?.receiverType,
      is_application: true,
      source: 'application',
      reason: edge.reason,
    });
  }

  return references;
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
