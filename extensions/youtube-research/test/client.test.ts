import { describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildSearchCommand,
  buildVideoCommand,
  buildPlaylistCommand,
  buildChannelSearchCommand,
  buildTranscriptSourcesCommand,
  buildTranscriptFetchCommand,
  parseYtDlpJsonPayload,
  YoutubeResearchClient,
} from '../src/client.js';

describe('youtube-research yt-dlp command and parse contract', () => {
  it('builds vectorized command shape for mixed/all search without shell strings', () => {
    expect(buildSearchCommand({
      query: 'kubernetes tips',
      limit: 3,
      type: 'mixed',
    })).toEqual(['yt-dlp', '--flat-playlist', 'ytsearch3:kubernetes tips', '--dump-json']);
  });

  it('builds fast ytsearch for normal video search and youtube search urls for channel and playlist searches', () => {
    expect(buildSearchCommand({
      query: 'python tutorial',
      limit: 5,
      type: 'video',
    })).toEqual([
      'yt-dlp',
      '--flat-playlist',
      'ytsearch5:python tutorial',
      '--dump-json',
    ]);

    expect(buildSearchCommand({
      query: 'Computerphile',
      limit: 5,
      type: 'channel',
    })).toEqual([
      'yt-dlp',
      '--flat-playlist',
      'https://www.youtube.com/results?search_query=Computerphile&sp=EgIQAg%253D%253D',
      '--dump-json',
    ]);

    expect(buildSearchCommand({
      query: 'python tutorial',
      limit: 5,
      type: 'playlist',
    })).toEqual([
      'yt-dlp',
      '--flat-playlist',
      'https://www.youtube.com/results?search_query=python+tutorial&sp=EgIQAw%253D%253D',
      '--dump-json',
    ]);
  });

  it('keeps date-aware video search flat and overfetches for local filters', () => {
    expect(buildSearchCommand({
      query: 'python tutorial',
      limit: 5,
      type: 'video',
      sort: 'date',
    })).toEqual([
      'yt-dlp',
      '--flat-playlist',
      'ytsearch25:python tutorial',
      '--dump-json',
    ]);

    expect(buildSearchCommand({
      query: 'python tutorial',
      limit: 5,
      type: 'video',
      published_after: '2024-01-01',
    })).toEqual([
      'yt-dlp',
      '--flat-playlist',
      'ytsearch25:python tutorial',
      '--dump-json',
    ]);

    expect(buildSearchCommand({
      query: 'python tutorial',
      limit: 5,
      type: 'video',
      published_before: '2024-12-31',
    })).toEqual([
      'yt-dlp',
      '--flat-playlist',
      'ytsearch25:python tutorial',
      '--dump-json',
    ]);
  });

  it('overfetches for duration and channel filters without switching to large non-flat payloads', () => {
    expect(buildSearchCommand({
      query: 'rust ownership explained',
      limit: 3,
      type: 'video',
      duration: 'short',
    })).toEqual([
      'yt-dlp',
      '--flat-playlist',
      'ytsearch15:rust ownership explained',
      '--dump-json',
    ]);

    expect(buildSearchCommand({
      query: 'rust ownership',
      limit: 5,
      type: 'video',
      channel: "Let's Get Rusty",
    })).toEqual([
      'yt-dlp',
      '--flat-playlist',
      'ytsearch25:rust ownership',
      '--dump-json',
    ]);
  });

  it('builds per-tool command shapes for direct fetch calls', () => {
    expect(buildVideoCommand({ video_id: 'abc123' })).toEqual([
      'yt-dlp',
      '--dump-json',
      '--no-playlist',
      '--write-info-json',
      'https://www.youtube.com/watch?v=abc123',
    ]);

    expect(buildVideoCommand({ video_id: 'abc123', includeComments: true, commentsLimit: 5 })).toEqual([
      'yt-dlp',
      '--dump-json',
      '--no-playlist',
      '--write-info-json',
      '--write-comments',
      '--extractor-args',
      'youtube:max_comments=5',
      'https://www.youtube.com/watch?v=abc123',
    ]);

    expect(buildPlaylistCommand({ playlist_id: 'PL123' })).toEqual([
      'yt-dlp',
      '--dump-json',
      '--flat-playlist',
      'https://www.youtube.com/playlist?list=PL123',
    ]);

    expect(buildChannelSearchCommand({ query: 'kubernetes' })).toEqual([
      'yt-dlp',
      '--flat-playlist',
      'https://www.youtube.com/results?search_query=kubernetes&sp=EgIQAg%253D%253D',
      '--dump-json',
    ]);

    expect(buildChannelSearchCommand({ channel_id: 'UC123', limit: 3 })).toEqual([
      'yt-dlp',
      '--flat-playlist',
      'https://www.youtube.com/channel/UC123/videos',
      '--dump-json',
    ]);

    expect(buildChannelSearchCommand({ handle: '@openai' })).toEqual([
      'yt-dlp',
      '--flat-playlist',
      'https://www.youtube.com/@openai/videos',
      '--dump-json',
    ]);

    expect(buildChannelSearchCommand({ url: 'https://www.youtube.com/channel/UC123' })).toEqual([
      'yt-dlp',
      '--flat-playlist',
      'https://www.youtube.com/channel/UC123/videos',
      '--dump-json',
    ]);

    expect(buildTranscriptSourcesCommand({ video_id: 'abc123' })).toEqual([
      'yt-dlp',
      '--list-subs',
      'https://www.youtube.com/watch?v=abc123',
    ]);

    expect(buildTranscriptFetchCommand({
      source: 'manual_subtitle',
      language: 'en',
      sourceLanguage: 'en',
      generated: true,
      video_id: 'abc123',
    })).toEqual([
      'yt-dlp',
      '--write-subs',
      '--skip-download',
      '--sub-langs',
      'en',
      '--sub-format',
      'vtt',
      'https://www.youtube.com/watch?v=abc123',
    ]);

    expect(buildTranscriptFetchCommand({
      source: 'automatic_subtitle',
      language: 'en',
      sourceLanguage: 'en',
      generated: true,
      video_id: 'abc123',
    })).toEqual([
      'yt-dlp',
      '--write-auto-subs',
      '--skip-download',
      '--sub-langs',
      'en',
      '--sub-format',
      'vtt',
      'https://www.youtube.com/watch?v=abc123',
    ]);

    expect(buildTranscriptFetchCommand({
      source: 'translated_subtitle',
      language: 'es',
      sourceLanguage: 'es',
      generated: true,
      video_id: 'abc123',
    })).toEqual([
      'yt-dlp',
      '--write-auto-subs',
      '--write-subs',
      '--skip-download',
      '--sub-langs',
      'es',
      '--sub-format',
      'vtt',
      'https://www.youtube.com/watch?v=abc123',
    ]);
  });

  it('maps non-JSON output into explicit parse_error shape', () => {
    expect(() => parseYtDlpJsonPayload('not json')).toThrow(SyntaxError);
  });

  it('parses yt-dlp --list-subs output with realistic subsection format', async () => {
    const listOutput = [
      'Available subtitles for abc123:',
      'Language formats',
      'en              vtt, ttml',
      'fr              vtt',
      'Available automatic captions for abc123:',
      'Language formats',
      'en              vtt',
      'Available translated subtitles for abc123:',
      'Language formats',
      'de              vtt',
      '',
    ].join('\n');

    const run = vi.fn().mockResolvedValue({
      stdout: listOutput,
      stderr: '',
      exitCode: 0,
    });

    const client = new YoutubeResearchClient({
      binary: 'yt-dlp',
      run,
    });

    const result = await client.listTranscriptSources({ video_id: 'abc123' });
    expect(result.manual.map((source) => source.language)).toEqual(['en', 'fr']);
    expect(result.automatic.map((source) => source.language)).toEqual(['en']);
    expect(result.translated.map((source) => source.language)).toEqual(['de']);
    expect(run).toHaveBeenCalledOnce();
  });

  it('supports legacy --list-subs language map lines', async () => {
    const run = vi.fn().mockResolvedValue({
      stdout: 'Manual: en, fr\nAuto: es\n',
      stderr: '',
      exitCode: 0,
    });

    const client = new YoutubeResearchClient({
      binary: 'yt-dlp',
      run,
    });

    const result = await client.listTranscriptSources({ video_id: 'abc123' });

    expect(result.manual.map((source) => source.language)).toEqual(['en', 'fr']);
    expect(result.automatic.map((source) => source.language)).toEqual(['es']);
  });

  it('fetchTranscript reads subtitle text from generated subtitle files when yt-dlp writes output files', async () => {
    const outputDir = join(tmpdir(), 'youtube-research-client-tests');
    const outputPath = join(outputDir, 'abc123.en.vtt');
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(outputPath, 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello world\n');

    try {
      const run = vi.fn().mockResolvedValue({
        stdout: '',
        stderr: `[info] Writing video subtitles to: ${outputPath}\n`,
        exitCode: 0,
      });

      const client = new YoutubeResearchClient({
        binary: 'yt-dlp',
        run,
      });

      const text = await client.fetchTranscript({
        source: 'manual_subtitle',
        language: 'en',
        sourceLanguage: 'en',
        generated: false,
        video_id: 'abc123',
      });

      expect(text).toContain('Hello world');
    } finally {
      rmSync(outputPath, { force: true });
    }

    rmSync(outputDir, { recursive: true, force: true });
  });

  it('uses injectable executor for test-driven command verification', async () => {
    const run = vi.fn().mockResolvedValue({ stdout: '{"id":"x"}\n', stderr: '', exitCode: 0 });
    const client = new YoutubeResearchClient({
      binary: 'yt-dlp',
      run,
    });

    await expect(client.getVideo({ video_id: 'abc' })).resolves.toEqual({ id: 'x' });
    expect(run).toHaveBeenCalledOnce();
    const calledArgs = run.mock.calls[0][0];
    expect(calledArgs).toContain('yt-dlp');
    expect(calledArgs[0]).toBe('yt-dlp');
  });
});
