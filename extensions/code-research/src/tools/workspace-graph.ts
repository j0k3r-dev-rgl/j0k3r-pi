import { Type } from 'typebox';
import { loadCodeResearchConfig } from '../config.js';
import { getWorkspaceGraphRoot, readSubprojectGraphShard, readWorkspaceGraphManifest } from '../core/graph-persistence.js';
import { loadWorkspaceGraphState } from '../core/workspace-state.js';
import type { GraphManifest, WorkspaceGraphState } from '../types.js';

async function summarizeWorkspaceGraphState(
  state: WorkspaceGraphState,
  manifestStatus: 'ok' | 'missing' | 'incompatible' | 'corrupt' | 'oversized' | 'errored',
  manifest?: GraphManifest
) {
  const languages = { java: 0, go: 0, ts: 0, js: 0 };
  const languageCoverage = {
    java: { subprojects: 0, fileCount: 0, symbolCount: 0 },
    go: { subprojects: 0, fileCount: 0, symbolCount: 0 },
    ts: { subprojects: 0, fileCount: 0, symbolCount: 0 },
    js: { subprojects: 0, fileCount: 0, symbolCount: 0 },
  };
  const now = Date.now();
  const updatedAtMs = Date.parse(state.updatedAt);
  const ageSeconds = Number.isFinite(updatedAtMs) ? Math.max(0, Math.floor((now - updatedAtMs) / 1000)) : undefined;
  const shardPathById = new Map((manifest?.subprojects ?? []).map((subproject) => [subproject.id, subproject.shardPath]));
  const projects = await Promise.all(state.subprojects.map(async (subproject) => {
    for (const language of subproject.languageHints) {
      languages[language] += 1;
      languageCoverage[language].subprojects += 1;
    }

    let shardCounts = { fileCount: 0, symbolCount: 0 };
    const shardResult = await readSubprojectGraphShard(state.projectRoot, subproject.id, { generation: subproject.generation });
    if (shardResult.status === 'ok') {
      for (const node of shardResult.data.nodes) {
        if (node.kind === 'file') {
          languageCoverage[node.language].fileCount += 1;
          shardCounts.fileCount += 1;
        } else if (node.kind === 'symbol') {
          languageCoverage[node.language].symbolCount += 1;
          shardCounts.symbolCount += 1;
        }
      }
    }

    const snapshotFileCount = Object.keys(subproject.snapshot).length;
    const primaryLanguage = subproject.languageHints[0] ?? 'unknown';
    return {
      id: subproject.id,
      root: subproject.root,
      workspaceRelativeRoot: subproject.root,
      status: subproject.status,
      markers: subproject.markers,
      languageHints: subproject.languageHints,
      primaryLanguage,
      generation: subproject.generation,
      fileCount: shardCounts.fileCount || snapshotFileCount,
      symbolCount: shardCounts.symbolCount,
      snapshotStatus: snapshotFileCount > 0 ? 'indexed' : 'empty',
      shardPath: shardPathById.get(subproject.id),
    };
  }));
  const indexedProjects = projects.filter((project) => project.snapshotStatus === 'indexed').length;
  const emptyProjectRoots = projects.filter((project) => project.snapshotStatus === 'empty').map((project) => project.workspaceRelativeRoot);
  const emptyProjects = emptyProjectRoots.length;
  const partialProjects = projects.filter((project) => project.status === 'partial').length;
  const erroredProjects = projects.filter((project) => project.status === 'errored').length;
  const graphUsableForQueries = state.status === 'fresh' || state.status === 'stale';

  return {
    status: state.status,
    projectRoot: state.projectRoot,
    graphRoot: getWorkspaceGraphRoot(state.projectRoot),
    generation: state.generation,
    manifestPath: state.manifestPath,
    updatedAt: state.updatedAt,
    ageSeconds,
    freshness: {
      updatedAt: state.updatedAt,
      ageSeconds,
      isFreshEnough: state.status === 'fresh',
    },
    graphUsableForQueries,
    monorepo: {
      detected: state.subprojects.length > 1,
      subprojectCount: state.subprojects.length,
      roots: state.subprojects.map((subproject) => subproject.root),
    },
    indexing: {
      sectioned: state.subprojects.length > 1,
      layout: state.subprojects.length > 1 ? 'per-subproject-shards' : 'single-subproject-shard',
      shardCount: state.subprojects.length,
      manifestStatus,
      stateStatus: state.status,
    },
    coverage: {
      indexedFiles: state.coverage.indexedFiles,
      skippedLargeFiles: state.coverage.skippedLargeFiles,
      skippedUnsupportedFiles: state.coverage.skippedUnsupportedFiles,
      unreadableDirectoryCount: state.coverage.unreadableDirectories.length,
      excludedDirectoryCount: state.coverage.excludedDirectories.length,
      detectedProjects: projects.length,
      indexedProjects,
      emptyProjects,
      emptyProjectRoots,
      partialProjects,
      erroredProjects,
      projectsWithUnreadableDirs: state.coverage.unreadableDirectories.length > 0 ? state.subprojects.length : 0,
    },
    languages,
    languageCoverage,
    unreadableDirectories: state.coverage.unreadableDirectories,
    projects,
    subprojects: projects,
    error: state.error,
  };
}

export function registerWorkspaceGraphStatusTool(pi: any) {
  pi.registerTool({
    name: 'workspace_graph_status',
    label: 'Workspace Graph Status',
    description: 'Inspect workspace graph health and monorepo coverage before relying on Code Research results. Reports whether the graph is fresh/usable, which subprojects/languages are indexed, and whether shards are partial, missing, incompatible, or errored. This does not search code.',
    promptSnippet: 'Check graph freshness, usability, indexed languages, and monorepo subproject coverage before graph-backed code inspection.',
    promptGuidelines: [
      'Use workspace_graph_status when entering an unfamiliar repo/monorepo or when code_find/code_call_hierarchy results look suspicious or stale.',
      'Use the project/language counts to choose better code_find paths and concrete language filters in monorepos.',
      'Do not use this for symbol lookup, references, or call flow; use code_find or code_call_hierarchy for those.',
      'If status is missing, incompatible, stale, partial, disabled, or errored, prefer direct validation or rerun after the lifecycle refresh/reload completes.',
    ],
    parameters: Type.Object({}),
    async execute(_toolCallId: any, _params: any, _signal: any, _onUpdate: any, ctx: any) {
      const config = await loadCodeResearchConfig(ctx.cwd);
      if (!config.graph.enable) {
        return {
          content: [{ type: 'text', text: 'Workspace graph status: disabled' }],
          details: {
            status: 'disabled',
            graph: {
              enable: config.graph.enable,
              addGitignore: config.graph.addGitignore,
            },
            configPath: config.configPath,
            warnings: config.warnings,
          },
        };
      }

      const state = await loadWorkspaceGraphState(ctx.cwd);
      if (state.status === 'missing') {
        return { content: [{ type: 'text', text: 'Workspace graph status: missing' }], details: { status: 'missing' } };
      }
      if (state.status === 'ok') {
        const manifest = await readWorkspaceGraphManifest(ctx.cwd);
        const summary = await summarizeWorkspaceGraphState(state.data, manifest.status, manifest.status === 'ok' ? manifest.data : undefined);
        const projectList = summary.projects.map((project) => project.workspaceRelativeRoot).join(',');
        return {
          content: [{
            type: 'text',
            text: `Workspace graph status: ${summary.status} | usable=${summary.graphUsableForQueries ? 'yes' : 'no'} | age_s=${summary.ageSeconds ?? 'unknown'} | monorepo=${summary.monorepo.detected ? 'yes' : 'no'} | shards=${summary.indexing.shardCount} | indexed_files=${summary.coverage.indexedFiles} | detected_projects=${summary.coverage.detectedProjects} | indexed_projects=${summary.coverage.indexedProjects} | empty_projects=${summary.coverage.emptyProjects} | partial_projects=${summary.coverage.partialProjects} | unreadable_dirs=${summary.coverage.unreadableDirectoryCount} | go_files=${summary.languageCoverage.go.fileCount} | go_symbols=${summary.languageCoverage.go.symbolCount} | workspace_projects=${projectList}`,
          }],
          details: summary,
        };
      }
      return { content: [{ type: 'text', text: `Workspace graph status: ${state.status}` }], details: { status: state.status } };
    },
  });
}
