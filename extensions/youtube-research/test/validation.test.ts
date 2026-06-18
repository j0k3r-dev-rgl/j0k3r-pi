import { describe, expect, it } from 'vitest';
import { validateSearchFilters, normalizeSearchType, validateSearchDateRange, normalizeSourceMode, validateVideoOrTranscriptRef, validatePlaylistRef, validateChannelInput, normalizeSearchQuery } from '../src/validation.js';

describe('youtube-research validation logic', () => {
  it('validates required youtube_search query and accepted limits', () => {
    expect(() => validateSearchFilters({ query: '' })).toThrow('query is required');
    expect(() => validateSearchFilters({ query: 'hello', limit: 0 })).toThrow('limit must be');
    expect(() => validateSearchFilters({ query: 'hello', limit: 21 })).toThrow('limit must be');
    expect(validateSearchFilters({ query: 'hello' }).limit).toBe(10);
  });

  it('defaults search type to mixed/all and rejects invalid types', () => {
    expect(normalizeSearchType(undefined)).toBe('mixed');
    expect(normalizeSearchType('all')).toBe('mixed');
    expect(() => normalizeSearchType('article' as 'video')).toThrow('invalid search type');
    expect(normalizeSearchType('video')).toBe('video');
  });

  it('validates date filters and rejects reversed ranges', () => {
    expect(() => validateSearchDateRange('2024-13-01')).toThrow('published_after must be ISO YYYY-MM-DD');
    expect(() => validateSearchDateRange('2026-01-10', '2025-01-01')).toThrow('earlier than or equal');
  });

  it('validates and normalizes transcript source mode', () => {
    expect(normalizeSourceMode(undefined)).toBe('best-effort');
    expect(normalizeSourceMode('auto')).toBe('best-effort');
    expect(normalizeSourceMode('manual')).toBe('manual');
    expect(normalizeSourceMode('translated')).toBe('translated');
    expect(() => normalizeSourceMode('weird' as any)).toThrow('source_mode');
  });

  it('enforces exactly one URL/ID for video, transcript, and playlist references', () => {
    expect(() => validateVideoOrTranscriptRef({})).toThrow('exactly one of url or video_id is required');
    expect(() => validateVideoOrTranscriptRef({ url: 'https://youtu.be/a', video_id: 'abc' })).toThrow('exactly one of url or video_id is required');
    expect(() => validateVideoOrTranscriptRef({ url: 'https://youtu.be/a' })).not.toThrow();

    expect(() => validatePlaylistRef({})).toThrow('exactly one of url or playlist_id is required');
    expect(() => validatePlaylistRef({ url: 'https://youtube.com/playlist', playlist_id: 'PL123' })).toThrow('exactly one of url or playlist_id is required');
    expect(() => validatePlaylistRef({ playlist_id: 'PL123' })).not.toThrow();
  });

  it('validates channel input requires one identity field', () => {
    expect(() => validateChannelInput({})).toThrow('one of query, channel_id, handle, or url is required');
    expect(() => validateChannelInput({ query: 'open source' })).not.toThrow();
  });

  it('does not inject implicit technical bias into topic-free query normalization', () => {
    const normalized = normalizeSearchQuery({
      query: 'kubernetes networking',
      topic_tags: ['official', 'deep dive'],
    });
    expect(normalized).toContain('kubernetes networking');
    expect(normalized).toContain('official deep dive');
    expect(normalized).not.toContain('technical');
  });
});
