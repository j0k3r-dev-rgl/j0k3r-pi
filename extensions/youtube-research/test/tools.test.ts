import { describe, expect, it, vi } from 'vitest';
import { registerYoutubeResearchTools, YOUTUBE_RESEARCH_TOOL_NAMES } from '../src/tools.js';
import { ytDlpMissingError } from '../src/runtime.js';
import type {
  YtDlpClient,
  YoutubeSearchResult,
  YoutubeVideoDetails,
  YoutubeChannelResult,
  YoutubePlaylistDetails,
  TranscriptSource,
  TranscriptSourceInventory,
} from '../src/types.js';

type Tool = {
  name: string;
  description: string;
  parameters: { type: string; [key: string]: unknown };
  execute: (...args: unknown[]) => Promise<unknown> | unknown;
};

type MockPi = {
  tools: Tool[];
  registerTool: (tool: Tool) => void;
};

function createMockPi(): MockPi {
  const tools: Tool[] = [];
  return {
    tools,
    registerTool(tool: Tool) {
      tools.push(tool);
    },
  };
}

function createMockClient(): { client: YtDlpClient; calls: string[] } {
  const calls: string[] = [];
  const client = {
    search: vi.fn(async (_input) => {
      calls.push('search');
      return [];
    }),
    getVideo: vi.fn(async (_input) => {
      calls.push('getVideo');
      return null;
    }),
    getPlaylist: vi.fn(async (_input) => {
      calls.push('getPlaylist');
      return null;
    }),
    searchChannels: vi.fn(async (_input) => {
      calls.push('searchChannels');
      return [];
    }),
    listTranscriptSources: vi.fn(async (_input) => {
      calls.push('listTranscriptSources');
      const inventory: TranscriptSourceInventory = {
        manual: [],
        automatic: [],
        translated: [],
      };
      return inventory;
    }),
    fetchTranscript: vi.fn(async (_input) => {
      calls.push('fetchTranscript');
      return 'sample transcript';
    }),
  } satisfies YtDlpClient;

  return { client, calls };
}

function execute(tool: Tool, params: Record<string, unknown>) {
  return tool.execute('id', params, undefined, undefined, {});
}

describe('youtube-research tool registration', () => {
  it('registers exactly five named tools', () => {
    const pi = createMockPi();
    registerYoutubeResearchTools(pi);

    const names = pi.tools.map((tool) => tool.name);
    expect(names).toEqual(YOUTUBE_RESEARCH_TOOL_NAMES);
    for (const tool of pi.tools) {
      expect(tool.parameters.type).toBe('object');
      expect(typeof tool.description).toBe('string');
      expect(typeof tool.execute).toBe('function');
    }

    expect(pi.tools.find((tool) => tool.name === 'youtube_search')?.description).toMatch(/enriched video metadata/i);
    expect(pi.tools.find((tool) => tool.name === 'youtube_video_get')?.description).toMatch(/description preview.*comments/i);
    expect(pi.tools.find((tool) => tool.name === 'youtube_transcript_get')?.description).toMatch(/source modes.*fallback/i);
    expect(pi.tools.find((tool) => tool.name === 'youtube_channel_search')?.description).toMatch(/query.*channel ID.*handle.*URL/i);
    expect(pi.tools.find((tool) => tool.name === 'youtube_playlist_get')?.description).toMatch(/URL.*playlist ID/i);
  });

  it('returns stable structured success/failure envelopes from all public tools', async () => {
    const pi = createMockPi();
    registerYoutubeResearchTools(pi, {
      checkRuntime: vi.fn().mockResolvedValue({ error: ytDlpMissingError('yt-dlp') }),
    });

    for (const tool of pi.tools) {
      const result = (await execute(tool, {} as Record<string, unknown>)) as { details: Record<string, unknown>; isError: boolean | undefined };
      expect(result).toHaveProperty('details.status');
      expect(result.details).toHaveProperty('error');
      expect(result.isError).toBe(true);
      expect(result.details.error).toHaveProperty('code');
    }
  });

  it('validates exactly-one url/id references before extraction for video/channel/playlist tools', async () => {
    const pi = createMockPi();
    const videoOnly = 'https://youtube.com/watch?v=abc123';
    const playlistOnly = 'https://www.youtube.com/playlist?list=PL1234567890123';

    registerYoutubeResearchTools(pi, {
      checkRuntime: vi.fn().mockResolvedValue({ runtime: { binary: 'yt-dlp' } }),
    });

    const videoTool = pi.tools.find((tool) => tool.name === 'youtube_video_get');
    const playlistTool = pi.tools.find((tool) => tool.name === 'youtube_playlist_get');

    const invalidVideoUrl = (await execute(videoTool!, { url: playlistOnly })) as { details: { error: { code: string } }; isError: boolean };
    expect(invalidVideoUrl.isError).toBe(true);
    expect(invalidVideoUrl.details.error.code).toBe('validation_error');

    const invalidPlaylistUrl = (await execute(playlistTool!, { url: videoOnly })) as { details: { error: { code: string } }; isError: boolean };
    expect(invalidPlaylistUrl.isError).toBe(true);
    expect(invalidPlaylistUrl.details.error.code).toBe('validation_error');

    const neither = (await execute(videoTool!, {})) as { details: { error: { code: string } }; isError: boolean };
    expect(neither.isError).toBe(true);
    expect(neither.details.error.code).toBe('validation_error');
  });

  it('accepts watch URLs with playlist context when they still identify a video', async () => {
    const pi = createMockPi();
    const { client } = createMockClient();
    (client.getVideo as any).mockResolvedValueOnce({
      id: 'abc123',
      title: 'Watch With List',
      webpage_url: 'https://www.youtube.com/watch?v=abc123&list=PL123456',
    });

    registerYoutubeResearchTools(pi, {
      checkRuntime: vi.fn().mockResolvedValue({ runtime: { binary: 'yt-dlp' } }),
      createClient: () => client,
    });

    const videoTool = pi.tools.find((tool) => tool.name === 'youtube_video_get');
    const result = (await execute(videoTool!, { url: 'https://www.youtube.com/watch?v=abc123&list=PL123456' })) as {
      details: { status: 'success'; data: { video_id: string } };
      isError?: boolean;
    };

    expect(result.isError).toBeUndefined();
    expect(result.details.status).toBe('success');
    expect(result.details.data.video_id).toBe('abc123');
  });

  it('implements youtube_search with default mixed mode and normalized mixed result shape', async () => {
    const pi = createMockPi();
    const { client } = createMockClient();

    const rawResults = [
      {
        _type: 'url',
        ie_key: 'Youtube',
        title: 'Tech video',
        webpage_url: 'https://youtube.com/watch?v=vid123',
        id: 'vid123',
        channel: 'Tech Creator',
        channel_id: 'tech-chan',
        description: 'A deep dive into youtube architecture and ranking systems for agents.',
        duration: 3723,
        view_count: 50123,
        upload_date: '20250102',
      },
      { _type: 'url', ie_key: 'YoutubeTab', title: 'Channel One', webpage_url: 'https://youtube.com/@channel1', id: 'chan1', channel_follower_count: 100, channel: 'Channel One' },
      { _type: 'url', ie_key: 'YoutubeTab', title: 'List', webpage_url: 'https://youtube.com/playlist?list=PL1', id: 'PL1', playlist_count: 1 },
      { _type: 'url', ie_key: 'Youtube', title: 'Other', webpage_url: 'https://youtube.com/watch?v=vid456', id: 'vid456', view_count: 2 },
    ];
    (client.search as any).mockResolvedValueOnce(rawResults);

    registerYoutubeResearchTools(pi, {
      checkRuntime: vi.fn().mockResolvedValue({ runtime: { binary: 'yt-dlp' } }),
      createClient: () => client,
    });

    const tool = pi.tools.find((entry) => entry.name === 'youtube_search');
    const result = (await execute(tool!, { query: 'youtube architecture', limit: 4 })) as {
      content: Array<{ text: string }>;
      details: { status: string; data: { results: YoutubeSearchResult[] } };
      isError?: boolean;
    };

    expect(result.isError).toBeUndefined();
    expect(result.details.status).toBe('success');
    expect(result.details.data.results).toHaveLength(4);
    expect(result.details.data.results.map((entry: YoutubeSearchResult) => entry.result_type)).toEqual(['video', 'channel', 'playlist', 'video']);
    expect(result.content[0].text).toContain('youtube architecture');
    expect(result.content[0].text).toContain('Tech video');
    expect(result.content[0].text).toContain('Channel One');
    expect(result.content[0].text).toContain('channel: Tech Creator');
    expect(result.content[0].text).toContain('views: 50,123');
    expect(result.content[0].text).toContain('duration: 1:02:03');
    expect(result.content[0].text).toContain('snippet: A deep dive into youtube architecture');
    expect(client.getVideo).not.toHaveBeenCalled();
  });

  it('enriches selected video search results with metadata useful for choosing a video', async () => {
    const pi = createMockPi();
    const { client } = createMockClient();

    (client.search as any).mockResolvedValueOnce([
      { _type: 'url', ie_key: 'Youtube', title: 'Video A', webpage_url: 'https://youtube.com/watch?v=aaa111', id: 'aaa111', channel: 'Chan A' },
      { _type: 'url', ie_key: 'Youtube', title: 'Video B', webpage_url: 'https://youtube.com/watch?v=bbb222', id: 'bbb222', channel: 'Chan B' },
      { _type: 'url', ie_key: 'YoutubeTab', title: 'Playlist', webpage_url: 'https://youtube.com/playlist?list=PL1', id: 'PL1' },
    ]);
    (client.getVideo as any)
      .mockResolvedValueOnce({
        id: 'aaa111',
        title: 'Video A enriched',
        webpage_url: 'https://youtube.com/watch?v=aaa111',
        channel: 'Chan A',
        description: 'This description explains why Video A is the best result for the query.'.repeat(3),
        like_count: 42,
        comment_count: 7,
        tags: ['rust', 'borrow checker', 'ownership', 'memory'],
        chapters: [{ title: 'Intro', start_time: 0 }],
      })
      .mockResolvedValueOnce({
        id: 'bbb222',
        title: 'Video B enriched',
        webpage_url: 'https://youtube.com/watch?v=bbb222',
        channel: 'Chan B',
        description: 'Second video description',
        like_count: 5,
        comment_count: 1,
        tags: ['rust'],
        chapters: [],
      });

    registerYoutubeResearchTools(pi, {
      checkRuntime: vi.fn().mockResolvedValue({ runtime: { binary: 'yt-dlp' } }),
      createClient: () => client,
    });

    const tool = pi.tools.find((entry) => entry.name === 'youtube_search');
    const result = (await execute(tool!, { query: 'rust ownership', type: 'mixed', limit: 3, enrich: true, enrichLimit: 2, descriptionPreviewChars: 90 })) as {
      content: Array<{ text: string }>;
      details: { status: string; data: { results: YoutubeSearchResult[] } };
    };

    expect(client.getVideo).toHaveBeenCalledTimes(2);
    expect(client.getVideo).toHaveBeenNthCalledWith(1, expect.objectContaining({ video_id: 'aaa111', descriptionPreviewChars: 90 }), undefined);
    expect(result.details.data.results[0]).toMatchObject({
      title: 'Video A enriched',
      description_preview: expect.stringContaining('This description explains'),
      like_count: 42,
      comment_count: 7,
      chapters_count: 1,
      tags: ['rust', 'borrow checker', 'ownership', 'memory'],
    });
    expect(result.details.data.results[2].result_type).toBe('playlist');
    expect(result.content[0].text).toContain('likes: 42');
    expect(result.content[0].text).toContain('comments: 7');
    expect(result.content[0].text).toContain('description: This description explains');
    expect(result.content[0].text).toContain('tags: rust, borrow checker, ownership');
  });

  it('keeps video-only search results when live yt-dlp rows arrive as url entries', async () => {
    const pi = createMockPi();
    const { client } = createMockClient();

    (client.search as any).mockResolvedValueOnce([
      { _type: 'url', ie_key: 'Youtube', title: 'Video A', webpage_url: 'https://youtube.com/watch?v=aaa111', id: 'aaa111' },
      { _type: 'url', ie_key: 'Youtube', title: 'Video B', webpage_url: 'https://youtube.com/watch?v=bbb222', id: 'bbb222' },
    ]);

    registerYoutubeResearchTools(pi, {
      checkRuntime: vi.fn().mockResolvedValue({ runtime: { binary: 'yt-dlp' } }),
      createClient: () => client,
    });

    const tool = pi.tools.find((entry) => entry.name === 'youtube_search');
    const result = (await execute(tool!, { query: 'python tutorial', type: 'video', limit: 5 })) as {
      details: { status: string; data: { results: YoutubeSearchResult[]; effective_type: string; total: number } };
      isError?: boolean;
    };

    expect(result.isError).toBeUndefined();
    expect(result.details.status).toBe('success');
    expect(result.details.data.effective_type).toBe('video');
    expect(result.details.data.total).toBe(2);
    expect(result.details.data.results.every((entry: YoutubeSearchResult) => entry.result_type === 'video')).toBe(true);
  });

  it('passes topic tags as additional search text to the yt-dlp client', async () => {
    const pi = createMockPi();
    const { client } = createMockClient();
    (client.search as any).mockResolvedValueOnce([
      { _type: 'url', ie_key: 'Youtube', title: 'Borrow Checker', webpage_url: 'https://youtube.com/watch?v=borrow1', id: 'borrow1' },
    ]);

    registerYoutubeResearchTools(pi, {
      checkRuntime: vi.fn().mockResolvedValue({ runtime: { binary: 'yt-dlp' } }),
      createClient: () => client,
    });

    const tool = pi.tools.find((entry) => entry.name === 'youtube_search');
    const result = (await execute(tool!, { query: 'rust ownership', topic_tags: ['borrow checker'], type: 'video', limit: 5 })) as {
      content: Array<{ text: string }>;
      details: { status: string; data: { query: string } };
    };

    expect(client.search).toHaveBeenCalledWith(expect.objectContaining({ query: 'rust ownership borrow checker' }));
    expect(result.details.data.query).toBe('rust ownership borrow checker');
    expect(result.content[0].text).toContain('rust ownership borrow checker');
  });

  it('keeps matching short-duration results found beyond the visible limit because the client overfetches', async () => {
    const pi = createMockPi();
    const { client } = createMockClient();

    (client.search as any).mockResolvedValueOnce([
      { _type: 'url', ie_key: 'Youtube', title: 'Long', webpage_url: 'https://youtube.com/watch?v=long111', id: 'long111', duration: 1530 },
      { _type: 'url', ie_key: 'Youtube', title: 'Medium', webpage_url: 'https://youtube.com/watch?v=med111', id: 'med111', duration: 361 },
      { _type: 'url', ie_key: 'Youtube', title: 'Short A', webpage_url: 'https://youtube.com/watch?v=short1', id: 'short1', duration: 206 },
      { _type: 'url', ie_key: 'Youtube', title: 'Short B', webpage_url: 'https://youtube.com/watch?v=short2', id: 'short2', duration: 149 },
    ]);

    registerYoutubeResearchTools(pi, {
      checkRuntime: vi.fn().mockResolvedValue({ runtime: { binary: 'yt-dlp' } }),
      createClient: () => client,
    });

    const tool = pi.tools.find((entry) => entry.name === 'youtube_search');
    const result = (await execute(tool!, { query: 'rust ownership explained', type: 'video', duration: 'short', limit: 1 })) as {
      details: { status: string; data: { results: YoutubeSearchResult[]; total: number } };
    };

    expect(result.details.status).toBe('success');
    expect(result.details.data.total).toBe(1);
    expect(result.details.data.results[0]?.title).toBe('Short A');
  });

  it('uses published dates for date-aware video search behavior when search rows include upload_date', async () => {
    const pi = createMockPi();
    const { client } = createMockClient();

    (client.search as any).mockResolvedValueOnce([
      { _type: 'video', ie_key: 'Youtube', title: 'Older Video', webpage_url: 'https://youtube.com/watch?v=old111', id: 'old111', upload_date: '20230101' },
      { _type: 'video', ie_key: 'Youtube', title: 'Newest Video', webpage_url: 'https://youtube.com/watch?v=new222', id: 'new222', upload_date: '20250115' },
      { _type: 'video', ie_key: 'Youtube', title: 'Middle Video', webpage_url: 'https://youtube.com/watch?v=mid333', id: 'mid333', upload_date: '20240120' },
    ]);

    registerYoutubeResearchTools(pi, {
      checkRuntime: vi.fn().mockResolvedValue({ runtime: { binary: 'yt-dlp' } }),
      createClient: () => client,
    });

    const tool = pi.tools.find((entry) => entry.name === 'youtube_search');
    const result = (await execute(tool!, {
      query: 'python tutorial',
      type: 'video',
      sort: 'date',
      published_after: '2024-01-01',
      limit: 5,
    })) as {
      content: Array<{ text: string }>;
      details: { status: string; data: { results: YoutubeSearchResult[]; effective_type: string; total: number } };
      isError?: boolean;
    };

    expect(result.isError).toBeUndefined();
    expect(result.details.status).toBe('success');
    expect(result.details.data.effective_type).toBe('video');
    expect(result.details.data.total).toBe(2);
    expect(result.details.data.results.map((entry: YoutubeSearchResult) => entry.title)).toEqual(['Newest Video', 'Middle Video']);
    expect(result.content[0].text).toContain('published: 2025-01-15');
    expect(result.content[0].text).toContain('published: 2024-01-20');
  });

  it('supports restrictive/explicit source modes with transcript fallback reporting', async () => {
    const pi = createMockPi();
    const strictMissingManualClient = createMockClient();
    (strictMissingManualClient.client.listTranscriptSources as any).mockResolvedValueOnce({
      manual: [] as TranscriptSource[],
      automatic: [] as TranscriptSource[],
      translated: [] as TranscriptSource[],
    });

    registerYoutubeResearchTools(pi, {
      checkRuntime: vi.fn().mockResolvedValue({ runtime: { binary: 'yt-dlp' } }),
      createClient: () => strictMissingManualClient.client,
    });

    const transcriptTool = pi.tools.find((tool) => tool.name === 'youtube_transcript_get');
    const manualResult = (await execute(transcriptTool!, {
      video_id: 'abc123',
      source_mode: 'manual',
      language: 'en',
    })) as { details: { error: { code: string } }; isError: boolean };
    expect(manualResult.isError).toBe(true);
    expect(manualResult.details.error.code).toBe('source_unavailable');

    const piFallback = createMockPi();
    const fallbackClient = createMockClient();
    (fallbackClient.client.listTranscriptSources as any).mockResolvedValueOnce({
      manual: [],
      automatic: [],
      translated: [],
    });
    (fallbackClient.client.getVideo as any).mockResolvedValueOnce({
      id: 'abc123',
      title: 'Fallback Video',
      description: 'Fallback description available',
    });

    registerYoutubeResearchTools(piFallback, {
      checkRuntime: vi.fn().mockResolvedValue({ runtime: { binary: 'yt-dlp' } }),
      createClient: () => fallbackClient.client,
    });

    const transcriptToolFallback = piFallback.tools.find((tool) => tool.name === 'youtube_transcript_get');
    const fallbackResult = (await execute(transcriptToolFallback!, {
      video_id: 'abc123',
      language: 'en',
      source_mode: 'best-effort',
    })) as {
      details: {
        status: 'success';
        data: { used_fallback: boolean; content_source: string; fallback_reason?: string; text: string };
      };
    };

    expect(fallbackResult.details.status).toBe('success');
    expect(fallbackResult.details.data.used_fallback).toBe(true);
    expect(fallbackResult.details.data.content_source).toMatch(/_fallback$/);
    expect(fallbackResult.details.data.text).toContain('Fallback description available');
    expect(fallbackResult.details.data.fallback_reason).toBeDefined();
  });

  it('returns metadata-rich channel search entries separate from mixed search discovery', async () => {
    const pi = createMockPi();
    const { client } = createMockClient();

    const channelRaw = [
      {
        _type: 'url',
        ie_key: 'YoutubeTab',
        title: 'Dev Ops',
        webpage_url: 'https://youtube.com/@devops',
        id: 'chan-1',
        description: 'engineering lab',
        channel_follower_count: 2300,
        channel_video_count: 88,
        channel: 'Dev Ops',
        channel_id: 'chan-1',
      },
    ];
    (client.searchChannels as any).mockResolvedValueOnce(channelRaw);

    registerYoutubeResearchTools(pi, {
      checkRuntime: vi.fn().mockResolvedValue({ runtime: { binary: 'yt-dlp' } }),
      createClient: () => client,
    });

    const channelTool = pi.tools.find((tool) => tool.name === 'youtube_channel_search');
    const result = (await execute(channelTool!, { query: 'dev channel', limit: 1 })) as {
      details: { status: 'success'; data: { results: YoutubeChannelResult[] } };
    };

    expect(result.details.status).toBe('success');
    expect(result.details.data.results).toHaveLength(1);
    expect(result.details.data.results[0].channel_name).toBe('Dev Ops');
    expect(result.details.data.results[0]).toHaveProperty('subscriber_count');
    expect(result.details.data.results[0]).toHaveProperty('video_count');
  });

  it('filters out video rows from youtube_channel_search query results', async () => {
    const pi = createMockPi();
    const { client } = createMockClient();

    (client.searchChannels as any).mockResolvedValueOnce([
      {
        _type: 'url',
        ie_key: 'Youtube',
        title: 'A video title',
        webpage_url: 'https://www.youtube.com/watch?v=vid123',
        id: 'vid123',
        channel: 'Video Channel',
        channel_id: 'chan-video',
      },
      {
        _type: 'url',
        ie_key: 'YoutubeTab',
        title: 'Gentleman Programming',
        webpage_url: 'https://www.youtube.com/channel/UCbx_d228PdYwgB4Jz202SIQ',
        id: 'UCbx_d228PdYwgB4Jz202SIQ',
        channel: 'Gentleman Programming',
        channel_id: 'UCbx_d228PdYwgB4Jz202SIQ',
      },
    ]);

    registerYoutubeResearchTools(pi, {
      checkRuntime: vi.fn().mockResolvedValue({ runtime: { binary: 'yt-dlp' } }),
      createClient: () => client,
    });

    const channelTool = pi.tools.find((tool) => tool.name === 'youtube_channel_search');
    const result = (await execute(channelTool!, { query: 'gentleman programming', limit: 5 })) as {
      details: { status: 'success'; data: { results: YoutubeChannelResult[] } };
    };

    expect(result.details.status).toBe('success');
    expect(result.details.data.results).toHaveLength(1);
    expect(result.details.data.results[0].channel_name).toBe('Gentleman Programming');
    expect(result.details.data.results[0].channel_id).toBe('UCbx_d228PdYwgB4Jz202SIQ');
  });

  it('supports direct channel lookup by channel_id using channel videos metadata', async () => {
    const pi = createMockPi();
    const { client } = createMockClient();

    (client.searchChannels as any).mockResolvedValueOnce([
      {
        _type: 'url',
        ie_key: 'Youtube',
        title: 'Some channel video',
        webpage_url: 'https://www.youtube.com/watch?v=SOxuW5K2FFY',
        id: 'SOxuW5K2FFY',
        playlist: 'Gentleman Programming - Videos',
        playlist_id: 'UCbx_d228PdYwgB4Jz202SIQ',
        playlist_title: 'Gentleman Programming - Videos',
        playlist_uploader: 'Gentleman Programming',
        playlist_uploader_id: '@gentlemanprogramming',
        playlist_channel: 'Gentleman Programming',
        playlist_channel_id: 'UCbx_d228PdYwgB4Jz202SIQ',
        playlist_webpage_url: 'https://www.youtube.com/channel/UCbx_d228PdYwgB4Jz202SIQ/videos',
      },
    ]);

    registerYoutubeResearchTools(pi, {
      checkRuntime: vi.fn().mockResolvedValue({ runtime: { binary: 'yt-dlp' } }),
      createClient: () => client,
    });

    const channelTool = pi.tools.find((tool) => tool.name === 'youtube_channel_search');
    const result = (await execute(channelTool!, { channel_id: 'UCbx_d228PdYwgB4Jz202SIQ', limit: 5 })) as {
      details: { status: 'success'; data: { results: YoutubeChannelResult[] } };
    };

    expect(result.details.status).toBe('success');
    expect(result.details.data.results).toHaveLength(1);
    expect(result.details.data.results[0].channel_name).toBe('Gentleman Programming');
    expect(result.details.data.results[0].channel_id).toBe('UCbx_d228PdYwgB4Jz202SIQ');
    expect(result.details.data.results[0].url).toContain('/channel/UCbx_d228PdYwgB4Jz202SIQ');
  });

  it('fetches playlist details with compact entry normalization and direct URL/ID support', async () => {
    const pi = createMockPi();
    const { client } = createMockClient();

    (client.getPlaylist as any).mockResolvedValue({
      id: 'PL123',
      title: 'Playlist One',
      webpage_url: 'https://youtube.com/playlist?list=PL123',
      description: 'desc',
      channel: 'host',
      entries: [{ title: 'Episode', id: 'vid1', duration: 12, url: 'https://youtube.com/watch?v=vid1' }],
    });

    registerYoutubeResearchTools(pi, {
      checkRuntime: vi.fn().mockResolvedValue({ runtime: { binary: 'yt-dlp' } }),
      createClient: () => client,
    });

    const playlistTool = pi.tools.find((tool) => tool.name === 'youtube_playlist_get');

    const byId = (await execute(playlistTool!, { playlist_id: 'PL123' })) as {
      details: { status: string; data: YoutubePlaylistDetails; error?: { code: string } };
      isError?: boolean;
    };
    expect(byId.details.status).toBe('success');
    expect(byId.details.data.playlist_id).toBe('PL123');
    expect(byId.details.data.entries).toHaveLength(1);

    const byUrl = (await execute(playlistTool!, { url: 'https://www.youtube.com/playlist?list=PL123' })) as {
      details: { status: 'success'; data: YoutubePlaylistDetails };
    };
    expect(byUrl.details.status).toBe('success');
    expect(byUrl.details.data.playlist_id).toBe('PL123');
  });

  it('returns normalized youtube_video_get payload from id/url reference', async () => {
    const pi = createMockPi();
    const { client } = createMockClient();

    const rawVideo = {
      id: 'abc123',
      title: 'Deep Video',
      webpage_url: 'https://youtube.com/watch?v=abc123',
      uploader: 'Host',
      uploader_id: '@host',
      channel_id: 'UChost123',
      description: 'This intro explains why the video is useful before listing resources and links.'.repeat(4),
      duration: 3723,
      view_count: 11,
      subtitles: {
        en: ['a'],
      },
      automatic_captions: {
        es: ['b'],
        fr: ['c'],
        de: ['d'],
        it: ['e'],
        pt: ['f'],
        ja: ['g'],
      },
      comments: [{
        id: 'comment-1',
        author: '@viewer',
        text: 'This helped me decide to watch the full video.',
        like_count: 7,
        timestamp: 1710000000,
        parent: 'root',
      }],
    };

    (client.getVideo as any).mockResolvedValue(rawVideo);

    registerYoutubeResearchTools(pi, {
      checkRuntime: vi.fn().mockResolvedValue({ runtime: { binary: 'yt-dlp' } }),
      createClient: () => client,
    });

    const videoTool = pi.tools.find((tool) => tool.name === 'youtube_video_get');
    const urlResult = (await execute(videoTool!, { url: 'https://youtu.be/abc123', includeComments: true, commentsLimit: 1, descriptionPreviewChars: 80 })) as {
      content: Array<{ text: string }>;
      details: { status: 'success'; data: YoutubeVideoDetails };
    };
    expect(urlResult.details.status).toBe('success');
    expect(urlResult.details.data.title).toBe('Deep Video');
    expect(urlResult.details.data.video_id).toBe('abc123');
    expect(urlResult.details.data.channel_name).toBe('Host');
    expect(urlResult.details.data.channel_id).toBe('UChost123');
    expect(urlResult.content[0].text).toContain('Deep Video');
    expect(urlResult.content[0].text).toContain('abc123');
    expect(urlResult.details.data.description_preview).toContain('This intro explains why the video is useful');
    expect(urlResult.details.data.comments).toHaveLength(1);
    expect(client.getVideo).toHaveBeenCalledWith(expect.objectContaining({ includeComments: true, commentsLimit: 1 }), undefined);
    expect(urlResult.content[0].text).toContain('duration: 1:02:03');
    expect(urlResult.content[0].text).toContain('views: 11');
    expect(urlResult.content[0].text).toContain('description: This intro explains why the video is useful');
    expect(urlResult.content[0].text).toContain('captions: manual en; automatic es, fr, de, it, pt… (+1 more)');
    expect(urlResult.content[0].text).toContain('comments');
    expect(urlResult.content[0].text).toContain('@viewer');

    const idResult = (await execute(videoTool!, { video_id: 'abc123' })) as { details: { status: 'success'; data: { video_id: string } } };
    expect(idResult.details.data.video_id).toBe('abc123');
  });

  it('maps unavailable youtube videos to not_found instead of a generic yt-dlp failure', async () => {
    const pi = createMockPi();
    const { client } = createMockClient();
    (client.getVideo as any).mockRejectedValueOnce(new Error('ERROR: [youtube] missing123: Video unavailable'));

    registerYoutubeResearchTools(pi, {
      checkRuntime: vi.fn().mockResolvedValue({ runtime: { binary: 'yt-dlp' } }),
      createClient: () => client,
    });

    const videoTool = pi.tools.find((tool) => tool.name === 'youtube_video_get');
    const result = (await execute(videoTool!, { video_id: 'missing123' })) as {
      isError?: boolean;
      details: { status: 'failure'; error: { code: string; message: string; recoverable: boolean } };
    };

    expect(result.isError).toBe(true);
    expect(result.details.error.code).toBe('not_found');
    expect(result.details.error.message).toContain('Video unavailable');
  });
});
