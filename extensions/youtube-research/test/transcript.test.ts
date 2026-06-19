import { describe, expect, it } from 'vitest';
import {
  buildTranscriptPlan,
  pickTranscriptCandidate,
  TranscriptFallbackError,
  isTranscriptSourceSelectable,
} from '../src/transcript.js';

describe('youtube-research transcript fallback engine', () => {
  const onlyManual = {
    manual: [{ source: 'manual_subtitle', language: 'en', requested: 'en', generated: false }],
    automatic: [],
    translated: [],
  };

  const onlyAuto = {
    manual: [],
    automatic: [{ source: 'automatic_subtitle', language: 'en', requested: 'en', generated: true }],
    translated: [],
  };

  const mixedWithManualAlternate = {
    manual: [
      { source: 'manual_subtitle', language: 'en', requested: 'en', generated: false },
      { source: 'manual_subtitle', language: 'fr', requested: 'fr', generated: false },
    ],
    automatic: [{ source: 'automatic_subtitle', language: 'en', requested: 'en', generated: true }],
    translated: [{ source: 'translated_subtitle', language: 'es', requested: 'es', generated: true }],
  };

  it('fails restrictive manual mode when manual captions are unavailable', () => {
    const plan = buildTranscriptPlan(onlyAuto, { sourceMode: 'manual', language: 'en' });
    expect(plan.candidates).toHaveLength(0);
    expect(() => pickTranscriptCandidate(plan, 'manual')).toThrow('manual');
  });

  it('fails restrictive automatic mode when automatic captions are unavailable', () => {
    const plan = buildTranscriptPlan(onlyManual, { sourceMode: 'automatic', language: 'en' });
    expect(plan.candidates).toHaveLength(0);
    expect(() => pickTranscriptCandidate(plan, 'automatic')).toThrow('automatic');
  });

  it('does not allow transcript fallback in any-caption mode', () => {
    const plan = buildTranscriptPlan(onlyManual, { sourceMode: 'any-caption', language: 'en' });
    expect(plan.candidates.every((candidate) => candidate.source !== 'metadata_fallback')).toBe(true);
  });

  it('uses strict manual-requested -> automatic-requested -> alternate order for best-effort', () => {
    const plan = buildTranscriptPlan(mixedWithManualAlternate, { sourceMode: 'best-effort', language: 'en' });
    expect(plan.candidates.slice(0, 4).map((candidate) => `${candidate.source}:${candidate.language}:${candidate.fallback}`)).toEqual([
      'manual_subtitle:en:false',
      'automatic_subtitle:en:false',
      'manual_subtitle:fr:true',
      'description_fallback:en:true',
    ]);
    expect(plan.candidates[0].fallback).toBe(false);
    expect(plan.candidates[1].fallback).toBe(false);
  });

  it('reports selection eligibility with explicit false when language mismatched and candidate is strict', () => {
    expect(isTranscriptSourceSelectable({ source: 'manual_subtitle', language: 'fr', sourceLanguage: 'fr', generated: false }, 'en')).toBe(false);
    expect(isTranscriptSourceSelectable({ source: 'metadata_fallback', language: 'en', sourceLanguage: 'en', generated: true }, 'en')).toBe(true);
  });

  it('throws a stable typed error for translated-only failures', () => {
    const plan = buildTranscriptPlan({ manual: [], automatic: [], translated: [] }, { sourceMode: 'translated', language: 'en' });
    expect(() => pickTranscriptCandidate(plan, 'translated')).toThrowError(TranscriptFallbackError);
  });

  it('prefers original automatic captions before requested translated captions in best-effort', () => {
    const plan = buildTranscriptPlan(
      {
        manual: [],
        automatic: [
          { source: 'automatic_subtitle', language: 'es', requested: 'es', generated: true },
          { source: 'automatic_subtitle', language: 'en-orig', requested: 'en-orig', generated: true },
        ],
        translated: [{ source: 'translated_subtitle', language: 'es', requested: 'es', generated: true }],
      },
      { sourceMode: 'best-effort', language: 'es' },
    );

    expect(plan.candidates[0].source).toBe('automatic_subtitle');
    expect(plan.candidates[0].language).toBe('en-orig');
    expect(plan.candidates.findIndex((candidate) => candidate.source === 'translated_subtitle')).toBeGreaterThan(0);
  });

  it('prefers translated source only after caption alternatives in best-effort', () => {
    const plan = buildTranscriptPlan(
      {
        manual: [{ source: 'manual_subtitle', language: 'en', requested: 'en', generated: false }],
        automatic: [{ source: 'automatic_subtitle', language: 'es', requested: 'es', generated: true }],
        translated: [{ source: 'translated_subtitle', language: 'en', requested: 'en', generated: true }],
      },
      { sourceMode: 'best-effort', language: 'en' },
    );

    const first = pickTranscriptCandidate(plan, 'best-effort');
    expect(first.source).toBe('manual_subtitle');

    const fallbackIndex = plan.candidates.findIndex((candidate) => candidate.source === 'translated_subtitle' && candidate.language === 'en');
    expect(fallbackIndex).toBeGreaterThan(plan.candidates.findIndex((candidate) => candidate.source === 'automatic_subtitle'));
  });
});
