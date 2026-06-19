import type {
  TranscriptSourceInventory,
  TranscriptPlan,
  TranscriptSourceMode,
  TranscriptSource,
  TranscriptSourceSelection,
} from './types.js';

export interface TranscriptRequirement {
  language?: string;
  sourceMode: TranscriptSourceMode;
  requestedTextOnly?: boolean;
}

export interface TranscriptCandidateInfo {
  source: TranscriptSource;
  usedFallback: boolean;
  reason?: string;
}

export interface TranscriptFallbackResult {
  candidate: TranscriptCandidateInfo;
  content: string;
}

export class TranscriptFallbackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TranscriptFallbackError';
  }
}

function toPlanCandidate(
  source: TranscriptSource,
  sourceLanguage: string,
  sourceMode: Exclude<TranscriptSourceMode, 'auto'>,
  fallback: boolean,
  reason?: string,
) {
  return {
    source: source.source,
    language: sourceLanguage,
    sourceMode,
    fallback,
    generated: source.generated,
    reason,
  } as TranscriptPlan['candidates'][number];
}

function addRequestedSourceCandidates(
  sources: TranscriptSource[],
  requestedLanguage: string,
  sourceMode: Exclude<TranscriptSourceMode, 'auto'>,
  candidates: TranscriptPlan['candidates'],
): void {
  const normalizedRequested = requestedLanguage.toLowerCase();
  const requested = sources.filter((source) => source.language.toLowerCase() === normalizedRequested);

  for (const source of requested) {
    candidates.push(
      toPlanCandidate(
        source,
        source.language,
        sourceMode,
        false,
        `requested language ${requestedLanguage}`,
      ),
    );
  }
}

function addOriginalSourceCandidates(
  sources: TranscriptSource[],
  requestedLanguage: string,
  sourceMode: Exclude<TranscriptSourceMode, 'auto'>,
  candidates: TranscriptPlan['candidates'],
): void {
  const normalizedRequested = requestedLanguage.toLowerCase();
  const originals = sources.filter((source) => {
    const language = source.language.toLowerCase();
    return language !== normalizedRequested && (language.endsWith('-orig') || source.requested?.toLowerCase().endsWith('-orig'));
  });

  for (const source of originals) {
    candidates.push(
      toPlanCandidate(
        source,
        source.language,
        sourceMode,
        true,
        `using original caption language ${source.language} before translated/requested alternatives`,
      ),
    );
  }
}

function addAlternateSourceCandidates(
  sources: TranscriptSource[],
  requestedLanguage: string,
  sourceMode: Exclude<TranscriptSourceMode, 'auto'>,
  candidates: TranscriptPlan['candidates'],
): void {
  const normalizedRequested = requestedLanguage.toLowerCase();
  const alternates = sources.filter((source) => {
    const language = source.language.toLowerCase();
    return language !== normalizedRequested && !language.endsWith('-orig') && !source.requested?.toLowerCase().endsWith('-orig');
  });

  for (const source of alternates) {
    candidates.push(
      toPlanCandidate(
        source,
        source.language,
        sourceMode,
        true,
        `requested language ${requestedLanguage} unavailable, using alternate ${source.language}`,
      ),
    );
  }
}

function addTranscriptFallbackCandidates(requestedLanguage: string, candidates: TranscriptPlan['candidates']): void {
  candidates.push(
    toPlanCandidate(
      { source: 'description_fallback', language: requestedLanguage || 'en', requested: requestedLanguage || 'en', generated: true } as TranscriptSource,
      requestedLanguage || 'en',
      'best-effort',
      true,
      'no caption source available',
    ),
    toPlanCandidate(
      { source: 'chapters_fallback', language: requestedLanguage || 'en', requested: requestedLanguage || 'en', generated: true } as TranscriptSource,
      requestedLanguage || 'en',
      'best-effort',
      true,
      'no caption source available',
    ),
    toPlanCandidate(
      { source: 'metadata_fallback', language: requestedLanguage || 'en', requested: requestedLanguage || 'en', generated: true } as TranscriptSource,
      requestedLanguage || 'en',
      'best-effort',
      true,
      'no caption source available',
    ),
  );
}

function candidateMode(mode: TranscriptSourceMode): Exclude<TranscriptSourceMode, 'auto'> {
  return mode === 'auto' ? 'best-effort' : mode;
}

export function buildTranscriptPlan(inventory: TranscriptSourceInventory, options: TranscriptRequirement): TranscriptPlan {
  const requestedLanguage = options.language ?? 'en';
  const effectiveMode = candidateMode(options.sourceMode);
  const candidates: TranscriptPlan['candidates'] = [];

  if (options.sourceMode === 'manual') {
    addRequestedSourceCandidates(inventory.manual, requestedLanguage, 'manual', candidates);
    return {
      candidates: candidates.filter((candidate) => candidate.source === 'manual_subtitle' && candidate.language === requestedLanguage),
      effectiveMode,
    };
  }

  if (options.sourceMode === 'automatic') {
    addRequestedSourceCandidates(inventory.automatic, requestedLanguage, 'automatic', candidates);
    return {
      candidates: candidates.filter((candidate) => candidate.source === 'automatic_subtitle' && candidate.language === requestedLanguage),
      effectiveMode,
    };
  }

  if (options.sourceMode === 'translated') {
    addRequestedSourceCandidates(inventory.translated, requestedLanguage, 'translated', candidates);
    return {
      candidates: candidates.filter((candidate) => candidate.source === 'translated_subtitle' && candidate.language === requestedLanguage),
      effectiveMode,
    };
  }

  if (options.sourceMode === 'any-caption') {
    addRequestedSourceCandidates(inventory.manual, requestedLanguage, 'any-caption', candidates);
    addRequestedSourceCandidates(inventory.automatic, requestedLanguage, 'any-caption', candidates);
    addAlternateSourceCandidates(inventory.manual, requestedLanguage, 'any-caption', candidates);
    addAlternateSourceCandidates(inventory.automatic, requestedLanguage, 'any-caption', candidates);
    return {
      candidates: candidates.filter((candidate) => candidate.source === 'manual_subtitle' || candidate.source === 'automatic_subtitle'),
      effectiveMode,
    };
  }

  // best-effort / auto alias: prioritize reliable/original captions before translated fallbacks.
  addRequestedSourceCandidates(inventory.manual, requestedLanguage, 'best-effort', candidates);
  addOriginalSourceCandidates(inventory.manual, requestedLanguage, 'best-effort', candidates);
  addOriginalSourceCandidates(inventory.automatic, requestedLanguage, 'best-effort', candidates);
  addRequestedSourceCandidates(inventory.automatic, requestedLanguage, 'best-effort', candidates);
  addAlternateSourceCandidates(inventory.manual, requestedLanguage, 'best-effort', candidates);
  addAlternateSourceCandidates(inventory.automatic, requestedLanguage, 'best-effort', candidates);
  addRequestedSourceCandidates(inventory.translated, requestedLanguage, 'best-effort', candidates);
  addTranscriptFallbackCandidates(requestedLanguage, candidates);

  return {
    candidates,
    effectiveMode,
  };
}

export function pickTranscriptCandidate(plan: TranscriptPlan, mode?: TranscriptSourceMode): TranscriptSourceSelection {
  if (plan.candidates.length === 0) {
    const resolvedMode = mode ?? 'best-effort';
    throw new TranscriptFallbackError(`no transcript source available for mode ${resolvedMode}`);
  }

  const first = plan.candidates[0];
  return {
    source: first.source,
    language: first.language,
    sourceLanguage: first.language,
    generated: first.generated,
  };
}

export function buildTranscriptFallbackMessage(candidate: TranscriptSourceSelection, _sourceMode: TranscriptSourceMode): string {
  if (candidate.source === 'metadata_fallback') {
    return `Used metadata fallback text as transcript fallback for ${candidate.language}.`;
  }
  if (candidate.source === 'chapters_fallback') {
    return `Used chapter fallback text for ${candidate.language} because subtitles were unavailable.`;
  }
  if (candidate.source === 'description_fallback') {
    return `Used description fallback text for ${candidate.language} because subtitles were unavailable.`;
  }
  return `Using ${candidate.source} in ${candidate.language} (${candidate.generated ? 'generated' : 'manual'}).`;
}

export function isTranscriptSourceSelectable(source: TranscriptSourceSelection, requestedLanguage?: string): boolean {
  if (!requestedLanguage) return true;
  if (source.source === 'metadata_fallback' || source.source === 'chapters_fallback' || source.source === 'description_fallback') {
    return source.language === requestedLanguage;
  }
  return source.sourceLanguage === requestedLanguage;
}
