import { describe, expect, it } from 'vitest';
import {
  GRAPH_REFERENCE_KINDS,
  evaluateGraphUsability,
  getFindReferencesGraphCoverage,
  normalizeGraphLanguage,
} from '../../src/core/graph-policy.js';

describe('graph policy', () => {
  it('denies graph usage for disabled, unreadable, incompatible, and unusable graph states', () => {
    expect(evaluateGraphUsability({ graphEnabled: false, query: 'find_symbol' })).toEqual({
      usable: false,
      reason: 'graph_disabled',
    });

    expect(
      evaluateGraphUsability({
        graphEnabled: true,
        query: 'find_symbol',
        stateReadStatus: 'missing',
      })
    ).toEqual({ usable: false, reason: 'state_unreadable' });

    expect(
      evaluateGraphUsability({
        graphEnabled: true,
        query: 'find_symbol',
        stateReadStatus: 'ok',
        manifestReadStatus: 'incompatible',
      })
    ).toEqual({ usable: false, reason: 'manifest_unreadable' });

    for (const status of ['missing', 'stale', 'partial', 'errored', 'incompatible', 'refreshing'] as const) {
      expect(
        evaluateGraphUsability({
          graphEnabled: true,
          query: 'find_symbol',
          stateReadStatus: 'ok',
          manifestReadStatus: 'ok',
          stateStatus: status,
          language: 'ts',
        })
      ).toEqual({ usable: false, reason: 'status_unusable' });
    }
  });

  it('allows only fresh readable graph state for supported languages', () => {
    expect(
      evaluateGraphUsability({
        graphEnabled: true,
        query: 'find_symbol',
        stateReadStatus: 'ok',
        manifestReadStatus: 'ok',
        stateStatus: 'fresh',
        language: 'ts',
      })
    ).toEqual({ usable: true });

    expect(
      evaluateGraphUsability({
        graphEnabled: true,
        query: 'find_symbol',
        stateReadStatus: 'ok',
        manifestReadStatus: 'ok',
        stateStatus: 'fresh',
        language: 'py',
      })
    ).toEqual({ usable: false, reason: 'language_unsupported' });
  });

  it('normalizes only supported graph languages for explicit and auto inputs', () => {
    expect(normalizeGraphLanguage({ language: 'ts' })).toBe('ts');
    expect(normalizeGraphLanguage({ language: 'js' })).toBe('js');
    expect(normalizeGraphLanguage({ language: 'java' })).toBe('java');
    expect(normalizeGraphLanguage({ language: 'auto', path: '/tmp/example.ts' })).toBe('ts');
    expect(normalizeGraphLanguage({ language: 'auto', path: '/tmp/example.js' })).toBe('js');
    expect(normalizeGraphLanguage({ language: 'auto', path: '/tmp/App.java' })).toBe('java');
    expect(normalizeGraphLanguage({ language: 'auto', path: '/tmp/example.py' })).toBeUndefined();
    expect(normalizeGraphLanguage({ language: 'py' })).toBeUndefined();
    expect(normalizeGraphLanguage({ language: 'auto', path: '/tmp/example.txt' })).toBeUndefined();
  });

  it('limits graph reference coverage to call, implements, and extends', () => {
    expect([...GRAPH_REFERENCE_KINDS].sort()).toEqual(['call', 'extends', 'implements']);

    expect(getFindReferencesGraphCoverage({ path: 'src/a.ts', symbol: 'helper', language: 'ts', kind: 'function' })).toEqual({
      requiredReferenceKinds: undefined,
      graphCoverageMode: 'conservative-fallback',
    });

    expect(
      evaluateGraphUsability({
        graphEnabled: true,
        query: 'find_references',
        stateReadStatus: 'ok',
        manifestReadStatus: 'ok',
        stateStatus: 'fresh',
        language: 'java',
        requiredReferenceKinds: ['call', 'implements'],
      })
    ).toEqual({ usable: true });

    expect(
      evaluateGraphUsability({
        graphEnabled: true,
        query: 'find_references',
        stateReadStatus: 'ok',
        manifestReadStatus: 'ok',
        stateStatus: 'fresh',
        language: 'java',
        requiredReferenceKinds: ['call', 'import'],
      })
    ).toEqual({ usable: false, reason: 'coverage_insufficient' });

    expect(
      evaluateGraphUsability({
        graphEnabled: true,
        query: 'find_references',
        stateReadStatus: 'ok',
        manifestReadStatus: 'ok',
        stateStatus: 'fresh',
        language: 'java',
        requiredReferenceKinds: undefined,
      })
    ).toEqual({ usable: false, reason: 'coverage_insufficient' });
  });
});
