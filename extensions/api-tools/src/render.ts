import { keyHint } from './pi-runtime.js';
import type { ApiToolResult } from './types.js';

export type Component = {
  render(width: number): string[];
  invalidate(): void;
};

export interface ApiRenderOptions {
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
const CJK_REGEX = /[\u1100-\u115f\u231a-\u231b\u2329-\u232a\u23e9-\u23ec\u23f0\u23f3\u25fd-\u25fe\u2614-\u2615\u2648-\u2653\u267f\u2693\u26a1\u26aa-\u26ab\u26bd-\u26be\u26c4-\u26c5\u26ce\u26d4\u26ea\u26f2-\u26f3\u26f5\u26fa\u26fd\u2705\u270a-\u270b\u2728\u274c\u274e\u2753-\u2755\u2757\u2795-\u2797\u27b0\u27bf\u2b1b-\u2b1c\u2b50\u2b55\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/u;

export function stripAnsi(str: string): string {
  return str.replace(ANSI_REGEX, '');
}

export function charWidth(char: string): number {
  return CJK_REGEX.test(char) ? 2 : 1;
}

export function visibleWidth(str: string): number {
  const stripped = stripAnsi(str);
  let width = 0;
  for (const ch of stripped) {
    width += charWidth(ch);
  }
  return width;
}

export function truncateWithAnsi(str: string, maxWidth: number): string {
  if (maxWidth <= 0) return '';
  if (visibleWidth(str) <= maxWidth) return str;

  let visible = 0;
  let result = '';
  const ansiTokenRegex = /^\x1b\[[0-9;]*[a-zA-Z]/;
  const chars = [...str];
  let i = 0;

  while (i < chars.length) {
    const slice = chars.slice(i).join('');
    const match = slice.match(ansiTokenRegex);
    if (match) {
      result += match[0];
      i += [...match[0]].length;
      continue;
    }
    const ch = chars[i];
    const w = charWidth(ch);
    if (visible + w > maxWidth) break;
    result += ch;
    visible += w;
    i++;
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

export function wrapLineToWidth(text: string, width: number): string[] {
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
        let strippedCount = 0;
        while (remIdx < rem.length && strippedCount < chunkStripped.length) {
          const m = rem.slice(remIdx).match(/^\x1b\[[0-9;]*[a-zA-Z]/);
          if (m) {
            remIdx += m[0].length;
          } else {
            remIdx++;
            strippedCount++;
          }
        }
        const nextRem = rem.slice(remIdx);
        if (nextRem.length === rem.length) {
          rem = rem.slice(1);
        } else {
          rem = nextRem;
        }
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

export function extractApiToolAction(toolName: string, args: any): string | undefined {
  if (!args || typeof args !== 'object') return undefined;
  switch (toolName) {
    case 'api_status':
      return undefined;
    case 'api_auth_status':
    case 'api_login':
      return typeof args.provider === 'string' && args.provider.trim() ? args.provider.trim() : undefined;
    case 'api_rest_request': {
      const method = typeof args.method === 'string' ? args.method.trim() : '';
      const path = typeof args.path === 'string' ? args.path.trim() : '';
      const combined = `${method} ${path}`.trim();
      return combined || undefined;
    }
    case 'api_swagger': {
      const action = typeof args.action === 'string' ? args.action.trim() : '';
      const target = typeof args.operation === 'string' ? args.operation.trim() : typeof args.tag === 'string' ? args.tag.trim() : '';
      const combined = `${action} ${target}`.trim();
      return combined || undefined;
    }
    case 'api_graphql': {
      const action = typeof args.action === 'string' ? args.action.trim() : '';
      const target = typeof args.operationName === 'string' ? args.operationName.trim() : typeof args.name === 'string' ? args.name.trim() : '';
      const combined = `${action} ${target}`.trim();
      return combined || undefined;
    }
    default:
      return undefined;
  }
}

function getKeyHint(theme: any, action: 'expand' | 'collapse'): string {
  try {
    const hint = keyHint('app.tools.expand', action);
    return `${DIM}${hint}${RESET}`;
  } catch {
    const key = theme?.keybinding?.('app.tools.expand') ?? 'ctrl+o';
    return `${DIM}${key} ${action}${RESET}`;
  }
}

function buildSummary(toolName: string, result: ApiToolResult): string {
  const status = result.isError ? 'failure' : String(result.details?.status ?? 'success');
  const action = typeof result.details?.action === 'string' ? result.details.action : 'action';
  const identity = typeof result.details?.identity === 'string' ? ` · ${result.details.identity}` : '';
  const continuation = result.details?.continuation?.has_more ? ' · more available' : '';
  return `${toolName} ${action} · ${status}${identity}${continuation}`;
}

function metadataLines(result: ApiToolResult): string[] {
  const lines: string[] = [];
  const continuation = result.details?.continuation;
  const failure = result.details?.failure;
  const render = result.details?.render;

  if (typeof result.details?.contract_version === 'number') lines.push(`contract_version: ${result.details.contract_version}`);
  if (render?.authorization_state) lines.push(`authorization: ${render.authorization_state}`);
  if (typeof continuation?.returned_count === 'number') {
    lines.push(`returned: ${continuation.returned_count}${typeof continuation.total === 'number' ? `/${continuation.total}` : ''}`);
  }
  if (typeof continuation?.next_cursor === 'string' && continuation.next_cursor.length > 0) lines.push(`cursor: ${continuation.next_cursor.slice(0, 10)}`);
  if (failure?.category) lines.push(`failure: ${failure.category}`);
  if (failure?.code) lines.push(`code: ${failure.code}`);
  if (failure?.next_step) lines.push(`next: ${failure.next_step}`);
  return lines;
}

function resultBody(result: ApiToolResult): string {
  return (result.content ?? [])
    .filter((entry) => entry?.type === 'text')
    .map((entry) => entry.text ?? '')
    .join('\n');
}

export function renderApiToolCall(
  toolName: string,
  args: any,
  _theme?: any,
  context?: any,
): Component {
  return {
    invalidate() {},
    render(width: number): string[] {
      if (width <= 0) return [];
      const actionBadge = extractApiToolAction(toolName, args);
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

export function renderApiToolResult(
  toolName: string,
  result: ApiToolResult,
  options: ApiRenderOptions = {},
  theme?: any,
  context?: any,
): Component {
  const isError = Boolean(
    context?.isError ||
    result?.isError ||
    result?.details?.status === 'failure' ||
    result?.details?.failure,
  );
  const borderColor = isError ? RED : LIME;

  if (context?.state) {
    context.state.hasResult = true;
    context.state.borderColor = borderColor;
  }

  return {
    invalidate() {},
    render(width: number): string[] {
      if (width <= 0) return [];
      const isExpanded = Boolean(options?.expanded);
      const keyHintStr = getKeyHint(theme, isExpanded ? 'collapse' : 'expand');
      const bodyLines: string[] = [];

      if (options?.isPartial) {
        bodyLines.push(`${toolName} · running…`);
      } else if (!isExpanded) {
        const summary = buildSummary(toolName, result);
        bodyLines.push(summary);
        bodyLines.push(keyHintStr);
      } else {
        const summary = buildSummary(toolName, result);
        bodyLines.push(summary);
        bodyLines.push(keyHintStr);
        const detailLines = metadataLines(result);
        if (detailLines.length > 0) {
          bodyLines.push('');
          bodyLines.push(...detailLines);
        }
        const body = resultBody(result);
        if (body) {
          bodyLines.push('');
          bodyLines.push(...body.split('\n'));
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
