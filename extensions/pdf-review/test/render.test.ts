import { describe, expect, it, vi } from 'vitest';
import pdfReviewExtension from '../index.js';
import {
  CYAN,
  DIM,
  LIME,
  RED,
  RESET,
  extractPdfBadge,
  renderPdfExtractCall,
  renderPdfExtractResult,
  visibleWidth,
} from '../src/render.js';

const mockTheme = {
  fg: (_token: string, text: string) => text,
  bold: (text: string) => text,
  keybinding: (action: string) => (action === 'app.tools.expand' ? 'ctrl+o' : undefined),
};

describe('pdf-review renderers', () => {
  it('registers pdf_extract with renderShell: "self", renderCall, and renderResult', () => {
    const tools: any[] = [];
    const pi = {
      registerTool: vi.fn((tool: any) => tools.push(tool)),
    };

    pdfReviewExtension(pi);

    const tool = tools.find((t) => t.name === 'pdf_extract');
    expect(tool).toBeDefined();
    expect(tool.renderShell).toBe('self');
    expect(typeof tool.renderCall).toBe('function');
    expect(typeof tool.renderResult).toBe('function');
  });

  it('extracts correct badge for pdf_extract', () => {
    expect(extractPdfBadge({})).toBe('pdf_extract');
    expect(extractPdfBadge({ path: 'docs/spec.pdf' })).toBe('pdf_extract [spec.pdf]');
  });

  it('renders pending call card with rounded corners and consistent line widths', () => {
    const context = { state: {} };
    const call = renderPdfExtractCall({ path: 'paper.pdf' }, mockTheme, context);
    const lines = call.render(80);

    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('╭');
    expect(lines[0]).toContain('╮');
    expect(lines[0]).toContain('pdf_extract [paper.pdf]');
    expect(lines[1]).toContain('│');
    expect(lines[1]).toContain('Pending: Extracting PDF...');
    expect(lines[2]).toContain('╰');
    expect(lines[2]).toContain('╯');

    for (const line of lines) {
      expect(visibleWidth(line)).toBe(80);
      expect(line).not.toMatch(/\x1b\[4[0-7]m/);
    }
  });

  it('coordinates two-phase slot assembly via context.state', () => {
    const context: any = { state: {} };

    // Phase 1: Pending call
    const pendingLines = renderPdfExtractCall({ path: 'paper.pdf' }, mockTheme, context).render(80);
    expect(pendingLines).toHaveLength(3);
    expect(pendingLines[0]).toContain('╭');
    expect(pendingLines[2]).toContain('╰');

    // Result arrives
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
    expect(context.state.borderColor).toBe(LIME);

    // Phase 2: Call re-renders as top border only
    const resolvedCall = renderPdfExtractCall({ path: 'paper.pdf' }, mockTheme, context).render(80);
    expect(resolvedCall).toHaveLength(1);
    expect(resolvedCall[0]).toContain('╭');
    expect(resolvedCall[0]).toContain(LIME);

    // Result renders framed lines + bottom border
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

  it('renders collapsed and expanded views with full metadata and OCR status', () => {
    const result = {
      details: {
        status: 'success',
        data: {
          file: { path: '/tmp/report.pdf', sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', sizeBytes: 204800, mimeType: 'application/pdf' },
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
    };

    const collapsed = renderPdfExtractResult(result, { expanded: false }, mockTheme).render(80).join('\n');
    expect(collapsed).toContain('✓ report.pdf · 12 pages · 5400 chars [ocr]');
    expect(collapsed).toContain('ctrl+o expand');

    const expanded = renderPdfExtractResult(result, { expanded: true }, mockTheme).render(80).join('\n');
    expect(expanded).toContain('file: /tmp/report.pdf');
    expect(expanded).toContain('sha256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(expanded).toContain('file size: 200.0 KiB');
    expect(expanded).toContain('page count: 12');
    expect(expanded).toContain('text source: ocr');
    expect(expanded).toContain('extracted chars: 5400 (truncated)');
    expect(expanded).toContain('ocr: provider=ocrmypdf language=eng (5400 chars)');
    expect(expanded).toContain('rendered pages: 1');
    expect(expanded).toContain('TEXT_EXTRACTION_EMPTY: No text layer found');
    expect(expanded).toContain('text preview:');
    expect(expanded).toContain('Annual summary report 2026...');
    expect(expanded).toContain('ctrl+o collapse');
  });

  it('renders electric red border and error message on failure', () => {
    const context: any = { state: {} };
    const errResult = {
      isError: true,
      details: {
        status: 'failure',
        error: { code: 'validation_error', message: 'File is not a valid PDF' },
      },
    };

    const lines = renderPdfExtractResult(errResult, { expanded: false }, mockTheme, context).render(80);
    expect(context.state.borderColor).toBe(RED);
    expect(lines[lines.length - 1]).toContain(RED);
    expect(lines.join('\n')).toContain('Error: File is not a valid PDF');
  });

  it('safeguards against narrow width (< 24 columns)', () => {
    const callLines = renderPdfExtractCall({ path: 'doc.pdf' }, mockTheme).render(16);
    expect(callLines).toHaveLength(1);
    expect(callLines[0]).not.toContain('╭');

    const resultLines = renderPdfExtractResult(
      {
        details: {
          status: 'success',
          data: {
            file: { path: 'doc.pdf' },
            pageCount: 1,
            textCharCount: 10,
            textSource: 'pdf-text-layer',
          },
        },
      },
      { expanded: false },
      mockTheme,
    ).render(16);
    expect(resultLines.length).toBeGreaterThan(0);
    expect(resultLines[resultLines.length - 1]).not.toContain('╰');
  });
});
