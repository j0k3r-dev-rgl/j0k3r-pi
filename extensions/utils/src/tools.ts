import { readFile } from 'node:fs/promises';
import { Type } from 'typebox';
import { convertMarkdownToAudio, type MarkdownToAudioEngine, type MarkdownToAudioProgressEvent, type MarkdownToAudioResult, type MarkdownToAudioVoiceQuality } from './markdown-to-audio.js';
import { captureScreenshot, ScreenshotError, summarizeScreenshotResult, type OsReleaseReader, type ScreenshotCommandFinder, type ScreenshotCommandRunner, type ScreenshotResult } from './screenshot.js';

type ToolContent = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };

type ToolResponse<T> =
  | { status: 'success'; data: T; warnings?: string[] }
  | { status: 'failure'; error: { code: string; message: string; recoverable: boolean; installHint?: string }; warnings?: string[] };

export interface PiToolResult<T = unknown> {
  content: ToolContent[];
  details?: ToolResponse<T>;
  isError?: boolean;
}

type ToolUpdateCallback = (partial: PiToolResult | { content: ToolContent[]; details?: unknown }) => void;
type ToolExecutionContext = { cwd?: string; env?: NodeJS.ProcessEnv; model?: { input?: string[] }; ui?: { setStatus?: (key: string, text?: string) => void } };

export interface MarkdownToAudioParams {
  path: string;
  outputPath?: string;
  engine?: MarkdownToAudioEngine;
  language?: string;
  voiceModel?: string;
  voiceQuality?: MarkdownToAudioVoiceQuality;
  speed?: number;
  sentenceSilence?: number;
  noiseScale?: number;
  noiseW?: number;
  mp3BitrateKbps?: number;
}

export interface ScreenshotParams {
  outputPath?: string;
  maxInlineBytes?: number;
}

interface ScreenshotExecutionOverrides {
  platform?: NodeJS.Platform;
  findCommand?: ScreenshotCommandFinder;
  runCommand?: ScreenshotCommandRunner;
  readOsRelease?: OsReleaseReader;
}

const DEFAULT_SCREENSHOT_MAX_INLINE_BYTES = 5 * 1024 * 1024;

const markdownToAudioParameters = Type.Object({
  path: Type.String({ description: 'Path to a local Markdown file, relative to the current workspace or absolute.' }),
  outputPath: Type.Optional(Type.String({ description: 'Output audio path. Defaults to a .wav file next to the Markdown file. Supports .wav and .mp3.' })),
  engine: Type.Optional(Type.String({ description: 'TTS engine to use. auto prefers Piper and falls back to espeak-ng.', enum: ['auto', 'piper', 'espeak-ng'] } as any)),
  language: Type.Optional(Type.String({ description: 'Language or voice code, such as es, es_ES, es_MX, or en_US. Defaults to es.' })),
  voiceModel: Type.Optional(Type.String({ description: 'Piper .onnx voice model path. If omitted, the tool searches /usr/share/piper-voices.' })),
  voiceQuality: Type.Optional(Type.String({ description: 'Preferred Piper voice quality when auto-selecting a model. auto balances speed and quality by preferring medium, then low, then high.', enum: ['auto', 'high', 'medium', 'low'] } as any)),
  speed: Type.Optional(Type.Number({ minimum: 0.25, maximum: 450, description: 'Speech speed. Values from 0.25 to 4 are relative multipliers where 1 is normal. For espeak-ng, values above 4 are treated as words per minute. For Piper, speed maps to length-scale as 1/speed.' })),
  sentenceSilence: Type.Optional(Type.Number({ minimum: 0, maximum: 5, description: 'Piper-only seconds of silence after each sentence. Useful for more natural narration pacing.' })),
  noiseScale: Type.Optional(Type.Number({ minimum: 0, maximum: 2, description: 'Piper-only generator noise scale. Piper default is usually 0.667; adjust carefully for voice variation.' })),
  noiseW: Type.Optional(Type.Number({ minimum: 0, maximum: 2, description: 'Piper-only phoneme width variation. Piper default is usually 0.8; adjust carefully for prosody variation.' })),
  mp3BitrateKbps: Type.Optional(Type.Number({ minimum: 16, maximum: 320, description: 'MP3 audio bitrate in kbps when outputPath ends in .mp3. Defaults to 64 for compact spoken-word audio.' })),
});

const screenshotParameters = Type.Object({
  outputPath: Type.Optional(Type.String({ description: 'PNG output path for the screenshot. Defaults to a temporary .png file. Supports relative or absolute paths.' })),
  maxInlineBytes: Type.Optional(Type.Number({ minimum: 1024, maximum: 50 * 1024 * 1024, description: 'Maximum PNG size to attach inline for immediate visual inspection. Defaults to 5 MiB.' })),
});

export function registerUtilsTools(pi: any): void {
  pi.registerTool({
    name: 'screenshot',
    label: 'Screenshot',
    description: 'Capture a Linux desktop screenshot, save it as PNG, and attach the image inline in the same tool result for immediate visual inspection. Requires an active X11 or Wayland graphical session and a supported local screenshot utility.',
    promptSnippet: 'Capture and immediately inspect a Linux desktop screenshot as an inline PNG image.',
    promptGuidelines: [
      'Use screenshot when the user asks to see the screen, inspect the desktop, or capture a screenshot in the current Linux session.',
      'screenshot is Linux-only and requires DISPLAY or WAYLAND_DISPLAY; if neither is present, tell the user Pi is running headless or in a pure shell/TTY and cannot capture a desktop screenshot from that session.',
      'If screenshot reports missing dependencies, tell the user to install one supported screenshot utility for their distribution/session: grim for wlroots Wayland, gnome-screenshot for GNOME, spectacle for KDE, maim/scrot/ImageMagick import for X11.',
      'Let screenshot choose its default temporary output path for quick inspections; pass outputPath only when the user asks to keep the PNG or when a workspace artifact is intentionally useful.',
      'screenshot saves a PNG and returns the image inline in the same tool call when the active model supports images, so do not ask the user to manually attach or read the file afterward.',
    ],
    parameters: screenshotParameters,
    async execute(_id: string, params: ScreenshotParams, signal?: AbortSignal, _onUpdate?: ToolUpdateCallback, ctx?: ToolExecutionContext) {
      try {
        const executionParams = params as ScreenshotParams & ScreenshotExecutionOverrides;
        const data = await captureScreenshot({
          cwd: ctx?.cwd ?? process.cwd(),
          outputPath: executionParams.outputPath,
          platform: executionParams.platform,
          env: ctx?.env ?? process.env,
          signal,
          findCommand: executionParams.findCommand,
          runCommand: executionParams.runCommand,
          readOsRelease: executionParams.readOsRelease,
        });
        const content = await buildScreenshotContent(data, params, ctx);
        return buildSuccessWithContent(content, data);
      } catch (error) {
        if (error instanceof ScreenshotError) {
          return buildFailure(error.code, error.installHint ? `${error.message}\n${error.installHint}` : error.message, error.recoverable, error.installHint, 'screenshot');
        }
        return buildFailure('capture_failed', error instanceof Error ? error.message : 'screenshot failed', true, undefined, 'screenshot');
      }
    },
  });

  pi.registerTool({
    name: 'markdown_to_audio',
    label: 'Markdown to Audio',
    description: 'Convert a local Markdown file to an audio file using local TTS engines. Prefers Piper and falls back to espeak-ng; supports WAV and MP3 output.',
    promptSnippet: 'Convert a local Markdown file into a WAV or MP3 audio file for listening.',
    promptGuidelines: [
      'Use markdown_to_audio when the user asks to listen to a Markdown document or convert Markdown into speech audio.',
      'For markdown_to_audio, pass voiceModel when the user wants a specific Piper voice; otherwise the tool searches installed Piper voices.',
      'For more natural Piper narration, tune speed, sentenceSilence, noiseScale, and noiseW instead of rewriting the source Markdown.',
    ],
    parameters: markdownToAudioParameters,
    async execute(_id: string, params: MarkdownToAudioParams, signal?: AbortSignal, onUpdate?: ToolUpdateCallback, ctx?: ToolExecutionContext) {
      try {
        const data = await convertMarkdownToAudio({
          ...params,
          cwd: ctx?.cwd ?? process.cwd(),
          signal,
          onProgress: (event) => emitProgressUpdate(onUpdate, ctx, event),
        });
        return buildSuccess(summarizeMarkdownToAudio(data), data);
      } catch (error) {
        return buildFailure(classifyError(error), error instanceof Error ? error.message : 'markdown_to_audio failed');
      } finally {
        ctx?.ui?.setStatus?.('markdown_to_audio', undefined);
      }
    },
  });
}

function emitProgressUpdate(onUpdate: ToolUpdateCallback | undefined, ctx: ToolExecutionContext | undefined, event: MarkdownToAudioProgressEvent): void {
  ctx?.ui?.setStatus?.('markdown_to_audio', buildStatusText(event));
  if (!onUpdate) return;
  onUpdate({
    content: [{ type: 'text', text: event.message }],
    details: { status: 'progress', data: event },
  });
}

function buildStatusText(event: MarkdownToAudioProgressEvent): string {
  return event.message.replace(/^markdown_to_audio:\s*/u, 'TTS · ');
}

async function buildScreenshotContent(result: ScreenshotResult, params: ScreenshotParams, ctx: ToolExecutionContext | undefined): Promise<ToolContent[]> {
  if (!modelCanAcceptImages(ctx)) {
    result.warnings.push('current model does not support image inputs; screenshot was saved but not attached inline');
    return [{ type: 'text', text: summarizeScreenshotResult(result, { inlineAttached: false }) }];
  }

  const maxInlineBytes = normalizeMaxInlineBytes(params.maxInlineBytes);
  if (result.outputSizeBytes > maxInlineBytes) {
    result.warnings.push(`screenshot image is ${result.outputSizeBytes.toLocaleString('en-US')} bytes, above maxInlineBytes ${maxInlineBytes.toLocaleString('en-US')}; saved PNG was not attached inline`);
    return [{ type: 'text', text: summarizeScreenshotResult(result, { inlineAttached: false }) }];
  }

  try {
    const bytes = await readFile(result.outputPath);
    return [
      { type: 'text', text: summarizeScreenshotResult(result, { inlineAttached: true }) },
      { type: 'image', data: bytes.toString('base64'), mimeType: 'image/png' },
    ];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.warnings.push(`could not read screenshot file for inline attachment: ${message}`);
    return [{ type: 'text', text: summarizeScreenshotResult(result, { inlineAttached: false }) }];
  }
}

function modelCanAcceptImages(ctx: ToolExecutionContext | undefined): boolean {
  return !ctx?.model?.input || ctx.model.input.includes('image');
}

function normalizeMaxInlineBytes(value: number | undefined): number {
  if (value === undefined) return DEFAULT_SCREENSHOT_MAX_INLINE_BYTES;
  if (!Number.isFinite(value)) throw new Error('maxInlineBytes must be a finite number');
  if (value < 1024 || value > 50 * 1024 * 1024) throw new Error('maxInlineBytes must be between 1024 and 52428800');
  return Math.round(value);
}

function buildSuccess<T extends { warnings?: string[] }>(text: string, data: T): PiToolResult<T> {
  return buildSuccessWithContent([{ type: 'text', text }], data);
}

function buildSuccessWithContent<T extends { warnings?: string[] }>(content: ToolContent[], data: T): PiToolResult<T> {
  return {
    content,
    details: { status: 'success', data, warnings: data.warnings?.length ? data.warnings : undefined },
  };
}

function buildFailure(code: string, message: string, recoverable = code !== 'validation_error', installHint?: string, toolName = 'markdown_to_audio'): PiToolResult<never> {
  return {
    content: [{ type: 'text', text: `${toolName} failed: ${message}` }],
    details: { status: 'failure', error: { code, message, recoverable, installHint } },
    isError: true,
  };
}

function classifyError(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (/path is required|expected a markdown|unsupported output|must be|found no readable text/.test(message)) return 'validation_error';
  if (/enoent|eacces|eperm|not found on path|no supported tts engine|install piper|requires ffmpeg|no voice model/.test(message)) return 'dependency_error';
  return 'audio_generation_error';
}

function summarizeMarkdownToAudio(result: MarkdownToAudioResult): string {
  const lines = [
    `markdown_to_audio: ${result.inputPath}`,
    `output: ${result.outputPath}`,
    `engine: ${result.engine} (${result.engineRole}) | program: ${result.ttsProgram}${result.voiceModel ? ` | voice: ${result.voiceModel}` : ''}`,
    `language: ${result.language} | format: ${result.format}`,
    `text: ${result.textCharCount.toLocaleString('en-US')} chars`,
    `audio size: ${result.outputSizeBytes.toLocaleString('en-US')} bytes`,
    result.warnings.length ? `warnings: ${result.warnings.join('; ')}` : undefined,
  ].filter(Boolean);
  return lines.join('\n');
}
