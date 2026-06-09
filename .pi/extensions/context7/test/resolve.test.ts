import { describe, expect, it } from 'vitest';
import { resolveLibraryCandidate } from '../src/resolve.js';
import type { LibraryCandidate } from '../src/types.js';

function candidate(overrides: Partial<LibraryCandidate>): LibraryCandidate {
  return {
    id: overrides.id ?? '/example/pkg',
    name: overrides.name ?? 'pkg',
    description: overrides.description ?? 'package documentation',
    totalSnippets: overrides.totalSnippets ?? 100,
    trustScore: overrides.trustScore ?? 7,
    benchmarkScore: overrides.benchmarkScore ?? 60,
    versions: overrides.versions,
  };
}

describe('context7 resolve scoring', () => {
  it('selects one exact best candidate with a rationale', () => {
    const result = resolveLibraryCandidate({
      libraryName: 'react',
      query: 'hooks useEffect',
      candidates: [
        candidate({ id: '/facebook/react', name: 'react', trustScore: 9, benchmarkScore: 90, totalSnippets: 1200 }),
        candidate({ id: '/reactjs/react-router', name: 'react-router', trustScore: 8, benchmarkScore: 80, totalSnippets: 800 }),
      ],
    });

    expect(result.status).toBe('selected');
    if (result.status === 'selected') {
      expect(result.selected.id).toBe('/facebook/react');
      expect(result.score).toBeGreaterThanOrEqual(45);
      expect(result.rationale).toContain('selected /facebook/react');
    }
  });

  it('returns ambiguity when multiple plausible candidates are close', () => {
    const result = resolveLibraryCandidate({
      libraryName: 'router',
      query: 'routing docs',
      candidates: [
        candidate({ id: '/alpha/router', name: 'router', trustScore: 8, benchmarkScore: 70, totalSnippets: 500 }),
        candidate({ id: '/beta/router', name: 'router', trustScore: 8, benchmarkScore: 69, totalSnippets: 490 }),
      ],
    });

    expect(result.status).toBe('ambiguous');
    if (result.status === 'ambiguous') {
      expect(result.candidates).toHaveLength(2);
      expect(result.rationale).toContain('ambiguous');
    }
  });

  it('returns no_results without selecting when candidates are empty', () => {
    const result = resolveLibraryCandidate({ libraryName: 'missing-lib', query: 'usage', candidates: [] });

    expect(result).toEqual({ status: 'no_results', candidates: [], rationale: 'No Context7 library candidates were found.' });
  });

  it('prefers candidates matching a requested version', () => {
    const result = resolveLibraryCandidate({
      libraryName: 'next.js',
      query: 'app router',
      version: '15.0.0',
      candidates: [
        candidate({ id: '/vercel/next.js', name: 'next.js', trustScore: 9, benchmarkScore: 95, versions: ['14.2.0'] }),
        candidate({ id: '/vercel/next.js/v15', name: 'next.js', trustScore: 8, benchmarkScore: 80, versions: ['15.0.0'] }),
      ],
    });

    expect(result.status).toBe('selected');
    if (result.status === 'selected') {
      expect(result.selected.id).toBe('/vercel/next.js/v15');
      expect(result.rationale).toContain('version 15.0.0');
    }
  });

  it('uses deterministic ID ordering for unresolved ties', () => {
    const result = resolveLibraryCandidate({
      libraryName: 'kit',
      query: 'install',
      candidates: [
        candidate({ id: '/zeta/kit', name: 'kit' }),
        candidate({ id: '/alpha/kit', name: 'kit' }),
      ],
    });

    expect(result.status).toBe('ambiguous');
    if (result.status === 'ambiguous') {
      expect(result.candidates.map((item) => item.candidate.id)).toEqual(['/alpha/kit', '/zeta/kit']);
    }
  });
});
