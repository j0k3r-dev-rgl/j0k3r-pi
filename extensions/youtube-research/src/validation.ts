import type {
  YoutubeSearchInput,
  YoutubeChannelSearchInput,
  YoutubeTranscriptInput,
  PlaylistRefInput,
  VideoRefInput,
  TranscriptSourceMode,
  NormalizedSearchInput,
  EffectiveSearchType,
} from './types.js';

export const SEARCH_LIMIT_MAX = 20;
export const SEARCH_LIMIT_MIN = 1;

export const SEARCH_TYPES: Array<YoutubeSearchInput['type']> = ['video', 'channel', 'playlist', 'all', 'mixed'];
export const SEARCH_DURATIONS: Array<NonNullable<YoutubeSearchInput['duration']>> = ['short', 'medium', 'long', 'any'];
export const SEARCH_SORTS: Array<NonNullable<YoutubeSearchInput['sort']>> = ['relevance', 'date', 'views', 'rating'];
export const SEARCH_ENRICH_DEFAULT_LIMIT = 3;
export const SEARCH_ENRICH_MAX_LIMIT = 5;
export const SEARCH_DESCRIPTION_PREVIEW_DEFAULT_CHARS = 300;
export const SEARCH_DESCRIPTION_PREVIEW_MAX_CHARS = 2000;
export const PLAYLIST_ENTRIES_DEFAULT_LIMIT = 10;
export const PLAYLIST_ENTRIES_MAX_LIMIT = 100;
export const PLAYLIST_ENTRIES_MAX_OFFSET = 99;
export const PLAYLIST_ACCESSIBLE_ENTRY_WINDOW = 100;
export const PLAYLIST_DESCRIPTION_PREVIEW_DEFAULT_CHARS = 500;
export const PLAYLIST_DESCRIPTION_PREVIEW_MAX_CHARS = 2000;
export const CHANNEL_LIMIT_DEFAULT = 5;
export const CHANNEL_LIMIT_MAX = 20;
export const CHANNEL_VIDEOS_DEFAULT_LIMIT = 5;
export const CHANNEL_VIDEOS_MAX_LIMIT = 20;
export const CHANNEL_PLAYLISTS_DEFAULT_LIMIT = 5;
export const CHANNEL_PLAYLISTS_MAX_LIMIT = 20;
export const CHANNEL_OFFSET_MAX = 99;
export const CHANNEL_DESCRIPTION_PREVIEW_DEFAULT_CHARS = 500;
export const CHANNEL_DESCRIPTION_PREVIEW_MAX_CHARS = 2000;
export const TRANSCRIPT_SOURCE_MODES: TranscriptSourceMode[] = ['auto', 'manual', 'automatic', 'translated', 'any-caption', 'best-effort'];

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const [year, month, day] = value.split('-').map((part) => Number.parseInt(part, 10));
  const date = new Date(`${value}T00:00:00.000Z`);

  return (
    Number.isFinite(year) &&
    Number.isFinite(month) &&
    Number.isFinite(day) &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() + 1 === month &&
    date.getUTCDate() === day
  );
}

export function normalizeSearchType(input?: YoutubeSearchInput['type']): EffectiveSearchType {
  if (input === undefined || input === 'all' || input === 'mixed') return 'mixed';
  if (input === 'video' || input === 'channel' || input === 'playlist') return input;
  throw new Error(`invalid search type: ${String(input)}`);
}

export function validateSearchType(input?: YoutubeSearchInput['type']): void {
  if (input === undefined) return;
  if (!SEARCH_TYPES.includes(input)) throw new Error(`invalid search type: ${String(input)}`);
}

export function normalizeLimit(input: unknown): number {
  if (input === undefined) return 10;
  if (typeof input !== 'number' || !Number.isInteger(input)) throw new Error('limit must be an integer');
  if (input < SEARCH_LIMIT_MIN || input > SEARCH_LIMIT_MAX) throw new Error(`limit must be between ${SEARCH_LIMIT_MIN} and ${SEARCH_LIMIT_MAX}`);
  return input;
}

export function validateSearchDateRange(after?: string, before?: string): void {
  if (after !== undefined && !isIsoDate(after)) {
    throw new Error('published_after must be ISO YYYY-MM-DD');
  }
  if (before !== undefined && !isIsoDate(before)) {
    throw new Error('published_before must be ISO YYYY-MM-DD');
  }

  if (after && before && new Date(`${after}T00:00:00.000Z`) > new Date(`${before}T00:00:00.000Z`)) {
    throw new Error('published_after must be earlier than or equal to published_before');
  }
}

export function validateSearchFilters(input: YoutubeSearchInput): NormalizedSearchInput {
  if (!input.query || !input.query.trim()) {
    throw new Error('query is required');
  }
  if (input.duration !== undefined && !SEARCH_DURATIONS.includes(input.duration)) {
    throw new Error(`duration must be one of ${SEARCH_DURATIONS.join(', ')}`);
  }
  if (input.sort !== undefined && !SEARCH_SORTS.includes(input.sort)) {
    throw new Error(`sort must be one of ${SEARCH_SORTS.join(', ')}`);
  }
  validateSearchType(input.type);
  const limit = normalizeLimit(input.limit);
  validateSearchDateRange(input.published_after, input.published_before);

  const type = normalizeSearchType(input.type);
  const rawInput = input as unknown as Record<string, unknown>;

  return {
    query: normalizeSearchQuery(input),
    limit,
    type,
    channel: input.channel,
    published_after: input.published_after,
    published_before: input.published_before,
    duration: input.duration,
    sort: input.sort,
    language: input.language,
    topic_tags: input.topic_tags,
    enrich: optionalBoolean(rawInput, 'enrich', false),
    enrichLimit: boundedInteger(rawInput, 'enrichLimit', SEARCH_ENRICH_DEFAULT_LIMIT, SEARCH_ENRICH_MAX_LIMIT),
    descriptionPreviewChars: boundedInteger(rawInput, 'descriptionPreviewChars', SEARCH_DESCRIPTION_PREVIEW_DEFAULT_CHARS, SEARCH_DESCRIPTION_PREVIEW_MAX_CHARS),
  };
}

export function normalizeSearchTopicQuery(input: YoutubeSearchInput): string {
  const topicSuffix = (input.topic_tags ?? []).filter(Boolean).map((tag) => tag.trim()).filter(Boolean).join(' ');
  const baseQuery = input.query.trim();
  return [baseQuery, topicSuffix].filter(Boolean).join(' ').trim();
}

export function normalizeSearchQuery(input: YoutubeSearchInput): string {
  return normalizeSearchTopicQuery(input);
}

export function normalizeSourceMode(input: unknown): Exclude<TranscriptSourceMode, 'auto'> {
  if (input === 'auto' || input === undefined) return 'best-effort';
  if (input === 'manual' || input === 'automatic' || input === 'translated' || input === 'any-caption' || input === 'best-effort') return input;
  throw new Error('source_mode must be one of auto, manual, automatic, translated, any-caption, best-effort');
}

function optionalBoolean(input: Record<string, unknown>, key: string, defaultValue: boolean): boolean {
  const value = input[key];
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  if (typeof value !== 'boolean') {
    throw new Error(`${key} must be a boolean`);
  }
  return value;
}

function boundedInteger(input: Record<string, unknown>, key: string, defaultValue: number, maxValue: number): number {
  const value = input[key];
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`${key} must be an integer`);
  }
  if (value < 1 || value > maxValue) {
    throw new Error(`${key} must be between 1 and ${maxValue}`);
  }
  return value;
}

function boundedNonNegativeInteger(input: Record<string, unknown>, key: string, defaultValue: number, maxValue: number): number {
  const value = input[key];
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`${key} must be an integer`);
  }
  if (value < 0 || value > maxValue) {
    throw new Error(`${key} must be between 0 and ${maxValue}`);
  }
  return value;
}

function hasExactlyOneRef(ref: Partial<Record<string, string>>, keys: string[]): boolean {
  const present = keys.filter((key) => {
    const value = ref[key];
    return typeof value === 'string' && value.trim().length > 0;
  });
  return present.length === 1;
}

export function validateVideoOrTranscriptRef(input: VideoRefInput | YoutubeTranscriptInput): void {
  if (!hasExactlyOneRef(input as Partial<Record<string, string>>, ['url', 'video_id'])) {
    throw new Error('exactly one of url or video_id is required');
  }
}

export function validatePlaylistRef(input: PlaylistRefInput): void {
  if (!hasExactlyOneRef(input as Partial<Record<string, string>>, ['url', 'playlist_id'])) {
    throw new Error('exactly one of url or playlist_id is required');
  }
  const rawInput = input as unknown as Record<string, unknown>;
  boundedNonNegativeInteger(rawInput, 'entriesOffset', 0, PLAYLIST_ENTRIES_MAX_OFFSET);
  boundedInteger(rawInput, 'entriesLimit', PLAYLIST_ENTRIES_DEFAULT_LIMIT, PLAYLIST_ENTRIES_MAX_LIMIT);
  optionalBoolean(rawInput, 'enrichEntries', false);
  boundedInteger(rawInput, 'descriptionPreviewChars', PLAYLIST_DESCRIPTION_PREVIEW_DEFAULT_CHARS, PLAYLIST_DESCRIPTION_PREVIEW_MAX_CHARS);
}

export function validateChannelInput(input: YoutubeChannelSearchInput): void {
  const keys = ['query', 'channel_id', 'handle', 'url'] as Array<keyof YoutubeChannelSearchInput>;
  const present = keys.filter((key) => {
    const value = input[key];
    return typeof value === 'string' && value.trim().length > 0;
  });
  if (present.length === 0) {
    throw new Error('one of query, channel_id, handle, or url is required');
  }
  if (present.length > 1) {
    throw new Error('exactly one of query, channel_id, handle, or url is required');
  }
  const rawInput = input as unknown as Record<string, unknown>;
  boundedInteger(rawInput, 'limit', CHANNEL_LIMIT_DEFAULT, CHANNEL_LIMIT_MAX);
  boundedNonNegativeInteger(rawInput, 'videosOffset', 0, CHANNEL_OFFSET_MAX);
  boundedInteger(rawInput, 'videosLimit', CHANNEL_VIDEOS_DEFAULT_LIMIT, CHANNEL_VIDEOS_MAX_LIMIT);
  boundedNonNegativeInteger(rawInput, 'playlistsOffset', 0, CHANNEL_OFFSET_MAX);
  boundedInteger(rawInput, 'playlistsLimit', CHANNEL_PLAYLISTS_DEFAULT_LIMIT, CHANNEL_PLAYLISTS_MAX_LIMIT);
  optionalBoolean(rawInput, 'includeVideos', false);
  optionalBoolean(rawInput, 'enrichVideos', false);
  optionalBoolean(rawInput, 'includePlaylists', false);
  boundedInteger(rawInput, 'descriptionPreviewChars', CHANNEL_DESCRIPTION_PREVIEW_DEFAULT_CHARS, CHANNEL_DESCRIPTION_PREVIEW_MAX_CHARS);
}
