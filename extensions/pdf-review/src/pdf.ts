import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type PdfWarningCode =
  | 'TEXT_EXTRACTION_EMPTY'
  | 'TEXT_TRUNCATED'
  | 'PAGES_TRUNCATED'
  | 'PAGE_RENDER_SKIPPED'
  | 'IMAGE_BYTES_TRUNCATED'
  | 'OCR_USED'
  | 'OCR_EMPTY'
  | 'OCR_UNAVAILABLE';

export interface PdfWarning {
  code: PdfWarningCode;
  message: string;
  page?: number;
}

export interface RenderedPageInfo {
  page: number;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  byteLength: number;
  width?: number;
  height?: number;
  source: 'pdf-render';
}

export interface PdfExtractResult {
  file: {
    path: string;
    sha256: string;
    sizeBytes: number;
    mimeType: 'application/pdf';
  };
  pageCount: number | null;
  text: string;
  textCharCount: number;
  textSource: 'pdf-text-layer' | 'ocr' | 'empty';
  ocr?: {
    provider: PdfOcrProvider;
    language: string;
    charCount: number;
  };
  renderedPages: RenderedPageInfo[];
  warnings: PdfWarning[];
  limits: Required<PdfExtractLimits>;
  truncated: {
    text: boolean;
    pages: boolean;
    images: boolean;
  };
}

export interface PdfTextResult {
  text?: string;
  total?: number;
  numpages?: number;
  nPages?: number;
  pages?: unknown[];
}

export interface PdfParser {
  getText(): Promise<PdfTextResult>;
  getScreenshot?(input: {
    first: number;
    desiredWidth: number;
    imageDataUrl: boolean;
    imageBuffer: boolean;
  }): Promise<{
    total?: number;
    pages: Array<{
      pageNumber: number;
      dataUrl?: string;
      width?: number;
      height?: number;
    }>;
  }>;
  destroy(): Promise<void>;
}

export type PdfParserFactory = (bytes: Uint8Array) => PdfParser | Promise<PdfParser>;

export type PdfOcrMode = 'none' | 'auto';
export type PdfOcrProvider = 'ocrmypdf';

export interface PdfOcrRequest {
  filePath: string;
  provider: PdfOcrProvider;
  language: string;
  timeoutMs: number;
}

export interface PdfOcrResult {
  text: string;
}

export type PdfOcrRunner = (input: PdfOcrRequest) => Promise<PdfOcrResult>;

export interface PdfExtractLimits {
  maxPdfSizeBytes?: number;
  textCharsLimit?: number;
  pagesLimit?: number;
  renderWidth?: number;
  maxImageBytesPerPage?: number;
  maxTotalImageBytes?: number;
  textTimeoutMs?: number;
  renderTimeoutMs?: number;
  ocrTimeoutMs?: number;
}

export interface PdfExtractInput extends PdfExtractLimits {
  path: string;
  cwd: string;
  renderPages?: boolean;
  ocrMode?: PdfOcrMode;
  ocrProvider?: PdfOcrProvider;
  ocrLanguage?: string;
  createParser?: PdfParserFactory;
  runOcr?: PdfOcrRunner;
}

const DEFAULT_LIMITS: Required<PdfExtractLimits> = {
  maxPdfSizeBytes: 25 * 1024 * 1024,
  textCharsLimit: 50_000,
  pagesLimit: 5,
  renderWidth: 1280,
  maxImageBytesPerPage: 4 * 1024 * 1024,
  maxTotalImageBytes: 12 * 1024 * 1024,
  textTimeoutMs: 20_000,
  renderTimeoutMs: 30_000,
  ocrTimeoutMs: 120_000,
};

export function sha256Hex(bytes: Uint8Array | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function extractPdf(input: PdfExtractInput): Promise<PdfExtractResult> {
  const limits = normalizeLimits(input);
  const filePath = resolveInputPath(input.cwd, input.path);
  if (extname(filePath).toLowerCase() !== '.pdf') {
    throw new Error('expected a PDF file path');
  }

  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) {
    throw new Error('expected a PDF file');
  }
  if (fileStat.size > limits.maxPdfSizeBytes) {
    throw new Error(`PDF is too large: ${fileStat.size} bytes exceeds ${limits.maxPdfSizeBytes}`);
  }

  const bytes = await readFile(filePath);
  const parser = await (input.createParser ?? createPdfParseParser)(new Uint8Array(bytes));
  const warnings: PdfWarning[] = [];

  try {
    const parsedText = await withTimeout(parser.getText(), limits.textTimeoutMs, 'PDF text extraction timed out');
    const rawText = String(parsedText.text ?? '').trim();
    if (!rawText) {
      warnings.push({ code: 'TEXT_EXTRACTION_EMPTY', message: 'PDF text extraction returned no text; the file may be scanned or image-only.' });
    }

    const ocrProvider = input.ocrProvider ?? 'ocrmypdf';
    const ocrLanguage = input.ocrLanguage ?? 'eng';
    let effectiveText = rawText;
    let textSource: PdfExtractResult['textSource'] = rawText ? 'pdf-text-layer' : 'empty';
    let ocr: PdfExtractResult['ocr'];

    if (!rawText && input.ocrMode === 'auto') {
      try {
        const ocrResult = await (input.runOcr ?? runOcrMyPdf)({
          filePath,
          provider: ocrProvider,
          language: ocrLanguage,
          timeoutMs: limits.ocrTimeoutMs,
        });
        effectiveText = String(ocrResult.text ?? '').trim();
        if (effectiveText) {
          textSource = 'ocr';
          ocr = { provider: ocrProvider, language: ocrLanguage, charCount: effectiveText.length };
          warnings.push({ code: 'OCR_USED', message: `OCR fallback used via ${ocrProvider}.` });
        } else {
          warnings.push({ code: 'OCR_EMPTY', message: `OCR fallback via ${ocrProvider} returned no text.` });
        }
      } catch (error) {
        warnings.push({ code: 'OCR_UNAVAILABLE', message: `OCR fallback via ${ocrProvider} failed: ${error instanceof Error ? error.message : 'unknown error'}` });
      }
    }

    const text = effectiveText.length > limits.textCharsLimit ? effectiveText.slice(0, limits.textCharsLimit) : effectiveText;
    const textTruncated = effectiveText.length > limits.textCharsLimit;
    if (textTruncated) {
      warnings.push({ code: 'TEXT_TRUNCATED', message: `PDF text truncated to ${limits.textCharsLimit} characters.` });
    }

    let pageCount = inferPageCount(parsedText);
    let renderedPages: RenderedPageInfo[] = [];

    if (input.renderPages) {
      if (!parser.getScreenshot) {
        warnings.push({ code: 'PAGE_RENDER_SKIPPED', message: 'PDF renderer does not support screenshots.' });
      } else {
        const screenshots = await withTimeout(parser.getScreenshot({
          first: limits.pagesLimit,
          desiredWidth: limits.renderWidth,
          imageDataUrl: true,
          imageBuffer: false,
        }), limits.renderTimeoutMs, 'PDF page rendering timed out');
        pageCount = Math.max(pageCount ?? 0, screenshots.total ?? screenshots.pages.length) || pageCount;
        renderedPages = buildRenderedPageInfo(screenshots.pages, limits, warnings);
      }
    }

    const pagesTruncated = pageCount !== null && pageCount > limits.pagesLimit;
    if (pagesTruncated && input.renderPages) {
      warnings.push({ code: 'PAGES_TRUNCATED', message: `Only ${limits.pagesLimit} rendered page(s) returned from ${pageCount}.` });
    }

    return {
      file: {
        path: filePath,
        sha256: sha256Hex(bytes),
        sizeBytes: fileStat.size,
        mimeType: 'application/pdf',
      },
      pageCount,
      text,
      textCharCount: effectiveText.length,
      textSource,
      ocr,
      renderedPages,
      warnings,
      limits,
      truncated: {
        text: textTruncated,
        pages: pagesTruncated && Boolean(input.renderPages),
        images: warnings.some((warning) => warning.code === 'IMAGE_BYTES_TRUNCATED'),
      },
    };
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

function normalizeLimits(input: PdfExtractInput): Required<PdfExtractLimits> {
  return {
    maxPdfSizeBytes: input.maxPdfSizeBytes ?? DEFAULT_LIMITS.maxPdfSizeBytes,
    textCharsLimit: clampInteger(input.textCharsLimit, 'textCharsLimit', 1, 200_000, DEFAULT_LIMITS.textCharsLimit),
    pagesLimit: clampInteger(input.pagesLimit, 'pagesLimit', 1, 50, DEFAULT_LIMITS.pagesLimit),
    renderWidth: clampInteger(input.renderWidth, 'renderWidth', 320, 3000, DEFAULT_LIMITS.renderWidth),
    maxImageBytesPerPage: input.maxImageBytesPerPage ?? DEFAULT_LIMITS.maxImageBytesPerPage,
    maxTotalImageBytes: input.maxTotalImageBytes ?? DEFAULT_LIMITS.maxTotalImageBytes,
    textTimeoutMs: input.textTimeoutMs ?? DEFAULT_LIMITS.textTimeoutMs,
    renderTimeoutMs: input.renderTimeoutMs ?? DEFAULT_LIMITS.renderTimeoutMs,
    ocrTimeoutMs: input.ocrTimeoutMs ?? DEFAULT_LIMITS.ocrTimeoutMs,
  };
}

function clampInteger(value: number | undefined, key: string, min: number, max: number, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value)) throw new Error(`${key} must be an integer`);
  if (value < min || value > max) throw new Error(`${key} must be between ${min} and ${max}`);
  return value;
}

function resolveInputPath(cwd: string, pathname: string): string {
  const trimmed = pathname.trim();
  if (!trimmed) throw new Error('path is required');
  return isAbsolute(trimmed) ? resolve(trimmed) : resolve(cwd, trimmed);
}

function inferPageCount(parsed: PdfTextResult): number | null {
  for (const candidate of [parsed.total, parsed.numpages, parsed.nPages]) {
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0) return candidate;
  }
  return Array.isArray(parsed.pages) ? parsed.pages.length : null;
}

function buildRenderedPageInfo(
  pages: Array<{ pageNumber: number; dataUrl?: string; width?: number; height?: number }>,
  limits: Required<PdfExtractLimits>,
  warnings: PdfWarning[],
): RenderedPageInfo[] {
  let totalBytes = 0;
  const result: RenderedPageInfo[] = [];
  for (const page of pages) {
    if (!page.dataUrl) continue;
    const parsed = parseImageDataUrl(page.dataUrl);
    if (!parsed) continue;
    const byteLength = Buffer.byteLength(parsed.data, 'base64');
    if (byteLength > limits.maxImageBytesPerPage || totalBytes + byteLength > limits.maxTotalImageBytes) {
      warnings.push({ code: 'IMAGE_BYTES_TRUNCATED', message: `Rendered page ${page.pageNumber} omitted by image byte limits.`, page: page.pageNumber });
      continue;
    }
    totalBytes += byteLength;
    result.push({
      page: page.pageNumber,
      mimeType: parsed.mimeType,
      byteLength,
      width: page.width,
      height: page.height,
      source: 'pdf-render',
    });
  }
  return result;
}

function parseImageDataUrl(dataUrl: string): { mimeType: RenderedPageInfo['mimeType']; data: string } | null {
  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,(.*)$/);
  if (!match) return null;
  return { mimeType: match[1] as RenderedPageInfo['mimeType'], data: match[2] };
}

async function createPdfParseParser(bytes: Uint8Array): Promise<PdfParser> {
  const { PDFParse } = await import('pdf-parse');
  return new PDFParse({ data: bytes }) as PdfParser;
}

async function runOcrMyPdf(input: PdfOcrRequest): Promise<PdfOcrResult> {
  if (input.provider !== 'ocrmypdf') {
    throw new Error(`unsupported OCR provider: ${input.provider}`);
  }

  const workdir = await mkdtemp(join(tmpdir(), 'pi-pdf-ocr-'));
  const sidecarPath = join(workdir, 'ocr.txt');
  const outputPath = join(workdir, 'ocr.pdf');
  try {
    await execFileAsync('ocrmypdf', [
      '--quiet',
      '--skip-text',
      '--rotate-pages',
      '--deskew',
      '-l',
      input.language,
      '--sidecar',
      sidecarPath,
      input.filePath,
      outputPath,
    ], {
      encoding: 'utf8',
      timeout: input.timeoutMs,
      maxBuffer: 20 * 1024 * 1024,
    });
    const text = await readFile(sidecarPath, 'utf8');
    return { text };
  } finally {
    await rm(workdir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}
