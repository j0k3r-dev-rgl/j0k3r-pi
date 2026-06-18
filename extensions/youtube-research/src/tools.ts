import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Type } from 'typebox';
import { checkYtDlpRuntime, YT_DLP_INSTALL_HINT } from './runtime.js';
import { YoutubeResearchClient } from './client.js';
import {
  validateSearchFilters,
  validateVideoOrTranscriptRef,
  validatePlaylistRef,
  validateChannelInput,
  normalizeSourceMode,
} from './validation.js';
import {
  normalizeSearchResults,
  normalizeSearchResult,
  normalizeVideoDetails,
  normalizeChannelResult,
  normalizePlaylistDetails,
  RawYtDlpItem,
} from './normalize.js';
import {
  buildTranscriptPlan,
  pickTranscriptCandidate,
  TranscriptFallbackError,
} from './transcript.js';
import {
  ToolResponse,
  PiToolResult,
  ToolError,
  YoutubeSearchInput,
  VideoRefInput,
  YoutubeTranscriptInput,
  YoutubeChannelSearchInput,
  PlaylistRefInput,
  NormalizedSearchInput,
  YoutubeSearchResult,
  YoutubeVideoDetails,
  YoutubeTranscriptResult,
  NormalizedVideoRef,
  NormalizedPlaylistRef,
  YtDlpClient,
  YtDlpRuntime,
  TranscriptSource,
} from './types.js';

const execFileAsync = promisify(execFile);

export const YOUTUBE_RESEARCH_TOOL_NAMES = [
  'youtube_search',
  'youtube_video_get',
  'youtube_transcript_get',
  'youtube_channel_search',
  'youtube_playlist_get',
] as const;

type RuntimeDependencyResult =
  | {
      runtime: YtDlpRuntime;
    }
  | {
      error: ToolError;
    };

export interface RegisterYoutubeResearchToolsDeps {
  checkRuntime?: typeof checkYtDlpRuntime;
  createClient?: (runtime: YtDlpRuntime) => YtDlpClient;
}

function isErrorLike(
  error: unknown,
): error is {
  code: ToolError['code'];
  message: string;
  recoverable?: boolean;
  install_hint?: string;
} {
  return !!(error && typeof error === 'object' && 'code' in (error as Record<string, unknown>) && 'message' in (error as Record<string, unknown>));
}

function buildFailure<T>(code: ToolError['code'], message: string, recoverable = true, install_hint?: string): PiToolResult<T> {
  return {
    content: [{ type: 'text', text: message }],
    details: {
      status: 'failure',
      error: {
        code,
        message,
        recoverable,
        ...(install_hint ? { install_hint } : {}),
      } as ToolError,
    },
    isError: true,
  };
}

function buildSuccess<T>(text: string, data: T): PiToolResult<T> {
  return {
    content: [{ type: 'text', text }],
    details: {
      status: 'success',
      data,
    } as ToolResponse<T>,
  };
}

function formatDuration(seconds?: number | null): string | null {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return null;
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

function formatViewCount(value?: number | null): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return value.toLocaleString('en-US');
}

function compactSnippet(value?: string | null, max = 120): string | null {
  if (!value) return null;
  const clean = value.replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function summarizeSearchResults(query: string, effectiveType: NormalizedSearchInput['type'], results: YoutubeSearchResult[]): string {
  const header = `youtube_search: ${results.length} result(s) for "${query}" [type=${effectiveType}]`;
  if (!results.length) return header;

  const lines = results.slice(0, 10).flatMap((entry, index) => {
    const identity = entry.video_id ?? entry.channel_id ?? entry.playlist_id ?? 'unknown';
    const meta = [
      entry.channel_name ? `channel: ${entry.channel_name}` : null,
      entry.published_date ? `published: ${entry.published_date}` : null,
      formatDuration(entry.duration) ? `duration: ${formatDuration(entry.duration)}` : null,
      formatViewCount(entry.view_count) ? `views: ${formatViewCount(entry.view_count)}` : null,
    ].filter(Boolean);

    const snippet = compactSnippet(entry.description_snippet);

    return [
      `${index + 1}. [${entry.result_type}] ${entry.title}`,
      `   id: ${identity}`,
      meta.length ? `   ${meta.join(' | ')}` : null,
      `   url: ${entry.url}`,
      snippet ? `   snippet: ${snippet}` : null,
    ].filter(Boolean) as string[];
  });

  return `${header}\n${lines.join('\n')}`;
}

function summarizeVideo(details: YoutubeVideoDetails): string {
  const lines = [
    `youtube_video_get: ${details.title} (${details.video_id})`,
    `url: ${details.url}`,
    details.channel_name ? `channel: ${details.channel_name}` : undefined,
    details.published_date ? `published: ${details.published_date}` : undefined,
  ].filter(Boolean);

  return lines.join('\n');
}

function summarizeTranscript(result: YoutubeTranscriptResult): string {
  const preview = result.text.split('\n').slice(0, 3).join(' ').slice(0, 240);
  const lines = [
    `youtube_transcript_get: ${result.content_source} [language=${result.language}]`,
    `video: ${result.video_ref}`,
    `fallback: ${result.used_fallback ? 'yes' : 'no'}`,
    preview ? `preview: ${preview}` : undefined,
  ].filter(Boolean);

  return lines.join('\n');
}

function summarizeChannelSearch(params: YoutubeChannelSearchInput, results: ReturnType<typeof normalizeChannelResult>[]): string {
  const identity = params.query ?? params.channel_id ?? params.handle ?? params.url ?? 'channel lookup';
  const header = `youtube_channel_search: ${results.length} result(s) for "${identity}"`;
  if (!results.length) return header;

  const lines = results.slice(0, 10).map((entry, index) => `${index + 1}. ${entry.channel_name} — ${entry.url}`);
  return `${header}\n${lines.join('\n')}`;
}

function summarizePlaylist(playlist: ReturnType<typeof normalizePlaylistDetails>): string {
  const lines = [
    `youtube_playlist_get: ${playlist.playlist_title} (${playlist.playlist_id})`,
    `url: ${playlist.url}`,
    `entries: ${playlist.entries?.length ?? 0}`,
    playlist.channel_name ? `channel: ${playlist.channel_name}` : undefined,
  ].filter(Boolean);

  return lines.join('\n');
}

function toToolError<T = unknown>(error: unknown): PiToolResult<T> {
  if (isErrorLike(error)) {
    return {
      content: [{ type: 'text', text: error.message }],
      details: {
        status: 'failure',
        error: {
          code: error.code,
          message: error.message,
          recoverable: error.recoverable ?? true,
          details: (error as ToolError).details,
          install_hint: error.code === 'yt_dlp_missing' ? error.install_hint ?? YT_DLP_INSTALL_HINT : error.install_hint,
        },
      },
      isError: true,
    } as PiToolResult<T>;
  }

  if (error instanceof TranscriptFallbackError) {
    return buildFailure<T>('source_unavailable', error.message, false);
  }

  if (error instanceof Error) {
    if (error.message.toLowerCase().includes('validation')) {
      return buildFailure<T>('validation_error', error.message, true);
    }
    return buildFailure<T>('yt_dlp_failed', error.message, false);
  }

  return buildFailure<T>('yt_dlp_failed', 'youtube_research tool failed', false);
}



interface NormalizedExecutionInput {
  runtime: YtDlpRuntime;
  client: YtDlpClient;
}

type SearchFilters = ReturnType<typeof validateSearchFilters>;

type YtDlpExecutor = (args: string[], options?: { signal?: AbortSignal; cwd?: string }) => Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}>;

function createDefaultExecutor(runtime: YtDlpRuntime): YtDlpExecutor {
  const binary = runtime.binary;

  return async (args: string[], options?: { signal?: AbortSignal; cwd?: string }) => {
    const [command, ...argv] = args.length > 0 ? args : [binary];

    try {
      const { stdout, stderr } = await execFileAsync(command, argv, {
        signal: options?.signal,
        cwd: options?.cwd,
        encoding: 'utf8',
        windowsHide: true,
      });
      return {
        stdout: String(stdout ?? ''),
        stderr: String(stderr ?? ''),
        exitCode: 0,
      };
    } catch (error) {
      const typed = error as { code?: number | string; stderr?: string | Buffer; stdout?: string | Buffer };
      const exitCode = Number.parseInt(String(typed.code ?? ''), 10);
      return {
        stdout: String(typed.stdout ?? ''),
        stderr: String(typed.stderr ?? (error instanceof Error ? error.message : 'yt-dlp execution failed')),
        exitCode: Number.isFinite(exitCode) ? exitCode : 1,
      };
    }
  };
}

function buildClient(runtime: YtDlpRuntime): YtDlpClient {
  return new YoutubeResearchClient({
    binary: runtime.binary,
    run: createDefaultExecutor(runtime),
  });
}

async function ensureRuntime(checkRuntime = checkYtDlpRuntime): Promise<RuntimeDependencyResult> {
  const result = await checkRuntime();
  if (result.runtime) {
    return { runtime: result.runtime };
  }

  return {
    error: result.error ?? {
      code: 'yt_dlp_missing',
      message: 'yt-dlp runtime was not detected',
      recoverable: true,
      install_hint: YT_DLP_INSTALL_HINT,
    },
  };
}

function parseYoutubeVideoId(candidate: string): string | null {
  const trimmed = candidate.trim();
  const direct = trimmed.match(/^([A-Za-z0-9_-]{6,})$/);
  if (direct) {
    return direct[1];
  }

  const patterns = [
    /(?:youtu\.be\/|youtube\.com\/shorts\/)([A-Za-z0-9_-]{6,})(?:[/?#&?].*)?$/,
    /youtube\.com\/watch\?(?:[^#&]*&)?v=([A-Za-z0-9_-]{6,})(?:[&#][^#]*)?/, 
    /youtube\.com\/embed\/([A-Za-z0-9_-]{6,})(?:[/?#&?].*)?$/,
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

function parseYoutubePlaylistId(candidate: string): string | null {
  const trimmed = candidate.trim();

  const direct = trimmed.match(/^([A-Za-z0-9_-]{10,})$/);
  if (direct) {
    return direct[1];
  }

  const match = trimmed.match(/[?&]list=([A-Za-z0-9_-]{5,})(?:[&#][^#]*)?/i);
  if (match?.[1]) {
    return match[1];
  }

  return null;
}

function isVideoUrl(input: string): boolean {
  return /youtube\.com\/watch\?|youtu\.be\//i.test(input) || /youtube\.com\/shorts\//i.test(input) || /youtube\.com\/embed\//i.test(input);
}

function isPlaylistUrl(input: string): boolean {
  return /youtube\.com\/playlist\//i.test(input) || /[?&]list=/.test(input);
}

function normalizeVideoReference(input: VideoRefInput): NormalizedVideoRef {
  if (input.url) {
    const url = input.url.trim();
    const videoId = parseYoutubeVideoId(url);
    if (!videoId) {
      throw new Error('invalid video url');
    }

    return { video_id: videoId, videoUrl: url };
  }

  if (input.video_id) {
    const videoId = input.video_id.trim();
    if (!/^[A-Za-z0-9_-]{6,}$/.test(videoId)) {
      throw new Error('invalid video id format');
    }
    return {
      video_id: videoId,
      videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
    };
  }

  throw new Error('exactly one of url or video_id is required');
}

function normalizePlaylistReference(input: PlaylistRefInput): NormalizedPlaylistRef {
  if (input.url) {
    const url = input.url.trim();
    if (!isPlaylistUrl(url)) {
      throw new Error('invalid playlist url: expected a YouTube playlist URL');
    }

    const playlistId = parseYoutubePlaylistId(url);
    if (!playlistId) {
      throw new Error('invalid playlist url');
    }

    return { playlist_id: playlistId, url };
  }

  if (input.playlist_id) {
    const id = input.playlist_id.trim();
    if (!/^[A-Za-z0-9_-]{5,}$/.test(id)) {
      throw new Error('invalid playlist id format');
    }

    return { playlist_id: id, url: `https://www.youtube.com/playlist?list=${id}` };
  }

  throw new Error('exactly one of url or playlist_id is required');
}

function mapSort(results: YoutubeSearchResult[], sort?: SearchFilters['sort']): YoutubeSearchResult[] {
  if (!sort) return results;

  const list = [...results];

  if (sort === 'date') {
    return list.sort((left, right) => {
      const leftDate = left.published_date ? Date.parse(left.published_date) : 0;
      const rightDate = right.published_date ? Date.parse(right.published_date) : 0;
      return rightDate - leftDate;
    });
  }

  if (sort === 'views') {
    return list.sort((left, right) => {
      const leftViews = left.view_count ?? 0;
      const rightViews = right.view_count ?? 0;
      return rightViews - leftViews;
    });
  }

  return list;
}

function durationCategory(seconds: number | null | undefined): 'short' | 'medium' | 'long' | undefined {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) {
    return undefined;
  }
  if (seconds <= 240) return 'short';
  if (seconds <= 1200) return 'medium';
  return 'long';
}

function applySearchFilters(results: YoutubeSearchResult[], input: SearchFilters): YoutubeSearchResult[] {
  let filtered = [...results];

  if (input.type !== 'mixed') {
    filtered = filtered.filter((entry) => entry.result_type === input.type);
  }

  if (input.channel) {
    const channelTerm = input.channel.toLowerCase();
    filtered = filtered.filter((entry) => {
      return (
        (entry.channel_id ?? '').toLowerCase().includes(channelTerm) ||
        (entry.channel_name ?? '').toLowerCase().includes(channelTerm)
      );
    });
  }

  if (input.published_after) {
    filtered = filtered.filter((entry) => {
      if (!entry.published_date) return false;
      return entry.published_date >= input.published_after!;
    });
  }

  if (input.published_before) {
    filtered = filtered.filter((entry) => {
      if (!entry.published_date) return false;
      return entry.published_date <= input.published_before!;
    });
  }

  if (input.duration && input.duration !== 'any') {
    filtered = filtered.filter((entry) => {
      return durationCategory(entry.duration) === input.duration;
    });
  }

  if (input.language) {
    const language = input.language.toLowerCase();
    filtered = filtered.filter((entry) => {
      if (!entry.language_hint) {
        return true;
      }
      return entry.language_hint.toLowerCase().includes(language);
    });
  }

  filtered = mapSort(filtered, input.sort);

  return filtered.slice(0, input.limit);
}

function cleanTranscriptText(raw: string): string {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => {
      if (/^WEBVTT/i.test(line)) return false;
      if (/^NOTE/.test(line)) return false;
      if (/^\d+$/.test(line)) return false;
      if (/^\d{2}:\d{2}:\d{2}\.?\d*/.test(line)) return false;
      if (/-->/.test(line)) return false;
      return true;
    })
    .map((line) => line.replace(/<[^>]+>/g, '').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function buildFallbackTranscriptText(video: YoutubeVideoDetails, source: TranscriptSource['source']): string {
  if (source === 'description_fallback') {
    return video.full_description?.trim() ?? '';
  }

  if (source === 'chapters_fallback') {
    return (video.chapters ?? [])
      .map((chapter) => chapter.title)
      .filter(Boolean)
      .join('\n')
      .trim();
  }

  if (source === 'metadata_fallback') {
    const pieces = [video.title, video.channel_name, video.full_description]
      .filter((piece): piece is string => typeof piece === 'string' && piece.trim().length > 0)
      .map((piece) => piece.trim());
    return pieces.join('\n');
  }

  return '';
}

function getDependencyStatus(checkRuntime = checkYtDlpRuntime): Promise<RuntimeDependencyResult> {
  return ensureRuntime(checkRuntime);
}

function normalizeSearchInput(input: YoutubeSearchInput): SearchFilters {
  return validateSearchFilters(input);
}

const searchParameters = Type.Object({
  query: Type.String(),
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 20 })),
  type: Type.Optional(Type.String()),
  channel: Type.Optional(Type.String()),
  published_after: Type.Optional(Type.String()),
  published_before: Type.Optional(Type.String()),
  duration: Type.Optional(Type.String()),
  sort: Type.Optional(Type.String()),
  language: Type.Optional(Type.String()),
  topic_tags: Type.Optional(Type.Array(Type.String())),
});

const videoParameters = Type.Object({
  url: Type.Optional(Type.String()),
  video_id: Type.Optional(Type.String()),
});

const transcriptParameters = Type.Object({
  url: Type.Optional(Type.String()),
  video_id: Type.Optional(Type.String()),
  source_mode: Type.Optional(Type.String()),
  language: Type.Optional(Type.String()),
});

const channelSearchParameters = Type.Object({
  query: Type.Optional(Type.String()),
  channel_id: Type.Optional(Type.String()),
  handle: Type.Optional(Type.String()),
  url: Type.Optional(Type.String()),
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 20 })),
});

const playlistParameters = Type.Object({
  url: Type.Optional(Type.String()),
  playlist_id: Type.Optional(Type.String()),
});

async function runSearch(
  params: YoutubeSearchInput,
  checkRuntime: RegisterYoutubeResearchToolsDeps['checkRuntime'],
  createClient: (runtime: YtDlpRuntime) => YtDlpClient,
): Promise<PiToolResult<{ results: YoutubeSearchResult[]; query: string; effective_type: NormalizedSearchInput['type']; total: number }>> {
  let normalized: SearchFilters;
  try {
    normalized = normalizeSearchInput(params);
  } catch (error) {
    return toToolError<{ results: YoutubeSearchResult[]; query: string; effective_type: NormalizedSearchInput['type']; total: number }>({
      code: 'validation_error',
      message: error instanceof Error ? error.message : 'invalid input',
      recoverable: true,
    });
  }

  const dependency = await getDependencyStatus(checkRuntime);
  if ('error' in dependency) {
    return toToolError<{ results: YoutubeSearchResult[]; query: string; effective_type: NormalizedSearchInput['type']; total: number }>(dependency.error);
  }

  const client = createClient(dependency.runtime);
  const rawResults = await client.search(normalized);

  const normalizedResults = normalizeSearchResults(rawResults as RawYtDlpItem[]);
  const filtered = applySearchFilters(normalizedResults, normalized);

  return buildSuccess(summarizeSearchResults(normalized.query, normalized.type, filtered), {
    results: filtered,
    query: normalized.query,
    effective_type: normalized.type,
    total: filtered.length,
  });
}

async function runVideoGet(
  params: VideoRefInput,
  checkRuntime: RegisterYoutubeResearchToolsDeps['checkRuntime'],
  createClient: (runtime: YtDlpRuntime) => YtDlpClient,
): Promise<PiToolResult<YoutubeVideoDetails>> {
  let reference: NormalizedVideoRef;
  try {
    validateVideoOrTranscriptRef(params);
    reference = normalizeVideoReference(params);
  } catch (error) {
    return toToolError<YoutubeVideoDetails>({
      code: 'validation_error',
      message: error instanceof Error ? error.message : 'invalid video reference',
      recoverable: true,
    });
  }

  const dependency = await getDependencyStatus(checkRuntime);
  if ('error' in dependency) {
    return toToolError<YoutubeVideoDetails>(dependency.error);
  }

  const client = createClient(dependency.runtime);
  const raw = await client.getVideo(reference);
  if (!raw) {
    return buildFailure('not_found', `No video metadata found for ${reference.video_id}`, false);
  }

  const details = normalizeVideoDetails(raw as RawYtDlpItem);
  return buildSuccess(summarizeVideo(details), details);
}

async function runTranscriptGet(
  params: YoutubeTranscriptInput,
  checkRuntime: RegisterYoutubeResearchToolsDeps['checkRuntime'],
  createClient: (runtime: YtDlpRuntime) => YtDlpClient,
): Promise<PiToolResult<YoutubeTranscriptResult>> {
  let reference: NormalizedVideoRef;
  try {
    validateVideoOrTranscriptRef(params);
    reference = normalizeVideoReference(params);
  } catch (error) {
    return toToolError<YoutubeTranscriptResult>({
      code: 'validation_error',
      message: error instanceof Error ? error.message : 'invalid video reference',
      recoverable: true,
    });
  }

  const effectiveMode = normalizeSourceMode(params.source_mode);
  const language = params.language ?? 'en';

  const dependency = await getDependencyStatus(checkRuntime);
  if ('error' in dependency) {
    return toToolError<YoutubeTranscriptResult>(dependency.error);
  }

  const client = createClient(dependency.runtime);
  const transcriptInventory = await client.listTranscriptSources(reference);
  const plan = buildTranscriptPlan(transcriptInventory, { sourceMode: params.source_mode ?? 'auto', language });

  const candidate = pickTranscriptCandidate(plan, params.source_mode ?? 'best-effort');
  const selectedPlan = plan.candidates.find(
    (entry) => entry.source === candidate.source && entry.language === candidate.language && entry.generated === candidate.generated,
  );

  const usedFallback = selectedPlan?.fallback ?? false;
  const fallbackReason = selectedPlan?.reason;
  const usedActualSource = candidate.source;

  let text = '';

  if (usedFallback) {
    const rawVideo = await client.getVideo(reference);
    if (!rawVideo) {
      return buildFailure('not_found', `No video metadata found for ${reference.video_id}`, false);
    }
    const video = normalizeVideoDetails(rawVideo as RawYtDlpItem);
    text = buildFallbackTranscriptText(video, usedActualSource);
    if (!text) {
      return buildFailure('source_unavailable', `No transcript fallback text found for ${reference.video_id}`, false);
    }
  } else {
    text = await client.fetchTranscript({
      source: usedActualSource,
      language: candidate.language,
      sourceLanguage: candidate.language,
      generated: candidate.generated,
      url: reference.videoUrl,
    });
    text = cleanTranscriptText(text);
    if (!text) {
      return buildFailure('source_unavailable', `Transcript source ${usedActualSource} returned no text`, false);
    }
  }

  const transcriptResult: YoutubeTranscriptResult = {
    video_ref: reference.videoUrl ?? `https://www.youtube.com/watch?v=${reference.video_id}`,
    text,
    content_source: usedActualSource,
    language: candidate.language,
    is_generated: candidate.generated,
    used_fallback: usedFallback,
    fallback_reason: usedFallback ? fallbackReason : undefined,
    source_mode_requested: params.source_mode,
    source_mode_effective: effectiveMode,
  };

  return buildSuccess(summarizeTranscript(transcriptResult), transcriptResult);
}

function isDirectChannelLookup(params: YoutubeChannelSearchInput): boolean {
  return Boolean(params.channel_id || params.handle || params.url);
}

async function runChannelSearch(
  params: YoutubeChannelSearchInput,
  checkRuntime: RegisterYoutubeResearchToolsDeps['checkRuntime'],
  createClient: (runtime: YtDlpRuntime) => YtDlpClient,
): Promise<PiToolResult<{ results: ReturnType<typeof normalizeChannelResult>[] }>> {
  try {
    validateChannelInput(params);
  } catch (error) {
    return toToolError<{ results: ReturnType<typeof normalizeChannelResult>[] }>({
      code: 'validation_error',
      message: error instanceof Error ? error.message : 'invalid channel input',
      recoverable: true,
    });
  }

  const dependency = await getDependencyStatus(checkRuntime);
  if ('error' in dependency) {
    return toToolError<{ results: ReturnType<typeof normalizeChannelResult>[] }>(dependency.error);
  }

  const client = createClient(dependency.runtime);
  const raw = await client.searchChannels(params);
  const limit = params.limit ?? 5;
  const directLookup = isDirectChannelLookup(params);
  const results = raw
    .filter((entry) => directLookup || normalizeSearchResult(entry as RawYtDlpItem).result_type === 'channel')
    .map((entry) => normalizeChannelResult(entry as RawYtDlpItem))
    .filter((entry) => {
      return entry.channel_name || entry.channel_id || entry.subscriber_count !== undefined || entry.video_count !== undefined;
    })
    .filter((entry, index, all) => index === all.findIndex((candidate) => candidate.channel_id === entry.channel_id && candidate.url === entry.url))
    .slice(0, directLookup ? 1 : limit);

  return buildSuccess(summarizeChannelSearch(params, results), {
    results,
  });
}

async function runPlaylistGet(
  params: PlaylistRefInput,
  checkRuntime: RegisterYoutubeResearchToolsDeps['checkRuntime'],
  createClient: (runtime: YtDlpRuntime) => YtDlpClient,
): Promise<PiToolResult<any>> {
  let reference: NormalizedPlaylistRef;
  try {
    validatePlaylistRef(params);
    reference = normalizePlaylistReference(params);
  } catch (error) {
    return toToolError<ReturnType<typeof normalizePlaylistDetails>>({
      code: 'validation_error',
      message: error instanceof Error ? error.message : 'invalid playlist reference',
      recoverable: true,
    });
  }

  const dependency = await getDependencyStatus(checkRuntime);
  if ('error' in dependency) {
    return toToolError<ReturnType<typeof normalizePlaylistDetails>>(dependency.error);
  }

  const client = createClient(dependency.runtime);
  const raw = await client.getPlaylist(reference);
  if (!raw) {
    return buildFailure('not_found', `No playlist found for ${reference.playlist_id ?? reference.url}`, false);
  }

  const playlist = normalizePlaylistDetails(raw as RawYtDlpItem);
  return buildSuccess(summarizePlaylist(playlist), playlist);
}

export function registerYoutubeResearchTools(pi: any, deps: RegisterYoutubeResearchToolsDeps = {}): void {
  const checkRuntime = deps.checkRuntime ?? checkYtDlpRuntime;
  const createClient = deps.createClient ?? buildClient;

  pi.registerTool({
    name: 'youtube_search',
    label: 'YouTube Search',
    description: 'Search videos, channels, and playlists on YouTube.',
    parameters: searchParameters,
    async execute(_id: string, params: YoutubeSearchInput) {
      try {
        return await runSearch(params, checkRuntime, createClient);
      } catch (error) {
        return toToolError(error);
      }
    },
  });

  pi.registerTool({
    name: 'youtube_video_get',
    label: 'YouTube Video Details',
    description: 'Fetch detailed metadata for a single video.',
    parameters: videoParameters,
    async execute(_id: string, params: VideoRefInput) {
      try {
        return await runVideoGet(params, checkRuntime, createClient);
      } catch (error) {
        return toToolError(error);
      }
    },
  });

  pi.registerTool({
    name: 'youtube_transcript_get',
    label: 'YouTube Transcript',
    description: 'Fetch transcript text with staged fallback semantics.',
    parameters: transcriptParameters,
    async execute(_id: string, params: YoutubeTranscriptInput) {
      try {
        return await runTranscriptGet(params, checkRuntime, createClient);
      } catch (error) {
        return toToolError(error);
      }
    },
  });

  pi.registerTool({
    name: 'youtube_channel_search',
    label: 'YouTube Channel Search',
    description: 'Search and inspect channels as recurring research sources.',
    parameters: channelSearchParameters,
    async execute(_id: string, params: YoutubeChannelSearchInput) {
      try {
        return await runChannelSearch(params, checkRuntime, createClient);
      } catch (error) {
        return toToolError(error);
      }
    },
  });

  pi.registerTool({
    name: 'youtube_playlist_get',
    label: 'YouTube Playlist',
    description: 'Fetch playlist metadata and compact entries.',
    parameters: playlistParameters,
    async execute(_id: string, params: PlaylistRefInput) {
      try {
        return await runPlaylistGet(params, checkRuntime, createClient);
      } catch (error) {
        return toToolError(error);
      }
    },
  });
}
