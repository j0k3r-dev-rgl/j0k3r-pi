import { loadCodeResearchConfig } from '../config.js';
import { queryReferencesFromGraph } from './reference-graph-queries.js';
import { ensureWorkspaceGraphReadable } from './graph-ensure.js';
import { evaluateGraphUsability, getFindReferencesGraphCoverage } from './graph-policy.js';
import type { FindReferencesInput, FindReferencesResolution, ReferenceLocation, ReferenceQueryDiagnostics } from '../types.js';

export async function resolveFindReferences(cwd: string, input: FindReferencesInput): Promise<FindReferencesResolution> {
  const graph = await findReferencesFromGraph(cwd, input);
  if (graph?.results !== undefined) {
    return {
      results: filterReferenceKinds(graph.results, input),
      diagnostics: graph.diagnostics,
    };
  }

  return {
    results: [],
    diagnostics: graph.diagnostics,
  };
}

export async function findReferences(cwd: string, input: FindReferencesInput): Promise<ReferenceLocation[]> {
  return (await resolveFindReferences(cwd, input)).results;
}

function filterReferenceKinds(results: ReferenceLocation[], input: FindReferencesInput): ReferenceLocation[] {
  if (!Array.isArray(input.reference_kinds) || input.reference_kinds.length === 0) return results;
  const requestedKinds = new Set(input.reference_kinds);
  if (input.language === 'java' && requestedKinds.has('call')) {
    requestedKinds.add('callback');
  }
  return results.filter((result) => requestedKinds.has(result.reference_kind));
}

async function findReferencesFromGraph(cwd: string, input: FindReferencesInput): Promise<{ results?: ReferenceLocation[]; diagnostics: ReferenceQueryDiagnostics }> {
  const config = await loadCodeResearchConfig(cwd);
  if (!config.graph.enable) {
    return {
      diagnostics: {
        source_mode: 'graph',
        graph_status: 'disabled',
        completeness: 'unavailable',
        graph_unavailable_reason: 'graph_disabled',
      },
    };
  }

  const { state, manifest } = await ensureWorkspaceGraphReadable(cwd);
  const coverage = getFindReferencesGraphCoverage(input);
  const decision = evaluateGraphUsability({
    graphEnabled: config.graph.enable,
    query: 'find_references',
    stateReadStatus: state.status,
    manifestReadStatus: manifest.status,
    stateStatus: state.status === 'ok' ? state.data.status : undefined,
    language: input.language,
    targetPath: input.path,
    requiredReferenceKinds: coverage.requiredReferenceKinds,
  });
  if (!decision.usable || state.status !== 'ok' || manifest.status !== 'ok') {
    return {
      diagnostics: {
        source_mode: 'graph',
        graph_status: mapGraphStatus(state.status, manifest.status, state.status === 'ok' ? state.data.status : undefined),
        completeness: 'unavailable',
        graph_unavailable_reason: mapUnavailableReason(!decision.usable ? decision.reason : undefined),
      },
    };
  }

  return {
    results: await queryReferencesFromGraph({
      cwd,
      input,
      state: state.data,
      manifest: manifest.data,
      policy: { allowStale: false },
    }),
    diagnostics: {
      source_mode: 'graph',
      graph_status: mapGraphStatus(state.status, manifest.status, state.data.status),
      completeness: 'complete',
      graph_unavailable_reason: null,
    },
  };
}

function mapGraphStatus(stateStatus: string, manifestStatus: string, graphState?: string): ReferenceQueryDiagnostics['graph_status'] {
  if (stateStatus === 'missing' || manifestStatus === 'missing') return 'missing';
  if (stateStatus === 'incompatible' || manifestStatus === 'incompatible') return 'incompatible';
  if (stateStatus === 'errored' || manifestStatus === 'errored') return 'error';
  if (graphState === 'partial') return 'partial';
  if (graphState === 'stale' || graphState === 'refreshing') return 'stale';
  return 'fresh';
}

function mapUnavailableReason(reason: string | undefined): ReferenceQueryDiagnostics['graph_unavailable_reason'] {
  switch (reason) {
    case 'graph_disabled':
    case 'language_unsupported':
    case 'coverage_insufficient':
    case 'state_unreadable':
    case 'manifest_unreadable':
      return reason;
    case 'status_unusable':
      return 'graph_stale';
    default:
      return 'graph_read_error';
  }
}
