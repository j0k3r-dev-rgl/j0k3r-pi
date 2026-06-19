import { PLAYLIST_ACCESSIBLE_ENTRY_WINDOW } from './validation.js';
import type {
  YoutubeSearchResult,
  YoutubeVideoDetails,
  YoutubeChannelResult,
  YoutubePlaylistDetails,
  YoutubeChannelSearchInput,
  YoutubeVideoComment,
  YoutubePlaylistEntry,
} from './types.js';

export interface RawYtDlpItem {
  [key: string]: unknown;
}

function toStringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function toNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function toBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function normalizeVideoComments(value: unknown): YoutubeVideoComment[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const comments: YoutubeVideoComment[] = [];
  for (const entry of value) {
    const raw = entry as Record<string, unknown>;
    const id = toStringOrUndefined(raw.id);
    const text = toStringOrUndefined(raw.text);
    if (!id || !text) {
      continue;
    }
    comments.push({
      id,
      author: toStringOrUndefined(raw.author) ?? null,
      text,
      like_count: toNumber(raw.like_count) ?? null,
      timestamp: toNumber(raw.timestamp) ?? null,
      parent: toStringOrUndefined(raw.parent) ?? null,
    });
  }
  return comments;
}

function pickUrl(raw: RawYtDlpItem): string {
  return toStringOrUndefined(raw.webpage_url) ?? toStringOrUndefined((raw as { url?: unknown }).url) ?? 'unknown';
}

function classifySearchResultType(raw: RawYtDlpItem): YoutubeSearchResult['result_type'] {
  if (raw._type === 'video' || raw._type === 'channel' || raw._type === 'playlist') {
    return raw._type as YoutubeSearchResult['result_type'];
  }

  const ieKey = toStringOrUndefined(raw.ie_key);
  const url = pickUrl(raw);

  if (ieKey === 'Youtube') {
    if (/youtube\.com\/watch\?/i.test(url) || /youtu\.be\//i.test(url) || /youtube\.com\/shorts\//i.test(url) || /youtube\.com\/embed\//i.test(url)) {
      return 'video';
    }
  }

  if (ieKey === 'YoutubePlaylist' || /youtube\.com\/playlist/i.test(url) || /[?&]list=/.test(url)) {
    return 'playlist';
  }

  if (ieKey === 'YoutubeTab') {
    if (/youtube\.com\/(?:channel|c|user)\//i.test(url) || /youtube\.com\/@/i.test(url)) {
      return 'channel';
    }
    if (/youtube\.com\/playlist/i.test(url) || /[?&]list=/.test(url)) {
      return 'playlist';
    }
  }

  return 'unknown';
}

function formatYtDlpDate(value: string): string | null {
  const clean = value.replace(/[^0-9]/g, '');
  if (clean.length === 8) {
    const y = clean.slice(0, 4);
    const m = clean.slice(4, 6);
    const d = clean.slice(6, 8);
    return `${y}-${m}-${d}`;
  }
  return null;
}

function pickPublishedDate(raw: RawYtDlpItem): string | null {
  const uploadDate = toStringOrUndefined(raw.upload_date);
  if (uploadDate) {
    return formatYtDlpDate(uploadDate);
  }
  const unix = toNumber(raw.timestamp);
  if (typeof unix === 'number') {
    return new Date(unix * 1000).toISOString().slice(0, 10);
  }
  return null;
}

function firstThumbnail(raw: RawYtDlpItem): string | null {
  const direct = toStringOrUndefined(raw.thumbnail);
  if (direct) return direct;
  const thumbs = raw.thumbnails;
  if (Array.isArray(thumbs) && thumbs.length > 0) {
    const first = thumbs[0] as { url?: unknown };
    return toStringOrUndefined(first?.url) ?? null;
  }
  return null;
}

export function normalizeSearchResult(raw: RawYtDlpItem): YoutubeSearchResult {
  const resultType = classifySearchResultType(raw);

  const title = toStringOrUndefined(raw.title) ?? 'untitled';
  const id = toStringOrUndefined(raw.id);

  return {
    result_type: resultType,
    title,
    url: pickUrl(raw),
    video_id: resultType === 'video' ? id ?? null : undefined,
    channel_id: toStringOrUndefined(raw.channel_id) ?? toStringOrUndefined(raw.uploader_id) ?? null,
    playlist_id: resultType === 'playlist' ? id ?? null : undefined,
    channel_name: toStringOrUndefined(raw.channel) ?? toStringOrUndefined(raw.uploader) ?? null,
    description_snippet: toStringOrUndefined(raw.description) ?? toStringOrUndefined(raw.description_note) ?? null,
    published_date: pickPublishedDate(raw),
    duration: toNumber(raw.duration) ?? null,
    view_count: toNumber(raw.view_count) ?? null,
    thumbnail_url: firstThumbnail(raw),
    language_hint: toStringOrUndefined((raw as { language?: unknown }).language) ?? null,
  };
}

export function normalizeSearchResults(raw: RawYtDlpItem[]): YoutubeSearchResult[] {
  return raw.map((item) => normalizeSearchResult(item));
}

export function normalizeVideoDetails(raw: RawYtDlpItem): YoutubeVideoDetails {
  const subtitles =
    typeof raw.subtitles === 'object' && raw.subtitles !== null
      ? raw.subtitles
      : {};
  const automaticCaptions =
    typeof raw.automatic_captions === 'object' && raw.automatic_captions !== null
      ? raw.automatic_captions
      : {};

  const subtitleLanguages = Object.keys(subtitles as Record<string, unknown>);
  const autoLanguages = Object.keys(automaticCaptions as Record<string, unknown>);

  return {
    title: toStringOrUndefined(raw.title) ?? 'untitled',
    url: pickUrl(raw),
    video_id: toStringOrUndefined(raw.id) ?? 'unknown',
    channel_name: toStringOrUndefined(raw.uploader) ?? toStringOrUndefined((raw as { channel?: unknown }).channel) ?? null,
    channel_id: toStringOrUndefined(raw.channel_id) ?? toStringOrUndefined(raw.uploader_id) ?? null,
    full_description: toStringOrUndefined(raw.description) ?? null,
    published_date: pickPublishedDate(raw),
    duration: toNumber(raw.duration) ?? null,
    view_count: toNumber(raw.view_count) ?? null,
    like_count: toNumber(raw.like_count) ?? null,
    dislike_count: toNumber(raw.dislike_count) ?? null,
    comment_count: toNumber(raw.comment_count) ?? null,
    tags: Array.isArray(raw.tags) ? raw.tags.filter((tag): tag is string => typeof tag === 'string') : undefined,
    chapters: Array.isArray(raw.chapters)
      ? (raw.chapters as Array<Record<string, unknown>>).map((chapter) => ({
          title: toStringOrUndefined(chapter.title) ?? 'Untitled chapter',
          start_time: toNumber(chapter.start_time) ?? undefined,
          end_time: toNumber(chapter.end_time) ?? undefined,
        }))
      : [],
    thumbnail_url: firstThumbnail(raw),
    caption_available: subtitleLanguages.length > 0 || autoLanguages.length > 0 || toBoolean(raw.always_rewrite) === true,
    caption_languages: subtitleLanguages,
    automatic_caption_languages: autoLanguages,
    comments: normalizeVideoComments(raw.comments),
  };
}

export function normalizeChannelResult(raw: RawYtDlpItem): YoutubeChannelResult {
  const playlistChannelName = toStringOrUndefined((raw as { playlist_channel?: unknown }).playlist_channel)
    ?? toStringOrUndefined((raw as { playlist_uploader?: unknown }).playlist_uploader);
  const playlistChannelId = toStringOrUndefined((raw as { playlist_channel_id?: unknown }).playlist_channel_id)
    ?? toStringOrUndefined((raw as { playlist_id?: unknown }).playlist_id);
  const playlistChannelUrl = toStringOrUndefined((raw as { playlist_webpage_url?: unknown }).playlist_webpage_url);
  const channelName = playlistChannelName ?? toStringOrUndefined(raw.title) ?? toStringOrUndefined(raw.channel) ?? 'unknown channel';

  return {
    channel_name: channelName,
    url: playlistChannelUrl ?? toStringOrUndefined(raw.webpage_url) ?? toStringOrUndefined(raw.channel_url) ?? 'unknown',
    channel_id: playlistChannelId ?? toStringOrUndefined(raw.channel_id) ?? toStringOrUndefined(raw.id) ?? null,
    description_snippet: toStringOrUndefined(raw.description) ?? null,
    subscriber_count:
      toNumber(raw.channel_follower_count) ?? toNumber((raw as { subscriber_count?: unknown }).subscriber_count) ?? null,
    video_count: toNumber(raw.channel_video_count) ?? toNumber((raw as { video_count?: unknown }).video_count) ?? null,
    handle: toStringOrUndefined((raw as { playlist_uploader_id?: unknown }).playlist_uploader_id)
      ?? toStringOrUndefined(raw.channel)
      ?? toStringOrUndefined(raw.uploader)
      ?? null,
    source_signals: {
      isVerified: !!toBoolean((raw as { is_verified?: unknown }).is_verified),
      rawType: toStringOrUndefined((raw as { _type?: unknown })._type) ?? null,
    },
  };
}

export function normalizePlaylistEntry(item: RawYtDlpItem, descriptionPreviewChars = 500): YoutubePlaylistEntry {
  const id = toStringOrUndefined(item.id) ?? toStringOrUndefined(item.video_id) ?? null;
  const description = toStringOrUndefined(item.description) ?? null;
  const rawUrl = toStringOrUndefined(item.webpage_url) ?? toStringOrUndefined(item.url);
  const url = rawUrl && /^https?:\/\//i.test(rawUrl) ? rawUrl : id ? `https://www.youtube.com/watch?v=${id}` : rawUrl ?? null;
  return {
    title: toStringOrUndefined(item.title) ?? 'untitled',
    url,
    video_id: id,
    duration: toNumber(item.duration) ?? null,
    channel_name: toStringOrUndefined(item.channel) ?? toStringOrUndefined(item.uploader) ?? null,
    channel_id: toStringOrUndefined(item.channel_id) ?? toStringOrUndefined(item.uploader_id) ?? null,
    description_preview: description ? compactText(description, descriptionPreviewChars) : null,
    published_date: pickPublishedDate(item),
    view_count: toNumber(item.view_count) ?? null,
    like_count: toNumber(item.like_count) ?? null,
    dislike_count: toNumber(item.dislike_count) ?? null,
    comment_count: toNumber(item.comment_count) ?? null,
    chapters_count: Array.isArray(item.chapters) ? item.chapters.length : null,
    tags: Array.isArray(item.tags) ? item.tags.filter((tag): tag is string => typeof tag === 'string').slice(0, 8) : undefined,
  };
}

function compactText(value: string, max: number): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export function normalizePlaylistDetails(
  raw: RawYtDlpItem,
  options: { entriesOffset?: number; entriesLimit?: number; descriptionPreviewChars?: number } = {},
): YoutubePlaylistDetails {
  const descriptionPreviewChars = options.descriptionPreviewChars ?? 500;
  const entries = Array.isArray((raw as { entries?: unknown }).entries)
    ? ((raw as { entries?: unknown[] }).entries ?? []).map((entry) => normalizePlaylistEntry(entry as RawYtDlpItem, descriptionPreviewChars))
    : undefined;
  const total = toNumber((raw as { playlist_count?: unknown }).playlist_count) ?? entries?.length ?? null;
  const entriesOffset = options.entriesOffset ?? 0;
  const entriesLimit = options.entriesLimit ?? entries?.length ?? 0;
  const entriesReturned = entries?.length ?? 0;
  const nextOffset = entriesOffset + entriesReturned;
  const accessibleTotal = total === null ? null : Math.min(total, PLAYLIST_ACCESSIBLE_ENTRY_WINDOW);
  const hasMoreEntries = accessibleTotal !== null ? nextOffset < accessibleTotal : entriesReturned >= entriesLimit;
  const modifiedDate = toStringOrUndefined((raw as { modified_date?: unknown }).modified_date);
  const description = toStringOrUndefined(raw.description) ?? null;

  return {
    playlist_title: toStringOrUndefined(raw.title) ?? 'untitled',
    playlist_id: toStringOrUndefined(raw.id) ?? 'unknown',
    url: toStringOrUndefined(raw.webpage_url) ?? 'unknown',
    channel_name: toStringOrUndefined((raw as { channel?: unknown }).channel) ?? null,
    channel_id: toStringOrUndefined(raw.channel_id) ?? null,
    uploader: toStringOrUndefined(raw.uploader) ?? null,
    uploader_id: toStringOrUndefined(raw.uploader_id) ?? null,
    description,
    description_preview: description ? compactText(description, descriptionPreviewChars) : null,
    video_count: total,
    view_count: toNumber(raw.view_count) ?? null,
    modified_date: modifiedDate ? formatYtDlpDate(modifiedDate) : null,
    entries_offset: entriesOffset,
    entries_limit: entriesLimit,
    entries_returned: entriesReturned,
    has_more_entries: hasMoreEntries,
    next_entries_offset: hasMoreEntries ? nextOffset : null,
    entries,
  };
}

export function normalizeChannelSearchInput(raw: RawYtDlpItem): YoutubeChannelSearchInput {
  return {
    query: toStringOrUndefined((raw as { query?: unknown }).query) ?? toStringOrUndefined((raw as { channel_name?: unknown }).channel_name) ?? toStringOrUndefined(raw.id),
    limit: toNumber((raw as { limit?: unknown }).limit),
    channel_id: toStringOrUndefined((raw as { channel_id?: unknown }).channel_id),
    handle: toStringOrUndefined((raw as { handle?: unknown }).handle),
    url: pickUrl(raw),
  };
}
