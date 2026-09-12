import { describe, expect, it } from 'vitest';
import {
  renderYoutubeToolCall,
  renderYoutubeToolResult,
  extractYoutubeAction,
  stripAnsi,
  visibleWidth,
  LIME,
  RED,
} from '../src/render.js';

describe('youtube-research custom renderer', () => {
  it('renders transcript results compactly by default and expands full content on demand inside hollow cards', () => {
    const result = {
      content: [{ type: 'text', text: 'youtube_transcript_get: automatic_subtitle [language=es]\nvideo: https://youtu.be/x\nfallback: no\ntranscript:\nUno dos tres cuatro cinco seis siete ocho nueve diez.' }],
      details: {
        status: 'success',
        data: {
          text: 'Uno dos tres cuatro cinco seis siete ocho nueve diez.',
          content_source: 'automatic_subtitle',
          language: 'es',
          video_ref: 'https://youtu.be/x',
        },
      },
    };

    const compact = renderYoutubeToolResult('youtube_transcript_get', result, { expanded: false }).render(100).join('\n');
    expect(compact).toContain('youtube_transcript_get');
    expect(compact).toContain('│');
    expect(compact).toContain('╰');
    expect(compact).toContain('full transcript available');
    expect(compact).toContain('ctrl+o expand');
    expect(compact).toContain('preview: Uno dos tres');
    expect(compact).not.toContain('transcript:\nUno dos tres');

    const expandedLines = renderYoutubeToolResult('youtube_transcript_get', result, { expanded: true }).render(40);
    const expanded = expandedLines.join('\n');
    expect(expanded).toContain('│');
    expect(expanded).toContain('╰');
    expect(expanded).toContain('ctrl+o collapse');
    expect(expanded).toContain('transcript:');
    expect(expanded).toContain('Uno dos tres cuatro cinco seis');
    expect(expanded).toContain('ocho nueve diez.');
    expect(expandedLines.every((line) => visibleWidth(line) <= 40)).toBe(true);
  });

  it('renders generic youtube tool results compactly by default with hollow card framing', () => {
    const result = {
      content: [{ type: 'text', text: 'youtube_channel_search: 1 result(s) for "Tecnonauta"\n1. Tecnonauta — url' }],
      details: { status: 'success', data: {} },
    };

    const compact = renderYoutubeToolResult('youtube_channel_search', result, { expanded: false }).render(80).join('\n');
    expect(compact).toContain('youtube_channel_search');
    expect(compact).toContain('│');
    expect(compact).toContain('╰');
    expect(compact).toContain('ctrl+o expand');
    expect(compact).not.toContain('1. Tecnonauta');
  });

  it('renders pending card during call phase and extracts action badge', () => {
    const context: any = { state: {} };
    const callComponent = renderYoutubeToolCall('youtube_search', { query: 'lo-fi beats' }, {}, context);
    const lines = callComponent.render(80);

    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('╭');
    expect(lines[0]).toContain('youtube_search [lo-fi beats]');
    expect(lines[0]).toContain('╮');
    expect(lines[1]).toContain('│');
    expect(lines[1]).toContain('Pending: lo-fi beats');
    expect(lines[2]).toContain('╰');
  });

  it('coordinates two-phase slot assembly via context.state', () => {
    const context: any = { state: {} };
    const callComponent = renderYoutubeToolCall('youtube_video_get', { video_ref: 'dQw4w9WgXcQ' }, {}, context);
    expect(callComponent.render(80)).toHaveLength(3);

    const resultComponent = renderYoutubeToolResult(
      'youtube_video_get',
      {
        content: [{ type: 'text', text: 'Never Gonna Give You Up' }],
        details: { status: 'success' },
      },
      { expanded: false },
      {},
      context,
    );
    expect(context.state.hasResult).toBe(true);
    expect(context.state.borderColor).toBe(LIME);

    // Call collapses to only top border in LIME
    const afterCall = callComponent.render(80);
    expect(afterCall).toHaveLength(1);
    expect(afterCall[0]).toContain('╭');
    expect(afterCall[0]).toContain(LIME);

    // Result ends with bottom border in LIME
    const resultLines = resultComponent.render(80);
    expect(resultLines[resultLines.length - 1]).toContain(LIME);
  });

  it('sets RED border on error results', () => {
    const context: any = { state: {} };
    const resultComponent = renderYoutubeToolResult(
      'youtube_transcript_get',
      {
        content: [{ type: 'text', text: 'Captions are disabled for this video.' }],
        details: { status: 'failure', error: { message: 'Captions are disabled' } },
        isError: true,
      },
      { expanded: false },
      {},
      context,
    );
    expect(context.state.hasResult).toBe(true);
    expect(context.state.borderColor).toBe(RED);

    const resultLines = resultComponent.render(80);
    expect(resultLines[resultLines.length - 1]).toContain(RED);
    expect(resultLines.join('\n')).toContain('Captions are disabled');
  });

  it('extracts youtube actions correctly across all tool types', () => {
    expect(extractYoutubeAction('youtube_search', { query: 'test query' })).toBe('test query');
    expect(extractYoutubeAction('youtube_video_get', { video_ref: 'abc123' })).toBe('abc123');
    expect(extractYoutubeAction('youtube_transcript_get', { video_ref: 'abc123', mode: 'manual' })).toBe('abc123 [manual]');
    expect(extractYoutubeAction('youtube_channel_search', { handle: '@creator' })).toBe('@creator');
    expect(extractYoutubeAction('youtube_playlist_get', { playlist_ref: 'PL12345' })).toBe('PL12345');
  });

  it('falls back to single fit line when width < 24', () => {
    const callComponent = renderYoutubeToolCall('youtube_search', { query: 'piano' }, {}, {});
    const lines = callComponent.render(20);
    expect(lines).toHaveLength(1);
    expect(visibleWidth(lines[0])).toBeLessThanOrEqual(20);
  });
});
