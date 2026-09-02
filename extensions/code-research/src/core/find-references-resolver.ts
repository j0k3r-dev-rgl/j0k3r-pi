import { loadCodeResearchConfig } from '../config.js';
import { queryReferencesFromGraph } from './reference-graph-queries.js';
import { readWorkspaceGraphManifest, readWorkspaceGraphState } from './graph-persistence.js';
import { evaluateGraphUsability, getFindReferencesGraphCoverage } from './graph-policy.js';
import { findTypeScriptReferences } from '../languages/typescript/find-references.js';
import { findJavaReferences } from '../languages/java/find-references.js';
import { findGoReferences } from '../languages/go/find-references.js';
import type { FindReferencesInput, FindReferencesResolution, ReferenceLocation, ReferenceQueryDiagnostics } from '../types.js';

export async function resolveFindReferences(cwd: string, input: FindReferencesInput): Promise<FindReferencesResolution> {
  const config = await loadCodeResearchConfig(cwd);
  const graph = config.graph.enable ? await findReferencesFromGraph(cwd, input) : undefined;
  if (graph?.results !== undefined) {
    const filteredGraphResults = filterReferenceKinds(graph.results, input);
    const directFallback = (shouldRunDirectComparison(input) || shouldAlwaysCompareDirectResults(input)) && shouldCompareDirectResults(input)
      ? filterReferenceKinds(await findReferencesDirect(cwd, input), input)
      : undefined;
    if (directFallback && hasMoreCompleteDirectCoverage(filteredGraphResults, directFallback)) {
      return {
        results: directFallback,
        diagnostics: {
          source_mode: 'hybrid',
          graph_status: graph.diagnostics.graph_status,
          completeness: 'fallback',
          fallback_reason: 'coverage_insufficient',
        },
      };
    }
    return {
      results: filteredGraphResults,
      diagnostics: graph.diagnostics,
    };
  }

  return {
    results: filterReferenceKinds(await findReferencesDirect(cwd, input), input),
    diagnostics: graph?.diagnostics ?? {
      source_mode: 'direct',
      graph_status: config.graph.enable ? 'fresh' : 'disabled',
      completeness: 'fallback',
      fallback_reason: config.graph.enable ? 'coverage_insufficient' : 'graph_disabled',
    },
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

async function findReferencesDirect(cwd: string, input: FindReferencesInput): Promise<ReferenceLocation[]> {
  switch (input.language ?? 'java') {
    case 'java':
      return findJavaReferences(cwd, input);
    case 'ts':
    case 'js':
      return findTypeScriptReferences(cwd, input);
    case 'go':
      return findGoReferences(cwd, input as any);
    case 'auto':
      throw new Error('find_references does not support auto language detection yet');
    default:
      throw new Error(`Unsupported language: ${input.language}`);
  }
}

async function findReferencesFromGraph(cwd: string, input: FindReferencesInput): Promise<{ results?: ReferenceLocation[]; diagnostics: ReferenceQueryDiagnostics }> {
  const state = await readWorkspaceGraphState(cwd);
  const manifest = await readWorkspaceGraphManifest(cwd);
  const coverage = getFindReferencesGraphCoverage(input);
  const decision = evaluateGraphUsability({
    graphEnabled: true,
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
        source_mode: 'direct',
        graph_status: mapGraphStatus(state.status, manifest.status, state.status === 'ok' ? state.data.status : undefined),
        completeness: 'fallback',
        fallback_reason: mapFallbackReason(!decision.usable ? decision.reason : undefined),
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
      fallback_reason: null,
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

function shouldRunDirectComparison(input: FindReferencesInput): boolean {
  return input.compare_direct_fallback === true;
}

function shouldAlwaysCompareDirectResults(input: FindReferencesInput): boolean {
  if (input.kind === 'variable') return true;
  if (input.language === 'java' && input.kind === 'interface') return true;
  return (input.language === 'ts' || input.language === 'js') && (!input.kind || input.kind === 'function' || input.kind === 'method' || input.kind === 'class' || input.kind === 'interface');
}

function shouldCompareDirectResults(input: FindReferencesInput): boolean {
  if (!Array.isArray(input.reference_kinds) || input.reference_kinds.length === 0) return true;
  const requestedKinds = new Set(input.reference_kinds ?? []);
  if (requestedKinds.has('read')) return true;
  if (requestedKinds.has('call')) return true;
  if ((input.language === 'ts' || input.language === 'js') && (requestedKinds.has('implements') || requestedKinds.has('extends'))) return true;
  return input.language === 'java' && input.kind === 'interface' && requestedKinds.has('implements');
}

function hasMoreCompleteDirectCoverage(graphResults: ReferenceLocation[], directResults: ReferenceLocation[]): boolean {
  if (directResults.length === 0) return false;
  const graphKeys = new Set(graphResults.map(referenceKey));
  return directResults.some((result) => !graphKeys.has(referenceKey(result)));
}

function referenceKey(result: ReferenceLocation): string {
  return [
    result.file,
    result.line,
    result.column,
    result.reference_kind,
    result.context_symbol,
    result.context_class,
    result.called_as,
    result.receiver_name,
    result.receiver_type,
  ].join('::');
}

function mapFallbackReason(reason: string | undefined): ReferenceQueryDiagnostics['fallback_reason'] {
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
