export type ToolStatus = 'success' | 'failure';

export interface ToolError {
  code:
    | 'validation_error'
    | 'yt_dlp_missing'
    | 'yt_dlp_failed'
    | 'not_found'
    | 'source_unavailable'
    | 'parse_error';
  message: string;
  recoverable: boolean;
  details?: Record<string, unknown>;
  install_hint?: string;
}

export type ToolResponse<T> =
  | { status: 'success'; data: T; warnings?: string[] }
  | { status: 'failure'; error: ToolError; warnings?: string[] };

export interface PiToolResult<T = unknown> {
  content: Array<{ type: 'text'; text: string }>;
  details?: ToolResponse<T>;
  isError?: boolean;
}

export type SearchType = 'video' | 'channel' | 'playlist' | 'all' | 'mixed';
export type EffectiveSearchType = 'video' | 'channel' | 'playlist' | 'mixed';
export type TranscriptSourceMode = 'auto' | 'manual' | 'automatic' | 'translated' | 'any-caption' | 'best-effort';

export type TranscriptContentSource =
  | 'manual_subtitle'
  | 'automatic_subtitle'
  | 'translated_subtitle'
  | 'description_fallback'
  | 'chapters_fallback'
  | 'metadata_fallback';

export interface YoutubeSearchInput {
  query: string;
  limit?: number;
  type?: SearchType;
  channel?: string;
  published_after?: string;
  published_before?: string;
  duration?: 'short' | 'medium' | 'long' | 'any';
  sort?: 'relevance' | 'date' | 'views' | 'rating';
  language?: string;
  topic_tags?: string[];
  enrich?: boolean;
  enrichLimit?: number;
  descriptionPreviewChars?: number;
}

export interface NormalizedSearchInput {
  query: string;
  limit: number;
  type: EffectiveSearchType;
  channel?: string;
  published_after?: string;
  published_before?: string;
  duration?: 'short' | 'medium' | 'long' | 'any';
  sort?: 'relevance' | 'date' | 'views' | 'rating';
  language?: string;
  topic_tags?: string[];
  enrich?: boolean;
  enrichLimit?: number;
  descriptionPreviewChars?: number;
}

export interface YoutubeSearchResult {
  result_type: 'video' | 'channel' | 'playlist' | 'unknown';
  title: string;
  url: string;
  video_id?: string | null;
  channel_id?: string | null;
  playlist_id?: string | null;
  channel_name?: string | null;
  description_snippet?: string | null;
  published_date?: string | null;
  duration?: number | null;
  view_count?: number | null;
  thumbnail_url?: string | null;
  language_hint?: string | null;
  description_preview?: string | null;
  like_count?: number | null;
  dislike_count?: number | null;
  comment_count?: number | null;
  chapters_count?: number | null;
  tags?: string[];
}

export interface VideoRefInput {
  url?: string;
  video_id?: string;
  includeComments?: boolean;
  commentsLimit?: number;
  commentsOffset?: number;
  descriptionPreviewChars?: number;
  cleanTranscript?: boolean;
}

export interface NormalizedVideoRef {
  url?: string;
  video_id?: string;
  videoUrl?: string;
  includeComments?: boolean;
  commentsLimit?: number;
  commentsOffset?: number;
  descriptionPreviewChars?: number;
  cleanTranscript?: boolean;
}

export interface YoutubeVideoComment {
  id: string;
  author?: string | null;
  text: string;
  like_count?: number | null;
  timestamp?: number | null;
  parent?: string | null;
}

export interface YoutubeVideoDetails {
  title: string;
  url: string;
  video_id: string;
  channel_name?: string | null;
  channel_id?: string | null;
  full_description?: string | null;
  description_preview?: string | null;
  published_date?: string | null;
  duration?: number | null;
  view_count?: number | null;
  like_count?: number | null;
  dislike_count?: number | null;
  comment_count?: number | null;
  tags?: string[];
  chapters?: Array<{ title: string; start_time?: number; end_time?: number }>;
  thumbnail_url?: string | null;
  caption_available?: boolean;
  caption_languages?: string[];
  automatic_caption_languages?: string[];
  comments_offset?: number;
  comments_limit?: number;
  comments_returned?: number;
  comments?: YoutubeVideoComment[];
}

export interface YoutubeTranscriptInput extends VideoRefInput {
  source_mode?: TranscriptSourceMode;
  language?: string;
}

export interface YoutubeTranscriptResult {
  video_ref: string;
  text: string;
  content_source: TranscriptContentSource;
  language: string;
  is_generated: boolean;
  used_fallback: boolean;
  fallback_reason?: string;
  source_mode_requested?: TranscriptSourceMode;
  source_mode_effective: 'manual' | 'automatic' | 'translated' | 'any-caption' | 'best-effort';
}

export interface YoutubeChannelSearchInput {
  query?: string;
  channel_id?: string;
  handle?: string;
  url?: string;
  limit?: number;
  includeVideos?: boolean;
  videosOffset?: number;
  videosLimit?: number;
  enrichVideos?: boolean;
  includePlaylists?: boolean;
  playlistsOffset?: number;
  playlistsLimit?: number;
  descriptionPreviewChars?: number;
}

export interface YoutubeChannelVideoEntry {
  title: string;
  url?: string | null;
  video_id?: string | null;
  duration?: number | null;
  description_preview?: string | null;
  published_date?: string | null;
  view_count?: number | null;
  like_count?: number | null;
  dislike_count?: number | null;
  comment_count?: number | null;
  chapters_count?: number | null;
  tags?: string[];
}

export interface YoutubeChannelPlaylistEntry {
  playlist_title: string;
  playlist_id?: string | null;
  url?: string | null;
  video_count?: number | null;
  description_preview?: string | null;
}

export interface YoutubeChannelResult {
  channel_name: string;
  url: string;
  channel_id?: string | null;
  description_snippet?: string | null;
  description_preview?: string | null;
  subscriber_count?: number | null;
  video_count?: number | null;
  handle?: string | null;
  thumbnail_url?: string | null;
  recent_videos?: YoutubeChannelVideoEntry[];
  playlists?: YoutubeChannelPlaylistEntry[];
  source_signals?: Record<string, unknown>;
}

export interface PlaylistRefInput {
  url?: string;
  playlist_id?: string;
  entriesOffset?: number;
  entriesLimit?: number;
  enrichEntries?: boolean;
  descriptionPreviewChars?: number;
}

export interface NormalizedPlaylistRef {
  url?: string;
  playlist_id?: string;
  entriesOffset: number;
  entriesLimit: number;
  enrichEntries: boolean;
  descriptionPreviewChars: number;
}

export interface YoutubePlaylistEntry {
  title: string;
  url?: string | null;
  video_id?: string | null;
  duration?: number | null;
  channel_name?: string | null;
  channel_id?: string | null;
  description_preview?: string | null;
  published_date?: string | null;
  view_count?: number | null;
  like_count?: number | null;
  dislike_count?: number | null;
  comment_count?: number | null;
  chapters_count?: number | null;
  tags?: string[];
}

export interface YoutubePlaylistDetails {
  playlist_title: string;
  playlist_id: string;
  url: string;
  channel_name?: string | null;
  channel_id?: string | null;
  uploader?: string | null;
  uploader_id?: string | null;
  description?: string | null;
  description_preview?: string | null;
  video_count?: number | null;
  view_count?: number | null;
  modified_date?: string | null;
  entries_offset: number;
  entries_limit: number;
  entries_returned: number;
  has_more_entries: boolean;
  next_entries_offset?: number | null;
  entries?: YoutubePlaylistEntry[];
}

export interface YtDlpRuntime {
  binary: string;
  version?: string;
}

export type YtDlpExecutor = (args: string[], options?: { signal?: AbortSignal; cwd?: string }) => Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}>;

export interface YtDlpClient {
  search(input: NormalizedSearchInput, signal?: AbortSignal): Promise<unknown[]>;
  getVideo(input: NormalizedVideoRef, signal?: AbortSignal): Promise<unknown>;
  getPlaylist(input: NormalizedPlaylistRef, signal?: AbortSignal): Promise<unknown>;
  searchChannels(input: YoutubeChannelSearchInput, signal?: AbortSignal): Promise<unknown[]>;
  getChannelAbout(input: YoutubeChannelSearchInput, signal?: AbortSignal): Promise<unknown>;
  getChannelVideos(input: YoutubeChannelSearchInput, signal?: AbortSignal): Promise<unknown>;
  getChannelPlaylists(input: YoutubeChannelSearchInput, signal?: AbortSignal): Promise<unknown>;
  listTranscriptSources(input: NormalizedVideoRef, signal?: AbortSignal): Promise<TranscriptSourceInventory>;
  fetchTranscript(input: TranscriptSourceSelection & { video_id?: string; url?: string }, signal?: AbortSignal): Promise<string>;
}

export interface TranscriptSource {
  source: TranscriptContentSource | string;
  language: string;
  requested: string;
  generated: boolean;
}

export interface TranscriptSourceInventory {
  manual: TranscriptSource[];
  automatic: TranscriptSource[];
  translated: TranscriptSource[];
}

export interface TranscriptSourceSelection {
  source: TranscriptContentSource;
  language: string;
  sourceLanguage: string;
  generated: boolean;
  video_id?: string;
  url?: string;
}

export interface TranscriptFallbackConfig {
  usedFallback: boolean;
  fallbackReason?: string;
  effectiveMode: Exclude<TranscriptSourceMode, 'auto'>;
}

export interface TranscriptPlan {
  candidates: Array<{ source: TranscriptContentSource; language: string; generated: boolean; sourceMode: TranscriptSourceMode; fallback: boolean; reason?: string }>;
  effectiveMode: Exclude<TranscriptSourceMode, 'auto'>;
}
