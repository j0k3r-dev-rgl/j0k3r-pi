import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { writeSubagentsDebugLog } from './debug.js';
import { visibleWidth as terminalVisibleWidth, wrapLineToWidth } from './render/text-width.js';

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
  return payload.preview || payload.content.map((part) => part.text || part.data || '').filter(Boolean).join('\n');
}

function jsonPreview(value: unknown, limit = 240): string {
  if (value === undefined) return '';
  let text: string;
  try { text = JSON.stringify(value); } catch { text = String(value); }
  return boundText(text, limit) ?? '';
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
}

export function registerSubagentExternalToolDefinition(name: string | undefined, definition: unknown): void {
  if (!name || !definition) return;
  externalToolDefinitions.set(name, definition);
  toolComponentCacheByTask.clear();
}

function hasToolRenderer(definition: unknown): boolean {
  return isRecord(definition) && (typeof definition.renderCall === 'function' || typeof definition.renderResult === 'function' || definition.renderShell === 'self');
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

function debugLog(context: Pick<SubagentThreadRenderContext, 'cwd'> | undefined, scope: string, data: unknown): void {
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

function truncateLines(context: SubagentThreadRenderContext, lines: string[], width = DEFAULT_RENDER_WIDTH): string[] {
  const out: string[] = [];
  for (const line of lines) out.push(fitsWidth(context, line, width) ? line : context.truncateToWidth(line, width));
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

const builtInToolDefinitionCache = new Map<string, unknown>();
const externalToolDefinitions = new Map<string, unknown>();
const externalToolSourcesLoaded = new Set<string>();
const runtimeToolDefinitionsByTask = new Map<string, Map<string, unknown>>();
const toolComponentCacheByTask = new Map<string, Map<string, unknown>>();

export function registerSubagentRuntimeToolDefinition(taskId: string | undefined, name: string | undefined, definition: unknown): void {
  if (!taskId || !name || !definition) return;
  let byName = runtimeToolDefinitionsByTask.get(taskId);
  if (!byName) {
    byName = new Map<string, unknown>();
    runtimeToolDefinitionsByTask.set(taskId, byName);
  }
  byName.set(name, definition);
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
  if (name === 'bash') return argString(input.command).split('\n')[0] ?? '';
  if (name.startsWith('memory_')) return memoryArgumentSummary(name, input);
  if (['grep', 'find', 'ls'].includes(name)) return [argString(input.pattern ?? input.query ?? input.name), argString(input.path ?? input.cwd)].filter(Boolean).join(' · ');
  return jsonPreview(args);
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
  }
  let component = taskCache.get(cacheId!);
  if (!component) {
    component = new componentCtor(item.name, cacheId ?? item.name, item.arguments, { showImages: context.showImages, imageWidthCells: context.imageWidthCells }, toolDefinition, context.tui, context.cwd);
    taskCache.set(cacheId!, component);
  }
  return component;
}

function renderToolItem(item: SubagentToolItem, context: SubagentThreadRenderContext, width: number, cached?: ThreadRenderEntry): string[] {
  const toolDefinition = renderableToolDefinition(item.name, [
    context.getToolDefinition?.(item.name),
    externalToolDefinitions.get(item.name),
    runtimeToolDefinition(context.taskId, item.name),
  ], context.cwd);
  const componentCtor = loadPiComponents()?.ToolExecutionComponent;
  if (typeof componentCtor === 'function' && context.tui && toolDefinition) {
    try {
      const componentSignature = JSON.stringify([item.name, item.arguments, context.showImages, context.imageWidthCells]);
      if (cached && (cached.componentSignature !== componentSignature || cached.toolDefinition !== toolDefinition || (!item.result && cached.hasResult))) {
        cached.component = undefined;
        cached.resultSignature = undefined;
        cached.expanded = undefined;
      }
      const component = cached
        ? (cached.component ?? new componentCtor(item.name, item.tool_call_id ?? item.id ?? item.name, item.arguments, { showImages: context.showImages, imageWidthCells: context.imageWidthCells }, toolDefinition, context.tui, context.cwd))
        : cachedToolComponent(item, context, componentCtor, toolDefinition);
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
  const result = item.result ? payloadText(item.result) : '';
  const args = toolArgumentSummary(item.name, item.arguments);
  const state = item.result?.isError ? 'failed' : item.status;
  const resultLines = result.split('\n');
  const visibleResult = context.toolOutputExpanded ? resultLines : resultLines.slice(0, 10);
  const fallback = [`${item.name} ${state}${args ? ` · ${args}` : ''}`, ...(result ? visibleResult : []),
    !context.toolOutputExpanded && resultLines.length > 10 ? '(click to expand)' : '',
  ].filter(Boolean);
  debugLog(context, 'tool_fallback_rendered', { name: item.name, status: item.status, fallbackPreview: fallback.join('\n').slice(0, 1000) });
  return fallback;
}

function renderBashItem(item: SubagentBashItem, context: SubagentThreadRenderContext, width: number, cached?: ThreadRenderEntry): string[] {
  const status = item.cancelled ? 'cancelled' : item.status ?? (item.exitCode && item.exitCode !== 0 ? 'failed' : 'completed');
  const adapted: SubagentToolItem = {
    type: 'tool',
    id: item.id,
    tool_call_id: item.tool_call_id,
    name: 'bash',
    arguments: { command: item.command },
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
    case 'tool_result': return [`tool result${item.name ? ` ${item.name}` : ''}${item.result.isError ? ' failed' : ''}`, payloadText(item.result)].filter(Boolean);
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
  width?: number;
  lines?: string[];
};

// Owned by one panel, not by the task history. Retain only the selected bounded thread.
export class SubagentThreadRenderCache {
  private entries = new Map<string, ThreadRenderEntry>();
  private identity: unknown[] = [];

  clear(): void {
    this.entries.clear();
    this.identity = [];
  }

  begin(context: SubagentThreadRenderContext): void {
    const identity = [context.taskId, context.cwd, context.theme, context.tui, loadPiComponents(), context.showImages, context.imageWidthCells];
    if (identity.some((value, index) => value !== this.identity[index])) this.clear();
    this.identity = identity;
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
}

export function renderThreadBody(snapshot: unknown, context: SubagentThreadRenderContext, cache?: SubagentThreadRenderCache): string[] {
  if (!isRenderableSnapshotRoot(snapshot)) { cache?.clear(); return []; }
  const width = Math.max(1, Math.floor(context.renderWidth ?? DEFAULT_RENDER_WIDTH));
  const lines: string[] = [];
  const renderedKeys = new Set<string>();
  cache?.begin(context);
  let attempt = 1;
  for (const [index, rawItem] of normalizeAttemptItems(snapshot.items as SubagentThreadItem[]).slice(0, DEFAULT_MAX_ITEMS).entries()) {
    try {
      if (!isThreadItem(rawItem)) {
        lines.push(safeTruncate(context, malformedItemText(rawItem), width));
        continue;
      }
      const item = boundItem(rawItem, DEFAULT_TEXT_LIMIT);
      if (item.type === 'attempt') attempt = item.attempt;
      const itemId = 'tool_call_id' in item && item.tool_call_id ? item.tool_call_id : ('id' in item && item.id ? item.id : `item-${index}`);
      const key = `attempt-${attempt}:${itemId}`;
      let slot = 0;
      const emitItem = (displayItem: SubagentThreadItem, target?: SubagentThreadRenderTarget) => {
        const itemContext = target ? {
          ...context,
          ...(target.kind === 'tool'
            ? { toolOutputExpanded: context.isExpanded?.(target, context.toolOutputExpanded ?? false) ?? context.toolOutputExpanded }
            : { hideThinkingBlock: !(context.isExpanded?.(target, !(context.hideThinkingBlock ?? false)) ?? !(context.hideThinkingBlock ?? false)) }),
        } : context;
        const cacheKey = `${key}:${item.type}:${slot++}`;
        renderedKeys.add(cacheKey);
        const cached = cache?.entry(cacheKey);
        const nativeTool = displayItem.type === 'tool' || displayItem.type === 'bash';
        const reusableLines = !nativeTool && displayItem.type !== 'custom';
        const signature = JSON.stringify([displayItem, displayItem.type === 'assistant' && displayItem.message.content.some((part) => part.type === 'thinking') ? itemContext.hideThinkingBlock : undefined]);
        if (cached && cached.signature !== signature) {
          cached.lines = undefined;
          if (!nativeTool) cached.component = undefined;
          cached.signature = signature;
        }
        // Tools still render on each frame: native loaders and asynchronous image updates stay live.
        const rendered = reusableLines && cached?.lines && cached.width === width
          ? cached.lines
          : truncateLines(itemContext, renderItem(displayItem, itemContext, width, cached), width);
        if (cached && reusableLines) {
          cached.width = width;
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
  }
  cache?.prune(renderedKeys);
  return lines;
}
