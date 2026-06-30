import { Type } from 'typebox';
import { convertMarkdownToAudio, type MarkdownToAudioEngine, type MarkdownToAudioResult, type MarkdownToAudioVoiceQuality } from './markdown-to-audio.js';

type ToolResponse<T> =
  | { status: 'success'; data: T; warnings?: string[] }
  | { status: 'failure'; error: { code: string; message: string; recoverable: boolean }; warnings?: string[] };

export interface PiToolResult<T = unknown> {
  content: Array<{ type: 'text'; text: string }>;
  details?: ToolResponse<T>;
  isError?: boolean;
}

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
}

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
});

export function registerUtilsTools(pi: any): void {
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
    async execute(_id: string, params: MarkdownToAudioParams, signal?: AbortSignal, _onUpdate?: unknown, ctx?: { cwd?: string }) {
      try {
        const data = await convertMarkdownToAudio({
          ...params,
          cwd: ctx?.cwd ?? process.cwd(),
          signal,
        });
        return buildSuccess(summarizeMarkdownToAudio(data), data);
      } catch (error) {
        return buildFailure(classifyError(error), error instanceof Error ? error.message : 'markdown_to_audio failed');
      }
    },
  });
}

function buildSuccess<T extends { warnings?: string[] }>(text: string, data: T): PiToolResult<T> {
  return {
    content: [{ type: 'text', text }],
    details: { status: 'success', data, warnings: data.warnings?.length ? data.warnings : undefined },
  };
}

function buildFailure(code: string, message: string): PiToolResult<never> {
  return {
    content: [{ type: 'text', text: `markdown_to_audio failed: ${message}` }],
    details: { status: 'failure', error: { code, message, recoverable: code !== 'validation_error' } },
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
    `engine: ${result.engine}${result.voiceModel ? ` | voice: ${result.voiceModel}` : ''}`,
    `language: ${result.language} | format: ${result.format}`,
    `text: ${result.textCharCount.toLocaleString('en-US')} chars`,
    `audio size: ${result.outputSizeBytes.toLocaleString('en-US')} bytes`,
    result.warnings.length ? `warnings: ${result.warnings.join('; ')}` : undefined,
  ].filter(Boolean);
  return lines.join('\n');
}
