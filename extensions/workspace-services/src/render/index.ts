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

function renderLineWithMargin(line: string, safeWidth: number): string {
  if (safeWidth <= 0) return '';
  if (safeWidth === 1) return ' ';
  const innerWidth = safeWidth - 1;
  const fitted = fit(line, innerWidth);
  if (safeWidth === 2 && visibleWidth(stripAnsi(fitted)) === 0 && visibleWidth(stripAnsi(line)) > 0) {
    // Conditional width-2 margin exception: omit 1-col margin only when needed for an intact wide grapheme
    return truncateToWidth(line, 2, '');
  }
  return ` ${fitted}`;
}

function wrapLinesToWidth(lines: string[], safeWidth: number): string[] {
  if (safeWidth <= 0) return [];
  if (safeWidth === 1) return [' '];
  const innerWidth = safeWidth - 1;
  const out: string[] = [];
  for (const raw of lines) {
    const subLines = raw.split(/\r\n|\r|\n/);
    for (const sub of subLines) {
      const normalized = sub.replace(/\t/g, '   ');
      if (normalized.length === 0) {
        out.push(' ');
        continue;
      }
      if (safeWidth === 2) {
        const probe = truncateToWidth(normalized, 1, '');
        if (visibleWidth(stripAnsi(probe)) === 0 && visibleWidth(stripAnsi(normalized)) > 0) {
          const wrappedWide = wrapTextWithAnsi(normalized, 2);
          for (const piece of wrappedWide) {
            out.push(visibleWidth(piece) > 2 ? truncateToWidth(piece, 2, '') : piece);
          }
          continue;
        }
      }
      const wrapped = wrapTextWithAnsi(normalized, innerWidth);
      for (const piece of wrapped) {
        const clamped = visibleWidth(piece) > innerWidth ? truncateToWidth(piece, innerWidth, '') : piece;
        out.push(` ${clamped}`);
      }
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
        const innerWidth = safeWidth - 1;

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
        cachedLine = [` ${fit(row, innerWidth)}`];
        return cachedLine;
      } catch {
        if (safeWidth <= 0) return [];
        return safeWidth === 1 ? [' '] : [` ${fit(String(toolName || 'workspace_service'), safeWidth - 1)}`];
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

function resultText(result: WorkspaceServiceRenderResult | undefined): string {
  return resultTextBlocks(result).join('\n');
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
  let context: any;

  if (typeof first === 'string') {
    toolName = first;
    result = second ?? {};
    options = third ?? {};
    context = fifth;
  } else {
    toolName = 'workspace_service';
    result = first ?? {};
    options = second ?? {};
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
        const innerWidth = safeWidth - 1;
        if (!options?.isPartial && cachedWidth === safeWidth && cachedLines !== undefined) {
          return cachedLines;
        }

        const outcome = result?.details as WorkspaceServiceOutcome | undefined;
        const actionBadge = extractWorkspaceServiceAction(toolName, context?.args);
        const badgePart = actionBadge ? ` ${DIM}[${inlineText(actionBadge)}]${RESET}` : '';
        const isExpanded = Boolean(options?.expanded);

        if (options?.isPartial) {
          return [renderLineWithMargin(`${CYAN}${toolName}${RESET}${badgePart} ${DIM}───${RESET} ${CYAN}●${RESET} running…`, safeWidth)];
        }

        const textBlocks = resultTextBlocks(result);
        const joinedText = textBlocks.join('\n');

        if (!outcome || typeof outcome.summary !== 'string') {
          const message = stripAnsi(joinedText) || 'workspace service result is missing details.';
          const inlineMsg = inlineText(message);
          const header = renderLineWithMargin(`${RED}${toolName}${RESET}${badgePart} ${DIM}───${RESET} ${RED}Warning: ${inlineMsg}${RESET}`, safeWidth);
          if (!isExpanded) {
            const out = [header];
            cachedWidth = safeWidth;
            cachedLines = out;
            return out;
          }
          const bodyLines = [`${RED}Warning: ${stripAnsi(message)}${RESET}`];
          for (const block of textBlocks) {
            if (block && block !== message) bodyLines.push(block);
          }
          const out = [header, ...wrapLinesToWidth(bodyLines, safeWidth)];
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
        const remainingForSummary = innerWidth - visibleWidth(prefix) - visibleWidth(more);
        const fittedSummary = more && remainingForSummary > 6
          ? fit(inlineText(summary), remainingForSummary)
          : inlineText(summary);
        const header = renderLineWithMargin(`${prefix}${fittedSummary}${more}`, safeWidth);

        if (!isExpanded) {
          const out = [header];
          cachedWidth = safeWidth;
          cachedLines = out;
          return out;
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
            bodyLines.push(...split);
          }
        } else {
          bodyLines.push(summary);
        }

        if (dataText && !joinedText.includes(dataText)) {
          bodyLines.push(...dataText.split(/\r\n|\r|\n/));
        }

        if (Array.isArray(outcome.warnings)) {
          for (const warning of outcome.warnings) {
            if (warning && !joinedText.includes(warning)) {
              bodyLines.push(`warning: ${warning}`);
            }
          }
        }

        if (outcome.nextAction && !joinedText.includes(outcome.nextAction)) {
          bodyLines.push(`next: ${outcome.nextAction}`);
        }

        if (outcome.truncation) {
          const hasReturnedInfo = joinedText.includes(`returned_lines=${outcome.truncation.returned}`) || joinedText.includes(`returned=${outcome.truncation.returned}`);
          if (!hasReturnedInfo) {
            bodyLines.push(`returned=${outcome.truncation.returned} hasMore=${String(outcome.truncation.hasMore)}`);
          }
          if (outcome.truncation.continuation && !joinedText.includes(outcome.truncation.continuation)) {
            bodyLines.push(`continue: ${outcome.truncation.continuation}`);
          }
        }

        const out = [header, ...wrapLinesToWidth(bodyLines, safeWidth)];
        cachedWidth = safeWidth;
        cachedLines = out;
        return out;
      } catch {
        if (safeWidth <= 0) return [];
        return safeWidth === 1 ? [' '] : [renderLineWithMargin(String(toolName || 'workspace_service'), safeWidth)];
      }
    },
  };
}
