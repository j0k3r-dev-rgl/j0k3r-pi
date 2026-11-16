import { describe, expect, it } from 'vitest';
import {
  COMPACT_TOOL_RENDERING,
  RED,
  extractMarkdownToAudioBadge,
  extractScreenshotBadge,
  renderMarkdownToAudioCall,
  renderMarkdownToAudioResult,
  renderScreenshotCall,
  renderScreenshotResult,
  visibleWidth,
} from '../src/render.js';
import { registerUtilsTools } from './helpers-enabled.js';

const FRAME = /[╭╮╰╯│]/;

const mockTheme = {
  fg: (_token: string, text: string) => text,
  bold: (text: string) => text,
  keybinding: (action: string) => (action === 'app.tools.expand' ? 'ctrl+o' : undefined),
};

describe('utils renderers', () => {
  it('registers the compact marker, self shell, and both safe slots on every tool', async () => {
    expect(COMPACT_TOOL_RENDERING.compactToolRenderingVersion).toBe(1);
    const tools = await registerUtilsTools();
    expect(tools.map((tool) => tool.name)).toEqual(['screenshot', 'markdown_to_audio']);
    for (const tool of tools) {
      expect(tool.renderShell, `${tool.name} renderShell`).toBe('self');
      expect(tool.compactToolRenderingVersion, `${tool.name} marker`).toBe(1);
      expect(typeof tool.renderCall).toBe('function');
      expect(typeof tool.renderResult).toBe('function');
    }
  });

  describe('screenshot renderer', () => {
    it('extracts correct badges for screenshot action and target', () => {
      expect(extractScreenshotBadge({})).toBe('capture [screen]');
      expect(extractScreenshotBadge({ action: 'list-windows' })).toBe('list-windows');
      expect(extractScreenshotBadge({ action: 'capture', target: 'active-window' })).toBe('capture [active-window]');
      expect(extractScreenshotBadge({ action: 'capture', target: 'window' })).toBe('capture [window]');
    });

    it('renders the pending screenshot call as one compact inline row', () => {
      const context = { state: {} };
      const lines = renderScreenshotCall({ target: 'screen' }, mockTheme, context).render(80);

      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('screenshot');
      expect(lines[0]).toContain('capture [screen]');
      expect(lines[0]).toContain('running');
      expect(lines[0]).toContain('─');
      expect(lines[0]).not.toMatch(FRAME);
      expect(lines[0]).not.toMatch(/ctrl\+o|to expand/i);
      expect(visibleWidth(lines[0])).toBeLessThanOrEqual(80);
    });

    it('coordinates two-phase slot assembly for screenshot via context.state', () => {
      const context: any = { state: {} };

      const pending = renderScreenshotCall({ target: 'screen' }, mockTheme, context).render(80);
      expect(pending).toHaveLength(1);
      expect(pending[0]).not.toMatch(FRAME);

      const resultComp = renderScreenshotResult(
        {
          details: {
            status: 'success',
            data: {
              action: 'capture',
              target: 'screen',
              outputPath: '/tmp/screenshot.png',
              outputSizeBytes: 1048576,
              warnings: [],
            },
          },
        },
        { expanded: false },
        mockTheme,
        context,
      );

      expect(context.state.hasResult).toBe(true);

      const resolvedCall = renderScreenshotCall({ target: 'screen' }, mockTheme, context).render(80);
      expect(resolvedCall).toEqual([]);

      const resultLines = resultComp.render(80);
      expect(resultLines).toHaveLength(1);
      expect(resultLines[0]).toContain('screenshot');
      expect(resultLines[0]).toContain('/tmp/screenshot.png');
      expect(resultLines[0]).not.toMatch(FRAME);
    });

    it('renders screenshot capture compactly and keeps complete expanded metadata', () => {
      const result = {
        details: {
          status: 'success',
          data: {
            action: 'capture',
            target: 'window',
            outputPath: '/tmp/win.png',
            outputSizeBytes: 204800,
            displayServer: 'wayland',
            screenshotProgram: 'grim',
            command: 'grim /tmp/win.png',
            window: {
              id: '0x123',
              title: 'Terminal Window',
              app: 'foot',
              bounds: { x: 0, y: 0, width: 800, height: 600 },
            },
            warnings: ['Sample warning'],
          },
        },
      };

      const collapsedLines = renderScreenshotResult(result, { expanded: false }, mockTheme, { state: {} }).render(120);
      expect(collapsedLines).toHaveLength(1);
      expect(collapsedLines[0]).toContain('captured window 800x600');
      expect(collapsedLines[0]).toContain('200.0 KiB');
      expect(collapsedLines[0]).toContain('/tmp/win.png');
      expect(collapsedLines[0]).not.toMatch(/ctrl\+o|to expand/i);
      expect(collapsedLines[0]).not.toMatch(FRAME);

      const expanded = renderScreenshotResult(result, { expanded: true }, mockTheme, { state: {} }).render(120).join('\n');
      expect(expanded).toContain('target: window');
      expect(expanded).toContain('window: id=0x123 title="Terminal Window" app=foot');
      expect(expanded).toContain('dimensions: 800x600 at (0, 0)');
      expect(expanded).toContain('Sample warning');
      expect(expanded).not.toMatch(/ctrl\+o|to collapse/i);
    });

    it('renders screenshot list-windows compactly and keeps every window on expansion', () => {
      const result = {
        details: {
          status: 'success',
          data: {
            action: 'list-windows',
            displayServer: 'wayland',
            backend: 'hyprland',
            command: 'hyprctl clients',
            windows: [
              { id: '1', title: 'Editor', app: 'code', focused: true },
              { id: '2', title: 'Browser', app: 'chrome', focused: false },
            ],
            warnings: [],
          },
        },
      };

      const collapsedLines = renderScreenshotResult(result, { expanded: false }, mockTheme, { state: {} }).render(80);
      expect(collapsedLines).toHaveLength(1);
      expect(collapsedLines[0]).toContain('2 windows listed');

      const expanded = renderScreenshotResult(result, { expanded: true }, mockTheme, { state: {} }).render(80).join('\n');
      expect(expanded).toContain('[1] "Editor" [code] (focused)');
      expect(expanded).toContain('[2] "Browser" [chrome]');
    });

    it('marks screenshot failures in one red row and keeps returned text on expansion', () => {
      const context: any = { state: {} };
      const errResult = {
        isError: true,
        details: {
          status: 'failure',
          error: { code: 'missing_dependency', message: 'grim not found on path' },
        },
        content: [{ type: 'text', text: 'install grim to capture screenshots' }],
      };

      const lines = renderScreenshotResult(errResult, { expanded: false }, mockTheme, context).render(80);
      expect(context.state.isError).toBe(true);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('error');
      expect(lines[0]).toContain('grim not found on path');
      expect(lines[0]).not.toMatch(FRAME);

      const redTheme = { ...mockTheme, fg: (name: string, text: string) => (name === 'error' ? `${RED}${text}\x1b[0m` : text) };
      expect(renderScreenshotResult(errResult, { expanded: false }, redTheme, { state: {} }).render(80)[0]).toContain(RED);

      const expanded = renderScreenshotResult(errResult, { expanded: true }, mockTheme, { state: {} }).render(80);
      expect(expanded.every((l) => l.startsWith(' '))).toBe(true);
      expect(expanded.slice(1)).toContain(' install grim to capture screenshots');
    });
  });

  describe('markdown_to_audio renderer', () => {
    it('extracts correct badge from markdown file path', () => {
      expect(extractMarkdownToAudioBadge({})).toBe('tts');
      expect(extractMarkdownToAudioBadge({ path: 'docs/guide.md' })).toBe('tts [guide.md]');
    });

    it('renders the pending audio call as one compact inline row', () => {
      const context = { state: {} };
      const lines = renderMarkdownToAudioCall({ path: 'notes/demo.md' }, mockTheme, context).render(80);

      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('markdown_to_audio');
      expect(lines[0]).toContain('tts [demo.md]');
      expect(lines[0]).toContain('running');
      expect(lines[0]).not.toMatch(FRAME);
    });

    it('coordinates two-phase slot assembly for the audio tool', () => {
      const context: any = { state: {} };
      const pending = renderMarkdownToAudioCall({ path: 'notes.md' }, mockTheme, context).render(80);
      expect(pending).toHaveLength(1);

      const resultComp = renderMarkdownToAudioResult(
        {
          details: {
            status: 'success',
            data: {
              inputPath: 'notes.md',
              outputPath: 'notes.wav',
              engine: 'piper',
              textCharCount: 450,
              outputSizeBytes: 32000,
              warnings: [],
            },
          },
        },
        { expanded: false },
        mockTheme,
        context,
      );

      expect(context.state.hasResult).toBe(true);

      const resolvedCall = renderMarkdownToAudioCall({ path: 'notes.md' }, mockTheme, context).render(80);
      expect(resolvedCall).toEqual([]);

      const resultLines = resultComp.render(80);
      expect(resultLines).toHaveLength(1);
      expect(resultLines[0]).toContain('markdown_to_audio');
      expect(resultLines[0]).toContain('450 chars');
      expect(resultLines[0]).not.toMatch(FRAME);
    });

    it('renders audio compactly and keeps complete expanded metadata', () => {
      const result = {
        details: {
          status: 'success',
          data: {
            inputPath: 'doc.md',
            outputPath: 'doc.mp3',
            engine: 'piper',
            engineRole: 'primary',
            ttsProgram: 'piper-tts',
            voiceModel: 'es_ES.onnx',
            language: 'es',
            format: 'mp3',
            textCharCount: 1200,
            outputSizeBytes: 65536,
            warnings: ['Notice'],
          },
        },
      };

      const collapsedLines = renderMarkdownToAudioResult(result, { expanded: false }, mockTheme, { state: {} }).render(120);
      expect(collapsedLines).toHaveLength(1);
      expect(collapsedLines[0]).toContain('1200 chars');
      expect(collapsedLines[0]).toContain('64.0 KiB');
      expect(collapsedLines[0]).toContain('[piper]');
      expect(collapsedLines[0]).not.toMatch(/ctrl\+o|to expand/i);

      const expanded = renderMarkdownToAudioResult(result, { expanded: true }, mockTheme, { state: {} }).render(120).join('\n');
      expect(expanded).toContain('input: doc.md');
      expect(expanded).toContain('output: doc.mp3');
      expect(expanded).toContain('engine: piper (primary)');
      expect(expanded).toContain('voice model: es_ES.onnx');
      expect(expanded).toContain('Notice');
      expect(expanded).not.toMatch(/ctrl\+o|to collapse/i);
    });

    it('marks audio failures in one red row and keeps returned text on expansion', () => {
      const context: any = { state: {} };
      const errResult = {
        isError: true,
        details: {
          status: 'failure',
          error: { code: 'audio_generation_error', message: 'piper process exited with code 1' },
        },
        content: [{ type: 'text', text: 'install piper-tts or espeak-ng' }],
      };

      const lines = renderMarkdownToAudioResult(errResult, { expanded: false }, mockTheme, context).render(80);
      expect(context.state.isError).toBe(true);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('piper process exited with code 1');

      const expanded = renderMarkdownToAudioResult(errResult, { expanded: true }, mockTheme, { state: {} }).render(80);
      expect(expanded.every((l) => l.startsWith(' '))).toBe(true);
      expect(expanded.slice(1)).toContain(' install piper-tts or espeak-ng');
    });
  });

  it('keeps every returned text block reachable when expanded', () => {
    for (const [render, result] of [
      [renderScreenshotResult, { content: [{ type: 'text', text: 'BLOCK_ONE' }, { type: 'text', text: 'BLOCK_TWO' }], details: { status: 'success', data: { action: 'capture', target: 'screen' } } }],
      [renderMarkdownToAudioResult, { content: [{ type: 'text', text: 'BLOCK_ONE' }, { type: 'text', text: 'BLOCK_TWO' }], details: { status: 'success', data: { engine: 'piper' } } }],
    ] as const) {
      const expanded = (render as any)(result, { expanded: true }, mockTheme, { state: {} }).render(200).join('\n');
      expect(expanded).toContain('BLOCK_ONE');
      expect(expanded).toContain('BLOCK_TWO');
    }
  });

  it('wraps very long single-line payloads without quadratic blowup', () => {
    const result = { content: [{ type: 'text', text: 'x'.repeat(20000) }], details: { status: 'success', data: { action: 'capture' } } };
    const started = Date.now();
    const lines = renderScreenshotResult(result, { expanded: true }, mockTheme, { state: {} }).render(2);
    expect(lines.length).toBeGreaterThan(1000);
    expect(Date.now() - started).toBeLessThan(2000);
    for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(2);
  });

  it('stays width-safe at narrow widths and emits no cells at zero width', () => {
    const callLines = renderScreenshotCall({ target: 'screen' }, mockTheme).render(18);
    expect(callLines).toHaveLength(1);
    expect(visibleWidth(callLines[0])).toBeLessThanOrEqual(18);
    expect(callLines[0]).not.toMatch(FRAME);

    for (const width of [1, 2, 10, 23]) {
      const resultLines = renderScreenshotResult(
        { details: { status: 'success', data: { action: 'capture', target: 'screen', outputPath: '/tmp/a-very-long-screenshot-name.png' } } },
        { expanded: true },
        mockTheme,
        { state: {} },
      ).render(width);
      expect(resultLines.length).toBeGreaterThan(0);
      for (const line of resultLines) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    }

    expect(
      renderScreenshotResult({ details: { status: 'success', data: {} } }, { expanded: false }, mockTheme, { state: {} }).render(0),
    ).toEqual([]);
  });
});
