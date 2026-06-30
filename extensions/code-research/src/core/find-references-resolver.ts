import { loadCodeResearchConfig } from '../config.js';
import { queryReferencesFromGraph } from './reference-graph-queries.js';
import { readWorkspaceGraphManifest, readWorkspaceGraphState } from './graph-persistence.js';
import { evaluateGraphUsability, getFindReferencesGraphCoverage } from './graph-policy.js';
import { findTypeScriptReferences } from '../languages/typescript/find-references.js';
import { findJavaReferences } from '../languages/java/find-references.js';
import type { FindReferencesInput, ReferenceLocation } from '../types.js';

export async function findReferences(cwd: string, input: FindReferencesInput): Promise<ReferenceLocation[]> {
  const config = await loadCodeResearchConfig(cwd);
  const graphResults = config.graph.enable ? await findReferencesFromGraph(cwd, input) : undefined;
  if (graphResults) return graphResults;

  switch (input.language ?? 'java') {
    case 'java':
      return findJavaReferences(cwd, input);
    case 'ts':
    case 'js':
      return findTypeScriptReferences(cwd, input);
    case 'auto':
      throw new Error('find_references does not support auto language detection yet');
    default:
      throw new Error(`Unsupported language: ${input.language}`);
  }
}

async function findReferencesFromGraph(cwd: string, input: FindReferencesInput): Promise<ReferenceLocation[] | undefined> {
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
  if (!decision.usable || state.status !== 'ok' || manifest.status !== 'ok') return undefined;

  return queryReferencesFromGraph({
    cwd,
    input,
    state: state.data,
    manifest: manifest.data,
    policy: { allowStale: false },
  });
}
