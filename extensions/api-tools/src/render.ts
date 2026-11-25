import { truncateToWidth, visibleWidth as tuiVisibleWidth, wrapTextWithAnsi } from './pi-runtime.js';
import type { ApiToolResult } from './types.js';

export const API_TOOL_NAMES = [
  'api_status', 'api_auth_status', 'api_login', 'api_rest_request', 'api_swagger', 'api_graphql',
] as const;

export function buildApiToolRenderers(toolName: string) {
  return {
    compactToolRenderingVersion: 1 as const,
    compactLeftMargin: 1 as const,
    renderShell: 'self' as const,
    renderCall: (args: any, theme: any, context?: any) => renderApiToolCall(toolName, args, theme, context),
    renderResult: (result: ApiToolResult, options: any, theme: any, context?: any) => renderApiToolResult(toolName, result, options, theme, context),
  };
}

/** Presentation-only entry: no config, clients, tools or lifecycle resources. */
export function registerToolRenderers(pi: any): void {
  pi.registerToolRenderer?.((toolName: string, next: () => unknown) =>
    API_TOOL_NAMES.some((name) => name === toolName) ? buildApiToolRenderers(toolName) : next());
}

export type Component = {
  compactLeftMargin?: number;
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
const MUTED_FALLBACK = '\x1b[38;2;122;167;184m';
const FG_RESET = '\x1b[39m';
const HAS_SGR_RE = /\x1b\[[0-9;]*m/;
const PURE_FG_SGR_RE = /^\x1b\[(?:3[0-7]|9[0-7]|38;[0-9;]+)m$/;
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

const ANSI_OSC_APC_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b_[^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]/g;

export function stripAnsi(str: string): string {
  return str.replace(ANSI_OSC_APC_RE, '');
}

export function visibleWidth(str: string): number {
  return tuiVisibleWidth(str);
}

export function fit(text: string, width: number): string {
  if (width <= 0) return '';
  return truncateToWidth(text, width, width >= 4 ? '…' : '');
}

function styleMuted(theme: any, text: string): string {
  if (!text) return text;
  if (typeof theme?.fg === 'function') {
    try {
      const styled = theme.fg('muted', text);
      if (typeof styled === 'string' && styled !== text) {
        return styled;
      }
    } catch {
      // Fall back to arch-electric muted foreground
    }
  }
  return `${MUTED_FALLBACK}${text}${FG_RESET}`;
}

function mutePlainLine(theme: any, line: string): string {
  if (!line || HAS_SGR_RE.test(line)) return line;
  return styleMuted(theme, line);
}

function matchEscapeAt(str: string, index: number): string | undefined {
  if (str[index] !== '\x1b') return undefined;
  const next = str[index + 1];
  if (next === '[') {
    const m = str.slice(index).match(/^\x1b\[[0-?]*[ -/]*[@-~]/);
    return m?.[0];
  }
  if (next === ']' || next === '_') {
    const rest = str.slice(index + 2);
    const bel = rest.indexOf('\x07');
    const st = rest.indexOf('\x1b\\');
    if (bel !== -1 && (st === -1 || bel < st)) return str.slice(index, index + 2 + bel + 1);
    if (st !== -1) return str.slice(index, index + 2 + st + 2);
  }
  return undefined;
}

function wrapWidth2WithConditionalMargin(line: string): string[] {
  const normalized = line.replace(/\t/g, '   ');
  if (!normalized) return [' '];

  let sgr: string[] = [];
  let osc8 = '';
  const out: string[] = [];
  let i = 0;

  while (i < normalized.length) {
    const seq = matchEscapeAt(normalized, i);
    if (seq) {
      if (seq.startsWith('\x1b[') && seq.endsWith('m')) {
        const params = seq.slice(2, -1);
        if (params === '' || params.split(';').includes('0')) {
          sgr = [];
        } else if (params === '39' && sgr.every((entry) => PURE_FG_SGR_RE.test(entry))) {
          sgr = [];
        } else {
          sgr.push(seq);
        }
      } else if (seq.startsWith('\x1b]8;')) {
        const oscMatch = seq.match(/^\x1b\]8;[^;]*;([^\x07\x1b]*)(?:\x07|\x1b\\)$/);
        if (oscMatch) osc8 = oscMatch[1] ? seq : '';
      }
      i += seq.length;
      continue;
    }
    let end = i + 1;
    while (end < normalized.length && !matchEscapeAt(normalized, end)) end++;
    for (const { segment } of graphemeSegmenter.segment(normalized.slice(i, end))) {
      const w = visibleWidth(segment);
      if (w === 0) continue;
      const prefix = sgr.join('') + osc8;
      const suffix = (osc8 ? '\x1b]8;;\x07' : '') + (sgr.length > 0 ? RESET : '');
      if (w >= 2) {
        out.push(`${prefix}${segment}${suffix}`);
      } else {
        out.push(` ${prefix}${segment}${suffix}`);
      }
    }
    i = end;
  }

  return out.length > 0 ? out : [' '];
}

function wrapMarginedLine(line: string, safeWidth: number): string[] {
  if (safeWidth <= 0) return [];
  if (safeWidth === 1) return [' '];
  if (safeWidth === 2) return wrapWidth2WithConditionalMargin(line);
  const innerWidth = safeWidth - 1;
  const normalized = line.replace(/\t/g, '   ');
  if (normalized.length === 0) return [' '];
  const wrapped = wrapTextWithAnsi(normalized, innerWidth);
  return wrapped.map((piece) => {
    const safePiece = visibleWidth(piece) > innerWidth ? truncateToWidth(piece, innerWidth, '') : piece;
    return ` ${safePiece}`;
  });
}

function wrapMarginedLines(lines: string[], safeWidth: number): string[] {
  if (safeWidth <= 0) return [];
  if (safeWidth === 1) return [' '];
  const out: string[] = [];
  for (const raw of lines) {
    const subLines = raw.split(/\r\n|\r|\n/);
    for (const sub of subLines) {
      out.push(...wrapMarginedLine(sub, safeWidth));
    }
  }
  return out;
}

function inlineText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

export function extractApiToolAction(toolName: string, args: any): string | undefined {
  if (!args || typeof args !== 'object') return undefined;
  switch (toolName) {
    case 'api_status':
      return undefined;
    case 'api_auth_status':
      return typeof args.provider === 'string' && args.provider.trim() ? args.provider.trim() : undefined;
    case 'api_login': {
      if (typeof args.alias === 'string' && args.alias.trim()) return args.alias.trim();
      if (typeof args.provider === 'string' && args.provider.trim()) return args.provider.trim();
      return undefined;
    }
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

function buildSummary(toolName: string, result: ApiToolResult | undefined, isError: boolean, badge?: string): string {
  const status = isError ? 'failure' : String(result?.details?.status ?? 'success');
  const action = typeof result?.details?.action === 'string' ? result.details.action : undefined;
  const rawIdentity = typeof result?.details?.identity === 'string' ? result.details.identity : undefined;
  const identity = rawIdentity && rawIdentity !== badge && rawIdentity !== toolName ? ` · ${rawIdentity}` : '';
  const continuation = result?.details?.continuation?.has_more ? ' · more available' : '';
  const bodyFirstLine = inlineText(resultBody(result).split('\n')[0] ?? '');
  const prefix = action ? `${action} · ` : '';
  const fallbackBody = !action && !identity && bodyFirstLine ? ` · ${bodyFirstLine}` : '';
  return `${prefix}${status}${identity}${continuation}${fallbackBody}`;
}

function metadataLines(result: ApiToolResult | undefined): string[] {
  const lines: string[] = [];
  const details = result?.details;
  if (!details) return lines;
  const continuation = details.continuation;
  const failure = details.failure;
  const render = details.render;

  if (typeof details.contract_version === 'number') lines.push(`contract_version: ${details.contract_version}`);
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

function resultBody(result: ApiToolResult | undefined): string {
  if (!result || !Array.isArray(result.content)) return '';
  return result.content
    .filter((entry) => entry?.type === 'text' && typeof entry.text === 'string')
    .map((entry) => entry.text)
    .join('\n');
}

export function renderApiToolCall(
  toolName: string,
  args: any,
  _theme?: any,
  context?: any,
): Component {
  let cachedWidth: number | undefined;
  let cachedColor: string | undefined;
  let cachedLine: string[] | undefined;

  return {
    compactLeftMargin: 1 as const,
    invalidate() {
      cachedWidth = undefined;
      cachedColor = undefined;
      cachedLine = undefined;
    },
    render(width: number): string[] {
      const safeWidth = Number.isFinite(width) ? Math.floor(width) : 0;
      try {
        if (safeWidth <= 0) return [];
        if (context?.state?.hasResult) return [];
        if (safeWidth === 1) return [' '];

        const actionBadge = extractApiToolAction(toolName, args);
        const color = context?.isError ? RED : CYAN;
        if (cachedWidth === safeWidth && cachedColor === color && cachedLine) {
          return cachedLine;
        }

        const badgePart = actionBadge ? ` ${DIM}[${inlineText(actionBadge)}]${RESET}` : '';
        const pendingDetail = actionBadge ? `Pending: ${inlineText(actionBadge)}` : 'Pending…';
        const row = `${color}${toolName}${RESET}${badgePart} ${DIM}───${RESET} ${color}●${RESET} ${pendingDetail}`;
        cachedWidth = safeWidth;
        cachedColor = color;
        cachedLine = wrapMarginedLine(row, safeWidth);
        return cachedLine;
      } catch {
        if (safeWidth <= 0) return [];
        return wrapMarginedLine(String(toolName || 'api_tool'), safeWidth);
      }
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
  let isError = false;
  let color = LIME;
  try {
    isError = Boolean(
      context?.isError ||
      result?.isError ||
      result?.details?.status === 'failure' ||
      result?.details?.failure,
    );
    color = isError ? RED : LIME;
    if (context?.state) {
      context.state.hasResult = true;
      context.state.borderColor = color;
    }
  } catch {
    if (context?.state) {
      context.state.hasResult = true;
      context.state.borderColor = RED;
    }
  }

  let cachedWidth: number | undefined;
  let cachedLines: string[] | undefined;

  return {
    compactLeftMargin: 1 as const,
    invalidate() {
      cachedWidth = undefined;
      cachedLines = undefined;
    },
    render(width: number): string[] {
      const safeWidth = Number.isFinite(width) ? Math.floor(width) : 0;
      try {
        if (safeWidth <= 0) return [];
        if (safeWidth === 1) return [' '];
        if (!options?.isPartial && cachedWidth === safeWidth && cachedLines !== undefined) {
          return cachedLines;
        }

        const actionBadge = extractApiToolAction(toolName, context?.args);
        const badgePart = actionBadge ? ` ${DIM}[${inlineText(actionBadge)}]${RESET}` : '';
        const isExpanded = Boolean(options?.expanded);

        if (options?.isPartial) {
          return wrapMarginedLine(`${CYAN}${toolName}${RESET}${badgePart} ${DIM}───${RESET} ${CYAN}●${RESET} running…`, safeWidth);
        }

        const icon = isError ? `${RED}✗${RESET}` : `${LIME}✓${RESET}`;
        const summary = buildSummary(toolName, result, isError, actionBadge);
        const headerLines = wrapMarginedLine(`${color}${toolName}${RESET}${badgePart} ${DIM}───${RESET} ${icon} ${summary}`, safeWidth);

        if (!isExpanded) {
          cachedWidth = safeWidth;
          cachedLines = headerLines;
          return headerLines;
        }

        const extraLines: string[] = [];
        const detailLines = metadataLines(result);
        if (detailLines.length > 0) {
          for (const detailLine of detailLines) {
            extraLines.push(mutePlainLine(theme, detailLine));
          }
        }
        const body = resultBody(result);
        if (body) {
          for (const sub of body.split(/\r\n|\r|\n/)) {
            extraLines.push(mutePlainLine(theme, sub));
          }
        }

        const out = [...headerLines, ...wrapMarginedLines(extraLines, safeWidth)];
        cachedWidth = safeWidth;
        cachedLines = out;
        return out;
      } catch {
        if (safeWidth <= 0) return [];
        return wrapMarginedLine(String(toolName || 'api_tool'), safeWidth);
      }
    },
  };
}
