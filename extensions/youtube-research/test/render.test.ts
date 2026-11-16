import { describe, expect, it } from 'vitest';
import {
  COMPACT_TOOL_RENDERING,
  renderYoutubeToolCall,
  renderYoutubeToolResult,
  extractYoutubeAction,
  visibleWidth,
} from '../src/render.js';
import { registerYoutubeResearchTools } from '../src/tools.js';

const FRAME = /[╭╮╰╯│]/;

describe('youtube-research custom renderer', () => {
  it('renders transcript results as one compact inline row and expands the full transcript losslessly', () => {
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

    const compactLines = renderYoutubeToolResult('youtube_transcript_get', result, { expanded: false }).render(100);
    const compact = compactLines.join('\n');
    expect(compactLines).toHaveLength(1);
    expect(compact).toContain('youtube_transcript_get');
    expect(compact).toContain('automatic_subtitle');
    expect(compact).toContain('es');
    expect(compact).toContain('10 words');
    expect(compact).toContain('https://youtu.be/x');
    expect(compact).toContain('─');
    expect(compact).not.toMatch(FRAME);
    expect(compact).not.toMatch(/ctrl\+o|to expand/i);
    expect(compact).not.toContain('transcript:\nUno dos tres');

    const expandedLines = renderYoutubeToolResult('youtube_transcript_get', result, { expanded: true }).render(40);
    const expanded = expandedLines.join('\n');
    // Same header row at the same width; only the clipped tail differs from the 100-cell row.
    expect(expandedLines[0]).toBe(
      renderYoutubeToolResult('youtube_transcript_get', result, { expanded: false }).render(40)[0],
    );
    expect(expanded).not.toMatch(FRAME);
    expect(expanded).not.toMatch(/ctrl\+o|to collapse/i);
    expect(expanded).toContain('transcript:');
    expect(expanded).toContain('Uno dos tres cuatro cinco seis');
    expect(expanded).toContain('ocho nueve diez.');
    expect(expandedLines.every((line) => visibleWidth(line) <= 40)).toBe(true);
  });

  it('renders generic youtube results as one compact row without dumping result text', () => {
    const result = {
      content: [{ type: 'text', text: 'youtube_channel_search: 1 result(s) for "Tecnonauta"\n1. Tecnonauta — url' }],
      details: { status: 'success', data: { results: [{ name: 'Tecnonauta' }] } },
    };

    const compactLines = renderYoutubeToolResult('youtube_channel_search', result, { expanded: false }).render(80);
    const compact = compactLines.join('\n');
    expect(compactLines).toHaveLength(1);
    expect(compact).toContain('youtube_channel_search');
    expect(compact).toContain('complete');
    expect(compact).toContain('1 results');
    expect(compact).not.toMatch(FRAME);
    expect(compact).not.toMatch(/ctrl\+o|to expand/i);
    expect(compact).not.toContain('1. Tecnonauta');

    const expanded = renderYoutubeToolResult('youtube_channel_search', result, { expanded: true }).render(80).join('\n');
    expect(expanded).toContain('1. Tecnonauta');
  });

  it('keeps playlist pagination identity in the compact row and preserves entries on expansion', () => {
    const result = {
      content: [{ type: 'text', text: 'youtube_playlist_get: 2 entries\n- one\n- two' }],
      details: {
        status: 'success',
        data: { entries: [{ id: 'a' }, { id: 'b' }], entriesOffset: 10, entriesTotal: 42, playlist: { id: 'PL123' } },
      },
    };
    const compact = renderYoutubeToolResult('youtube_playlist_get', result, { expanded: false }).render(120).join('\n');
    expect(compact).toContain('PL123');
    expect(compact).toContain('2 entries');
    expect(compact).toContain('entries 10+ of 42');
    expect(renderYoutubeToolResult('youtube_playlist_get', result, { expanded: true }).render(120).join('\n')).toContain('- two');
  });

  it('renders one pending inline row during the call phase and extracts the action badge', () => {
    const context: any = { state: {} };
    const callComponent = renderYoutubeToolCall('youtube_search', { query: 'lo-fi beats' }, {}, context);
    const lines = callComponent.render(80);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('youtube_search');
    expect(lines[0]).toContain('lo-fi beats');
    expect(lines[0]).toContain('running');
    expect(lines[0]).not.toMatch(FRAME);
  });

  it('coordinates two-phase slot assembly via context.state without borders', () => {
    const context: any = { state: {} };
    const callComponent = renderYoutubeToolCall('youtube_video_get', { video_ref: 'dQw4w9WgXcQ' }, {}, context);
    expect(callComponent.render(80)).toHaveLength(1);

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
    expect(context.state.isError).toBe(false);

    expect(callComponent.render(80)).toEqual([]);

    const resultLines = resultComponent.render(80);
    expect(resultLines).toHaveLength(1);
    expect(resultLines[0]).toContain('youtube_video_get');
    expect(resultLines[0]).not.toMatch(FRAME);
  });

  it('marks error results in the compact row and keeps the returned text on expansion', () => {
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
    expect(context.state.isError).toBe(true);

    const resultLines = resultComponent.render(80);
    expect(resultLines).toHaveLength(1);
    expect(resultLines[0]).toContain('error');
    expect(resultLines[0]).toContain('Captions are disabled');
    expect(resultLines[0]).not.toMatch(FRAME);

    const expanded = renderYoutubeToolResult(
      'youtube_transcript_get',
      {
        content: [{ type: 'text', text: 'Captions are disabled for this video.' }],
        details: { status: 'failure', error: { message: 'Captions are disabled' } },
        isError: true,
      },
      { expanded: true },
      {},
      { state: {} },
    ).render(80);
    expect(expanded.every((l) => l.startsWith(' '))).toBe(true);
    expect(expanded.slice(1)).toContain(' Captions are disabled for this video.');
  });

  it('extracts youtube actions correctly across all tool types', () => {
    expect(extractYoutubeAction('youtube_search', { query: 'test query' })).toBe('test query');
    expect(extractYoutubeAction('youtube_video_get', { video_ref: 'abc123' })).toBe('abc123');
    expect(extractYoutubeAction('youtube_transcript_get', { video_ref: 'abc123', mode: 'manual' })).toBe('abc123 [manual]');
    expect(extractYoutubeAction('youtube_channel_search', { handle: '@creator' })).toBe('@creator');
    expect(extractYoutubeAction('youtube_playlist_get', { playlist_ref: 'PL12345' })).toBe('PL12345');
  });

  it('fits narrow widths and emits no cells at zero width', () => {
    const callComponent = renderYoutubeToolCall('youtube_search', { query: 'piano' }, {}, {});
    const lines = callComponent.render(20);
    expect(lines).toHaveLength(1);
    expect(visibleWidth(lines[0])).toBeLessThanOrEqual(20);

    const result = {
      content: [{ type: 'text', text: 'a\n\nb' }],
      details: { status: 'success', data: {} },
    };
    for (const width of [1, 2, 10, 23]) {
      const rendered = renderYoutubeToolResult('youtube_search', result, { expanded: true }).render(width);
      for (const line of rendered) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    }
    expect(renderYoutubeToolResult('youtube_search', result, { expanded: true }).render(0)).toEqual([]);
  });

  it('keeps every returned text block reachable when expanded', () => {
    const result = {
      content: [
        { type: 'text', text: 'BLOCK_ONE' },
        { type: 'text', text: 'BLOCK_TWO' },
      ],
      details: { status: 'success', data: {} },
    };
    const expanded = renderYoutubeToolResult('youtube_search', result, { expanded: true }).render(200).join('\n');
    expect(expanded).toContain('BLOCK_ONE');
    expect(expanded).toContain('BLOCK_TWO');
  });

  it('wraps very long single-line transcripts without quadratic blowup', () => {
    const result = { content: [{ type: 'text', text: 'x'.repeat(20000) }], details: { status: 'success', data: {} } };
    const started = Date.now();
    const lines = renderYoutubeToolResult('youtube_search', result, { expanded: true }).render(2);
    expect(lines.length).toBeGreaterThan(1000);
    expect(Date.now() - started).toBeLessThan(2000);
    for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(2);
  });

  it('registers the compact marker, self shell, and both safe slots on every public tool', () => {
    expect(COMPACT_TOOL_RENDERING.compactToolRenderingVersion).toBe(1);
    const tools: any[] = [];
    registerYoutubeResearchTools({ registerTool: (tool: any) => tools.push(tool) });
    expect(tools.map((tool) => tool.name)).toEqual([
      'youtube_search',
      'youtube_video_get',
      'youtube_transcript_get',
      'youtube_channel_search',
      'youtube_playlist_get',
    ]);
    for (const tool of tools) {
      expect(tool.renderShell, `${tool.name} renderShell`).toBe('self');
      expect(tool.compactToolRenderingVersion, `${tool.name} marker`).toBe(1);
      expect(tool.renderCall, `${tool.name} renderCall`).toBeTypeOf('function');
      expect(tool.renderResult, `${tool.name} renderResult`).toBeTypeOf('function');
    }
  });
});
