import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';

export type MarkdownToAudioEngine = 'auto' | 'piper' | 'espeak-ng';
export type EffectiveMarkdownToAudioEngine = Exclude<MarkdownToAudioEngine, 'auto'>;
export type MarkdownToAudioFormat = 'wav' | 'mp3';
export type MarkdownToAudioVoiceQuality = 'auto' | 'high' | 'medium' | 'low';
export type MarkdownToAudioEngineRole = 'primary' | 'fallback' | 'requested';
export type MarkdownToAudioProgressStage = 'preparing' | 'synthesizing' | 'converting' | 'done';

export interface MarkdownToAudioProgressEvent {
  stage: MarkdownToAudioProgressStage;
  message: string;
  elapsedSeconds: number;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  code: number;
}

export type CommandRunner = (command: string, args: string[], options: { input?: string; signal?: AbortSignal }) => Promise<CommandResult>;
export type CommandFinder = (command: string) => Promise<string | null>;
export type VoiceModelFinder = (language: string, voiceQuality?: MarkdownToAudioVoiceQuality) => Promise<string | null>;

export interface MarkdownToAudioInput {
  path: string;
  cwd: string;
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
  signal?: AbortSignal;
  onProgress?: (event: MarkdownToAudioProgressEvent) => void;
  progressIntervalMs?: number;
  findCommand?: CommandFinder;
  findVoiceModel?: VoiceModelFinder;
  runCommand?: CommandRunner;
}

export interface MarkdownToAudioResult {
  inputPath: string;
  outputPath: string;
  engine: EffectiveMarkdownToAudioEngine;
  engineRole: MarkdownToAudioEngineRole;
  ttsProgram: string;
  format: MarkdownToAudioFormat;
  language: string;
  voiceModel?: string;
  textCharCount: number;
  outputSizeBytes: number;
  warnings: string[];
}

const DEFAULT_LANGUAGE = 'es';
const DEFAULT_ESPEAK_SPEED = 175;
const DEFAULT_MP3_BITRATE_KBPS = 64;
const DEFAULT_PROGRESS_INTERVAL_MS = 1_000;
const PIPER_CANDIDATES = ['piper-tts', 'piper'];
const VOICE_ROOT = '/usr/share/piper-voices';

export function markdownToPlainText(markdown: string): string {
  const cleaned = markdown
    .replace(/^---\s*[\r\n][\s\S]*?[\r\n]---\s*/u, '')
    .replace(/<!--([\s\S]*?)-->/gu, ' ')
    .replace(/```[\w-]*[\r\n][\s\S]*?```/gu, ' ')
    .replace(/~~~[\w-]*[\r\n][\s\S]*?~~~/gu, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/`([^`]+)`/gu, '$1')
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/gu, '$1')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/\bhttps?:\/\/\S+/gu, ' ')
    .replace(/\r/g, '\n');

  const lines = cleaned.split('\n').map((line) => normalizeMarkdownLineForSpeech(line));
  return lines.join('\n')
    .replace(/[ \t]+/gu, ' ')
    .replace(/\n[ \t]+/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

function normalizeMarkdownLineForSpeech(line: string): string {
  const trimmed = line.trim();
  if (!trimmed) return '';
  if (/^\s*[-*_]{3,}\s*$/u.test(trimmed)) return '';
  if (/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/u.test(trimmed)) return '';

  const heading = trimmed.match(/^#{1,6}\s+(.+)$/u);
  if (heading) return ensureSpeechPunctuation(heading[1]);

  const blockquote = trimmed.match(/^>\s?(.+)$/u);
  if (blockquote) return ensureSpeechPunctuation(blockquote[1]);

  const unordered = trimmed.match(/^[-*+]\s+(.+)$/u);
  if (unordered) return ensureSpeechPunctuation(unordered[1]);

  const ordered = trimmed.match(/^\d+[.)]\s+(.+)$/u);
  if (ordered) return ensureSpeechPunctuation(ordered[1]);

  if (trimmed.includes('|')) {
    const cells = trimmed.split('|').map((cell) => cell.trim()).filter(Boolean);
    if (cells.length > 1) return ensureSpeechPunctuation(cells.join(', '));
  }

  return trimmed;
}

function ensureSpeechPunctuation(text: string): string {
  const cleaned = text.trim();
  if (!cleaned) return '';
  return /[.!?…:]$/u.test(cleaned) ? cleaned : `${cleaned}.`;
}

export async function convertMarkdownToAudio(input: MarkdownToAudioInput): Promise<MarkdownToAudioResult> {
  const cwd = input.cwd || process.cwd();
  const inputPath = resolveInputPath(cwd, input.path);
  await assertMarkdownFile(inputPath);

  const markdown = await readFile(inputPath, 'utf8');
  const text = markdownToPlainText(markdown);
  if (!text) {
    throw new Error('markdown_to_audio found no readable text after converting markdown to plain text');
  }

  const language = normalizeLanguage(input.language ?? DEFAULT_LANGUAGE);
  const requestedEngine = input.engine ?? 'auto';
  const outputPath = resolveOutputPath(cwd, inputPath, input.outputPath);
  const format = inferFormat(outputPath);
  const synthOutputPath = format === 'mp3' ? join(tmpdir(), `pi-markdown-audio-${Date.now()}-${Math.random().toString(16).slice(2)}.wav`) : outputPath;
  const findCommand = input.findCommand ?? findCommandOnPath;
  const runCommand = input.runCommand ?? runCommandWithSpawn;
  const warnings: string[] = [];
  const progress = createProgressReporter(input.onProgress, input.progressIntervalMs);

  progress.emit('preparing', 'preparing markdown audio');
  await mkdir(dirname(outputPath), { recursive: true });

  try {
    const selected = await selectEngine(requestedEngine, findCommand);
    if (selected.engine === 'piper') {
      const voiceModel = input.voiceModel
        ? resolveInputPath(cwd, input.voiceModel)
        : await (input.findVoiceModel ?? findPiperVoiceModel)(language, input.voiceQuality);
      if (!voiceModel) {
        if (requestedEngine === 'piper') {
          throw new Error('piper selected but no voice model was provided or found under /usr/share/piper-voices');
        }
        warnings.push('piper is installed but no voice model was found; falling back to espeak-ng');
        const espeakCommand = await findCommand('espeak-ng');
        if (!espeakCommand) throw installError();
        const engineRole: MarkdownToAudioEngineRole = 'fallback';
        await withProgressPulse(progress, 'synthesizing', buildSynthesisProgressMessage('espeak-ng', engineRole, espeakCommand, input.speed, text.length), async () => {
          await synthesizeWithEspeak(espeakCommand, text, synthOutputPath, language, input.speed, runCommand, input.signal);
        });
        await convertIfNeededWithProgress(progress, format, synthOutputPath, outputPath, input.mp3BitrateKbps, findCommand, runCommand, input.signal);
        const result = await buildResult(inputPath, outputPath, 'espeak-ng', engineRole, espeakCommand, format, language, undefined, text.length, warnings);
        progress.emit('done', `done · ${format} · ${basename(outputPath)}`);
        return result;
      }
      const engineRole = getEngineRole(requestedEngine, 'piper');
      await withProgressPulse(progress, 'synthesizing', buildSynthesisProgressMessage('piper', engineRole, selected.command, input.speed, text.length), async () => {
        await synthesizeWithPiper(selected.command, text, synthOutputPath, voiceModel, {
          speed: input.speed,
          sentenceSilence: input.sentenceSilence,
          noiseScale: input.noiseScale,
          noiseW: input.noiseW,
        }, runCommand, input.signal);
      });
      await convertIfNeededWithProgress(progress, format, synthOutputPath, outputPath, input.mp3BitrateKbps, findCommand, runCommand, input.signal);
      const result = await buildResult(inputPath, outputPath, 'piper', engineRole, selected.command, format, language, voiceModel, text.length, warnings);
      progress.emit('done', `done · ${format} · ${basename(outputPath)}`);
      return result;
    }

    const engineRole = getEngineRole(requestedEngine, 'espeak-ng');
    await withProgressPulse(progress, 'synthesizing', buildSynthesisProgressMessage('espeak-ng', engineRole, selected.command, input.speed, text.length), async () => {
      await synthesizeWithEspeak(selected.command, text, synthOutputPath, language, input.speed, runCommand, input.signal);
    });
    await convertIfNeededWithProgress(progress, format, synthOutputPath, outputPath, input.mp3BitrateKbps, findCommand, runCommand, input.signal);
    const result = await buildResult(inputPath, outputPath, 'espeak-ng', engineRole, selected.command, format, language, undefined, text.length, warnings);
    progress.emit('done', `done · ${format} · ${basename(outputPath)}`);
    return result;
  } finally {
    if (format === 'mp3') {
      await rm(synthOutputPath, { force: true }).catch(() => undefined);
    }
  }
}

interface ProgressReporter {
  intervalMs: number;
  emit(stage: MarkdownToAudioProgressStage, description: string): void;
}

function createProgressReporter(onProgress: ((event: MarkdownToAudioProgressEvent) => void) | undefined, intervalMs: number | undefined): ProgressReporter {
  const startedAt = Date.now();
  return {
    intervalMs: Math.max(250, Math.round(intervalMs ?? DEFAULT_PROGRESS_INTERVAL_MS)),
    emit(stage, description) {
      if (!onProgress) return;
      const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
      onProgress({
        stage,
        elapsedSeconds,
        message: `markdown_to_audio: ${description} · ${formatElapsed(elapsedSeconds)} elapsed`,
      });
    },
  };
}

function getEngineRole(requestedEngine: MarkdownToAudioEngine, engine: EffectiveMarkdownToAudioEngine): MarkdownToAudioEngineRole {
  if (requestedEngine !== 'auto') return 'requested';
  return engine === 'piper' ? 'primary' : 'fallback';
}

function buildSynthesisProgressMessage(engine: EffectiveMarkdownToAudioEngine, engineRole: MarkdownToAudioEngineRole, ttsProgram: string, speed: number | undefined, textCharCount: number): string {
  return `${engine} synthesis · ${engineRole} · program ${basename(ttsProgram)} · speed ${formatSpeed(speed)} · ${formatCompactCount(textCharCount)} chars · progress n/a`;
}

function buildConversionProgressMessage(mp3BitrateKbps: number | undefined): string {
  return `mp3 conversion · ${normalizeMp3BitrateKbps(mp3BitrateKbps)}k · progress n/a`;
}

function formatSpeed(speed: number | undefined): string {
  return `${speed ?? 1}x`;
}

function formatCompactCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

function formatElapsed(elapsedSeconds: number): string {
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

async function withProgressPulse<T>(progress: ProgressReporter, stage: MarkdownToAudioProgressStage, description: string, task: () => Promise<T>): Promise<T> {
  progress.emit(stage, description);
  const timer = setInterval(() => progress.emit(stage, description), progress.intervalMs);
  try {
    return await task();
  } finally {
    clearInterval(timer);
  }
}

async function selectEngine(engine: MarkdownToAudioEngine, findCommand: CommandFinder): Promise<{ engine: EffectiveMarkdownToAudioEngine; command: string }> {
  if (engine === 'piper') {
    const command = await findFirstCommand(PIPER_CANDIDATES, findCommand);
    if (!command) throw new Error('piper selected but neither piper-tts nor piper was found on PATH');
    return { engine: 'piper', command };
  }
  if (engine === 'espeak-ng') {
    const command = await findCommand('espeak-ng');
    if (!command) throw new Error('espeak-ng selected but it was not found on PATH');
    return { engine: 'espeak-ng', command };
  }

  const piper = await findFirstCommand(PIPER_CANDIDATES, findCommand);
  if (piper) return { engine: 'piper', command: piper };
  const espeak = await findCommand('espeak-ng');
  if (espeak) return { engine: 'espeak-ng', command: espeak };
  throw installError();
}

async function findFirstCommand(commands: string[], findCommand: CommandFinder): Promise<string | null> {
  for (const command of commands) {
    const found = await findCommand(command);
    if (found) return found;
  }
  return null;
}

function installError(): Error {
  return new Error('no supported TTS engine found; install piper-tts or espeak-ng (Arch: yay -S piper-tts piper-voices-es-es && sudo pacman -S espeak-ng ffmpeg)');
}

async function synthesizeWithPiper(
  command: string,
  text: string,
  outputPath: string,
  voiceModel: string,
  options: { speed?: number; sentenceSilence?: number; noiseScale?: number; noiseW?: number },
  runCommand: CommandRunner,
  signal?: AbortSignal,
): Promise<void> {
  const args = ['-m', voiceModel, '-f', outputPath];
  if (options.speed !== undefined) {
    const lengthScale = clampNumber(1 / options.speed, 'speed', 0.25, 4).toFixed(2);
    args.push('--length-scale', lengthScale);
  }
  if (options.sentenceSilence !== undefined) {
    args.push('--sentence-silence', clampNumber(options.sentenceSilence, 'sentenceSilence', 0, 5).toFixed(2));
  }
  if (options.noiseScale !== undefined) {
    args.push('--noise-scale', clampNumber(options.noiseScale, 'noiseScale', 0, 2).toFixed(2));
  }
  if (options.noiseW !== undefined) {
    args.push('--noise-w', clampNumber(options.noiseW, 'noiseW', 0, 2).toFixed(2));
  }
  const result = await runCommand(command, args, { input: text, signal });
  assertCommandSucceeded('piper', result);
}

async function synthesizeWithEspeak(
  command: string,
  text: string,
  outputPath: string,
  language: string,
  speed: number | undefined,
  runCommand: CommandRunner,
  signal?: AbortSignal,
): Promise<void> {
  const wordsPerMinute = normalizeEspeakSpeed(speed);
  const args = ['-w', outputPath, '-v', language, '-s', String(wordsPerMinute)];
  const result = await runCommand(command, args, { input: text, signal });
  assertCommandSucceeded('espeak-ng', result);
}

async function convertIfNeededWithProgress(
  progress: ProgressReporter,
  format: MarkdownToAudioFormat,
  synthOutputPath: string,
  outputPath: string,
  mp3BitrateKbps: number | undefined,
  findCommand: CommandFinder,
  runCommand: CommandRunner,
  signal?: AbortSignal,
): Promise<void> {
  if (format !== 'mp3') return;
  await withProgressPulse(progress, 'converting', buildConversionProgressMessage(mp3BitrateKbps), async () => {
    await convertIfNeeded(format, synthOutputPath, outputPath, mp3BitrateKbps, findCommand, runCommand, signal);
  });
}

async function convertIfNeeded(
  format: MarkdownToAudioFormat,
  synthOutputPath: string,
  outputPath: string,
  mp3BitrateKbps: number | undefined,
  findCommand: CommandFinder,
  runCommand: CommandRunner,
  signal?: AbortSignal,
): Promise<void> {
  if (format !== 'mp3') return;
  const ffmpeg = await findCommand('ffmpeg');
  if (!ffmpeg) throw new Error('mp3 output requires ffmpeg, but ffmpeg was not found on PATH');
  const bitrate = normalizeMp3BitrateKbps(mp3BitrateKbps);
  const result = await runCommand(ffmpeg, ['-y', '-i', synthOutputPath, '-b:a', `${bitrate}k`, outputPath], { signal });
  assertCommandSucceeded('ffmpeg', result);
}

async function buildResult(
  inputPath: string,
  outputPath: string,
  engine: EffectiveMarkdownToAudioEngine,
  engineRole: MarkdownToAudioEngineRole,
  ttsProgram: string,
  format: MarkdownToAudioFormat,
  language: string,
  voiceModel: string | undefined,
  textCharCount: number,
  warnings: string[],
): Promise<MarkdownToAudioResult> {
  const fileStat = await stat(outputPath);
  return {
    inputPath,
    outputPath,
    engine,
    engineRole,
    ttsProgram,
    format,
    language,
    voiceModel,
    textCharCount,
    outputSizeBytes: fileStat.size,
    warnings,
  };
}

function assertCommandSucceeded(label: string, result: CommandResult): void {
  if (result.code !== 0) {
    const stderr = result.stderr.trim();
    throw new Error(`${label} failed with exit code ${result.code}${stderr ? `: ${stderr}` : ''}`);
  }
}

async function assertMarkdownFile(pathname: string): Promise<void> {
  const extension = extname(pathname).toLowerCase();
  if (!['.md', '.markdown', '.mdown'].includes(extension)) {
    throw new Error('expected a markdown file path (.md, .markdown, or .mdown)');
  }
  const fileStat = await stat(pathname);
  if (!fileStat.isFile()) throw new Error('expected a markdown file');
}

function resolveInputPath(cwd: string, pathname: string): string {
  const trimmed = pathname.trim().replace(/^@/, '');
  if (!trimmed) throw new Error('path is required');
  return isAbsolute(trimmed) ? resolve(trimmed) : resolve(cwd, trimmed);
}

function resolveOutputPath(cwd: string, inputPath: string, outputPath: string | undefined): string {
  if (outputPath?.trim()) return resolveInputPath(cwd, outputPath);
  const base = basename(inputPath, extname(inputPath));
  return join(dirname(inputPath), `${base}.wav`);
}

function inferFormat(outputPath: string): MarkdownToAudioFormat {
  const extension = extname(outputPath).toLowerCase();
  if (!extension || extension === '.wav') return 'wav';
  if (extension === '.mp3') return 'mp3';
  throw new Error('unsupported output format; use .wav or .mp3');
}

function normalizeLanguage(language: string): string {
  return language.trim().replace('-', '_') || DEFAULT_LANGUAGE;
}

function normalizeVoiceQuality(voiceQuality: MarkdownToAudioVoiceQuality | undefined): MarkdownToAudioVoiceQuality {
  if (!voiceQuality) return 'auto';
  if (['auto', 'high', 'medium', 'low'].includes(voiceQuality)) return voiceQuality;
  throw new Error('voiceQuality must be auto, high, medium, or low');
}

function normalizeMp3BitrateKbps(mp3BitrateKbps: number | undefined): number {
  if (mp3BitrateKbps === undefined) return DEFAULT_MP3_BITRATE_KBPS;
  if (!Number.isFinite(mp3BitrateKbps)) throw new Error('mp3BitrateKbps must be a finite number');
  return Math.round(clampNumber(mp3BitrateKbps, 'mp3BitrateKbps', 16, 320));
}

function normalizeEspeakSpeed(speed: number | undefined): number {
  if (speed === undefined) return DEFAULT_ESPEAK_SPEED;
  if (!Number.isFinite(speed)) throw new Error('speed must be a finite number');
  const wordsPerMinute = speed <= 4 ? DEFAULT_ESPEAK_SPEED * speed : speed;
  return Math.round(clampNumber(wordsPerMinute, 'speed', 80, 450));
}

function clampNumber(value: number, key: string, min: number, max: number): number {
  if (!Number.isFinite(value)) throw new Error(`${key} must be a finite number`);
  if (value < min || value > max) throw new Error(`${key} must be between ${min} and ${max}`);
  return value;
}

async function findCommandOnPath(command: string): Promise<string | null> {
  const pathEntries = (process.env.PATH ?? '').split(':').filter(Boolean);
  for (const entry of pathEntries) {
    const candidate = join(entry, command);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // keep searching
    }
  }
  return null;
}

export async function findPiperVoiceModel(language: string, voiceQuality: MarkdownToAudioVoiceQuality = 'auto'): Promise<string | null> {
  try {
    await access(VOICE_ROOT, constants.R_OK);
  } catch {
    return null;
  }

  const voices = await listOnnxFiles(VOICE_ROOT, 8);
  if (voices.length === 0) return null;

  const normalizedLanguage = normalizeLanguage(language).toLowerCase();
  const languageParts = normalizedLanguage.split('_');
  const preferred = voices.filter((voice) => voice.toLowerCase().includes(`/${languageParts[0]}/`));
  const exact = preferred.filter((voice) => voice.toLowerCase().includes(`/${normalizedLanguage}/`));
  const quality = normalizeVoiceQuality(voiceQuality);
  return pickBestVoice(exact, quality) ?? pickBestVoice(preferred, quality) ?? pickBestVoice(voices, quality);
}

async function listOnnxFiles(root: string, maxDepth: number): Promise<string[]> {
  if (maxDepth < 0) return [];
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const results: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      results.push(...await listOnnxFiles(path, maxDepth - 1));
    } else if (entry.isFile() && entry.name.endsWith('.onnx')) {
      results.push(path);
    }
  }
  return results.sort();
}

function pickBestVoice(voices: string[], voiceQuality: MarkdownToAudioVoiceQuality): string | null {
  if (voices.length === 0) return null;
  const preferredOrder = voiceQuality === 'auto'
    ? ['medium', 'low', 'high']
    : [voiceQuality, ...['medium', 'low', 'high'].filter((quality) => quality !== voiceQuality)];
  for (const quality of preferredOrder) {
    const match = voices.find((voice) => new RegExp(`/${quality}/`, 'u').test(voice));
    if (match) return match;
  }
  return voices[0];
}

async function runCommandWithSpawn(command: string, args: string[], options: { input?: string; signal?: AbortSignal }): Promise<CommandResult> {
  return await new Promise<CommandResult>((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], signal: options.signal });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      resolvePromise({
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        code: code ?? 1,
      });
    });

    if (options.input) child.stdin.end(options.input);
    else child.stdin.end();
  });
}
