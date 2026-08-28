import { Type } from 'typebox';
import { extractPdf, type PdfExtractInput, type PdfExtractResult } from './pdf.js';

type ToolResponse<T> =
  | { status: 'success'; data: T; warnings?: unknown[] }
  | { status: 'failure'; error: { code: string; message: string; recoverable: boolean }; warnings?: unknown[] };

export interface PiToolResult<T = unknown> {
  content: Array<{ type: 'text'; text: string }>;
  details?: ToolResponse<T>;
  isError?: boolean;
}

export interface PdfExtractParams {
  path: string;
  pagesLimit?: number;
  textCharsLimit?: number;
  renderPages?: boolean;
  renderWidth?: number;
  ocrMode?: 'none' | 'auto';
  ocrProvider?: 'ocrmypdf';
  ocrLanguage?: string;
}

const pdfExtractParameters = Type.Object({
  path: Type.String({ description: 'Path to a local PDF file, relative to the current workspace or absolute.' }),
  pagesLimit: Type.Optional(Type.Number({ minimum: 1, maximum: 50, description: 'Maximum rendered pages when renderPages is true. Defaults to 5.' })),
  textCharsLimit: Type.Optional(Type.Number({ minimum: 1, maximum: 200000, description: 'Maximum extracted text characters returned. Defaults to 50000.' })),
  renderPages: Type.Optional(Type.Boolean({ description: 'Render bounded pages as image metadata for scanned PDF detection. Base64 image payloads are not returned.' })),
  renderWidth: Type.Optional(Type.Number({ minimum: 320, maximum: 3000, description: 'Rendered page width when renderPages is true. Defaults to 1280.' })),
  ocrMode: Type.Optional(Type.Union([Type.Literal('none'), Type.Literal('auto')], { description: 'OCR behavior. auto runs OCR only when the PDF text layer is empty.' })),
  ocrProvider: Type.Optional(Type.Literal('ocrmypdf', { description: 'OCR provider. Currently supports ocrmypdf.' })),
  ocrLanguage: Type.Optional(Type.String({ description: 'OCR language for OCRmyPDF/Tesseract, e.g. eng, spa, or spa+eng. Defaults to eng.' })),
});

export function registerPdfReviewTools(pi: any): void {
  pi.registerTool({
    name: 'pdf_extract',
    label: 'PDF Extract',
    description: 'Extract text, metadata, sha256 hash, warnings, and optional rendered page metadata from a local PDF file.',
    promptSnippet: 'Extract text, metadata, hashes, warnings, and optional page render metadata from a local PDF.',
    promptGuidelines: [
      'Use pdf_extract when the user asks to inspect, summarize, verify, or extract content from a local PDF file.',
      'Use pdf_extract renderPages or OCR options only when the user needs page-render metadata or the PDF text layer may be empty.',
    ],
    parameters: pdfExtractParameters,
    async execute(_id: string, params: PdfExtractParams, _signal?: AbortSignal, _onUpdate?: unknown, ctx?: { cwd?: string }) {
      try {
        const data = await extractPdf({
          ...(params as PdfExtractInput),
          cwd: ctx?.cwd ?? process.cwd(),
        });
        return buildSuccess(summarizePdfExtract(data), data);
      } catch (error) {
        return buildFailure(classifyError(error), error instanceof Error ? error.message : 'pdf extraction failed');
      }
    },
  });
}

function buildSuccess<T>(text: string, data: T): PiToolResult<T> {
  return {
    content: [{ type: 'text', text }],
    details: { status: 'success', data, warnings: Array.isArray((data as { warnings?: unknown[] }).warnings) ? (data as { warnings: unknown[] }).warnings : undefined },
  };
}

function buildFailure(code: string, message: string): PiToolResult<never> {
  return {
    content: [{ type: 'text', text: `pdf_extract failed: ${message}` }],
    details: { status: 'failure', error: { code, message, recoverable: code !== 'validation_error' } },
    isError: true,
  };
}

function classifyError(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (/path is required|expected a pdf|must be|too large/.test(message)) return 'validation_error';
  if (/enoent|eacces|eperm|not a file/.test(message)) return 'read_error';
  return 'parse_error';
}

function summarizePdfExtract(result: PdfExtractResult): string {
  const lines = [
    `pdf_extract: ${result.file.path}`,
    `sha256: ${result.file.sha256}`,
    `size: ${result.file.sizeBytes.toLocaleString('en-US')} bytes${result.pageCount === null ? '' : ` | pages: ${result.pageCount.toLocaleString('en-US')}`}`,
    `text: ${result.textCharCount.toLocaleString('en-US')} chars from ${result.textSource}${result.truncated.text ? ` (truncated to ${result.text.length.toLocaleString('en-US')})` : ''}`,
    result.ocr ? `ocr: ${result.ocr.provider} [language=${result.ocr.language}]` : undefined,
    result.renderedPages.length ? `rendered pages: ${result.renderedPages.length}${result.truncated.pages ? ' (truncated)' : ''}` : undefined,
    result.warnings.length ? `warnings: ${result.warnings.map((warning) => warning.code).join(', ')}` : undefined,
    result.text ? ['extracted text:', result.text].join('\n') : 'extracted text: [empty]',
  ].filter(Boolean);
  return lines.join('\n');
}
