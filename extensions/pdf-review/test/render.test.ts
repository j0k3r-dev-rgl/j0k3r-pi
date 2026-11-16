import { describe, expect, it } from 'vitest';
import {
  COMPACT_TOOL_RENDERING,
  RED,
  extractPdfBadge,
  renderPdfExtractCall,
  renderPdfExtractResult,
  visibleWidth,
} from '../src/render.js';
import { registerPdfReviewTools } from '../src/tools.js';

const FRAME = /[╭╮╰╯│]/;

const mockTheme = {
  fg: (_token: string, text: string) => text,
  bold: (text: string) => text,
  keybinding: (action: string) => (action === 'app.tools.expand' ? 'ctrl+o' : undefined),
};

describe('pdf-review renderers', () => {
  it('registers pdf_extract with the compact marker, self shell, and both safe slots', () => {
    expect(COMPACT_TOOL_RENDERING.compactToolRenderingVersion).toBe(1);
    const tools: any[] = [];
    registerPdfReviewTools({ registerTool: (tool: any) => tools.push(tool) });

    const tool = tools.find((entry) => entry.name === 'pdf_extract');
    expect(tool).toBeDefined();
    expect(tool.renderShell).toBe('self');
    expect(tool.compactToolRenderingVersion).toBe(1);
    expect(typeof tool.renderCall).toBe('function');
    expect(typeof tool.renderResult).toBe('function');
  });

  it('extracts correct badge for pdf_extract', () => {
    expect(extractPdfBadge({})).toBe('pdf_extract');
    expect(extractPdfBadge({ path: 'docs/spec.pdf' })).toBe('pdf_extract [spec.pdf]');
  });

  it('renders the pending call as one compact inline row', () => {
    const context = { state: {} };
    const lines = renderPdfExtractCall({ path: 'paper.pdf' }, mockTheme, context).render(80);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('pdf_extract');
    expect(lines[0]).toContain('paper.pdf');
    expect(lines[0]).toContain('running');
    expect(lines[0]).toContain('─');
    expect(lines[0]).not.toMatch(FRAME);
    expect(lines[0]).not.toMatch(/ctrl\+o|to expand/i);
    expect(visibleWidth(lines[0])).toBeLessThanOrEqual(80);
  });

  it('coordinates two-phase slot assembly via context.state without borders', () => {
    const context: any = { state: {} };

    const pendingLines = renderPdfExtractCall({ path: 'paper.pdf' }, mockTheme, context).render(80);
    expect(pendingLines).toHaveLength(1);

    const resultComp = renderPdfExtractResult(
      {
        details: {
          status: 'success',
          data: {
            file: { path: 'paper.pdf', sha256: 'abc123456789', sizeBytes: 10240, mimeType: 'application/pdf' },
            pageCount: 3,
            text: 'Extracted text content',
            textCharCount: 22,
            textSource: 'pdf-text-layer',
            renderedPages: [],
            warnings: [],
            limits: {},
            truncated: { text: false, pages: false, images: false },
          },
        },
      },
      { expanded: false },
      mockTheme,
      context,
    );

    expect(context.state.hasResult).toBe(true);

    const resolvedCall = renderPdfExtractCall({ path: 'paper.pdf' }, mockTheme, context).render(80);
    expect(resolvedCall).toEqual([]);

    const resultLines = resultComp.render(80);
    expect(resultLines).toHaveLength(1);
    expect(resultLines[0]).toContain('pdf_extract');
    expect(resultLines[0]).toContain('3 pages');
    expect(resultLines[0]).not.toMatch(FRAME);
  });

  it('renders compact identity and keeps full metadata, page ranges and every text block on expansion', () => {
    const result = {
      details: {
        status: 'success',
        data: {
          file: {
            path: '/tmp/report.pdf',
            sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
            sizeBytes: 204800,
            mimeType: 'application/pdf',
          },
          pageCount: 12,
          text: 'Annual summary report 2026...\nDetailed financials follow.',
          textCharCount: 5400,
          textSource: 'ocr',
          ocr: { provider: 'ocrmypdf', language: 'eng', charCount: 5400 },
          renderedPages: [{ page: 1, mimeType: 'image/png', byteLength: 50000, source: 'pdf-render' }],
          warnings: [{ code: 'TEXT_EXTRACTION_EMPTY', message: 'No text layer found' }],
          truncated: { text: true, pages: false, images: false },
        },
      },
      content: [{ type: 'text', text: 'pdf_extract: /tmp/report.pdf\nAnnual summary report 2026...\nDetailed financials follow.' }],
    };

    const collapsedLines = renderPdfExtractResult(result, { expanded: false }, mockTheme, { state: {} }).render(120);
    expect(collapsedLines).toHaveLength(1);
    expect(collapsedLines[0]).toContain('report.pdf');
    expect(collapsedLines[0]).toContain('12 pages');
    expect(collapsedLines[0]).toContain('5400 chars');
    expect(collapsedLines[0]).toContain('[ocr]');
    expect(collapsedLines[0]).not.toMatch(/ctrl\+o|to expand/i);

    const expanded = renderPdfExtractResult(result, { expanded: true }, mockTheme, { state: {} }).render(120).join('\n');
    expect(expanded).toContain('file: /tmp/report.pdf');
    expect(expanded).toContain('sha256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(expanded).toContain('file size: 200.0 KiB');
    expect(expanded).toContain('page count: 12');
    expect(expanded).toContain('text source: ocr');
    expect(expanded).toContain('extracted chars: 5400 (truncated)');
    expect(expanded).toContain('ocr: provider=ocrmypdf language=eng (5400 chars)');
    expect(expanded).toContain('rendered pages: 1');
    expect(expanded).toContain('TEXT_EXTRACTION_EMPTY: No text layer found');
    // The returned text block is reachable in full, without a renderer-level preview slice.
    expect(expanded).toContain('Annual summary report 2026...');
    expect(expanded).toContain('Detailed financials follow.');
    expect(expanded).not.toMatch(/ctrl\+o|to collapse/i);
  });

  it('keeps long extracted text reachable beyond the old 500-character preview', () => {
    const longText = `${'X'.repeat(900)}TAIL_MARKER`;
    const result = {
      details: { status: 'success', data: { file: { path: 'big.pdf' }, pageCount: 1, textCharCount: longText.length, textSource: 'pdf-text-layer' } },
      content: [{ type: 'text', text: longText }],
    };
    const expanded = renderPdfExtractResult(result, { expanded: true }, mockTheme, { state: {} }).render(120).join('\n');
    expect(expanded).toContain('TAIL_MARKER');
  });

  it('marks failures in one red inline row and keeps returned text on expansion', () => {
    const context: any = { state: {} };
    const errResult = {
      isError: true,
      details: {
        status: 'failure',
        error: { code: 'validation_error', message: 'File is not a valid PDF' },
      },
      content: [{ type: 'text', text: 'pdf_extract failed: File is not a valid PDF' }],
    };

    const lines = renderPdfExtractResult(errResult, { expanded: false }, mockTheme, context).render(80);
    expect(context.state.isError).toBe(true);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('error');
    expect(lines[0]).toContain('File is not a valid PDF');
    expect(lines[0]).not.toMatch(FRAME);

    const redTheme = { ...mockTheme, fg: (name: string, text: string) => (name === 'error' ? `${RED}${text}\x1b[0m` : text) };
    expect(renderPdfExtractResult(errResult, { expanded: false }, redTheme, { state: {} }).render(80)[0]).toContain(RED);

    const expanded = renderPdfExtractResult(errResult, { expanded: true }, mockTheme, { state: {} }).render(80);
    expect(expanded.every((l) => l.startsWith(' '))).toBe(true);
    expect(expanded.slice(1)).toContain(' pdf_extract failed: File is not a valid PDF');
  });

  it('stays width-safe at narrow widths and emits no cells at zero width', () => {
    const callLines = renderPdfExtractCall({ path: 'doc.pdf' }, mockTheme).render(16);
    expect(callLines).toHaveLength(1);
    expect(visibleWidth(callLines[0])).toBeLessThanOrEqual(16);
    expect(callLines[0]).not.toMatch(FRAME);

    for (const width of [1, 2, 10, 23]) {
      const resultLines = renderPdfExtractResult(
        {
          details: {
            status: 'success',
            data: { file: { path: 'doc.pdf' }, pageCount: 1, textCharCount: 10, textSource: 'pdf-text-layer' },
          },
          content: [{ type: 'text', text: 'extracted body line\nsecond line' }],
        },
        { expanded: true },
        mockTheme,
        { state: {} },
      ).render(width);
      expect(resultLines.length).toBeGreaterThan(0);
      for (const line of resultLines) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    }

    expect(renderPdfExtractResult({ details: { status: 'success', data: {} } }, { expanded: false }, mockTheme, { state: {} }).render(0)).toEqual([]);
  });
});
