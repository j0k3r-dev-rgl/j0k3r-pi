import { keyHint, type Theme } from '@earendil-works/pi-coding-agent';
import type { Component } from '@earendil-works/pi-tui';

export interface ToolResultLike {
  content?: Array<{ type?: string; text?: string }>;
  details?: Record<string, any>;
  isError?: boolean;
}

export interface Context7RenderOptions {
  expanded?: boolean;
  isPartial?: boolean;
}

export const RESET = '\x1b[0m';
export const CYAN = '\x1b[1;38;2;0;229;255m';
export const LIME = '\x1b[1;38;2;102;255;102m';
export const RED = '\x1b[1;38;2;255;77;109m';
export const DIM = '\x1b[2m';
export const BOLD = '\x1b[1m';

const ANSI_REGEX = /\x1b\[[0-9;]*[a-zA-Z]/g;

export function stripAnsi(str: string): string {
  return str.replace(ANSI_REGEX, '');
}

export function visibleWidth(str: string): number {
  return stripAnsi(str).length;
}

export function truncateWithAnsi(str: string, maxWidth: number): string {
  if (maxWidth <= 0) return '';
  if (visibleWidth(str) <= maxWidth) return str;

  let visible = 0;
  let result = '';
  const ansiTokenRegex = /^\x1b\[[0-9;]*[a-zA-Z]/;
  let i = 0;

  while (i < str.length && visible < maxWidth) {
    const match = str.slice(i).match(ansiTokenRegex);
    if (match) {
      result += match[0];
      i += match[0].length;
    } else {
      result += str[i];
      visible++;
      i++;
    }
  }

  result += RESET;
  return result;
}

export function fit(text: string, width: number): string {
  return truncateWithAnsi(text, Math.max(0, width));
}

export function pad(text: string, width: number): string {
  const fitted = fit(text, width);
  const vis = visibleWidth(fitted);
  return fitted + ' '.repeat(Math.max(0, width - vis));
}

export function boxLine(content: string, innerWidth: number, borderColor: string = CYAN): string {
  const innerContentWidth = Math.max(0, innerWidth - 2);
  return `${borderColor}│${RESET} ${pad(content, innerContentWidth)} ${borderColor}│${RESET}`;
}

export function cardTopBorder(
  toolName: string,
  actionOrTarget: string | undefined,
  innerWidth: number,
  borderColor: string = CYAN,
  titleColor: string = borderColor,
): string {
  const cleanAction = actionOrTarget ? actionOrTarget.replace(/[\r\n]+/g, ' ').trim() : undefined;
  let label = cleanAction ? `${toolName} [${cleanAction}]` : toolName;

  const maxTitleWidth = Math.max(4, innerWidth - 4);
  if (visibleWidth(label) + 2 > maxTitleWidth && cleanAction) {
    const maxActionWidth = Math.max(3, maxTitleWidth - visibleWidth(toolName) - 5);
    const truncatedAction = fit(cleanAction, maxActionWidth);
    label = `${toolName} [${truncatedAction}]`;
  }

  let titleText = ` ${label} `;
  if (visibleWidth(titleText) > innerWidth) {
    titleText = ` ${fit(label, Math.max(1, innerWidth - 2))} `;
  }

  const rest = Math.max(0, innerWidth - visibleWidth(titleText));
  const leftDash = Math.min(2, rest);
  const rightDash = Math.max(0, rest - leftDash);
  return `${borderColor}╭${'─'.repeat(leftDash)}${RESET}${titleColor}${titleText}${RESET}${borderColor}${'─'.repeat(rightDash)}╮${RESET}`;
}

export function cardBottomBorder(innerWidth: number, borderColor: string = CYAN): string {
  return `${borderColor}╰${'─'.repeat(Math.max(0, innerWidth))}╯${RESET}`;
}

export function frameContent(
  lines: string[],
  innerWidth: number,
  borderColor: string = CYAN,
): string[] {
  const framed: string[] = [];
  for (const rawLine of lines) {
    const subLines = rawLine.split(/\r?\n/);
    for (const sub of subLines) {
      framed.push(boxLine(sub, innerWidth, borderColor));
    }
  }
  return framed;
}

function clip(value: unknown, maxChars = 100): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}

function title(toolName: string, theme?: Theme): string {
  if (!theme) return toolName;
  return theme.fg('toolTitle', theme.bold(toolName));
}

function getKeyHint(theme: any, action: 'expand' | 'collapse'): string {
  const key = theme?.keybinding?.('app.tools.expand') ?? 'ctrl+o';
  return `${DIM}${key} to ${action}${RESET}`;
}

function warningCount(details: Record<string, any>): string | undefined {
  const count = Array.isArray(details.warnings) ? details.warnings.length : 0;
  return count > 0 ? `${count} warning${count === 1 ? '' : 's'}` : undefined;
}

function cacheState(cache: any): string | undefined {
  if (!cache || typeof cache !== 'object') return undefined;
  if ('enabled' in cache) {
    if (!cache.enabled) return 'cache off';
    return cache.hit ? 'cache hit' : 'cache miss';
  }
  const entries = Object.values(cache).filter((entry) => entry && typeof entry === 'object') as Array<any>;
  if (entries.length === 0) return undefined;
  if (entries.every((entry) => !entry.enabled)) return 'cache off';
  if (entries.some((entry) => entry.enabled && !entry.hit)) return 'cache miss';
  if (entries.some((entry) => entry.enabled && entry.hit)) return 'cache hit';
  return undefined;
}

function resultText(result: ToolResultLike): string {
  return (result.content ?? [])
    .filter((part) => part?.type === 'text')
    .map((part) => part.text ?? '')
    .join('\n');
}

function requestIdentity(toolName: string, args: Record<string, unknown>): string[] {
  if (toolName === 'context7_status') return [];
  if (toolName === 'context7_search_library') {
    return [clip(args.libraryName, 60), clip(args.query, 100)].filter(Boolean);
  }
  if (toolName === 'context7_get_context') {
    return [clip(args.libraryId, 80), clip(args.query, 100)].filter(Boolean);
  }
  if (toolName === 'context7_resolve_and_get_context') {
    const library = args.version ? `${clip(args.libraryName, 60)}@${clip(args.version, 30)}` : clip(args.libraryName, 60);
    return [library, clip(args.query, 100)].filter(Boolean);
  }
  return [];
}

export function toolActionBadge(toolName: string, args: Record<string, unknown>): string | undefined {
  if (toolName === 'context7_status') return 'status';
  const identity = requestIdentity(toolName, args);
  return identity.length > 0 ? identity.join(' · ') : undefined;
}

function statusSummary(details: Record<string, any>): string[] {
  return [
    details.sdkAvailable === false ? 'unavailable' : 'ready',
    details.apiKeyPresent ? 'API key configured' : 'API key missing',
    cacheState(details.cache),
    warningCount(details),
  ].filter(Boolean) as string[];
}

function searchSummary(details: Record<string, any>): string[] {
  const results = Array.isArray(details.results) ? details.results : [];
  const count = typeof details.count === 'number' ? details.count : results.length;
  const firstId = results.find((candidate: any) => candidate?.id)?.id;
  return [
    `${count} candidate${count === 1 ? '' : 's'}`,
    firstId ? `top ${clip(firstId, 80)}` : undefined,
    cacheState(details.cache),
    warningCount(details),
  ].filter(Boolean) as string[];
}

function documentationSummary(details: Record<string, any>): string[] {
  const documentation = details.documentation ?? {};
  const snippets = Array.isArray(documentation.snippets) ? documentation.snippets : [];
  const sources = Array.isArray(documentation.sources) ? documentation.sources : [];
  const textChars = typeof documentation.text === 'string' ? documentation.text.length : undefined;
  return [
    clip(documentation.libraryId ?? details.request?.libraryId ?? '<unknown library>', 80),
    documentation.type === 'txt'
      ? `${textChars ?? 0} chars`
      : `${snippets.length} snippet${snippets.length === 1 ? '' : 's'}`,
    sources.length > 0 ? `${sources.length} source${sources.length === 1 ? '' : 's'}` : undefined,
    details.truncation?.truncated ? 'bounded · full artifact available' : undefined,
    cacheState(details.cache),
    warningCount(details),
  ].filter(Boolean) as string[];
}

function resolveSummary(details: Record<string, any>): string[] {
  const status = String(details.status ?? 'selected');
  const candidates = Array.isArray(details.candidates) ? details.candidates : [];
  const selectedId = details.selected?.id;
  const documentation = details.documentation;
  const snippets = Array.isArray(documentation?.snippets) ? documentation.snippets : [];
  return [
    status,
    selectedId ? clip(selectedId, 80) : undefined,
    status === 'ambiguous' ? `${candidates.length} candidates` : undefined,
    status === 'selected' && documentation?.type === 'json'
      ? `${snippets.length} snippet${snippets.length === 1 ? '' : 's'}`
      : undefined,
    details.truncation?.truncated ? 'bounded · full artifact available' : undefined,
    cacheState(details.cache),
    warningCount(details),
  ].filter(Boolean) as string[];
}

function compactSummary(toolName: string, result: ToolResultLike, theme?: Theme): string {
  const details = result.details ?? {};
  let parts: string[];
  if (result.isError) parts = ['error'];
  else if (toolName === 'context7_status') parts = statusSummary(details);
  else if (toolName === 'context7_search_library') parts = searchSummary(details);
  else if (toolName === 'context7_get_context') parts = documentationSummary(details);
  else if (toolName === 'context7_resolve_and_get_context') parts = resolveSummary(details);
  else parts = ['result'];
  const identity = requestIdentity(toolName, details.request ?? {});
  const summaryParts = [...identity, ...parts].filter((part, index, values) => part && values.indexOf(part) === index);
  return `${title(toolName, theme)} · ${summaryParts.join(' · ')}`;
}

function wrapLineToWidth(text: string, width: number): string[] {
  if (width <= 0) return [''];
  if (!text) return [''];
  if (visibleWidth(text) <= width) return [text];

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];

  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (visibleWidth(word) > width) {
      if (current) {
        lines.push(current);
        current = '';
      }
      let rem = word;
      while (visibleWidth(rem) > width) {
        const chunk = fit(rem, width);
        lines.push(chunk);
        const chunkStripped = stripAnsi(chunk);
        let remIdx = 0;
        let counted = 0;
        while (remIdx < rem.length && counted < chunkStripped.length) {
          const m = rem.slice(remIdx).match(/^\x1b\[[0-9;]*[a-zA-Z]/);
          if (m) {
            remIdx += m[0].length;
          } else {
            remIdx++;
            counted++;
          }
        }
        rem = rem.slice(remIdx);
        if (remIdx === 0) break;
      }
      if (rem) {
        current = rem;
      }
      continue;
    }

    if (!current) {
      current = word;
      continue;
    }

    const candidate = `${current} ${word}`;
    if (visibleWidth(candidate) <= width) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }

  if (current) lines.push(current);
  return lines;
}

export function renderContext7ToolCall(
  toolName: string,
  args: Record<string, unknown>,
  _theme?: Theme,
  context?: any,
): Component {
  return {
    invalidate() {},
    render(width: number): string[] {
      if (width <= 0) return [];
      const actionBadge = toolActionBadge(toolName, args);

      if (width < 24) {
        return [fit(actionBadge ? `${toolName} [${actionBadge}]` : toolName, width)];
      }

      const innerWidth = Math.max(0, width - 2);
      const state = context?.state;
      const isError = Boolean(context?.isError);
      const borderColor = state?.borderColor ?? (isError ? RED : CYAN);
      const topBorder = cardTopBorder(toolName, actionBadge, innerWidth, borderColor, borderColor);

      if (state?.hasResult) {
        return [topBorder];
      }

      const pendingDetail = actionBadge ? `Pending: ${actionBadge}` : 'Pending...';
      const pendingLine = `${CYAN}●${RESET} ${pendingDetail}`;

      return [
        topBorder,
        boxLine(pendingLine, innerWidth, borderColor),
        cardBottomBorder(innerWidth, borderColor),
      ];
    },
  };
}

export function renderContext7ToolResult(
  toolName: string,
  result: ToolResultLike,
  options: Context7RenderOptions = {},
  theme?: Theme,
  context?: any,
): Component {
  const isError = Boolean(context?.isError || result.isError || result.details?.error || result.details?.sdkAvailable === false);
  const borderColor = isError ? RED : LIME;

  if (context?.state) {
    context.state.hasResult = true;
    context.state.borderColor = borderColor;
  }

  return {
    invalidate() {},
    render(width: number): string[] {
      if (width <= 0) return [];

      const isExpanded = options?.expanded === true;
      const keyHint = getKeyHint(theme, isExpanded ? 'collapse' : 'expand');
      const bodyLines: string[] = [];

      if (options?.isPartial) {
        bodyLines.push(`${title(toolName, theme)} · running…`);
      } else if (isError) {
        const errorMsg = (result.details?.error?.message ?? result.details?.error ?? resultText(result)) || 'tool failed';
        bodyLines.push(`${RED}Error: ${stripAnsi(String(errorMsg))}${RESET}`);
        bodyLines.push(keyHint);
      } else if (!isExpanded) {
        bodyLines.push(compactSummary(toolName, result, theme));
        bodyLines.push(keyHint);
      } else {
        bodyLines.push(compactSummary(toolName, result, theme));
        bodyLines.push(keyHint);
        const content = resultText(result);
        if (content) {
          bodyLines.push('');
          bodyLines.push(...content.split('\n'));
        }
      }

      if (width < 24) {
        return bodyLines.map((line) => fit(stripAnsi(line), width));
      }

      const innerWidth = Math.max(0, width - 2);
      const innerContentWidth = Math.max(0, innerWidth - 2);
      const wrappedBodyLines: string[] = [];
      for (const rawLine of bodyLines) {
        for (const sub of rawLine.split(/\r?\n/)) {
          wrappedBodyLines.push(...wrapLineToWidth(sub, innerContentWidth));
        }
      }

      const framed = frameContent(wrappedBodyLines, innerWidth, borderColor);
      const bottomBorder = cardBottomBorder(innerWidth, borderColor);
      return [...framed, bottomBorder];
    },
  };
}

export function context7ToolRenderers(toolName: string) {
  return {
    renderShell: 'self' as const,
    renderCall(args: Record<string, unknown>, theme: Theme, context?: any) {
      return renderContext7ToolCall(toolName, args, theme, context);
    },
    renderResult(result: ToolResultLike, options: Context7RenderOptions, theme: Theme, context?: any) {
      return renderContext7ToolResult(toolName, result, options, theme, context);
    },
  };
}
