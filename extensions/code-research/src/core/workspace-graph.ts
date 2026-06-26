import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  CallSource,
  GraphEdge,
  GraphManifest,
  GraphNode,
  OwnerKind,
  SubprojectGraphShard,
  WorkspaceGraphState,
} from '../types.js';
import { buildProjectIndex } from './project-index.js';
import { compareSubprojectSnapshot, createSubprojectSnapshot } from './freshness.js';
import {
  createBaseArtifact,
  createEdgeId,
  createFileNodeId,
  createSubprojectNodeId,
  createSymbolNodeId,
  createWorkspaceNodeId,
} from './graph-schema.js';
import { ensureWorkspaceGraphGitignore, writeSubprojectGraphShard, writeWorkspaceGraphManifest } from './graph-persistence.js';
import { detectWorkspaceSubprojects } from './project-detector.js';
import { collectWorkspaceSourceFiles, detectGraphLanguage, toProjectRelativePath } from './source-policy.js';
import { createWorkspaceGraphState, loadWorkspaceGraphState, writeWorkspaceGraphState } from './workspace-state.js';
import {
  buildTypeScriptProjectIndex,
  type IndexedCallable as TsIndexedCallable,
  type IndexedClass as TsIndexedClass,
  type TypeScriptProjectIndex,
} from '../languages/typescript/function-call-tree.js';
import { extractSignature as extractTypeScriptSignature, resolveTypeScriptImportCandidates } from '../languages/typescript/shared.js';
import { extractSignature as extractJavaSignature } from '../languages/java/shared.js';
import { resolveJavaCallsForGraph } from '../languages/java/function-call-tree.js';

export async function ensureWorkspaceGraphFreshness(projectRoot: string): Promise<{ state: WorkspaceGraphState; manifest?: GraphManifest; changed: boolean }> {
  await ensureWorkspaceGraphGitignore(projectRoot);
  const current = await loadWorkspaceGraphState(projectRoot);
  if (current.status !== 'ok') {
    const built = await buildWorkspaceGraph(projectRoot);
    return { ...built, changed: true };
  }

  const existing = current.data;
  const unreadableDirectories = new Set<string>();
  const reportUnreadableDirectory = (dir: string) => unreadableDirectories.add(toProjectRelativePath(projectRoot, dir));
  const detected = await detectWorkspaceSubprojects(projectRoot, { onUnreadableDirectory: reportUnreadableDirectory });
  const previousById = new Map(existing.subprojects.map((subproject) => [subproject.id, subproject]));

  let stale = existing.status !== 'fresh';
  if (detected.length !== existing.subprojects.length) stale = true;

  for (const subproject of detected) {
    const previous = previousById.get(subproject.id);
    if (!previous || previous.root !== subproject.root || previous.markers.join('|') !== subproject.markers.join('|')) {
      stale = true;
      break;
    }

    const files = await collectWorkspaceSourceFiles(subproject.absoluteRoot, { onUnreadableDirectory: reportUnreadableDirectory });
    const snapshot = await createSubprojectSnapshot(projectRoot, files);
    if (compareSubprojectSnapshot(previous.snapshot, snapshot).stale) {
      stale = true;
      break;
    }
  }

  const previousUnreadable = [...(existing.coverage.unreadableDirectories ?? [])].sort();
  const nextUnreadable = [...unreadableDirectories].sort();
  if (previousUnreadable.join('|') !== nextUnreadable.join('|')) stale = true;

  if (!stale) {
    return { state: existing, changed: false };
  }

  await writeWorkspaceGraphState(projectRoot, {
    ...existing,
    status: 'refreshing',
  });

  const built = await buildWorkspaceGraph(projectRoot);
  return { ...built, changed: true };
}

export async function buildWorkspaceGraph(projectRoot: string): Promise<{ state: WorkspaceGraphState; manifest: GraphManifest }> {
  const generation = Date.now();
  const workspaceNodeId = createWorkspaceNodeId(projectRoot);
  const unreadableDirectories = new Set<string>();
  const reportUnreadableDirectory = (dir: string) => unreadableDirectories.add(toProjectRelativePath(projectRoot, dir));
  const detected = await detectWorkspaceSubprojects(projectRoot, { onUnreadableDirectory: reportUnreadableDirectory });
  const manifestSubprojects: GraphManifest['subprojects'] = [];
  const stateSubprojects: WorkspaceGraphState['subprojects'] = [];
  const coverage = {
    indexedFiles: 0,
    skippedLargeFiles: 0,
    skippedUnsupportedFiles: 0,
    excludedDirectories: ['node_modules', 'build', 'dist', 'coverage', '.next', '.nuxt', '.svelte-kit', '.react-router', '.turbo', '.vite', '.cache', 'out', 'vendor'],
    unreadableDirectories: [] as string[],
  };
  let workspaceStatus: WorkspaceGraphState['status'] = 'fresh';

  for (const subproject of detected) {
    const files = await collectWorkspaceSourceFiles(subproject.absoluteRoot, { onUnreadableDirectory: reportUnreadableDirectory });
    const snapshot = await createSubprojectSnapshot(projectRoot, files);
    coverage.indexedFiles += files.length;

    const shard = await buildSubprojectShard(projectRoot, subproject.absoluteRoot, subproject.id, subproject.root, subproject.markers);
    if (shard.nodes.length === 0) workspaceStatus = 'partial';
    const shardPath = `graphs/${subproject.id}.json`;
    await writeSubprojectGraphShard(projectRoot, subproject.id, shard);

    manifestSubprojects.push({ id: subproject.id, root: subproject.root, shardPath, generation });
    stateSubprojects.push({
      id: subproject.id,
      root: subproject.root,
      status: shard.nodes.length > 0 ? 'fresh' : 'partial',
      languageHints: Array.from(new Set(shard.nodes.flatMap((node) => node.kind === 'file' ? [node.language] : []))),
      shardPath,
      snapshot,
      generation,
      markers: subproject.markers,
    });
  }

  const manifest: GraphManifest = createBaseArtifact({
    projectRoot,
    generation,
    workspaceNodeId,
    subprojects: manifestSubprojects,
  });

  await writeWorkspaceGraphManifest(projectRoot, manifest);

  const state = createWorkspaceGraphState({
    projectRoot,
    status: workspaceStatus,
    generation,
    manifestPath: '.pi/workspace-code-graph/graph-manifest.json',
    subprojects: stateSubprojects,
    coverage: {
      ...coverage,
      unreadableDirectories: [...unreadableDirectories].sort(),
    },
  });

  await writeWorkspaceGraphState(projectRoot, state);
  return { state, manifest };
}

async function buildSubprojectShard(
  projectRoot: string,
  subprojectRoot: string,
  subprojectId: string,
  subprojectRelativeRoot: string,
  markers: string[]
): Promise<SubprojectGraphShard> {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const workspaceNodeId = createWorkspaceNodeId(projectRoot);
  const subprojectNodeId = createSubprojectNodeId(subprojectId);

  nodes.push({ id: workspaceNodeId, kind: 'workspace', name: 'workspace', root: '.' });
  nodes.push({ id: subprojectNodeId, kind: 'subproject', name: subprojectRelativeRoot, root: subprojectRelativeRoot, markers, languages: [] });
  edges.push({ id: createEdgeId('contains', workspaceNodeId, subprojectNodeId), kind: 'contains', from: workspaceNodeId, to: subprojectNodeId });

  const files = await collectWorkspaceSourceFiles(subprojectRoot);
  const languages = new Set<string>();

  const javaFiles = files.filter((file) => detectGraphLanguage(file) === 'java');
  if (javaFiles.length > 0) {
    languages.add('java');
    const javaIndex = await buildProjectIndex(subprojectRoot);
    buildJavaGraph(projectRoot, subprojectId, javaIndex, nodes, edges);
  }

  const tsFiles = files.filter((file) => {
    const language = detectGraphLanguage(file);
    return language === 'ts' || language === 'js';
  });
  if (tsFiles.length > 0) {
    const tsIndex = await buildTypeScriptProjectIndex(subprojectRoot);
    for (const file of tsFiles) {
      const language = detectGraphLanguage(file);
      if (language) languages.add(language);
    }
    buildTypeScriptGraph(projectRoot, subprojectId, tsIndex, nodes, edges);
  }

  const subprojectNode = nodes.find((node) => node.id === subprojectNodeId && node.kind === 'subproject');
  if (subprojectNode?.kind === 'subproject') subprojectNode.languages = [...languages];

  return createBaseArtifact({
    subprojectId,
    generation: Date.now(),
    nodes,
    edges,
  });
}

function buildJavaGraph(projectRoot: string, subprojectId: string, index: Awaited<ReturnType<typeof buildProjectIndex>>, nodes: GraphNode[], edges: GraphEdge[]) {
  const fileNodeIds = new Map<string, string>();
  const symbolIds = new Map<string, string>();
  const subprojectNodeId = createSubprojectNodeId(subprojectId);

  for (const classRecord of index.classes) {
    const relFile = toProjectRelativePath(projectRoot, classRecord.file);
    const fileNodeId = ensureFileNode(nodes, edges, fileNodeIds, subprojectNodeId, subprojectId, relFile, 'java', classRecord.file);
    const symbolId = createSymbolNodeId(subprojectId, relFile, undefined, classRecord.className, classRecord.line, classRecord.column);
    symbolIds.set(`${classRecord.file}:class:${classRecord.className}`, symbolId);
    nodes.push({
      id: symbolId,
      kind: 'symbol',
      language: 'java',
      symbolKind: classRecord.kind,
      name: classRecord.className,
      file: relFile,
      range: { startLine: classRecord.line, startColumn: classRecord.column, endLine: classRecord.line, endColumn: classRecord.column },
      owner: undefined,
      ownerKind: 'unknown',
      exported: true,
    });
    edges.push({ id: createEdgeId('contains', fileNodeId, symbolId), kind: 'contains', from: fileNodeId, to: symbolId });

    for (const implemented of classRecord.implements ?? []) {
      const target = index.classes.find((candidate) => candidate.className === implemented || candidate.fullName === implemented);
      edges.push({
        id: createEdgeId('implements', symbolId, target ? symbolIds.get(`${target.file}:class:${target.className}`) ?? `external:java:${implemented}` : `external:java:${implemented}`),
        kind: 'implements',
        from: symbolId,
        to: target ? symbolIds.get(`${target.file}:class:${target.className}`) ?? `external:java:${implemented}` : `external:java:${implemented}`,
      });
    }

    for (const extended of classRecord.extends ?? []) {
      const target = index.classes.find((candidate) => candidate.className === extended || candidate.fullName === extended);
      edges.push({
        id: createEdgeId('extends', symbolId, target ? symbolIds.get(`${target.file}:class:${target.className}`) ?? `external:java:${extended}` : `external:java:${extended}`),
        kind: 'extends',
        from: symbolId,
        to: target ? symbolIds.get(`${target.file}:class:${target.className}`) ?? `external:java:${extended}` : `external:java:${extended}`,
      });
    }
  }

  for (const method of index.methods) {
    const relFile = toProjectRelativePath(projectRoot, method.file);
    const fileNodeId = ensureFileNode(nodes, edges, fileNodeIds, subprojectNodeId, subprojectId, relFile, 'java', method.file);
    const symbolId = createSymbolNodeId(subprojectId, relFile, method.className, method.symbol, method.line, method.column);
    symbolIds.set(`${method.file}:method:${method.className}:${method.symbol}`, symbolId);
    nodes.push({
      id: symbolId,
      kind: 'symbol',
      language: 'java',
      symbolKind: 'method',
      name: method.symbol,
      file: relFile,
      range: { startLine: method.line, startColumn: method.column, endLine: method.node.endPosition.row + 1, endColumn: method.node.endPosition.column },
      owner: method.className,
      ownerKind: 'class',
      exported: true,
      signature: extractJavaSignature(method.node),
    });
    edges.push({ id: createEdgeId('contains', fileNodeId, symbolId), kind: 'contains', from: fileNodeId, to: symbolId });
  }

  for (const method of index.methods) {
    const fromId = symbolIds.get(`${method.file}:method:${method.className}:${method.symbol}`);
    if (!fromId) continue;
    for (const { call, resolved, targetMethod } of resolveJavaCallsForGraph(method, index)) {
      const resolvedTargetId = targetMethod ? symbolIds.get(`${targetMethod.file}:method:${targetMethod.className}:${targetMethod.symbol}`) : undefined;
      const toId = resolvedTargetId ?? `external:java:${call.methodName}`;
      edges.push({
        id: createEdgeId('calls', fromId, toId, `${call.line}:${call.column}`),
        kind: 'calls',
        from: fromId,
        to: toId,
        callsite: { line: call.line, column: call.column, text: call.callText, receiverName: call.object, receiverType: resolved?.receiverType },
        external: !resolvedTargetId,
        externalName: !resolvedTargetId ? call.methodName : undefined,
        externalKind: 'method',
        externalSource: !resolvedTargetId ? resolved?.source ?? 'unknown' : undefined,
        externalOwner: !resolvedTargetId ? resolved?.className : undefined,
        externalOwnerKind: !resolvedTargetId ? resolved?.ownerKind : undefined,
        reason: !resolvedTargetId ? resolved?.reason : undefined,
      });
    }
  }
}

function buildTypeScriptGraph(projectRoot: string, subprojectId: string, index: TypeScriptProjectIndex, nodes: GraphNode[], edges: GraphEdge[]) {
  const fileNodeIds = new Map<string, string>();
  const symbolIds = new Map<string, string>();
  const subprojectNodeId = createSubprojectNodeId(subprojectId);

  for (const classRecord of index.classes) {
    const relFile = toProjectRelativePath(projectRoot, classRecord.file);
    const fileNodeId = ensureFileNode(nodes, edges, fileNodeIds, subprojectNodeId, subprojectId, relFile, classRecord.language, classRecord.file);
    const symbolId = createSymbolNodeId(subprojectId, relFile, undefined, classRecord.className, classRecord.line, classRecord.column);
    symbolIds.set(`${classRecord.file}:class:${classRecord.className}`, symbolId);
    nodes.push({
      id: symbolId,
      kind: 'symbol',
      language: classRecord.language,
      symbolKind: 'class',
      name: classRecord.className,
      file: relFile,
      range: { startLine: classRecord.line, startColumn: classRecord.column, endLine: classRecord.node.endPosition.row + 1, endColumn: classRecord.node.endPosition.column },
      ownerKind: 'unknown',
      exported: Boolean(classRecord.exportedName),
      signature: extractTypeScriptSignature(classRecord.node),
    });
    edges.push({ id: createEdgeId('contains', fileNodeId, symbolId), kind: 'contains', from: fileNodeId, to: symbolId });
  }

  for (const callable of index.callables) {
    const relFile = toProjectRelativePath(projectRoot, callable.file);
    const fileNodeId = ensureFileNode(nodes, edges, fileNodeIds, subprojectNodeId, subprojectId, relFile, callable.language, callable.file);
    const symbolId = createSymbolNodeId(subprojectId, relFile, callable.ownerName, callable.symbol, callable.line, callable.column);
    symbolIds.set(`${callable.file}:${callable.kind}:${callable.ownerName ?? '<module>'}:${callable.symbol}`, symbolId);
    nodes.push({
      id: symbolId,
      kind: 'symbol',
      language: callable.language,
      symbolKind: callable.kind,
      name: callable.symbol,
      file: relFile,
      range: { startLine: callable.line, startColumn: callable.column, endLine: callable.node.endPosition.row + 1, endColumn: callable.node.endPosition.column },
      owner: callable.ownerName,
      ownerKind: callable.ownerKind,
      exported: Boolean(callable.exportedName),
      signature: extractTypeScriptSignature(callable.node),
    });
    edges.push({ id: createEdgeId('contains', fileNodeId, symbolId), kind: 'contains', from: fileNodeId, to: symbolId });
  }

  for (const file of index.files.values()) {
    const relFile = toProjectRelativePath(projectRoot, file.file);
    const fileNodeId = ensureFileNode(nodes, edges, fileNodeIds, subprojectNodeId, subprojectId, relFile, file.language, file.file);
    for (const binding of file.imports.values()) {
      const candidates = resolveTypeScriptImportCandidates(file.file, binding.source, index.projectConfig);
      const target = candidates.find((candidate) => index.files.has(candidate));
      if (!target) continue;
      const targetRel = toProjectRelativePath(projectRoot, target);
      const targetFileNodeId = ensureFileNode(nodes, edges, fileNodeIds, subprojectNodeId, subprojectId, targetRel, detectGraphLanguage(target) ?? file.language, target);
      edges.push({ id: createEdgeId('imports', fileNodeId, targetFileNodeId, binding.localName), kind: 'imports', from: fileNodeId, to: targetFileNodeId, importSource: binding.source });
    }
  }

  for (const callable of index.callables) {
    const fromId = symbolIds.get(`${callable.file}:${callable.kind}:${callable.ownerName ?? '<module>'}:${callable.symbol}`);
    if (!fromId) continue;
    for (const call of extractTypeScriptCalls(callable.node)) {
      const resolved = resolveTypeScriptCall(index, callable, call);
      const toId = resolved.target ? symbolIds.get(`${resolved.target.file}:${resolved.target.kind}:${resolved.target.ownerName ?? '<module>'}:${resolved.target.symbol}`) : undefined;
      edges.push({
        id: createEdgeId('calls', fromId, toId ?? `external:${callable.language}:${call.symbol}`, `${call.line}:${call.column}`),
        kind: 'calls',
        from: fromId,
        to: toId ?? `external:${callable.language}:${call.symbol}`,
        callsite: { line: call.line, column: call.column, text: call.text, receiverName: call.receiver },
        external: !toId,
        externalName: !toId ? call.symbol : undefined,
        externalKind: call.receiver ? 'method' : 'function',
        externalSource: !toId ? resolved.source : undefined,
        externalOwner: !toId ? resolved.owner : undefined,
        externalOwnerKind: !toId ? resolved.ownerKind : undefined,
        reason: !toId ? resolved.reason : undefined,
      });
    }
  }
}

function ensureFileNode(
  nodes: GraphNode[],
  edges: GraphEdge[],
  fileNodeIds: Map<string, string>,
  subprojectNodeId: string,
  subprojectId: string,
  relativeFile: string,
  language: 'ts' | 'js' | 'java',
  absoluteFile: string
): string {
  const existing = fileNodeIds.get(relativeFile);
  if (existing) return existing;
  const fileNodeId = createFileNodeId(subprojectId, relativeFile);
  fileNodeIds.set(relativeFile, fileNodeId);
  nodes.push({ id: fileNodeId, kind: 'file', path: relativeFile, language, size: 0 });
  edges.push({ id: createEdgeId('contains', subprojectNodeId, fileNodeId), kind: 'contains', from: subprojectNodeId, to: fileNodeId });
  void stat(absoluteFile).then((s) => {
    const node = nodes.find((candidate) => candidate.id === fileNodeId && candidate.kind === 'file');
    if (node?.kind === 'file') node.size = s.size;
  });
  return fileNodeId;
}

function extractTypeScriptCalls(callableNode: any): Array<{ symbol: string; receiver?: string; text: string; line: number; column: number }> {
  const body = callableNode.childForFieldName('body') ?? callableNode.childForFieldName('value');
  if (!body) return [];
  const calls: Array<{ symbol: string; receiver?: string; text: string; line: number; column: number }> = [];
  function visit(node: any) {
    if (!node?.isNamed) return;
    if (node.type === 'call_expression') {
      const functionNode = node.childForFieldName('function');
      if (functionNode?.type === 'identifier') {
        calls.push({ symbol: functionNode.text, text: node.text, line: node.startPosition.row + 1, column: node.startPosition.column });
        return;
      }
      if (functionNode?.type === 'member_expression') {
        const propertyNode = functionNode.childForFieldName('property');
        const objectNode = functionNode.childForFieldName('object');
        if (propertyNode) calls.push({ symbol: propertyNode.text.replace(/^#/, ''), receiver: objectNode?.text, text: node.text, line: node.startPosition.row + 1, column: node.startPosition.column });
        return;
      }
    }
    for (const child of node.children) visit(child);
  }
  visit(body);
  return calls;
}

function resolveTypeScriptCall(
  index: TypeScriptProjectIndex,
  current: TsIndexedCallable,
  call: { symbol: string; receiver?: string }
): { target?: TsIndexedCallable; source: CallSource; owner?: string; ownerKind?: OwnerKind; reason?: string } {
  if (call.receiver === 'this' && current.ownerName) {
    const target = index.callables.find((item) => item.file === current.file && item.ownerName === current.ownerName && item.kind === 'method' && item.symbol === call.symbol);
    if (target) return { target, source: 'application', owner: current.ownerName, ownerKind: 'class' };
  }

  if (!call.receiver) {
    const local = index.callables.find((item) => item.file === current.file && item.symbol === call.symbol && (item.kind === 'function' || item.ownerName === current.ownerName));
    if (local) return { target: local, source: 'application', owner: local.ownerName, ownerKind: local.ownerKind };

    const imported = index.files.get(current.file)?.imports.get(call.symbol);
    if (imported) {
      const targetFile = resolveTypeScriptImportCandidates(current.file, imported.source, index.projectConfig).find((candidate) => index.files.has(candidate));
      const target = targetFile ? index.callables.find((item) => item.file === targetFile && item.exportedName === imported.importedName) : undefined;
      if (target) return { target, source: 'application', owner: target.ownerName, ownerKind: target.ownerKind };
      return { source: imported.source.startsWith('.') ? 'unknown' : 'library', reason: 'import does not resolve to indexed callable' };
    }
  }

  if (call.receiver) {
    const importedClass = index.files.get(current.file)?.imports.get(call.receiver);
    if (importedClass) {
      const targetFile = resolveTypeScriptImportCandidates(current.file, importedClass.source, index.projectConfig).find((candidate) => index.files.has(candidate));
      const classRecord = targetFile ? index.classes.find((item) => item.file === targetFile && item.exportedName === importedClass.importedName) : undefined;
      const target = classRecord ? index.callables.find((item) => item.ownerName === classRecord.className && item.symbol === call.symbol) : undefined;
      if (target) return { target, source: 'application', owner: classRecord?.className, ownerKind: 'class' };
    }

    if (current.ownerName) {
      const target = index.callables.find((item) => item.file === current.file && item.ownerName === current.ownerName && item.symbol === call.symbol);
      if (target) return { target, source: 'application', owner: current.ownerName, ownerKind: 'class' };
    }
  }

  return { source: 'unknown', reason: 'call target not indexed' };
}
