import { describe, expect, it, vi } from 'vitest';
import utilsExtension from '../index.js';
import {
  CYAN,
  DIM,
  LIME,
  RED,
  RESET,
  extractMarkdownToAudioBadge,
  extractScreenshotBadge,
  renderMarkdownToAudioCall,
  renderMarkdownToAudioResult,
  renderScreenshotCall,
  renderScreenshotResult,
  visibleWidth,
} from '../src/render.js';

const mockTheme = {
  fg: (_token: string, text: string) => text,
  bold: (text: string) => text,
  keybinding: (action: string) => (action === 'app.tools.expand' ? 'ctrl+o' : undefined),
};

describe('utils renderers', () => {
  it('registers tools with renderShell: "self", renderCall, and renderResult', () => {
    const tools: any[] = [];
    const pi = {
      registerTool: vi.fn((tool: any) => tools.push(tool)),
    };

    utilsExtension(pi);

    const screenshotTool = tools.find((t) => t.name === 'screenshot');
    const audioTool = tools.find((t) => t.name === 'markdown_to_audio');

    expect(screenshotTool).toBeDefined();
    expect(screenshotTool.renderShell).toBe('self');
    expect(typeof screenshotTool.renderCall).toBe('function');
    expect(typeof screenshotTool.renderResult).toBe('function');

    expect(audioTool).toBeDefined();
    expect(audioTool.renderShell).toBe('self');
    expect(typeof audioTool.renderCall).toBe('function');
    expect(typeof audioTool.renderResult).toBe('function');
  });

  describe('screenshot renderer', () => {
    it('extracts correct badges for screenshot action and target', () => {
      expect(extractScreenshotBadge({})).toBe('capture [screen]');
      expect(extractScreenshotBadge({ action: 'list-windows' })).toBe('list-windows');
      expect(extractScreenshotBadge({ action: 'capture', target: 'active-window' })).toBe('capture [active-window]');
      expect(extractScreenshotBadge({ action: 'capture', target: 'window' })).toBe('capture [window]');
    });

    it('renders pending screenshot call card with rounded corners and consistent widths', () => {
      const context = { state: {} };
      const call = renderScreenshotCall({ target: 'screen' }, mockTheme, context);
      const lines = call.render(80);

      expect(lines).toHaveLength(3);
      expect(lines[0]).toContain('╭');
      expect(lines[0]).toContain('╮');
      expect(lines[0]).toContain('screenshot [capture [screen]]');
      expect(lines[1]).toContain('│');
      expect(lines[1]).toContain('Pending: Capturing screenshot...');
      expect(lines[2]).toContain('╰');
      expect(lines[2]).toContain('╯');

      for (const line of lines) {
        expect(visibleWidth(line)).toBe(80);
        expect(line).not.toMatch(/\x1b\[4[0-7]m/);
      }
    });

    it('coordinates two-phase slot assembly for screenshot via context.state', () => {
      const context: any = { state: {} };

      // Phase 1: Pending call
      const pending = renderScreenshotCall({ target: 'screen' }, mockTheme, context).render(80);
      expect(pending).toHaveLength(3);
      expect(pending[0]).toContain('╭');
      expect(pending[2]).toContain('╰');

      // Result arrives
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
      expect(context.state.borderColor).toBe(LIME);

      // Phase 2: Call re-renders as top border only
      const resolvedCall = renderScreenshotCall({ target: 'screen' }, mockTheme, context).render(80);
      expect(resolvedCall).toHaveLength(1);
      expect(resolvedCall[0]).toContain('╭');
      expect(resolvedCall[0]).toContain(LIME);

      // Slot 2: Result renders framed content + bottom border
      const resultLines = resultComp.render(80);
      expect(resultLines[resultLines.length - 1]).toContain('╰');

      const assembled = [...resolvedCall, ...resultLines];
      const tops = assembled.filter((l) => l.includes('╭'));
      const bottoms = assembled.filter((l) => l.includes('╰'));
      expect(tops).toHaveLength(1);
      expect(bottoms).toHaveLength(1);

      for (const line of assembled) {
        expect(visibleWidth(line)).toBe(80);
      }
    });

    it('renders screenshot capture collapsed and expanded views', () => {
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

      const collapsed = renderScreenshotResult(result, { expanded: false }, mockTheme).render(80).join('\n');
      expect(collapsed).toContain('✓ captured window 800x600 (200.0 KiB) -> /tmp/win.png');
      expect(collapsed).toContain('ctrl+o expand');

      const expanded = renderScreenshotResult(result, { expanded: true }, mockTheme).render(80).join('\n');
      expect(expanded).toContain('✓ captured window 800x600 (200.0 KiB) -> /tmp/win.png');
      expect(expanded).toContain('target: window');
      expect(expanded).toContain('window: id=0x123 title="Terminal Window" app=foot');
      expect(expanded).toContain('dimensions: 800x600 at (0, 0)');
      expect(expanded).toContain('Sample warning');
      expect(expanded).toContain('ctrl+o collapse');
    });

    it('renders screenshot list-windows collapsed and expanded views', () => {
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

      const collapsed = renderScreenshotResult(result, { expanded: false }, mockTheme).render(80).join('\n');
      expect(collapsed).toContain('✓ 2 windows listed');
      expect(collapsed).toContain('ctrl+o expand');

      const expanded = renderScreenshotResult(result, { expanded: true }, mockTheme).render(80).join('\n');
      expect(expanded).toContain('✓ 2 windows listed');
      expect(expanded).toContain('[1] "Editor" [code] (focused)');
      expect(expanded).toContain('[2] "Browser" [chrome]');
      expect(expanded).toContain('ctrl+o collapse');
    });

    it('renders electric red border and error message on screenshot failure', () => {
      const context: any = { state: {} };
      const errResult = {
        isError: true,
        details: {
          status: 'failure',
          error: { code: 'missing_dependency', message: 'grim not found on path' },
        },
      };

      const lines = renderScreenshotResult(errResult, { expanded: false }, mockTheme, context).render(80);
      expect(context.state.borderColor).toBe(RED);
      expect(lines[lines.length - 1]).toContain(RED);
      expect(lines.join('\n')).toContain('Error: grim not found on path');
    });
  });

  describe('markdown_to_audio renderer', () => {
    it('extracts correct badge from markdown file path', () => {
      expect(extractMarkdownToAudioBadge({})).toBe('tts');
      expect(extractMarkdownToAudioBadge({ path: 'docs/guide.md' })).toBe('tts [guide.md]');
    });

    it('renders pending audio call card', () => {
      const context = { state: {} };
      const lines = renderMarkdownToAudioCall({ path: 'notes/demo.md' }, mockTheme, context).render(80);

      expect(lines).toHaveLength(3);
      expect(lines[0]).toContain('╭');
      expect(lines[0]).toContain('markdown_to_audio [tts [demo.md]]');
      expect(lines[1]).toContain('Pending: Converting markdown to audio...');
      expect(lines[2]).toContain('╰');
    });

    it('coordinates two-phase slot assembly for audio tool', () => {
      const context: any = { state: {} };
      const pending = renderMarkdownToAudioCall({ path: 'notes.md' }, mockTheme, context).render(80);
      expect(pending).toHaveLength(3);

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
      expect(context.state.borderColor).toBe(LIME);

      const resolvedCall = renderMarkdownToAudioCall({ path: 'notes.md' }, mockTheme, context).render(80);
      expect(resolvedCall).toHaveLength(1);
      expect(resolvedCall[0]).toContain(LIME);

      const resultLines = resultComp.render(80);
      expect(resultLines[resultLines.length - 1]).toContain('╰');
    });

    it('renders audio collapsed and expanded views', () => {
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

      const collapsed = renderMarkdownToAudioResult(result, { expanded: false }, mockTheme).render(80).join('\n');
      expect(collapsed).toContain('✓ audio generated: 1200 chars (64.0 KiB) [piper]');
      expect(collapsed).toContain('ctrl+o expand');

      const expanded = renderMarkdownToAudioResult(result, { expanded: true }, mockTheme).render(80).join('\n');
      expect(expanded).toContain('input: doc.md');
      expect(expanded).toContain('output: doc.mp3');
      expect(expanded).toContain('engine: piper (primary)');
      expect(expanded).toContain('voice model: es_ES.onnx');
      expect(expanded).toContain('Notice');
      expect(expanded).toContain('ctrl+o collapse');
    });

    it('renders error on audio generation failure', () => {
      const context: any = { state: {} };
      const errResult = {
        isError: true,
        details: {
          status: 'failure',
          error: { code: 'audio_generation_error', message: 'piper process exited with code 1' },
        },
      };

      const lines = renderMarkdownToAudioResult(errResult, { expanded: false }, mockTheme, context).render(80);
      expect(context.state.borderColor).toBe(RED);
      expect(lines.join('\n')).toContain('Error: piper process exited with code 1');
    });
  });

  it('safeguards against narrow widths (< 24) without crashing', () => {
    const callLines = renderScreenshotCall({ target: 'screen' }, mockTheme).render(18);
    expect(callLines).toHaveLength(1);
    expect(callLines[0]).not.toContain('╭');

    const resultLines = renderScreenshotResult(
      { details: { status: 'success', data: { action: 'capture', target: 'screen' } } },
      { expanded: false },
      mockTheme,
    ).render(18);
    expect(resultLines.length).toBeGreaterThan(0);
    expect(resultLines[resultLines.length - 1]).not.toContain('╰');
  });
});
