import { detectGraphLanguage } from './source-policy.js';
import type { FindReferencesInput, ReferenceKind, SupportedLanguage, WorkspaceGraphStatusKind } from '../types.js';

export type GraphQueryKind =
  | 'find_symbol'
  | 'find_references'
  | 'function_call_tree'
  | 'reverse_function_call_tree';

export type GraphArtifactReadStatus = 'ok' | 'missing' | 'incompatible' | 'errored';

export type GraphUnusableReason =
  | 'graph_disabled'
  | 'state_unreadable'
  | 'manifest_unreadable'
  | 'status_unusable'
  | 'language_unsupported'
  | 'coverage_insufficient';

export type GraphUsabilityDecision =
  | { usable: true }
  | { usable: false; reason: GraphUnusableReason };

export interface GraphUsabilityInput {
  graphEnabled: boolean;
  query: GraphQueryKind;
  stateStatus?: WorkspaceGraphStatusKind;
  stateReadStatus?: GraphArtifactReadStatus;
  manifestReadStatus?: GraphArtifactReadStatus;
  language?: SupportedLanguage;
  targetPath?: string;
  allowStale?: boolean;
  requiredReferenceKinds?: ReferenceKind[];
}

export interface FindReferencesGraphCoverage {
  requiredReferenceKinds?: ReferenceKind[];
  graphCoverageMode: 'supported-subset' | 'conservative-fallback';
}

export const GRAPH_POLICY_SUPPORTED_LANGUAGES = new Set(['ts', 'js', 'java'] as const);
export const GRAPH_REFERENCE_KINDS = new Set<ReferenceKind>(['call', 'implements', 'extends']);
const UNUSABLE_GRAPH_STATUSES = new Set<WorkspaceGraphStatusKind>([
  'missing',
  'partial',
  'errored',
  'incompatible',
  'refreshing',
]);

export function normalizeGraphLanguage(input: {
  language?: SupportedLanguage;
  path?: string;
}): 'ts' | 'js' | 'java' | undefined {
  const language = input.language ?? 'auto';
  if (language === 'ts' || language === 'js' || language === 'java') return language;
  if (language === 'auto' && input.path) {
    const detected = detectGraphLanguage(input.path);
    if (detected === 'ts' || detected === 'js' || detected === 'java') return detected;
  }
  return undefined;
}

export function getFindReferencesGraphCoverage(input: FindReferencesInput): FindReferencesGraphCoverage {
  if (Array.isArray(input.reference_kinds) && input.reference_kinds.length > 0) {
    return {
      requiredReferenceKinds: input.reference_kinds,
      graphCoverageMode: input.reference_kinds.every((kind) => GRAPH_REFERENCE_KINDS.has(kind)) ? 'supported-subset' : 'conservative-fallback',
    };
  }

  return {
    requiredReferenceKinds: undefined,
    graphCoverageMode: 'conservative-fallback',
  };
}

export function evaluateGraphUsability(input: GraphUsabilityInput): GraphUsabilityDecision {
  if (!input.graphEnabled) return { usable: false, reason: 'graph_disabled' };
  if (input.stateReadStatus && input.stateReadStatus !== 'ok') return { usable: false, reason: 'state_unreadable' };
  if (input.manifestReadStatus && input.manifestReadStatus !== 'ok') return { usable: false, reason: 'manifest_unreadable' };
  if (!isUsableGraphStatus(input.stateStatus, input.allowStale ?? false)) return { usable: false, reason: 'status_unusable' };

  const normalizedLanguage = normalizeGraphLanguage({ language: input.language, path: input.targetPath });
  if (!normalizedLanguage || !GRAPH_POLICY_SUPPORTED_LANGUAGES.has(normalizedLanguage)) {
    return { usable: false, reason: 'language_unsupported' };
  }

  if (input.query === 'find_references' && !hasSupportedReferenceCoverage(input.requiredReferenceKinds)) {
    return { usable: false, reason: 'coverage_insufficient' };
  }

  return { usable: true };
}

function isUsableGraphStatus(status: WorkspaceGraphStatusKind | undefined, allowStale: boolean): boolean {
  if (!status) return false;
  if (status === 'fresh') return true;
  if (status === 'stale') return allowStale;
  return !UNUSABLE_GRAPH_STATUSES.has(status);
}

function hasSupportedReferenceCoverage(requiredReferenceKinds: ReferenceKind[] | undefined): boolean {
  return Array.isArray(requiredReferenceKinds)
    && requiredReferenceKinds.length > 0
    && requiredReferenceKinds.every((kind) => GRAPH_REFERENCE_KINDS.has(kind));
}
