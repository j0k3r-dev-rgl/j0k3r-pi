import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { extractPdf, sha256Hex, type PdfOcrRunner, type PdfParser } from '../src/pdf.js';
import pdfReviewExtension from '../index.js';

type Tool = {
  name: string;
  description: string;
  parameters: { type: string; [key: string]: unknown };
  execute: (...args: unknown[]) => Promise<unknown> | unknown;
};

function createMockPi() {
  const tools: Tool[] = [];
  return {
    tools,
    registerTool(tool: Tool) {
      tools.push(tool);
    },
  };
}

async function tempPdf(name = 'sample.pdf', content = 'fake pdf bytes') {
  const dir = join(tmpdir(), `pi-pdf-review-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(dir, { recursive: true });
  const path = join(dir, name);
  await writeFile(path, content);
  return { dir, path, bytes: Buffer.from(content) };
}

describe('pdf extraction', () => {
  it('extracts text, computes sha256, truncates text, and reports metadata', async () => {
    const file = await tempPdf();
    const parser: PdfParser = {
      getText: vi.fn(async () => ({ text: 'Hello PDF world. This text is long enough to truncate.', total: 3 })),
      destroy: vi.fn(async () => undefined),
    };

    const result = await extractPdf({
      path: file.path,
      cwd: file.dir,
      textCharsLimit: 18,
      createParser: async () => parser,
    });

    expect(result.file.path).toBe(file.path);
    expect(result.file.sha256).toBe(sha256Hex(file.bytes));
    expect(result.file.sizeBytes).toBe(file.bytes.length);
    expect(result.pageCount).toBe(3);
    expect(result.text).toBe('Hello PDF world. T');
    expect(result.textCharCount).toBe('Hello PDF world. This text is long enough to truncate.'.length);
    expect(result.truncated.text).toBe(true);
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'TEXT_TRUNCATED' }),
    ]));
    expect(parser.destroy).toHaveBeenCalledOnce();
  });

  it('can render bounded page screenshots as metadata without returning base64 payloads', async () => {
    const file = await tempPdf();
    const parser: PdfParser = {
      getText: vi.fn(async () => ({ text: 'scanned-ish pdf', total: 5 })),
      getScreenshot: vi.fn(async () => ({
        total: 5,
        pages: [
          { pageNumber: 1, dataUrl: `data:image/png;base64,${Buffer.from('page-one').toString('base64')}`, width: 800, height: 1000 },
          { pageNumber: 2, dataUrl: `data:image/png;base64,${Buffer.from('page-two').toString('base64')}`, width: 800, height: 1000 },
        ],
      })),
      destroy: vi.fn(async () => undefined),
    };

    const result = await extractPdf({
      path: file.path,
      cwd: file.dir,
      renderPages: true,
      pagesLimit: 2,
      createParser: async () => parser,
    });

    expect(parser.getScreenshot).toHaveBeenCalledWith({
      first: 2,
      desiredWidth: 1280,
      imageDataUrl: true,
      imageBuffer: false,
    });
    expect(result.pageCount).toBe(5);
    expect(result.renderedPages).toEqual([
      { page: 1, mimeType: 'image/png', byteLength: 8, width: 800, height: 1000, source: 'pdf-render' },
      { page: 2, mimeType: 'image/png', byteLength: 8, width: 800, height: 1000, source: 'pdf-render' },
    ]);
    expect(JSON.stringify(result.renderedPages)).not.toContain('page-one');
    expect(result.truncated.pages).toBe(true);
  });

  it('runs OCRmyPDF fallback when text extraction is empty and OCR auto mode is enabled', async () => {
    const file = await tempPdf();
    const parser: PdfParser = {
      getText: vi.fn(async () => ({ text: '', total: 2 })),
      destroy: vi.fn(async () => undefined),
    };
    const runOcr: PdfOcrRunner = vi.fn(async () => ({ text: 'OCR text from scanned document.' }));

    const result = await extractPdf({
      path: file.path,
      cwd: file.dir,
      ocrMode: 'auto',
      ocrProvider: 'ocrmypdf',
      ocrLanguage: 'spa+eng',
      createParser: async () => parser,
      runOcr,
    });

    expect(runOcr).toHaveBeenCalledWith(expect.objectContaining({
      filePath: file.path,
      provider: 'ocrmypdf',
      language: 'spa+eng',
    }));
    expect(result.text).toBe('OCR text from scanned document.');
    expect(result.textSource).toBe('ocr');
    expect(result.ocr).toMatchObject({ provider: 'ocrmypdf', language: 'spa+eng', charCount: 31 });
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'TEXT_EXTRACTION_EMPTY' }),
      expect.objectContaining({ code: 'OCR_USED' }),
    ]));
  });

  it('does not run OCR fallback when the PDF text layer has content', async () => {
    const file = await tempPdf();
    const parser: PdfParser = {
      getText: vi.fn(async () => ({ text: 'Native text layer.', total: 1 })),
      destroy: vi.fn(async () => undefined),
    };
    const runOcr: PdfOcrRunner = vi.fn(async () => ({ text: 'should not run' }));

    const result = await extractPdf({
      path: file.path,
      cwd: file.dir,
      ocrMode: 'auto',
      createParser: async () => parser,
      runOcr,
    });

    expect(runOcr).not.toHaveBeenCalled();
    expect(result.text).toBe('Native text layer.');
    expect(result.textSource).toBe('pdf-text-layer');
    expect(result.ocr).toBeUndefined();
  });

  it('returns empty text with an OCR warning when OCR fallback fails', async () => {
    const file = await tempPdf();
    const parser: PdfParser = {
      getText: vi.fn(async () => ({ text: '', total: 1 })),
      destroy: vi.fn(async () => undefined),
    };
    const runOcr: PdfOcrRunner = vi.fn(async () => { throw new Error('ocrmypdf not found'); });

    const result = await extractPdf({
      path: file.path,
      cwd: file.dir,
      ocrMode: 'auto',
      createParser: async () => parser,
      runOcr,
    });

    expect(result.text).toBe('');
    expect(result.textSource).toBe('empty');
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'OCR_UNAVAILABLE', message: expect.stringContaining('ocrmypdf not found') }),
    ]));
  });

  it('rejects non-pdf paths before parsing', async () => {
    const file = await tempPdf('note.txt');
    await expect(extractPdf({ path: file.path, cwd: file.dir })).rejects.toThrow(/expected a pdf/i);
  });
});

describe('pdf-review extension tool', () => {
  it('registers pdf_extract and returns structured success details', async () => {
    const pi = createMockPi();
    pdfReviewExtension(pi as any);

    const tool = pi.tools.find((entry) => entry.name === 'pdf_extract');
    expect(tool?.description).toMatch(/extract text/i);
    expect(tool?.parameters.type).toBe('object');
  });
});
