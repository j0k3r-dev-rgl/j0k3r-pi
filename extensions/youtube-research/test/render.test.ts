import { describe, expect, it } from 'vitest';
import { renderYoutubeToolResult } from '../src/render.js';

describe('youtube-research custom renderer', () => {
  it('renders transcript results compactly by default and expands full content on demand', () => {
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

    const compact = renderYoutubeToolResult(result, { expanded: false }).render(100).join('\n');
    expect(compact).toContain('youtube_transcript_get');
    expect(compact).toContain('full transcript available');
    expect(compact).toContain('ctrl+o expand');
    expect(compact).toContain('preview: Uno dos tres');
    expect(compact).not.toContain('transcript:\nUno dos tres');

    const expandedLines = renderYoutubeToolResult(result, { expanded: true }).render(40);
    const expanded = expandedLines.join('\n');
    expect(expanded).toContain('ctrl+o collapse');
    expect(expanded).toContain('transcript:');
    expect(expanded).toContain('Uno dos tres cuatro cinco seis');
    expect(expanded).toContain('ocho nueve diez.');
    expect(expandedLines.every((line) => line.length <= 40)).toBe(true);
  });

  it('renders generic youtube tool results compactly by default', () => {
    const result = {
      content: [{ type: 'text', text: 'youtube_channel_search: 1 result(s) for "Tecnonauta"\n1. Tecnonauta — url' }],
      details: { status: 'success', data: {} },
    };

    const compact = renderYoutubeToolResult(result, { expanded: false }).render(80).join('\n');
    expect(compact).toContain('youtube_channel_search');
    expect(compact).toContain('ctrl+o expand');
    expect(compact).not.toContain('1. Tecnonauta');
  });
});
