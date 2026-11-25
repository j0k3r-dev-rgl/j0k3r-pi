import { truncateToWidth, visibleWidth as tuiVisibleWidth, wrapTextWithAnsi } from '@earendil-works/pi-tui';
import type { WorkspaceServiceOutcome } from '../types.js';

export type RenderTheme = {
  fg?: (name: string, text: string) => string;
  bold?: (text: string) => string;
  keybinding?: (id: string) => string;
};

export type RenderComponent = {
  compactLeftMargin?: number;
  render(width: number): string[];
  invalidate(): void;
};

export type WorkspaceServiceRenderOptions = {
  expanded?: boolean;
  isPartial?: boolean;
};

export const RESET = '\x1b[0m';
export const CYAN = '\x1b[1;38;2;0;229;255m';
export const LIME = '\x1b[1;38;2;102;255;102m';
export const YELLOW = '\x1b[1;38;2;255;204;0m';
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

export function extractWorkspaceServiceAction(_toolName: string, args: any): string | undefined {
  if (!args || typeof args !== 'object') return undefined;
  if (typeof args.service === 'string' && args.service.trim().length > 0) {
    return args.service.trim();
  }
  return undefined;
}

export function renderWorkspaceServiceCall(
  toolName: string,
  args: any,
  _theme?: any,
  context?: any,
): RenderComponent {
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

        const actionBadge = extractWorkspaceServiceAction(toolName, args);
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
        return wrapMarginedLine(String(toolName || 'workspace_service'), safeWidth);
      }
    },
  };
}

type WorkspaceServiceRenderResult = {
  content?: Array<{ type: string; text?: string }>;
  details?: WorkspaceServiceOutcome | any;
  isError?: boolean;
};

function resultTextBlocks(result: WorkspaceServiceRenderResult | undefined): string[] {
  if (!result || !Array.isArray(result.content)) return [];
  return result.content
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text as string);
}

export function renderWorkspaceServiceResult(
  first: string | WorkspaceServiceRenderResult,
  second?: any,
  third?: any,
  fourth?: any,
  fifth?: any,
): RenderComponent {
  let toolName: string;
  let result: WorkspaceServiceRenderResult;
  let options: WorkspaceServiceRenderOptions;
  let theme: any;
  let context: any;

  if (typeof first === 'string') {
    toolName = first;
    result = second ?? {};
    options = third ?? {};
    theme = fourth;
    context = fifth;
  } else {
    toolName = 'workspace_service';
    result = first ?? {};
    options = second ?? {};
    theme = third;
    context = fourth;
  }

  let isError = false;
  let isPartialOutcome = false;
  let borderColor = LIME;
  try {
    const outcome = result?.details as WorkspaceServiceOutcome | undefined;
    isError = Boolean(context?.isError || result?.isError || (outcome && !outcome.ok));
    isPartialOutcome = Boolean(!isError && outcome?.status === 'partial');
    borderColor = isError ? RED : isPartialOutcome ? YELLOW : LIME;
    if (context?.state) {
      context.state.hasResult = true;
      context.state.borderColor = borderColor;
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

        const outcome = result?.details as WorkspaceServiceOutcome | undefined;
        const actionBadge = extractWorkspaceServiceAction(toolName, context?.args);
        const badgePart = actionBadge ? ` ${DIM}[${inlineText(actionBadge)}]${RESET}` : '';
        const isExpanded = Boolean(options?.expanded);

        if (options?.isPartial) {
          return wrapMarginedLine(`${CYAN}${toolName}${RESET}${badgePart} ${DIM}───${RESET} ${CYAN}●${RESET} running…`, safeWidth);
        }

        const textBlocks = resultTextBlocks(result);
        const joinedText = textBlocks.join('\n');

        if (!outcome || typeof outcome.summary !== 'string') {
          const message = stripAnsi(joinedText) || 'workspace service result is missing details.';
          const inlineMsg = inlineText(message);
          const headerLines = wrapMarginedLine(`${RED}${toolName}${RESET}${badgePart} ${DIM}───${RESET} ${RED}Warning: ${inlineMsg}${RESET}`, safeWidth);
          if (!isExpanded) {
            cachedWidth = safeWidth;
            cachedLines = headerLines;
            return headerLines;
          }
          const msgLines = stripAnsi(message).split(/\r\n|\r|\n/);
          const bodyLines = [
            `${RED}Warning: ${msgLines[0] ?? ''}${RESET}`,
            ...msgLines.slice(1).map((sub) => mutePlainLine(theme, sub)),
          ];
          for (const block of textBlocks) {
            if (block && block !== message) {
              for (const sub of block.split(/\r\n|\r|\n/)) {
                bodyLines.push(mutePlainLine(theme, sub));
              }
            }
          }
          const out = [...headerLines, ...wrapMarginedLines(bodyLines, safeWidth)];
          cachedWidth = safeWidth;
          cachedLines = out;
          return out;
        }

        const service = String((outcome.data as any)?.service ?? '').trim();
        const servicePart = service && service !== actionBadge && service !== toolName ? `${service} · ` : '';
        const nativeError = Boolean(context?.isError || result?.isError);
        const statusLabel = nativeError ? 'warning' : isPartialOutcome ? 'partial' : outcome.status;
        const summary = nativeError ? `Warning: ${joinedText || outcome.summary}` : outcome.summary;
        const more = outcome.truncation?.hasMore ? ' · more available' : '';
        const icon = isError ? `${RED}✗${RESET}` : isPartialOutcome ? `${YELLOW}⚠${RESET}` : `${LIME}✓${RESET}`;
        const prefix = `${borderColor}${toolName}${RESET}${badgePart} ${DIM}───${RESET} ${icon} ${servicePart}${statusLabel} · `;
        const headerLines = wrapMarginedLine(`${prefix}${inlineText(summary)}${more}`, safeWidth);

        if (!isExpanded) {
          cachedWidth = safeWidth;
          cachedLines = headerLines;
          return headerLines;
        }

        const bodyLines: string[] = [];
        const dataText = typeof (outcome.data as any)?.text === 'string' ? (outcome.data as any).text : undefined;

        if (joinedText.length > 0) {
          for (const block of textBlocks) {
            if (!block || block === summary || block === dataText) continue;
            const split = block.split(/\r\n|\r|\n/);
            // Skip a leading line that merely echoes the tool name + summary already shown in header
            const redundantHeaderLine = `${toolName}: ${outcome.summary}`;
            if (split[0] === redundantHeaderLine) {
              split.shift();
            }
            for (const sub of split) {
              bodyLines.push(mutePlainLine(theme, sub));
            }
          }
        } else {
          for (const sub of summary.split(/\r\n|\r|\n/)) {
            bodyLines.push(mutePlainLine(theme, sub));
          }
        }

        if (dataText && !joinedText.includes(dataText)) {
          for (const sub of dataText.split(/\r\n|\r|\n/)) {
            bodyLines.push(mutePlainLine(theme, sub));
          }
        }

        if (Array.isArray(outcome.warnings)) {
          for (const warning of outcome.warnings) {
            if (warning && !joinedText.includes(warning)) {
              bodyLines.push(mutePlainLine(theme, `warning: ${warning}`));
            }
          }
        }

        if (outcome.nextAction && !joinedText.includes(outcome.nextAction)) {
          bodyLines.push(mutePlainLine(theme, `next: ${outcome.nextAction}`));
        }

        if (outcome.truncation) {
          const hasReturnedInfo = joinedText.includes(`returned_lines=${outcome.truncation.returned}`) || joinedText.includes(`returned=${outcome.truncation.returned}`);
          if (!hasReturnedInfo) {
            bodyLines.push(mutePlainLine(theme, `returned=${outcome.truncation.returned} hasMore=${String(outcome.truncation.hasMore)}`));
          }
          if (outcome.truncation.continuation && !joinedText.includes(outcome.truncation.continuation)) {
            bodyLines.push(mutePlainLine(theme, `continue: ${outcome.truncation.continuation}`));
          }
        }

        const out = [...headerLines, ...wrapMarginedLines(bodyLines, safeWidth)];
        cachedWidth = safeWidth;
        cachedLines = out;
        return out;
      } catch {
        if (safeWidth <= 0) return [];
        return wrapMarginedLine(String(toolName || 'workspace_service'), safeWidth);
      }
    },
  };
}
