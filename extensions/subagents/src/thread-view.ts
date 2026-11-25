import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { isSubagentsDebugEnabled, writeSubagentsDebugLog } from './debug.js';
import {
  formatMarginedLine,
  truncateToWidth as terminalTruncateToWidth,
  visibleWidth as terminalVisibleWidth,
  wrapAnsiForWidth2,
  wrapLineToWidth,
} from './render/text-width.js';
import { contentRevision } from './render/content-revision.js';
import { DIM, hasAnsiEscape, MUTED, ORANGE, electric, themeFg } from './ui/theme.js';

import type {
  SubagentAssistantItem,
  SubagentAttemptItem,
  SubagentBashItem,
  SubagentCustomItem,
  SubagentErrorItem,
  SubagentStatusItem,
  SubagentThreadItem,
  SubagentThreadRenderContext,
  SubagentThreadRenderTarget,
  SubagentThreadSnapshot,
  SubagentToolItem,
  SubagentToolResultItem,
  SubagentToolResultPayload,
  SubagentUserItem,
} from './types.js';

type BoundOptions = { textLimit?: number; maxItems?: number };

const DEFAULT_TEXT_LIMIT = 4000;
const DEFAULT_MAX_ITEMS = 200;
const DEFAULT_RENDER_WIDTH = 100;
const require = createRequire(import.meta.url);
let injectedPiComponents: Record<string, any> | undefined;
let piComponents: Record<string, any> | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function isPayload(value: unknown): value is SubagentToolResultPayload {
  if (!isRecord(value) || typeof value.isError !== 'boolean' || !Array.isArray(value.content)) return false;
  return value.content.every((part) => isRecord(part) && typeof part.type === 'string' && isOptionalString(part.text) && isOptionalString(part.data) && isOptionalString(part.mimeType));
}

function isAssistantItem(item: Record<string, unknown>): item is SubagentAssistantItem {
  if (!isRecord(item.message) || item.message.role !== 'assistant' || !Array.isArray(item.message.content)) return false;
  return item.message.content.every((part) => {
    if (!isRecord(part) || typeof part.type !== 'string') return false;
    if (part.type === 'text') return typeof part.text === 'string';
    if (part.type === 'thinking') return isOptionalString(part.text) && isOptionalString(part.thinking);
    if (part.type === 'toolCall') return typeof part.id === 'string' && typeof part.name === 'string' && 'arguments' in part;
    return false;
  });
}

function isToolItem(item: Record<string, unknown>): item is SubagentToolItem {
  return typeof item.name === 'string'
    && ['pending', 'running', 'completed', 'failed', 'partial'].includes(String(item.status))
    && (item.result === undefined || isPayload(item.result));
}

function isToolResultItem(item: Record<string, unknown>): item is SubagentToolResultItem {
  return isPayload(item.result) && isOptionalString(item.name);
}

function isBashItem(item: Record<string, unknown>): item is SubagentBashItem {
  return typeof item.command === 'string'
    && (item.timeout === undefined || typeof item.timeout === 'number')
    && isOptionalString(item.started_at)
    && isOptionalString(item.ended_at)
    && isOptionalString(item.output)
    && (item.exitCode === undefined || typeof item.exitCode === 'number')
    && (item.status === undefined || ['running', 'completed', 'failed', 'cancelled'].includes(String(item.status)));
}

function isCustomItem(item: Record<string, unknown>): item is SubagentCustomItem {
  return typeof item.customType === 'string' && isOptionalString(item.fallbackText);
}

function isThreadItem(value: unknown): value is SubagentThreadItem {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  if (!isOptionalString(value.id)) return false;
  switch (value.type) {
    case 'attempt': return Number.isInteger(value.attempt) && Number(value.attempt) > 0;
    case 'assistant': return isAssistantItem(value);
    case 'user': return typeof value.text === 'string' && (value.label === undefined || ['delegated_task', 'continuation', 'context', 'prompt', 'user', 'queued'].includes(String(value.label)));
    case 'tool': return isToolItem(value);
    case 'tool_result': return isToolResultItem(value);
    case 'bash': return isBashItem(value);
    case 'custom': return isCustomItem(value);
    case 'status': return typeof value.text === 'string' && (value.severity === undefined || ['info', 'success', 'warning'].includes(String(value.severity)));
    case 'error': return typeof value.text === 'string';
    default: return false;
  }
}

export function isValidThreadSnapshot(value: unknown): value is SubagentThreadSnapshot {
  return isRecord(value)
    && value.version === 1
    && ['events', 'session_messages', 'mixed'].includes(String(value.source))
    && isOptionalString(value.created_at)
    && isOptionalString(value.updated_at)
    && Array.isArray(value.items)
    && value.items.every(isThreadItem);
}

function boundText(text: string | undefined, limit: number): string | undefined {
  if (text === undefined) return undefined;
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1))}…`;
}

function boundUnknown(value: unknown, limit: number): unknown {
  if (typeof value === 'string') return boundText(value, limit);
  if (Array.isArray(value)) return value.slice(0, 50).map((entry) => boundUnknown(entry, limit));
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).slice(0, 50).map(([key, entry]) => [key, boundUnknown(entry, limit)]));
}

function boundPayload(payload: SubagentToolResultPayload, limit: number): SubagentToolResultPayload {
  return {
    ...payload,
    details: boundUnknown(payload.details, limit),
    preview: boundText(payload.preview, limit),
    content: payload.content.map((part) => ({ ...part, text: boundText(part.text, limit), data: boundText(part.data, limit) })),
  };
}

function boundItem(item: SubagentThreadItem, limit: number): SubagentThreadItem {
  switch (item.type) {
    case 'attempt': return item;
    case 'assistant':
      return {
        ...item,
        message: {
          ...item.message,
          content: item.message.content.map((part) => {
            if (part.type === 'text') return { ...part, text: boundText(part.text, limit) ?? '' };
            if (part.type === 'thinking') return { ...part, text: boundText(part.text, limit), thinking: boundText(part.thinking ?? part.text, limit) };
            return part;
          }),
        },
      };
    case 'user': return { ...item, text: boundText(item.text, limit) ?? '' };
    case 'tool': return { ...item, arguments: boundUnknown(item.arguments, limit), result: item.result ? boundPayload(item.result, limit) : undefined };
    case 'tool_result': return { ...item, result: boundPayload(item.result, limit) };
    case 'bash': return { ...item, command: boundText(item.command, limit) ?? '', output: boundText(item.output, limit) };
    case 'custom': return { ...item, fallbackText: boundText(item.fallbackText, limit) };
    case 'status': return { ...item, text: boundText(item.text, limit) ?? '' };
    case 'error': return { ...item, text: boundText(item.text, limit) ?? '' };
  }
}

export function boundThreadSnapshot(value: unknown, options: BoundOptions = {}): SubagentThreadSnapshot | undefined {
  if (!isValidThreadSnapshot(value)) return undefined;
  const limit = Math.max(1, options.textLimit ?? DEFAULT_TEXT_LIMIT);
  const maxItems = Math.max(0, options.maxItems ?? DEFAULT_MAX_ITEMS);
  const items = value.items.length <= maxItems
    ? value.items
    : maxItems === 0
      ? []
      : maxItems === 1
        ? value.items.slice(0, 1)
        : [value.items[0]!, ...value.items.slice(-(maxItems - 1))];
  return { ...value, items: items.map((item) => boundItem(item, limit)) };
}

function payloadText(payload: SubagentToolResultPayload): string {
  const contentText = payload.content
    .map((part) => {
      if (part.text) return part.text;
      if (part.type === 'image') return `[image: ${part.mimeType ?? 'image'}]`;
      return part.data || '';
    })
    .filter(Boolean)
    .join('\n');
  return contentText || payload.preview || '';
}

function summarizeUnknownArgs(args: unknown, maxEntries = 3, maxValue = 200): string {
  if (args === undefined || args === null) return '';
  if (typeof args !== 'object') return boundText(String(args).replace(/\s+/g, ' ').trim(), maxValue) ?? '';
  if (Array.isArray(args)) return `[${args.length} items]`;
  const parts: string[] = [];
  for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string') {
      const clean = value.replace(/\s+/g, ' ').trim();
      if (clean) parts.push(`${key}=${boundText(clean, maxValue) ?? ''}`);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      parts.push(`${key}=${value}`);
    }
    if (parts.length >= maxEntries) break;
  }
  return parts.join(' · ');
}

function runningPiEntrypoint(): string | undefined {
  if (!process.argv[1]) return undefined;
  const resolved = path.resolve(process.argv[1]);
  try { return fs.realpathSync(resolved); } catch { return resolved; }
}

function findRunningPiPackageRoot(): string | undefined {
  let current = runningPiEntrypoint();
  if (!current) return undefined;
  if (!fs.existsSync(current)) return undefined;
  current = fs.statSync(current).isDirectory() ? current : path.dirname(current);
  while (true) {
    const packageJson = path.join(current, 'package.json');
    if (fs.existsSync(packageJson)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(packageJson, 'utf8')) as { name?: string };
        if (parsed.name === '@earendil-works/pi-coding-agent') return current;
      } catch {}
    }
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

export function setPiComponentProviderForSubagentRendering(provider: Record<string, any> | undefined): void {
  injectedPiComponents = provider;
  piComponents = provider;
  builtInToolDefinitionCache.clear();
  toolComponentCacheByTask.clear();
  bumpSubagentToolRendererGeneration();
}

export function resetPiComponentCacheForTests(): void {
  injectedPiComponents = undefined;
  piComponents = undefined;
  builtInToolDefinitionCache.clear();
  externalToolDefinitions.clear();
  externalToolSourcesLoaded.clear();
  externalToolRenderersBySource.clear();
  runtimeToolDefinitionsByTask.clear();
  toolComponentCacheByTask.clear();
  bumpSubagentToolRendererGeneration();
}

export function registerSubagentExternalToolDefinition(name: string | undefined, definition: unknown): void {
  if (!name || !definition) return;
  externalToolDefinitions.set(name, definition);
  toolComponentCacheByTask.clear();
  bumpSubagentToolRendererGeneration();
}

function hasToolRenderer(definition: unknown): boolean {
  return isRecord(definition) && (typeof definition.renderCall === 'function' || typeof definition.renderResult === 'function' || definition.renderShell === 'self');
}

/**
 * Opt-in presentation marker from the pinned owner contract
 * (`extensions/subagents/README.md`, "Compact Tool Rendering & Panel Contracts (v1)").
 * Presentation metadata only: a marked definition may keep its specialized rendering, while an
 * unmarked one is rendered through the local compact fallback.
 */
export const COMPACT_TOOL_RENDERING_VERSION = 1;

export function isCompactCompliantDefinition(definition: unknown): boolean {
  return isRecord(definition)
    && definition.compactToolRenderingVersion === COMPACT_TOOL_RENDERING_VERSION
    && definition.renderShell === 'self'
    && typeof definition.renderCall === 'function'
    && typeof definition.renderResult === 'function';
}

function sourcePathFromToolInfo(info: unknown): string | undefined {
  if (!isRecord(info) || !isRecord(info.sourceInfo)) return undefined;
  const rawPath = typeof info.sourceInfo.path === 'string' ? info.sourceInfo.path : undefined;
  if (!rawPath || rawPath.startsWith('<')) return undefined;
  const baseDir = typeof info.sourceInfo.baseDir === 'string' ? info.sourceInfo.baseDir : undefined;
  return path.isAbsolute(rawPath) ? rawPath : baseDir ? path.resolve(baseDir, rawPath) : path.resolve(rawPath);
}

type ToolRendererResolver = (name: string, next: () => unknown) => unknown;
const externalToolRenderersBySource = new Map<string, ToolRendererResolver[]>();

function createToolCapturePi(captured: unknown[], renderers: ToolRendererResolver[]): Record<string, any> {
  return {
    registerTool: (tool: unknown) => { captured.push(tool); },
    registerToolRenderer: (resolver: ToolRendererResolver) => { renderers.push(resolver); },
    registerCommand: () => undefined,
    registerShortcut: () => undefined,
    registerFlag: () => undefined,
    registerMessageRenderer: () => undefined,
    registerMarkdownTransformer: () => undefined,
    registerEntryRenderer: () => undefined,
    on: () => undefined,
    events: { on: () => undefined, emit: () => undefined },
    getFlag: () => undefined,
    getActiveTools: () => [],
    getAllTools: () => [],
    setActiveTools: () => undefined,
    sendMessage: () => undefined,
    sendUserMessage: () => undefined,
    appendEntry: () => undefined,
    exec: async () => ({ stdout: '', stderr: '', code: 0, killed: false }),
  };
}

function loadExternalToolSource(sourcePath: string): void {
  if (externalToolSourcesLoaded.has(sourcePath)) return;
  if (!fs.existsSync(sourcePath)) return;
  const packageRoot = findRunningPiPackageRoot();
  try {
    const piRequire = createRequire(packageRoot ? path.join(packageRoot, 'package.json') : import.meta.resolve('@earendil-works/pi-coding-agent'));
    const { createJiti } = piRequire('jiti') as { createJiti: (filename: string, options?: Record<string, unknown>) => (id: string) => any };
    const jiti = createJiti(packageRoot ? path.join(packageRoot, 'package.json') : import.meta.url, {
      moduleCache: true,
      interopDefault: true,
      ...(packageRoot ? { alias: {
        '@earendil-works/pi-coding-agent': packageRoot,
        '@earendil-works/pi-tui': path.join(packageRoot, 'node_modules', '@earendil-works', 'pi-tui', 'dist', 'index.js'),
      } } : {}),
    });
    const mod = jiti(sourcePath);
    // Prefer the synchronous presentation contract, never initialize an API client for replay.
    const register = mod?.registerToolRenderers ?? mod?.default ?? mod;
    if (typeof register !== 'function' || register.constructor?.name === 'AsyncFunction') return;
    const captured: unknown[] = [];
    const renderers: ToolRendererResolver[] = [];
    const maybePromise = register(createToolCapturePi(captured, renderers));
    if (maybePromise && typeof maybePromise.then === 'function') {
      void Promise.resolve(maybePromise).catch(() => undefined);
      return;
    }
    for (const tool of captured) {
      if (isRecord(tool) && typeof tool.name === 'string' && hasToolRenderer(tool)) registerSubagentExternalToolDefinition(tool.name, tool);
    }
    externalToolRenderersBySource.set(sourcePath, renderers);
    externalToolSourcesLoaded.add(sourcePath);
  } catch {}
}

export function resolveSubagentExternalToolDefinitionFromInfo(name: string, info: unknown): unknown {
  if (hasToolRenderer(info)) return info;
  const existing = externalToolDefinitions.get(name);
  if (existing) return existing;
  const sourcePath = sourcePathFromToolInfo(info);
  if (sourcePath) {
    loadExternalToolSource(sourcePath);
    const resolvers = externalToolRenderersBySource.get(sourcePath) ?? [];
    const resolve = (index: number): unknown => index < resolvers.length
      ? resolvers[index]!(name, () => resolve(index + 1))
      : externalToolDefinitions.get(name);
    try {
      const rendered = resolve(0);
      if (hasToolRenderer(rendered)) return rendered;
    } catch {}
  }
  return externalToolDefinitions.get(name);
}

function renderableToolDefinition(name: string, candidates: unknown[], cwd: string): unknown {
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (hasToolRenderer(candidate)) return candidate;
    const rehydrated = resolveSubagentExternalToolDefinitionFromInfo(name, candidate);
    if (hasToolRenderer(rehydrated)) return rehydrated;
  }
  return builtInToolDefinition(name, cwd);
}

function hasUsablePiComponents(value: unknown): value is Record<string, any> {
  return isRecord(value) && (
    typeof value.ToolExecutionComponent === 'function'
    || typeof value.AssistantMessageComponent === 'function'
    || typeof value.UserMessageComponent === 'function'
    || typeof value.createReadToolDefinition === 'function'
    || typeof value.createBashToolDefinition === 'function'
  );
}

function loadPiComponents(): Record<string, any> | undefined {
  if (injectedPiComponents !== undefined) return injectedPiComponents;
  if (piComponents !== undefined) return piComponents;
  const candidates = [
    () => {
      const packageRoot = findRunningPiPackageRoot();
      return packageRoot ? require(packageRoot) as Record<string, any> : undefined;
    },
    () => {
      const entrypoint = runningPiEntrypoint();
      if (!entrypoint) return undefined;
      return createRequire(entrypoint)('@earendil-works/pi-coding-agent') as Record<string, any>;
    },
    () => require('@earendil-works/pi-coding-agent') as Record<string, any>,
  ];
  for (const candidate of candidates) {
    try {
      const loaded = candidate();
      if (hasUsablePiComponents(loaded)) {
        piComponents = loaded;
        return piComponents;
      }
    } catch {}
  }
  return undefined;
}

async function importPiComponentCandidate(filePath: string | undefined): Promise<Record<string, any> | undefined> {
  if (!filePath || !fs.existsSync(filePath)) return undefined;
  try {
    const loaded = await import(pathToFileURL(filePath).href);
    return hasUsablePiComponents(loaded) ? loaded : undefined;
  } catch {
    return undefined;
  }
}

async function loadPiComponentsAsync(): Promise<Record<string, any> | undefined> {
  const packageRoot = findRunningPiPackageRoot();
  if (packageRoot) {
    const chunksDir = path.join(packageRoot, 'dist', 'bundle', 'chunks');
    try {
      if (fs.existsSync(chunksDir)) {
        for (const entry of fs.readdirSync(chunksDir)) {
          if (!entry.endsWith('.js')) continue;
          const loaded = await importPiComponentCandidate(path.join(chunksDir, entry));
          if (loaded) return loaded;
        }
      }
    } catch {}

    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8')) as { main?: string };
      const loaded = await importPiComponentCandidate(path.join(packageRoot, parsed.main ?? 'dist/index.js'));
      if (loaded) return loaded;
    } catch {}
  }

  const spec = '@earendil-works/pi-coding-agent';
  try {
    const loaded = await import(spec);
    if (hasUsablePiComponents(loaded)) return loaded;
  } catch {}

  return undefined;
}

export async function preloadPiComponentsForSubagentRendering(): Promise<boolean> {
  if (piComponents !== undefined && hasUsablePiComponents(piComponents)) return true;
  const loaded = await loadPiComponentsAsync();
  if (loaded) {
    piComponents = loaded;
    builtInToolDefinitionCache.clear();
    toolComponentCacheByTask.clear();
    return true;
  }
  if (loadPiComponents()) return true;
  return false;
}

// Debug logging is opt-in per workspace and each write re-reads the config from disk. Doing that
// twice per rendered row made replay cost grow with item count even with debug disabled. The flag is
// therefore resolved at most once per thread frame.
let frameDebugEnabled: boolean | undefined;

function debugLog(context: Pick<SubagentThreadRenderContext, 'cwd'> | undefined, scope: string, data: unknown): void {
  if (frameDebugEnabled === false) return;
  if (frameDebugEnabled === undefined) {
    try { frameDebugEnabled = isSubagentsDebugEnabled(context?.cwd ?? process.cwd()); } catch { frameDebugEnabled = false; }
    if (!frameDebugEnabled) return;
  }
  writeSubagentsDebugLog(context?.cwd, scope, data);
}

function renderComponent(component: unknown, width: number): string[] | undefined {
  if (!component || typeof (component as any).render !== 'function') return undefined;
  const lines = (component as any).render(width);
  return Array.isArray(lines)
    ? lines
        .filter((line): line is string => typeof line === 'string')
        .flatMap((line) => line.replace(/\r\n?/g, '\n').split('\n'))
    : undefined;
}

function fitsWidth(context: SubagentThreadRenderContext, text: string, width: number): boolean {
  try {
    if (context.visibleWidth(text) <= width) return true;
  } catch {}
  return terminalVisibleWidth(text) <= width;
}

function safeTruncate(context: SubagentThreadRenderContext, text: string, width = DEFAULT_RENDER_WIDTH): string {
  if (fitsWidth(context, text, width)) return text;
  try {
    return context.truncateToWidth(text, width);
  } catch {
    return text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text;
  }
}

function wrapLinesToWidth(context: SubagentThreadRenderContext, lines: string[], width = DEFAULT_RENDER_WIDTH): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (fitsWidth(context, line, width)) {
      out.push(line);
    } else {
      out.push(...wrapLineToWidth(line, width, width));
    }
  }
  return out;
}

function assistantText(item: SubagentAssistantItem, width?: number, hideThinking = false): string[] {
  const lines: string[] = [];
  for (const part of item.message.content) {
    if (part.type === 'text' && part.text.trim()) {
      if (width && width > 0) {
        lines.push(...wrapLineToWidth(part.text, width));
      } else {
        lines.push(part.text);
      }
    } else if (part.type === 'thinking' && (part.thinking ?? part.text)?.trim()) {
      if (hideThinking) { lines.push('Thinking...'); continue; }
      const thinkingRaw = (part.thinking ?? part.text)!.trim();
      const prefix = 'thinking: ';
      if (width && width > 0) {
        lines.push(...wrapLineToWidth(`${prefix}${thinkingRaw}`, width));
      } else {
        lines.push(`${prefix}${thinkingRaw}`);
      }
    }
    // Tool calls are rendered as separate tool rows, matching Pi's main thread composition.
  }
  if (item.message.errorMessage) lines.push(`error: ${item.message.errorMessage}`);
  return lines;
}

function renderAssistantItem(item: SubagentAssistantItem, context: SubagentThreadRenderContext, width: number, cached?: ThreadRenderEntry): string[] {
  const visibleContent = item.message.content.filter((part) => part.type !== 'toolCall');
  if (!visibleContent.length && !item.message.errorMessage) return [];
  const displayItem: SubagentAssistantItem = visibleContent.length === item.message.content.length
    ? item
    : { ...item, message: { ...item.message, content: visibleContent } };
  const componentCtor = loadPiComponents()?.AssistantMessageComponent;
  if (typeof componentCtor === 'function') {
    try {
      const markdownTheme = loadPiComponents()?.getMarkdownTheme?.() ?? context.theme;
      const component = cached?.component ?? new componentCtor(displayItem.message, context.hideThinkingBlock ?? false, markdownTheme, 'Thinking...');
      if (cached) cached.component = component;
      const rendered = renderComponent(component, width);
      if (rendered?.some((line) => line.trim())) return rendered;
    } catch (error) { debugLog(context, 'assistant_component_error', { error }); }
  }
  return assistantText(displayItem, width, context.hideThinkingBlock ?? false);
}

function userItemTitle(item: SubagentUserItem): string | undefined {
  if (item.label === 'context') return 'orchestrator context';
  if (item.label === 'delegated_task') return 'delegated task';
  if (item.label === 'continuation') return 'continuation prompt';
  if (item.label === 'queued') return 'queued live message';
  return undefined;
}

function renderUserItem(item: SubagentUserItem, context: SubagentThreadRenderContext, width: number, cached?: ThreadRenderEntry): string[] {
  const title = userItemTitle(item);
  const displayText = title ? `## ${title}\n\n${item.text}` : item.text;
  const componentCtor = loadPiComponents()?.UserMessageComponent;
  if (typeof componentCtor === 'function') {
    try {
      const markdownTheme = loadPiComponents()?.getMarkdownTheme?.() ?? context.theme;
      const component = cached?.component ?? new componentCtor(displayText, markdownTheme);
      if (cached) cached.component = component;
      const rendered = renderComponent(component, width);
      if (rendered?.some((line) => line.trim())) return rendered;
    } catch (error) { debugLog(context, 'user_component_error', { error, label: item.label }); }
  }
  const fallbackText = title ? `${title}\n${item.text}` : `${item.label ?? 'user'}: ${item.text}`;
  return fallbackText.replace(/\r\n?/g, '\n').split('\n')
    .flatMap((line) => wrapLineToWidth(line, width));
}

function renderAttemptItem(item: SubagentAttemptItem, context: SubagentThreadRenderContext, width: number): string[] {
  const label = `attempt ${item.attempt}`;
  const dividerWidth = Math.max(0, Math.min(12, Math.floor((width - label.length - 2) / 2)));
  const text = `${'─'.repeat(dividerWidth)} ${label} ${'─'.repeat(dividerWidth)}`.trim();
  return [context.theme?.fg?.('accent', context.theme?.bold?.(text) ?? text) ?? text];
}

const MAX_CACHED_TASKS = 50;
const MAX_RUNTIME_DEF_TASKS = 100;
const builtInToolDefinitionCache = new Map<string, unknown>();
const externalToolDefinitions = new Map<string, unknown>();
const externalToolSourcesLoaded = new Set<string>();
const runtimeToolDefinitionsByTask = new Map<string, Map<string, unknown>>();
const toolComponentCacheByTask = new Map<string, Map<string, unknown>>();
const safeCompliantDefinitionCache = new WeakMap<object, Record<string, any>>();

export function clearSubagentSessionRenderCaches(taskId?: string): void {
  if (taskId) {
    toolComponentCacheByTask.delete(taskId);
    runtimeToolDefinitionsByTask.delete(taskId);
    return;
  }
  toolComponentCacheByTask.clear();
  runtimeToolDefinitionsByTask.clear();
  bumpSubagentToolRendererGeneration();
}

export function registerSubagentRuntimeToolDefinition(taskId: string | undefined, name: string | undefined, definition: unknown): void {
  if (!taskId || !name || !definition) return;
  let byName = runtimeToolDefinitionsByTask.get(taskId);
  if (!byName) {
    byName = new Map<string, unknown>();
    runtimeToolDefinitionsByTask.set(taskId, byName);
    if (runtimeToolDefinitionsByTask.size > MAX_RUNTIME_DEF_TASKS) {
      const oldest = runtimeToolDefinitionsByTask.keys().next().value;
      if (oldest !== undefined) runtimeToolDefinitionsByTask.delete(oldest);
    }
  } else {
    runtimeToolDefinitionsByTask.delete(taskId);
    runtimeToolDefinitionsByTask.set(taskId, byName);
  }
  const previous = byName.get(name);
  byName.set(name, definition);
  if (previous !== definition) bumpSubagentToolRendererGeneration();
}

export function runtimeToolDefinition(taskId: string | undefined, name: string): unknown {
  return taskId ? runtimeToolDefinitionsByTask.get(taskId)?.get(name) : undefined;
}

function builtInToolDefinition(name: string, cwd: string): unknown {
  const key = `${cwd}\0${name}`;
  if (builtInToolDefinitionCache.has(key)) return builtInToolDefinitionCache.get(key);
  const pi = loadPiComponents();
  const factoryByName: Record<string, string> = {
    read: 'createReadToolDefinition',
    bash: 'createBashToolDefinition',
    powershell: 'createPowerShellToolDefinition',
    edit: 'createEditToolDefinition',
    write: 'createWriteToolDefinition',
    grep: 'createGrepToolDefinition',
    find: 'createFindToolDefinition',
    ls: 'createLsToolDefinition',
  };
  const factoryName = factoryByName[name];
  if (!factoryName) return undefined;
  const createSpecificToolDefinition = pi?.[factoryName];
  if (typeof createSpecificToolDefinition === 'function') {
    try {
      const definition = createSpecificToolDefinition(cwd);
      builtInToolDefinitionCache.set(key, definition);
      return definition;
    } catch {}
  }
  const createToolDefinition = pi?.createToolDefinition;
  if (typeof createToolDefinition !== 'function') return undefined;
  try {
    const definition = createToolDefinition(name, cwd);
    builtInToolDefinitionCache.set(key, definition);
    return definition;
  } catch { return undefined; }
}

function argString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value === undefined || value === null ? '' : String(value).trim();
}

function pathRangeSummary(input: Record<string, unknown>): string {
  const file = argString(input.path ?? input.file_path ?? input.file);
  if (!file) return '';
  const offset = Number(input.offset ?? 1);
  const limit = Number(input.limit);
  if (Number.isFinite(limit) && limit > 0) return `${file}:${Number.isFinite(offset) && offset > 0 ? offset : 1}-${(Number.isFinite(offset) && offset > 0 ? offset : 1) + limit - 1}`;
  if (Number.isFinite(offset) && offset > 1) return `${file}:${offset}`;
  return file;
}

function memoryArgumentSummary(name: string, input: Record<string, unknown>): string {
  if (name === 'memory_search') return argString(input.query);
  if (name === 'memory_recall') return [argString(input.context), argString(input.query)].filter(Boolean).join(' · ');
  if (name === 'memory_get' || name === 'memory_update' || name === 'memory_archive') return argString(input.id);
  if (name === 'memory_list') return [argString(input.scope), argString(input.kind), argString(input.project_name)].filter(Boolean).join(' · ');
  if (name === 'memory_add') return argString(input.title ?? input.summary ?? input.kind);
  if (name === 'memory_project_profile') return argString(input.action);
  if (name === 'memory_session_start') return argString(input.title);
  if (name === 'memory_session_prompt_add' || name === 'memory_session_finish') return argString(input.session_id);
  if (name === 'memory_migrate_project') return input.dry_run === false ? 'apply' : 'dry run';
  if (name === 'memory_export' || name === 'memory_import') return argString(input.path);
  return argString(input.query ?? input.id ?? input.action ?? input.kind ?? input.title ?? input.summary);
}

function toolArgumentSummary(name: string, args: unknown): string {
  const input = isRecord(args) ? args : {};
  if (name === 'read') return pathRangeSummary(input);
  if (name === 'edit' || name === 'write') return argString(input.path ?? input.file_path ?? input.file);
  if (name === 'bash' || name === 'powershell') return argString(input.command).split('\n')[0] ?? '';
  if (name === 'subagent_run') {
    return [argString(input.action ?? 'run'), argString(input.display_name ?? input.agent ?? input.task_id)].filter(Boolean).join(' · ');
  }
  if (name === 'ask_orchestrator') return boundText(argString(input.question), 80) ?? '';
  if (name === 'report_orchestrator') return boundText(argString(input.report), 80) ?? '';
  if (name.startsWith('memory_')) return memoryArgumentSummary(name, input);
  if (['grep', 'find', 'ls'].includes(name)) return [argString(input.pattern ?? input.query ?? input.name), argString(input.path ?? input.cwd)].filter(Boolean).join(' · ');
  return summarizeUnknownArgs(args);
}

function isActiveToolStatus(status: SubagentToolItem['status']): boolean {
  return status === 'pending' || status === 'running' || status === 'partial';
}

function cachedToolComponent(item: SubagentToolItem, context: SubagentThreadRenderContext, componentCtor: any, toolDefinition: unknown): any {
  const cacheId = item.tool_call_id ?? item.id;
  const shouldReuse = Boolean(context.taskId && cacheId && (isActiveToolStatus(item.status) || toolComponentCacheByTask.get(context.taskId!)?.has(cacheId!)));
  if (!shouldReuse) return new componentCtor(item.name, cacheId ?? item.name, item.arguments, { showImages: context.showImages, imageWidthCells: context.imageWidthCells }, toolDefinition, context.tui, context.cwd);
  let taskCache = toolComponentCacheByTask.get(context.taskId!);
  if (!taskCache) {
    taskCache = new Map<string, unknown>();
    toolComponentCacheByTask.set(context.taskId!, taskCache);
    if (toolComponentCacheByTask.size > MAX_CACHED_TASKS) {
      const oldest = toolComponentCacheByTask.keys().next().value;
      if (oldest !== undefined) toolComponentCacheByTask.delete(oldest);
    }
  } else {
    toolComponentCacheByTask.delete(context.taskId!);
    toolComponentCacheByTask.set(context.taskId!, taskCache);
  }
  let component = taskCache.get(cacheId!);
  if (!component) {
    component = new componentCtor(item.name, cacheId ?? item.name, item.arguments, { showImages: context.showImages, imageWidthCells: context.imageWidthCells }, toolDefinition, context.tui, context.cwd);
    taskCache.set(cacheId!, component);
    if (taskCache.size > DEFAULT_MAX_ITEMS) {
      const oldest = taskCache.keys().next().value;
      if (oldest !== undefined) taskCache.delete(oldest);
    }
  }
  return component;
}

/**
 * Wrap a compact-compliant definition so throwing `renderCall`/`renderResult` callbacks (or throwing
 * `.render()` methods) cannot fall through into Pi `ToolExecutionComponent.createResultFallback()`,
 * which emits `(N more lines, ctrl+o to expand)` hints.
 */
function safeCompliantDefinition(definition: Record<string, any>): Record<string, any> {
  const existing = safeCompliantDefinitionCache.get(definition);
  if (existing) return existing;
  const defHasMargin = isRecord(definition) && definition.compactLeftMargin === 1;

  const compactFallbackComponent = (linesProvider: (width: number) => string[]) => ({
    compactLeftMargin: 1,
    invalidate() {},
    render(width: number): string[] {
      if (!Number.isFinite(width) || width <= 0) return [];
      return linesProvider(width);
    },
  });

  const renderWithOnceMargin = (comp: any, width: number, fallback: (w: number) => string[]): string[] => {
    const safeWidth = Number.isFinite(width) ? Math.floor(width) : 0;
    if (safeWidth <= 0) return [];
    const hasMargin = defHasMargin || comp?.compactLeftMargin === 1;
    if (hasMargin) {
      const out = comp.render(safeWidth);
      return Array.isArray(out) ? out : fallback(safeWidth);
    }
    if (safeWidth === 1) {
      const probe = comp.render(2);
      if (!Array.isArray(probe)) return fallback(safeWidth);
      return probe.length > 0 ? [' '] : [];
    }
    const innerWidth = safeWidth - 1;
    const out = comp.render(innerWidth);
    if (!Array.isArray(out)) return fallback(safeWidth);
    return out.map((line) => formatMarginedLine(String(line), safeWidth, terminalVisibleWidth, terminalTruncateToWidth));
  };

  const wrapped: Record<string, any> = {
    ...definition,
    renderShell: 'self',
    compactToolRenderingVersion: COMPACT_TOOL_RENDERING_VERSION,
    compactLeftMargin: 1,
    renderCall(args: any, theme: any, ctx: any) {
      const fallback = (width: number) => {
        const safeWidth = Number.isFinite(width) ? Math.floor(width) : 0;
        if (safeWidth <= 0) return [];
        if (ctx?.state?.hasResult) return [];
        if (safeWidth === 1) return [' '];
        const innerWidth = safeWidth - 1;
        const name = definition.name || 'tool';
        if (name === 'bash') {
          const cmd = isRecord(args) && typeof args.command === 'string' ? args.command : undefined;
          const timeoutStatus = formatBashTimeoutFromArgs(args, Boolean(ctx?.executionStarted), undefined);
          const header = `${electric(ORANGE, 'bash')} ${ctx?.executionStarted ? 'running' : 'preparing'} ─ ${themeFg(theme, 'dim', timeoutStatus, DIM)}`;
          return [
            ...wrapBodyLineForWidth(header, innerWidth, safeWidth).map((l) => formatMarginedLine(l, safeWidth, terminalVisibleWidth, terminalTruncateToWidth)),
            ...orangeCommandLines(cmd, innerWidth, safeWidth).map((l) => formatMarginedLine(l, safeWidth, terminalVisibleWidth, terminalTruncateToWidth)),
          ];
        }
        const summary = toolArgumentSummary(name, args);
        const line = `${name} ${ctx?.executionStarted ? 'running' : 'preparing'}${summary ? ` ─ ${summary}` : ''}`;
        return wrapBodyLineForWidth(line, innerWidth, safeWidth).map((l) => formatMarginedLine(l, safeWidth, terminalVisibleWidth, terminalTruncateToWidth));
      };
      try {
        const comp = definition.renderCall(args, theme, ctx);
        if (!comp || typeof comp.render !== 'function') return comp;
        return {
          compactLeftMargin: 1,
          invalidate() { try { comp.invalidate?.(); } catch {} },
          render(width: number): string[] {
            if (!Number.isFinite(width) || width <= 0) return [];
            try {
              return renderWithOnceMargin(comp, width, fallback);
            } catch {
              return fallback(width);
            }
          },
        };
      } catch {
        return compactFallbackComponent(fallback);
      }
    },
    renderResult(result: any, opts: any, theme: any, ctx: any) {
      const fallback = (width: number) => {
        const name = definition.name || 'tool';
        const item: SubagentToolItem = {
          type: 'tool',
          name,
          arguments: ctx?.args,
          status: result?.isError || ctx?.isError ? 'failed' : opts?.isPartial ? 'partial' : 'completed',
          result: result && Array.isArray(result.content)
            ? { content: result.content, details: result.details, isError: Boolean(result.isError ?? ctx?.isError) }
            : undefined,
        };
        return compactToolRow(item, {
          cwd: ctx?.cwd ?? process.cwd(),
          visibleWidth: terminalVisibleWidth,
          truncateToWidth: terminalTruncateToWidth,
          toolOutputExpanded: Boolean(opts?.expanded),
          renderWidth: width,
        }, width);
      };
      try {
        const comp = definition.renderResult(result, opts, theme, ctx);
        if (!comp || typeof comp.render !== 'function') return comp;
        return {
          compactLeftMargin: 1,
          invalidate() { try { comp.invalidate?.(); } catch {} },
          render(width: number): string[] {
            if (!Number.isFinite(width) || width <= 0) return [];
            try {
              return renderWithOnceMargin(comp, width, fallback);
            } catch {
              return fallback(width);
            }
          },
        };
      } catch {
        return compactFallbackComponent(fallback);
      }
    },
  };
  safeCompliantDefinitionCache.set(definition, wrapped);
  return wrapped;
}

function renderToolItem(item: SubagentToolItem, context: SubagentThreadRenderContext, width: number, cached?: ThreadRenderEntry): string[] {
  const toolDefinition = renderableToolDefinition(item.name, [
    context.getToolDefinition?.(item.name),
    externalToolDefinitions.get(item.name),
    runtimeToolDefinition(context.taskId, item.name),
  ], context.cwd);
  const componentCtor = loadPiComponents()?.ToolExecutionComponent;
  // Only marked (compact-compliant) owner definitions delegate to the native component. Unmarked
  // definitions would re-enter Pi's default Box/background shell and expansion hint, so replay applies
  // this extension's own compact policy locally and never executes their rendering callbacks.
  if (typeof componentCtor === 'function' && context.tui && isCompactCompliantDefinition(toolDefinition)) {
    const safeDefinition = safeCompliantDefinition(toolDefinition as Record<string, any>);
    try {
      const componentSignature = JSON.stringify([item.name, item.arguments, context.showImages, context.imageWidthCells]);
      if (cached && (cached.componentSignature !== componentSignature || cached.toolDefinition !== toolDefinition || (!item.result && cached.hasResult))) {
        cached.component = undefined;
        cached.resultSignature = undefined;
        cached.expanded = undefined;
      }
      const component = cached
        ? (cached.component ?? new componentCtor(item.name, item.tool_call_id ?? item.id ?? item.name, item.arguments, { showImages: context.showImages, imageWidthCells: context.imageWidthCells }, safeDefinition, context.tui, context.cwd))
        : cachedToolComponent(item, context, componentCtor, safeDefinition);
      if (!cached?.component) {
        component.markExecutionStarted?.();
        component.setArgsComplete?.();
      }
      const resultSignature = JSON.stringify([item.status, item.result]);
      if (item.result && (!cached || cached.resultSignature !== resultSignature)) component.updateResult?.(item.result, item.status === 'partial');
      const expanded = context.toolOutputExpanded ?? false;
      if (!cached || cached.expanded !== expanded) component.setExpanded?.(expanded);
      if (cached) {
        cached.component = component;
        cached.componentSignature = componentSignature;
        cached.toolDefinition = toolDefinition;
        cached.resultSignature = resultSignature;
        cached.hasResult = Boolean(item.result);
        cached.expanded = expanded;
      }
      const rendered = renderComponent(component, width);
      if (rendered?.some((line) => line.trim())) return rendered;
      debugLog(context, 'tool_component_empty_fallback', { name: item.name, status: item.status, width, hasToolDefinition: Boolean(toolDefinition), hasTui: Boolean(context.tui) });
    } catch (error) { debugLog(context, 'tool_component_error_fallback', { error, name: item.name, status: item.status, width, hasToolDefinition: Boolean(toolDefinition), hasTui: Boolean(context.tui) }); }
  } else {
    debugLog(context, 'tool_component_unavailable_fallback', { name: item.name, status: item.status, hasComponentCtor: typeof componentCtor === 'function', hasToolDefinition: Boolean(toolDefinition), hasTui: Boolean(context.tui) });
  }
  const fallback = compactToolRow(item, context, width);
  debugLog(context, 'tool_fallback_rendered', { name: item.name, status: item.status, fallbackPreview: fallback.join('\n').slice(0, 1000) });
  return fallback;
}

const CMD_GRAPHEME_SEGMENTER = new Intl.Segmenter('en', { granularity: 'grapheme' });

function wrapExactCommandLine(rawLine: string, width: number, totalWidth = width + 1): string[] {
  const visual = rawLine.includes('\t') ? rawLine.replace(/\t/g, '   ') : rawLine;
  if (visual === '') return [''];
  if (terminalVisibleWidth(visual) <= width) return [visual];
  const allowWidth2Wide = totalWidth === 2;
  const out: string[] = [];
  let current = '';
  let currentWidth = 0;
  let chunkLimit = width;
  for (const { segment } of CMD_GRAPHEME_SEGMENTER.segment(visual)) {
    const gw = terminalVisibleWidth(segment);
    if (gw === 0) {
      current += segment;
      continue;
    }
    if (gw > width) {
      if (!allowWidth2Wide || gw > totalWidth) continue;
      if (currentWidth > 0) {
        out.push(current);
        current = '';
        currentWidth = 0;
      }
      chunkLimit = totalWidth;
      current += segment;
      currentWidth = gw;
      continue;
    }
    if (currentWidth + gw > chunkLimit && currentWidth > 0) {
      out.push(current);
      current = segment;
      currentWidth = gw;
      chunkLimit = width;
    } else {
      current += segment;
      currentWidth += gw;
    }
  }
  if (current !== '' || out.length === 0) out.push(current);
  return out;
}

/**
 * Wrap a bash command verbatim preserving leading/trailing spaces, tabs (3-col visual width),
 * real newlines, standalone CR and CRLF characters, consecutive blank lines, quotes, and literal
 * `\n` in the existing ORANGE foreground, without trimming, whitespace collapsing, or ellipsis.
 */
function orangeCommandLines(command: string | undefined, width: number, totalWidth = width + 1): string[] {
  if (width <= 0 || typeof command !== 'string' || command.length === 0) return [];
  const lines: string[] = [];
  for (const rawLine of command.split('\n')) {
    for (const chunk of wrapExactCommandLine(rawLine, width, totalWidth)) {
      lines.push(chunk === '' ? '' : electric(ORANGE, chunk));
    }
  }
  return lines;
}

function wrapBodyLineForWidth(rawLine: string, innerWidth: number, safeWidth: number): string[] {
  if (safeWidth === 2 && terminalVisibleWidth(rawLine) > innerWidth) {
    return wrapAnsiForWidth2(rawLine, terminalVisibleWidth);
  }
  return wrapLineToWidth(rawLine, innerWidth, safeWidth);
}

function formatSecondsShort(seconds: number): string {
  const rounded = Number.isInteger(seconds) ? seconds : Number(seconds.toFixed(1));
  return `${rounded}s`;
}

function formatBashTimeoutFromArgs(args: unknown, isRunning: boolean, startedAt?: string, nowMs = Date.now()): string {
  const rawTimeout = isRecord(args) ? args.timeout : undefined;
  if (typeof rawTimeout === 'number' && Number.isFinite(rawTimeout) && rawTimeout > 0) {
    const label = `timeout ${formatSecondsShort(rawTimeout)}`;
    if (isRunning && startedAt) {
      const startedMs = Date.parse(startedAt);
      if (Number.isFinite(startedMs)) {
        const elapsedSec = Math.max(0, Math.floor((nowMs - startedMs) / 1000));
        const remainingSec = Math.max(0, Math.ceil(rawTimeout - elapsedSec));
        return `${label} (${elapsedSec}s elapsed, ${remainingSec}s remaining)`;
      }
    }
    return label;
  }
  return 'no timeout';
}

function appendMutedWrappedLines(
  lines: string[],
  text: string,
  innerWidth: number,
  safeWidth: number,
  theme: any,
): void {
  for (const rawLine of text.split('\n')) {
    const alreadyAnsi = hasAnsiEscape(rawLine);
    for (const wrapped of wrapBodyLineForWidth(rawLine, innerWidth, safeWidth)) {
      const styled = !alreadyAnsi && wrapped.length > 0 ? themeFg(theme, 'muted', wrapped, MUTED) : wrapped;
      lines.push(formatMarginedLine(styled, safeWidth, terminalVisibleWidth, terminalTruncateToWidth));
    }
  }
}

/**
 * Local compact fallback for replay rows: automatic ANSI-aware wrapping without ellipsis clipping,
 * 1-column left margin (`width - 1`, `width <= 0 -> []`, `width === 1 -> [' ']`, omitting margin
 * only where necessary at total width 2 to fit an intact wide grapheme), muted plain-text expanded
 * body preserving existing ANSI, no frame, no background fill, and no generated expansion hint.
 * For `bash` specifically, renders the full command verbatim with real newlines and blank lines in
 * ORANGE and always displays truthful bash timeout status (`timeout Xs` with elapsed/remaining
 * while running, or `no timeout` when omitted).
 */
function compactToolRow(item: SubagentToolItem, context: SubagentThreadRenderContext, width = DEFAULT_RENDER_WIDTH): string[] {
  const safeWidth = Number.isFinite(width) ? Math.floor(width) : 0;
  if (safeWidth <= 0) return [];
  if (safeWidth === 1) return [' '];
  const innerWidth = safeWidth - 1;
  const details = item.result && isRecord(item.result.details) ? item.result.details : undefined;
  const state = details?.cancelled === true ? 'cancelled' : (item.result?.isError ? 'failed' : item.status);
  const isRunning = state === 'running' || state === 'pending' || state === 'partial';
  if (item.name === 'bash') {
    const command = isRecord(item.arguments) && typeof item.arguments.command === 'string' ? item.arguments.command : undefined;
    const timeoutText = formatBashTimeoutFromArgs(item.arguments, isRunning, item.started_at);
    const headerRaw = `${electric(ORANGE, 'bash')} ${state} ─ ${themeFg(context.theme, 'dim', timeoutText, DIM)}`;
    const lines = [
      ...wrapBodyLineForWidth(headerRaw, innerWidth, safeWidth).map((l) => formatMarginedLine(l, safeWidth, terminalVisibleWidth, terminalTruncateToWidth)),
      ...orangeCommandLines(command, innerWidth, safeWidth).map((l) => formatMarginedLine(l, safeWidth, terminalVisibleWidth, terminalTruncateToWidth)),
    ];
    if (!context.toolOutputExpanded) return lines;
    if (item.result) {
      const text = payloadText(item.result);
      if (text) appendMutedWrappedLines(lines, text, innerWidth, safeWidth, context.theme);
      const diff = typeof details?.diff === 'string' ? details.diff : undefined;
      if (diff?.trim()) {
        lines.push(` ${themeFg(context.theme, 'dim', 'diff:', DIM)}`);
        appendMutedWrappedLines(lines, diff, innerWidth, safeWidth, context.theme);
      }
    }
    return lines;
  }
  const args = toolArgumentSummary(item.name, item.arguments);
  const timeoutSuffix = item.name === 'powershell'
    ? ` ─ ${themeFg(context.theme, 'dim', formatBashTimeoutFromArgs(item.arguments, isRunning, item.started_at), DIM)}`
    : '';
  const header = `${item.name} ${state}${args ? ` ─ ${args}` : ''}${timeoutSuffix}`.trim();
  const lines = wrapBodyLineForWidth(header, innerWidth, safeWidth)
    .map((l) => formatMarginedLine(l, safeWidth, terminalVisibleWidth, terminalTruncateToWidth));
  if (!context.toolOutputExpanded) return lines;
  if (item.result) {
    const text = payloadText(item.result);
    if (text) appendMutedWrappedLines(lines, text, innerWidth, safeWidth, context.theme);
    const diff = typeof details?.diff === 'string' ? details.diff : undefined;
    if (diff?.trim()) {
      lines.push(` ${themeFg(context.theme, 'dim', 'diff:', DIM)}`);
      appendMutedWrappedLines(lines, diff, innerWidth, safeWidth, context.theme);
    }
  }
  return lines;
}

/** Orphan `tool_result` entries (no matching call row) use the same compact policy and 1-col margin. */
function compactToolResultRow(item: SubagentToolResultItem, context: SubagentThreadRenderContext, width = DEFAULT_RENDER_WIDTH): string[] {
  const safeWidth = Number.isFinite(width) ? Math.floor(width) : 0;
  if (safeWidth <= 0) return [];
  if (safeWidth === 1) return [' '];
  const innerWidth = safeWidth - 1;
  const state = item.result.isError ? 'failed' : 'completed';
  const header = `tool result${item.name ? ` ${item.name}` : ''} ─ ${state}`;
  const lines = wrapBodyLineForWidth(header, innerWidth, safeWidth)
    .map((l) => formatMarginedLine(l, safeWidth, terminalVisibleWidth, terminalTruncateToWidth));
  if (!context.toolOutputExpanded) return lines;
  const text = payloadText(item.result);
  if (text) appendMutedWrappedLines(lines, text, innerWidth, safeWidth, context.theme);
  return lines;
}

function renderBashItem(item: SubagentBashItem, context: SubagentThreadRenderContext, width: number, cached?: ThreadRenderEntry): string[] {
  const status = item.cancelled ? 'cancelled' : item.status ?? (item.exitCode && item.exitCode !== 0 ? 'failed' : 'completed');
  const adapted: SubagentToolItem = {
    type: 'tool',
    id: item.id,
    tool_call_id: item.tool_call_id,
    name: 'bash',
    arguments: { command: item.command, ...(item.timeout !== undefined ? { timeout: item.timeout } : {}) },
    started_at: item.started_at,
    ended_at: item.ended_at,
    status: status === 'cancelled' ? 'failed' : status === 'running' ? 'running' : status === 'failed' ? 'failed' : 'completed',
    result: item.output || item.exitCode !== undefined || item.fullOutputPath || item.truncated
      ? {
          content: item.output ? [{ type: 'text', text: item.output }] : [],
          details: { exitCode: item.exitCode, cancelled: item.cancelled, truncated: item.truncated, fullOutputPath: item.fullOutputPath, legacy_snapshot: true },
          isError: status === 'failed' || status === 'cancelled',
          preview: item.output,
        }
      : undefined,
  };
  return renderToolItem(adapted, context, width, cached);
}

function renderCustomItem(item: SubagentCustomItem, context: SubagentThreadRenderContext, width: number): string[] {
  const renderer = context.getMessageRenderer?.(item.customType);
  const componentCtor = loadPiComponents()?.CustomMessageComponent;
  if (typeof componentCtor === 'function' && renderer) {
    try {
      const markdownTheme = loadPiComponents()?.getMarkdownTheme?.() ?? context.theme;
      const component = new componentCtor({ type: item.customType, content: item.content, display: item.display }, renderer, markdownTheme);
      component.setExpanded?.(context.toolOutputExpanded ?? false);
      const rendered = renderComponent(component, width);
      if (rendered?.some((line) => line.trim())) return rendered;
    } catch (error) { debugLog(context, 'custom_component_error', { error, customType: item.customType, hasRenderer: Boolean(renderer) }); }
  }
  return [`custom ${item.customType}${item.fallbackText ? `: ${item.fallbackText}` : ''}`];
}

function renderItem(item: SubagentThreadItem, context: SubagentThreadRenderContext, width: number, cached?: ThreadRenderEntry): string[] {
  switch (item.type) {
    case 'attempt': return renderAttemptItem(item, context, width);
    case 'assistant': return renderAssistantItem(item, context, width, cached);
    case 'user': return renderUserItem(item, context, width, cached);
    case 'tool': return renderToolItem(item, context, width, cached);
    case 'tool_result': return compactToolResultRow(item, context, width);
    case 'bash': return renderBashItem(item, context, width, cached);
    case 'custom': return renderCustomItem(item, context, width);
    case 'status': return [`${item.severity ?? 'info'}: ${item.text}`];
    case 'error': return [`error: ${item.text}`];
  }
}

function isRenderableSnapshotRoot(value: unknown): value is { items: unknown[] } {
  return isRecord(value)
    && value.version === 1
    && ['events', 'session_messages', 'mixed'].includes(String(value.source))
    && Array.isArray(value.items);
}

function malformedItemText(item: unknown): string {
  if (isRecord(item) && typeof item.type === 'string') return `malformed thread item: ${item.type}`;
  return 'malformed thread item';
}

function closesLegacyAttempt(item: SubagentThreadItem): boolean {
  if (item.type === 'error') return true;
  if (item.type !== 'assistant') return false;
  const hasText = item.message.content.some((part) => part.type === 'text' && part.text.trim());
  const hasToolCall = item.message.content.some((part) => part.type === 'toolCall');
  return hasText && !hasToolCall;
}

function delegatedTaskText(text: string): string {
  const marker = '## delegated task';
  const index = text.lastIndexOf(marker);
  return index >= 0 ? text.slice(index + marker.length).trim() : text;
}

function normalizeLegacyAttemptPrefix(items: SubagentThreadItem[]): SubagentThreadItem[] {
  const users = items.filter((item): item is SubagentUserItem => item.type === 'user');
  const delegated = users.find((item) => item.label === 'delegated_task');
  const context = users.find((item) => item.label === 'context');
  const continuations = users.filter((item) => item.label === 'continuation');
  const supportedUsers = users.every((item) => item.label === 'delegated_task' || item.label === 'context' || item.label === 'continuation');
  if (!delegated || !supportedUsers) return items;

  const outputItems = items.filter((item) => item.type !== 'user');
  const chunks: SubagentThreadItem[][] = [];
  let current: SubagentThreadItem[] = [];
  for (const item of outputItems) {
    current.push(item);
    if (closesLegacyAttempt(item)) {
      chunks.push(current);
      current = [];
    }
  }
  if (current.length) chunks.push(current);

  const attemptCount = continuations.length + 1;
  while (chunks.length < attemptCount) chunks.push([]);
  if (chunks.length > attemptCount) return items;

  const normalized: SubagentThreadItem[] = [];
  for (let index = 0; index < attemptCount; index++) {
    const attempt = index + 1;
    normalized.push({ type: 'attempt', id: `attempt-${attempt}`, attempt });
    if (index === 0) {
      if (context) normalized.push(context);
      normalized.push({ ...delegated, text: delegatedTaskText(delegated.text) });
    } else {
      normalized.push(continuations[index - 1]!);
    }
    normalized.push(...chunks[index]!);
  }
  return normalized;
}

function normalizeAttemptItems(items: SubagentThreadItem[]): SubagentThreadItem[] {
  const firstAttempt = items.findIndex((item) => item.type === 'attempt');
  if (firstAttempt === 0) return items;
  if (firstAttempt < 0) return normalizeLegacyAttemptPrefix(items);
  return [...normalizeLegacyAttemptPrefix(items.slice(0, firstAttempt)), ...items.slice(firstAttempt)];
}

type ThreadRenderEntry = {
  signature?: string;
  component?: any;
  componentSignature?: string;
  toolDefinition?: unknown;
  resultSignature?: string;
  hasResult?: boolean;
  expanded?: boolean;
  /** Content revision of this item that produced `lines`; reused while it still matches. */
  itemRevision?: string;
  width?: number;
  lines?: string[];
};

type ThreadRenderCacheState = {
  contentStable: boolean;
  contextKey: string;
  rendererGeneration: number;
};

// Bumped whenever the set of renderable tool definitions can change, so per-item cache entries
// invalidate on renderer changes without re-resolving every definition to compare identities.
let toolRendererGeneration = 0;

export type PreparedThreadItem = {
  index: number;
  rawItem: unknown;
  attempt: number;
  itemKey: string;
};

export type PreparedThreadSnapshot = {
  items: PreparedThreadItem[];
  validKeys: Set<string>;
};

export function prepareNormalizedThreadSnapshot(snapshot: unknown): PreparedThreadSnapshot | undefined {
  if (!isRenderableSnapshotRoot(snapshot)) return undefined;
  const rawItems = normalizeAttemptItems(snapshot.items as SubagentThreadItem[]).slice(0, DEFAULT_MAX_ITEMS);
  const items: PreparedThreadItem[] = [];
  const validKeys = new Set<string>();
  let attempt = 1;
  for (let index = 0; index < rawItems.length; index += 1) {
    const rawItem: unknown = rawItems[index];
    if (isRecord(rawItem) && rawItem.type === 'attempt' && Number.isInteger(rawItem.attempt) && Number(rawItem.attempt) > 0) {
      attempt = Number(rawItem.attempt);
    }
    const itemId = isRecord(rawItem) && typeof rawItem.tool_call_id === 'string' && rawItem.tool_call_id
      ? rawItem.tool_call_id
      : (isRecord(rawItem) && typeof rawItem.id === 'string' && rawItem.id ? rawItem.id : `item-${index}`);
    const itemKey = `attempt-${attempt}:${itemId}`;
    validKeys.add(itemKey);
    items.push({ index, rawItem, attempt, itemKey });
  }
  return { items, validKeys };
}

// Owned by one panel, not by the task history. Retain only the selected bounded thread.
export class SubagentThreadRenderCache {
  private entries = new Map<string, ThreadRenderEntry>();
  private identity: unknown[] = [];
  private revision: string | undefined;
  private state: ThreadRenderCacheState = { contentStable: false, contextKey: '', rendererGeneration: -1 };

  clear(): void {
    this.entries.clear();
    this.identity = [];
    this.revision = undefined;
    this.state = { contentStable: false, contextKey: '', rendererGeneration: -1 };
  }

  /**
   * Start a frame. `revision` describes the whole rendered item content; when it is unchanged since
   * the previous frame plus the same width/expansion/renderer inputs, unchanged terminal items can
   * reuse their lines without re-encoding or re-rendering anything.
   */
  begin(context: SubagentThreadRenderContext, revision: string, contextKey: string): ThreadRenderCacheState {
    const identity = [context.taskId, context.cwd, context.theme, context.tui, loadPiComponents(), context.showImages, context.imageWidthCells];
    if (identity.some((value, index) => value !== this.identity[index])) this.clear();
    this.identity = identity;
    const contentStable = this.revision === revision;
    this.revision = revision;
    this.state = { contentStable, contextKey, rendererGeneration: toolRendererGeneration };
    return this.state;
  }

  beginViewport(context: SubagentThreadRenderContext, contextKey: string): ThreadRenderCacheState {
    const identity = [context.taskId, context.cwd, context.theme, context.tui, loadPiComponents(), context.showImages, context.imageWidthCells];
    if (identity.some((value, index) => value !== this.identity[index])) this.clear();
    this.identity = identity;
    this.revision = undefined;
    this.state = { contentStable: false, contextKey, rendererGeneration: toolRendererGeneration };
    return this.state;
  }

  entry(key: string): ThreadRenderEntry {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = {};
      this.entries.set(key, entry);
    }
    return entry;
  }

  prune(keys: Set<string>): void {
    for (const key of this.entries.keys()) if (!keys.has(key)) this.entries.delete(key);
  }

  pruneByItemKeys(validItemKeys: Set<string>): void {
    for (const key of this.entries.keys()) {
      const sep1 = key.indexOf(':');
      const sep2 = sep1 >= 0 ? key.indexOf(':', sep1 + 1) : -1;
      const itemKey = sep2 >= 0 ? key.slice(0, sep2) : key;
      if (!validItemKeys.has(itemKey)) this.entries.delete(key);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}

export function getSubagentToolRendererGeneration(): number {
  return toolRendererGeneration;
}

export function bumpSubagentToolRendererGeneration(): void {
  toolRendererGeneration += 1;
}

export function renderPreparedThreadItem(
  prepared: PreparedThreadItem,
  context: SubagentThreadRenderContext,
  width: number,
  cache?: SubagentThreadRenderCache,
  options?: { contentStable?: boolean; contextKey?: string },
): { lines: string[]; hasLiveTool: boolean; renderedKeys: string[] } {
  const lines: string[] = [];
  const renderedKeys: string[] = [];
  let hasLiveTool = false;
  const stableFrame = Boolean(options?.contentStable);
  const rawItem = prepared.rawItem;
  const key = prepared.itemKey;
  frameDebugEnabled = undefined;

  try {
    if (!isThreadItem(rawItem)) {
      lines.push(safeTruncate(context, malformedItemText(rawItem), width));
      return { lines, hasLiveTool, renderedKeys };
    }
    const item = boundItem(rawItem, DEFAULT_TEXT_LIMIT);
    let slot = 0;
    const emitItem = (displayItem: SubagentThreadItem, target?: SubagentThreadRenderTarget) => {
      const itemContext = target ? {
        ...context,
        ...(target.kind === 'tool'
          ? { toolOutputExpanded: context.isExpanded?.(target, context.toolOutputExpanded ?? false) ?? context.toolOutputExpanded }
          : { hideThinkingBlock: !(context.isExpanded?.(target, !(context.hideThinkingBlock ?? false)) ?? !(context.hideThinkingBlock ?? false)) }),
      } : context;
      const cacheKey = `${key}:${item.type}:${slot++}`;
      renderedKeys.push(cacheKey);
      const cached = cache?.entry(cacheKey);
      const nativeTool = displayItem.type === 'tool' || displayItem.type === 'bash';
      const isLiveTool = (displayItem.type === 'tool' && (displayItem.status === 'running' || displayItem.status === 'partial' || displayItem.status === 'pending'))
        || (displayItem.type === 'bash' && (displayItem.status === undefined || displayItem.status === 'running'));
      const reusableLines = !isLiveTool && displayItem.type !== 'custom';
      if (!reusableLines) hasLiveTool = true;
      const signature = [
        displayItem.type === 'assistant' && displayItem.message.content.some((part) => part.type === 'thinking') ? String(itemContext.hideThinkingBlock) : '',
        nativeTool ? String(itemContext.toolOutputExpanded) : '',
      ].join('|');
      const toolName = displayItem.type === 'bash' ? 'bash' : (displayItem.type === 'tool' ? displayItem.name : undefined);
      const currentDef = nativeTool && toolName ? renderableToolDefinition(toolName, [
        itemContext.getToolDefinition?.(toolName),
        externalToolDefinitions.get(toolName),
        runtimeToolDefinition(itemContext.taskId, toolName),
      ], itemContext.cwd) : undefined;
      const canReuseByFrame = stableFrame && Boolean(cached?.lines) && cached!.width === width;
      const itemRevision = !cache ? '' : canReuseByFrame ? cached!.itemRevision : contentRevision(displayItem);
      const staleContent = !canReuseByFrame && Boolean(cached) && cached!.itemRevision !== itemRevision;
      const rendererChanged = Boolean(cached) && nativeTool && cached!.toolDefinition !== currentDef;
      if (cached && (staleContent || rendererChanged || cached.signature !== signature)) {
        cached.lines = undefined;
        if (!nativeTool || rendererChanged) cached.component = undefined;
        cached.signature = signature;
      }
      if (cached) cached.toolDefinition = currentDef;
      const rendered = reusableLines && cached?.lines && cached.width === width
        && (canReuseByFrame || cached.itemRevision === itemRevision)
        ? cached.lines
        : wrapLinesToWidth(itemContext, renderItem(displayItem, itemContext, width, cached), width);
      if (cached && reusableLines) {
        cached.width = width;
        cached.itemRevision = itemRevision;
        cached.lines = rendered;
      }
      lines.push(...rendered);
      context.onItemRendered?.(item, rendered, target);
    };
    if (item.type === 'assistant' && context.onItemRendered) {
      let run: typeof item.message.content = [];
      let runKind: string | undefined;
      let runIndex = 0;
      const flush = () => {
        if (!run.length) return;
        emitItem({ ...item, message: { ...item.message, content: run, errorMessage: undefined } },
          runKind === 'thinking' ? { kind: 'thinking', key: `${key}:thinking-${runIndex}` } : undefined);
        run = [];
        runIndex++;
      };
      for (const part of item.message.content) {
        if (part.type === 'toolCall') { flush(); runKind = undefined; continue; }
        if (runKind !== part.type) flush();
        runKind = part.type;
        run.push(part);
      }
      flush();
      if (item.message.errorMessage) emitItem({ ...item, message: { ...item.message, content: [] } });
    } else {
      emitItem(item, item.type === 'tool' || item.type === 'bash' || item.type === 'custom' ? { kind: 'tool', key } : undefined);
    }
  } catch {
    lines.push(safeTruncate(context, 'thread item unavailable', width));
  }
  return { lines, hasLiveTool, renderedKeys };
}

export function renderThreadBody(snapshot: unknown, context: SubagentThreadRenderContext, cache?: SubagentThreadRenderCache): string[] {
  const prepared = prepareNormalizedThreadSnapshot(snapshot);
  if (!prepared) { cache?.clear(); return []; }
  if (context.renderWidth !== undefined && context.renderWidth <= 0) return [];
  const width = Math.max(1, Math.floor(context.renderWidth ?? DEFAULT_RENDER_WIDTH));
  const lines: string[] = [];
  const renderedKeys = new Set<string>();
  frameDebugEnabled = undefined;
  const revision = cache ? contentRevision(prepared.items.map((entry) => entry.rawItem)) : '';
  const contextKey = [
    width,
    context.toolOutputExpanded ? 'tool-expanded' : 'tool-collapsed',
    context.hideThinkingBlock ? 'thinking-hidden' : 'thinking-visible',
    context.showImages ? 'images' : 'no-images',
    context.imageWidthCells ?? '',
    context.cwd,
  ].join('|');
  const cacheState = cache?.begin(context, revision, contextKey);
  const stableFrame = Boolean(cacheState?.contentStable) && cacheState?.contextKey === contextKey;
  for (const entry of prepared.items) {
    const result = renderPreparedThreadItem(entry, context, width, cache, { contentStable: stableFrame, contextKey });
    lines.push(...result.lines);
    for (const k of result.renderedKeys) renderedKeys.add(k);
  }
  cache?.prune(renderedKeys);
  return lines;
}
