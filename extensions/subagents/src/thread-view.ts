import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { writeSubagentsDebugLog } from './debug.js';

import type {
  SubagentAssistantItem,
  SubagentBashItem,
  SubagentCustomItem,
  SubagentErrorItem,
  SubagentStatusItem,
  SubagentThreadItem,
  SubagentThreadRenderContext,
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
    case 'assistant': return isAssistantItem(value);
    case 'user': return typeof value.text === 'string' && (value.label === undefined || ['delegated_task', 'context', 'prompt', 'user'].includes(String(value.label)));
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

function boundPayload(payload: SubagentToolResultPayload, limit: number): SubagentToolResultPayload {
  return {
    ...payload,
    preview: boundText(payload.preview, limit),
    content: payload.content.map((part) => ({ ...part, text: boundText(part.text, limit), data: boundText(part.data, limit) })),
  };
}

function boundItem(item: SubagentThreadItem, limit: number): SubagentThreadItem {
  switch (item.type) {
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
    case 'tool': return { ...item, result: item.result ? boundPayload(item.result, limit) : undefined };
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
  return { ...value, items: value.items.slice(0, maxItems).map((item) => boundItem(item, limit)) };
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

export function resetPiComponentCacheForTests(): void {
  piComponents = undefined;
  builtInToolDefinitionCache.clear();
}

function loadPiComponents(): Record<string, any> | undefined {
  if (piComponents !== undefined) return piComponents;
  const candidates = [
    () => require('@earendil-works/pi-coding-agent') as Record<string, any>,
    () => {
      const entrypoint = runningPiEntrypoint();
      if (!entrypoint) return undefined;
      return createRequire(entrypoint)('@earendil-works/pi-coding-agent') as Record<string, any>;
    },
    () => {
      const packageRoot = findRunningPiPackageRoot();
      return packageRoot ? require(packageRoot) as Record<string, any> : undefined;
    },
  ];
  for (const candidate of candidates) {
    try {
      const loaded = candidate();
      if (loaded) {
        piComponents = loaded;
        return piComponents;
      }
    } catch {}
  }
  return undefined;
}

function debugLog(context: Pick<SubagentThreadRenderContext, 'cwd'> | undefined, scope: string, data: unknown): void {
  writeSubagentsDebugLog(context?.cwd, scope, data);
}

function renderComponent(component: unknown, width: number): string[] | undefined {
  if (!component || typeof (component as any).render !== 'function') return undefined;
  const lines = (component as any).render(width);
  return Array.isArray(lines) ? lines.filter((line): line is string => typeof line === 'string') : undefined;
}

const TERMINAL_ESCAPE_RE = /\u001b\][^\u001b\u0007]*(?:\u001b\\|\u0007)|\u001b\[[0-?]*[ -/]*[@-~]/g;

function terminalVisibleWidth(text: string): number {
  return [...text.replace(TERMINAL_ESCAPE_RE, '')].length;
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

function assistantText(item: SubagentAssistantItem): string[] {
  const lines: string[] = [];
  for (const part of item.message.content) {
    if (part.type === 'text' && part.text.trim()) lines.push(part.text);
    else if (part.type === 'thinking' && (part.thinking ?? part.text)?.trim()) lines.push(`thinking: ${part.thinking ?? part.text}`);
    // Tool calls are rendered as separate tool rows, matching Pi's main thread composition.
  }
  if (item.message.errorMessage) lines.push(`error: ${item.message.errorMessage}`);
  return lines;
}

function renderAssistantItem(item: SubagentAssistantItem, context: SubagentThreadRenderContext, width: number): string[] {
  const visibleContent = item.message.content.filter((part) => part.type !== 'toolCall');
  if (!visibleContent.length && !item.message.errorMessage) return [];
  const displayItem: SubagentAssistantItem = visibleContent.length === item.message.content.length
    ? item
    : { ...item, message: { ...item.message, content: visibleContent } };
  const componentCtor = loadPiComponents()?.AssistantMessageComponent;
  if (typeof componentCtor === 'function') {
    try {
      const markdownTheme = loadPiComponents()?.getMarkdownTheme?.() ?? context.theme;
      const rendered = renderComponent(new componentCtor(displayItem.message, false, markdownTheme, 'Thinking...'), width);
      if (rendered?.some((line) => line.trim())) return rendered;
    } catch (error) { debugLog(context, 'assistant_component_error', { error }); }
  }
  return assistantText(displayItem);
}

function renderUserItem(item: SubagentUserItem, context: SubagentThreadRenderContext, width: number): string[] {
  const componentCtor = loadPiComponents()?.UserMessageComponent;
  if (typeof componentCtor === 'function') {
    try {
      const markdownTheme = loadPiComponents()?.getMarkdownTheme?.() ?? context.theme;
      const rendered = renderComponent(new componentCtor(item.text, markdownTheme), width);
      if (rendered?.some((line) => line.trim())) return rendered;
    } catch (error) { debugLog(context, 'user_component_error', { error, label: item.label }); }
  }
  return [`${item.label ?? 'user'}: ${item.text}`];
}

const builtInToolDefinitionCache = new Map<string, unknown>();

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

function renderToolItem(item: SubagentToolItem, context: SubagentThreadRenderContext, width: number): string[] {
  const toolDefinition = context.getToolDefinition?.(item.name) ?? builtInToolDefinition(item.name, context.cwd);
  const componentCtor = loadPiComponents()?.ToolExecutionComponent;
  if (typeof componentCtor === 'function' && context.tui && toolDefinition) {
    try {
      const component = new componentCtor(item.name, item.tool_call_id ?? item.id ?? item.name, item.arguments, { showImages: context.showImages, imageWidthCells: context.imageWidthCells }, toolDefinition, context.tui, context.cwd);
      component.markExecutionStarted?.();
      component.setArgsComplete?.();
      if (item.result) component.updateResult?.(item.result, item.status === 'partial');
      component.setExpanded?.(context.toolOutputExpanded ?? false);
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
  const fallback = [`${item.name} ${state}${args ? ` · ${args}` : ''}`, ...(result ? [result] : [])];
  debugLog(context, 'tool_fallback_rendered', { name: item.name, status: item.status, fallbackPreview: fallback.join('\n').slice(0, 1000) });
  return fallback;
}

function renderBashItem(item: SubagentBashItem, context: SubagentThreadRenderContext, width: number): string[] {
  const componentCtor = loadPiComponents()?.BashExecutionComponent;
  if (typeof componentCtor === 'function' && context.tui) {
    try {
      const component = new componentCtor(item.command, context.tui, true);
      if (item.output) component.appendOutput?.(item.output);
      if (item.status !== 'running') component.setComplete?.(item.exitCode, item.cancelled ?? item.status === 'cancelled', item.truncated ? { truncated: true } : undefined, item.fullOutputPath);
      component.setExpanded?.(context.toolOutputExpanded ?? false);
      const rendered = renderComponent(component, width);
      if (rendered?.some((line) => line.trim())) return rendered;
    } catch (error) { debugLog(context, 'bash_component_error', { error, command: item.command.slice(0, 200), status: item.status, hasTui: Boolean(context.tui) }); }
  }
  const status = item.cancelled ? 'cancelled' : item.status ?? (item.exitCode && item.exitCode !== 0 ? 'failed' : 'completed');
  const exit = item.exitCode === undefined ? '' : ` exit:${item.exitCode}`;
  return [`bash ${status}${exit}: ${item.command}`, item.output ?? ''].filter(Boolean);
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

function renderItem(item: SubagentThreadItem, context: SubagentThreadRenderContext, width: number): string[] {
  switch (item.type) {
    case 'assistant': return renderAssistantItem(item, context, width);
    case 'user': return renderUserItem(item, context, width);
    case 'tool': return renderToolItem(item, context, width);
    case 'tool_result': return [`tool result${item.name ? ` ${item.name}` : ''}${item.result.isError ? ' failed' : ''}`, payloadText(item.result)].filter(Boolean);
    case 'bash': return renderBashItem(item, context, width);
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

export function renderThreadBody(snapshot: unknown, context: SubagentThreadRenderContext): string[] {
  if (!isRenderableSnapshotRoot(snapshot)) return [];
  const width = Math.max(1, Math.floor(context.renderWidth ?? DEFAULT_RENDER_WIDTH));
  const lines: string[] = [];
  for (const rawItem of snapshot.items.slice(0, DEFAULT_MAX_ITEMS)) {
    try {
      if (!isThreadItem(rawItem)) {
        lines.push(safeTruncate(context, malformedItemText(rawItem), width));
        continue;
      }
      const item = boundItem(rawItem, DEFAULT_TEXT_LIMIT);
      lines.push(...truncateLines(context, renderItem(item, context, width), width));
    } catch {
      lines.push(safeTruncate(context, 'thread item unavailable', width));
    }
  }
  return lines;
}
