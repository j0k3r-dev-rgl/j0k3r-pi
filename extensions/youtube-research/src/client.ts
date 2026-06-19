import { promises as fs } from 'node:fs';
import type {
  NormalizedSearchInput,
  NormalizedVideoRef,
  NormalizedPlaylistRef,
  YtDlpClient,
  YtDlpExecutor,
  TranscriptSourceSelection,
  TranscriptSourceInventory,
  TranscriptSource,
  YoutubeChannelSearchInput,
} from './types.js';

export interface YtDlpRawResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface YoutubeClientOptions {
  binary?: string;
  run: YtDlpExecutor;
}

export interface ParsedYtDlpOutput {
  payloads: unknown[];
}

export interface TranscriptFetchCommandOptions extends TranscriptSourceSelection {
  video_id?: string;
  url?: string;
}

export function parseYtDlpJsonPayload(raw: string): ParsedYtDlpOutput {
  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const payloads = lines.map((line) => JSON.parse(line));
  return { payloads };
}

function youtubeVideoUrl(input: NormalizedVideoRef): string {
  return input.videoUrl ?? input.url ?? `https://www.youtube.com/watch?v=${input.video_id ?? ''}`;
}

function youtubePlaylistUrl(input: NormalizedPlaylistRef): string {
  return input.url ?? `https://www.youtube.com/playlist?list=${input.playlist_id ?? ''}`;
}

function commandBinary(binary?: string): string {
  return binary ?? 'yt-dlp';
}

function toInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

const YOUTUBE_SEARCH_SP = {
  video: 'EgIQAQ%253D%253D',
  channel: 'EgIQAg%253D%253D',
  playlist: 'EgIQAw%253D%253D',
} as const;

function buildTypedYoutubeSearchUrl(input: NormalizedSearchInput): string | null {
  if (input.type === 'mixed' || input.type === 'video') return null;

  const encodedQuery = encodeURIComponent(input.query).replace(/%20/g, '+');
  return `https://www.youtube.com/results?search_query=${encodedQuery}&sp=${YOUTUBE_SEARCH_SP[input.type]}`;
}

function needsSearchOverfetch(input: NormalizedSearchInput): boolean {
  return Boolean(
    input.channel
    || (input.duration && input.duration !== 'any')
    || input.published_after
    || input.published_before
    || input.language
    || input.sort === 'date'
    || input.sort === 'views',
  );
}

function searchFetchLimit(input: NormalizedSearchInput): number {
  return needsSearchOverfetch(input) ? Math.min(Math.max(input.limit * 5, input.limit), 50) : input.limit;
}

export function buildSearchCommand(input: NormalizedSearchInput, binary?: string): string[] {
  const fetchLimit = searchFetchLimit(input);
  const target = input.type === 'video'
    ? `ytsearch${fetchLimit}:${input.query}`
    : buildTypedYoutubeSearchUrl(input) ?? `ytsearch${fetchLimit}:${input.query}`;

  return [
    commandBinary(binary),
    '--flat-playlist',
    target,
    '--dump-json',
  ];
}

export function buildVideoCommand(input: NormalizedVideoRef, binary?: string): string[] {
  const args = [
    commandBinary(binary),
    '--dump-json',
    '--no-playlist',
    '--write-info-json',
  ];

  if (input.includeComments) {
    args.push('--write-comments', '--extractor-args', `youtube:max_comments=${input.commentsLimit ?? 5}`);
  }

  args.push(youtubeVideoUrl(input));
  return args;
}

export function buildPlaylistCommand(input: NormalizedPlaylistRef, binary?: string): string[] {
  return [
    commandBinary(binary),
    '--dump-json',
    '--flat-playlist',
    youtubePlaylistUrl(input),
  ];
}

function ensureChannelVideosUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (/\/videos$/i.test(trimmed)) return trimmed;
  return `${trimmed}/videos`;
}

export function buildChannelSearchCommand(input: YoutubeChannelSearchInput, binary?: string): string[] {
  const command = commandBinary(binary);

  if (input.channel_id) {
    return [command, '--flat-playlist', `https://www.youtube.com/channel/${input.channel_id.trim()}/videos`, '--dump-json'];
  }

  if (input.handle) {
    const cleanHandle = input.handle.trim().replace(/^\//, '').replace(/^@/, '');
    return [command, '--flat-playlist', `https://www.youtube.com/@${cleanHandle}/videos`, '--dump-json'];
  }

  if (input.url) {
    return [command, '--flat-playlist', ensureChannelVideosUrl(input.url), '--dump-json'];
  }

  const query = input.query?.trim() ?? '';
  const encodedQuery = encodeURIComponent(query).replace(/%20/g, '+');
  return [command, '--flat-playlist', `https://www.youtube.com/results?search_query=${encodedQuery}&sp=${YOUTUBE_SEARCH_SP.channel}`, '--dump-json'];
}

export function buildTranscriptSourcesCommand(input: NormalizedVideoRef, binary?: string): string[] {
  return [commandBinary(binary), '--list-subs', youtubeVideoUrl(input)];
}

export function buildTranscriptFetchCommand(selection: TranscriptFetchCommandOptions, binary?: string): string[] {
  const args = [
    commandBinary(binary),
    '--write-subs',
    '--skip-download',
    '--sub-langs',
    selection.language,
    '--sub-format',
    'vtt',
    youtubeVideoUrl({ video_id: selection.video_id, url: selection.url, videoUrl: selection.url }),
  ];

  if (selection.source === 'automatic_subtitle') {
    args.splice(1, 1, '--write-auto-subs');
  }

  if (selection.source === 'translated_subtitle') {
    args.splice(1, 1, '--write-subs');
    args.splice(1, 0, '--write-auto-subs');
  }

  return args;
}

function normalizeOutputLanguageLine(raw: string): string {
  return raw
    .split(':')[0]
    .trim()
    .toLowerCase();
}

function collectUniqueSource(
  target: TranscriptSource[],
  seen: Set<string>,
  source: TranscriptSource['source'],
  language: string,
): void {
  const normalizedLanguage = language.toLowerCase();
  if (!normalizedLanguage) return;
  if (seen.has(normalizedLanguage)) return;

  target.push({
    source,
    language: normalizedLanguage,
    requested: normalizedLanguage,
    generated: source === 'automatic_subtitle' || source === 'translated_subtitle',
  });
  seen.add(normalizedLanguage);
}

function parseSectionHeader(line: string): 'manual' | 'automatic' | 'translated' | null {
  const normalized = line.toLowerCase();
  if (normalized.includes('available automatic captions') || normalized.includes('available automatic subtitles')) {
    return 'automatic';
  }
  if (normalized.includes('available translated subtitles') || normalized.includes('available translated captions')) {
    return 'translated';
  }
  if (normalized.includes('available subtitles')) {
    return 'manual';
  }
  return null;
}

function addLegacySourceLine(
  line: string,
  inventory: TranscriptSourceInventory,
  seen: { manual: Set<string>; automatic: Set<string>; translated: Set<string> },
): boolean {
  const legacy = /^(manual|auto|automatic|translated)\s*:\s*(.*)$/i.exec(line);
  if (!legacy) {
    return false;
  }

  const label = legacy[1].toLowerCase();
  const values = legacy[2]?.split(',').map((value) => normalizeOutputLanguageLine(value)).filter(Boolean) ?? [];
  const type = label === 'manual' ? 'manual' : label.startsWith('auto') ? 'automatic' : 'translated';

  for (const value of values) {
    if (!value) continue;
    if (type === 'manual') {
      collectUniqueSource(inventory.manual, seen.manual, 'manual_subtitle', value);
    }
    if (type === 'automatic') {
      collectUniqueSource(inventory.automatic, seen.automatic, 'automatic_subtitle', value);
    }
    if (type === 'translated') {
      collectUniqueSource(inventory.translated, seen.translated, 'translated_subtitle', value);
    }
  }

  return true;
}

function parseLanguageLine(
  line: string,
  section: 'manual' | 'automatic' | 'translated' | null,
  inventory: TranscriptSourceInventory,
  seen: { manual: Set<string>; automatic: Set<string>; translated: Set<string> },
): boolean {
  if (!section) return false;

  const match = /^\s*([a-zA-Z]{2,}(?:-[a-zA-Z0-9]{2,})?)\s*(?::|\t|\s{2,})\s*(.+)$/
    .exec(line);
  if (!match) return false;

  const language = normalizeOutputLanguageLine(match[1]);
  const format = match[2]?.trim().toLowerCase() ?? '';
  if (!language || !format) {
    return false;
  }

  if (!/\b(vtt|srt|ttml|srv\d|json3|webvtt)\b/.test(format) && format !== '--') {
    return false;
  }

  if (section === 'manual') {
    collectUniqueSource(inventory.manual, seen.manual, 'manual_subtitle', language);
  }
  if (section === 'automatic') {
    collectUniqueSource(inventory.automatic, seen.automatic, 'automatic_subtitle', language);
  }
  if (section === 'translated') {
    collectUniqueSource(inventory.translated, seen.translated, 'translated_subtitle', language);
  }

  return true;
}

function parseListSubsOutput(output: string): TranscriptSourceInventory {
  const lines = output.split('\n');
  const seen = {
    manual: new Set<string>(),
    automatic: new Set<string>(),
    translated: new Set<string>(),
  };

  const inventory: TranscriptSourceInventory = {
    manual: [],
    automatic: [],
    translated: [],
  };

  let currentSection: 'manual' | 'automatic' | 'translated' | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const header = parseSectionHeader(line);
    if (header) {
      currentSection = header;
      continue;
    }

    if (addLegacySourceLine(line, inventory, seen)) {
      currentSection = null;
      continue;
    }

    if (parseLanguageLine(line, currentSection, inventory, seen)) {
      continue;
    }
  }

  return inventory;
}

function parseSubtitlePath(result: { stdout: string; stderr: string }): string | null {
  const combined = `${result.stdout || ''}\n${result.stderr || ''}`;
  const match = combined.match(/subtitle(?:s)? to:\s*(.+\.(?:vtt|srt|ttml|srv\d|json3))(?:\b|\s|$)/i);
  if (!match || !match[1]) {
    return null;
  }
  return match[1].trim().replace(/["']/g, '');
}

async function readTranscriptFile(pathname: string): Promise<string> {
  const normalized = pathname;
  const text = await fs.readFile(normalized, 'utf8');

  try {
    await fs.unlink(normalized);
  } catch {
    // best-effort cleanup only
  }

  return text;
}

async function runAndParseJson(run: YtDlpExecutor, args: string[]): Promise<unknown[]> {
  const result = await run(args);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || 'yt-dlp execution failed');
  }
  return parseYtDlpJsonPayload(result.stdout).payloads;
}

export class YoutubeResearchClient implements YtDlpClient {
  constructor(private options: YoutubeClientOptions) {}

  async search(input: NormalizedSearchInput, _signal?: AbortSignal): Promise<unknown[]> {
    return runAndParseJson(this.options.run, buildSearchCommand(input, this.options.binary));
  }

  async getVideo(input: NormalizedVideoRef, _signal?: AbortSignal): Promise<unknown> {
    const payloads = await runAndParseJson(this.options.run, buildVideoCommand(input, this.options.binary));
    return payloads[0] ?? null;
  }

  async getPlaylist(input: NormalizedPlaylistRef, _signal?: AbortSignal): Promise<unknown> {
    const payloads = await runAndParseJson(this.options.run, buildPlaylistCommand(input, this.options.binary));
    return payloads[0] ?? null;
  }

  async searchChannels(input: YoutubeChannelSearchInput, _signal?: AbortSignal): Promise<unknown[]> {
    return runAndParseJson(this.options.run, buildChannelSearchCommand(input, this.options.binary));
  }

  async listTranscriptSources(input: NormalizedVideoRef, _signal?: AbortSignal): Promise<TranscriptSourceInventory> {
    try {
      const result = await this.options.run(buildTranscriptSourcesCommand(input, this.options.binary));
      if (result.exitCode !== 0) {
        return { manual: [], automatic: [], translated: [] };
      }
      return parseListSubsOutput(result.stdout);
    } catch {
      return { manual: [], automatic: [], translated: [] };
    }
  }

  async fetchTranscript(input: TranscriptFetchCommandOptions, _signal?: AbortSignal): Promise<string> {
    const result = await this.options.run(buildTranscriptFetchCommand(input, this.options.binary));
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || 'yt-dlp transcript fetch failed');
    }

    const subtitlePath = parseSubtitlePath(result);
    if (subtitlePath) {
      return readTranscriptFile(subtitlePath);
    }

    const trimmed = `${result.stdout}`.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }

    throw new Error('yt-dlp did not produce subtitle output for transcript fetch');
  }
}

export function createTextFallbackCandidate(language = 'en', generated = true): TranscriptSource {
  return {
    source: 'metadata_fallback',
    language,
    requested: `fallback-${language}`,
    generated,
  };
}

export function isYtDlpParseFailure(error: unknown): boolean {
  return error instanceof SyntaxError;
}
