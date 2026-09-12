export type Component = {
  render(width: number): string[];
  invalidate(): void;
};

export interface BrowserRenderOptions {
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
const CJK_REGEX =
  /[\u1100-\u115f\u231a-\u231b\u2329-\u232a\u23e9-\u23ec\u23f0\u23f3\u25fd-\u25fe\u2614-\u2615\u2648-\u2653\u267f\u2693\u26a1\u26aa-\u26ab\u26bd-\u26be\u26c4-\u26c5\u26ce\u26d4\u26ea\u26f2-\u26f3\u26f5\u26fa\u26fd\u2705\u270a-\u270b\u2728\u274c\u274e\u2753-\u2755\u2757\u2795-\u2797\u27b0\u27bf\u2b1b-\u2b1c\u2b50\u2b55\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/u;

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

export function getKeyHint(theme: any, action: 'expand' | 'collapse'): string {
  const key = theme?.keybinding?.('app.tools.expand') ?? 'ctrl+o';
  return `${DIM}${key} ${action}${RESET}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

export function extractBrowserBadge(toolName: string, args: any): string {
  if (!args || typeof args !== 'object') {
    switch (toolName) {
      case 'browser_cdp_status':
        return 'cdp_status';
      case 'browser_tabs_list':
        return 'tabs_list';
      case 'go_to_page':
        return 'go_to';
      case 'browser_page_screenshot':
        return 'page_screenshot';
      default:
        return toolName;
    }
  }

  switch (toolName) {
    case 'browser_cdp_status':
      return 'cdp_status';
    case 'browser_tabs_list':
      return 'tabs_list';
    case 'go_to_page':
      return args.url ? `go_to [${args.url}]` : 'go_to';
    case 'browser_page_screenshot': {
      const target = args.targetId ?? args.urlContains ?? args.titleContains;
      return target ? `page_screenshot [${target}]` : 'page_screenshot';
    }
    default:
      return toolName;
  }
}

function getPendingText(toolName: string): string {
  switch (toolName) {
    case 'browser_cdp_status':
      return 'Checking CDP status...';
    case 'browser_tabs_list':
      return 'Listing browser tabs...';
    case 'go_to_page':
      return 'Navigating to page...';
    case 'browser_page_screenshot':
      return 'Capturing page screenshot...';
    default:
      return 'Pending...';
  }
}

export function renderBrowserCall(
  toolName: string,
  args: any,
  _theme?: any,
  context?: any,
): Component {
  return {
    invalidate() {},
    render(width: number): string[] {
      if (width <= 0) return [];
      const badge = extractBrowserBadge(toolName, args);

      if (width < 24) {
        return [fit(`${toolName} [${badge}]`, width)];
      }

      const innerWidth = Math.max(0, width - 2);
      const state = context?.state;
      const isError = Boolean(context?.isError);
      const borderColor = state?.borderColor ?? (isError ? RED : CYAN);
      const topBorder = cardTopBorder(toolName, badge, innerWidth, borderColor, borderColor);

      if (state?.hasResult) {
        return [topBorder];
      }

      const pendingDetail = getPendingText(toolName);
      const pendingLine = `${CYAN}●${RESET} Pending: ${pendingDetail}`;

      return [
        topBorder,
        boxLine(pendingLine, innerWidth, borderColor),
        cardBottomBorder(innerWidth, borderColor),
      ];
    },
  };
}

function buildCdpStatusSummary(data: any): string {
  const reachable = data?.versionReachable && data?.tabsReachable;
  const browser = data?.browser ? `(${data.browser})` : '';
  const cdpUrl = data?.cdpUrl ?? 'http://127.0.0.1:9222';
  if (reachable) {
    return `✓ CDP connected ${browser} · ${cdpUrl}`.replace(/\s+/g, ' ');
  }
  return `CDP unreachable · ${cdpUrl}`;
}

function buildTabsListSummary(data: any): string {
  const count = typeof data?.returnedCount === 'number' ? data.returnedCount : (data?.tabs?.length ?? 0);
  const total = typeof data?.totalPageTargets === 'number' ? data.totalPageTargets : count;
  const countStr = total > count ? `${count}/${total}` : `${count}`;
  return `✓ ${countStr} page tab(s) available`;
}

function buildGoToPageSummary(data: any): string {
  const url = data?.target?.url ?? data?.requestedUrl ?? '';
  const title = data?.target?.title ? ` [${data.target.title}]` : '';
  return `✓ navigated -> ${url}${title}`;
}

function buildPageScreenshotSummary(data: any): string {
  const dim = data?.width && data?.height ? `${data.width}x${data.height}` : '';
  const size = typeof data?.outputSizeBytes === 'number' ? formatBytes(data.outputSizeBytes) : '';
  const outPath = data?.outputPath ?? '';

  const dimPart = dim ? `${dim} ` : '';
  const sizePart = size ? `(${size}) ` : '';
  return `✓ captured page ${dimPart}${sizePart}-> ${outPath}`.trim();
}

function buildBrowserExpandedLines(toolName: string, data: any): string[] {
  const lines: string[] = [];

  switch (toolName) {
    case 'browser_cdp_status':
      lines.push(`cdp endpoint: ${data?.cdpUrl ?? 'unknown'}`);
      lines.push(`version endpoint: ${data?.versionReachable ? 'reachable' : 'unreachable'}`);
      lines.push(`tabs endpoint: ${data?.tabsReachable ? 'reachable' : 'unreachable'}`);
      if (data?.browser) lines.push(`browser: ${data.browser}`);
      if (data?.protocolVersion) lines.push(`protocol: ${data.protocolVersion}`);
      if (typeof data?.pageTargetCount === 'number') lines.push(`page targets: ${data.pageTargetCount}`);
      break;

    case 'browser_tabs_list': {
      lines.push(`cdp endpoint: ${data?.cdpUrl ?? 'unknown'}`);
      lines.push(`page targets: ${data?.totalPageTargets ?? data?.tabs?.length ?? 0}`);
      const tabs = Array.isArray(data?.tabs) ? data.tabs : [];
      for (const [idx, tab] of tabs.entries()) {
        const title = tab.title ? `"${tab.title}"` : '(untitled)';
        const wsStatus = tab.hasWebSocketDebuggerUrl ? 'websocket=yes' : 'websocket=no';
        lines.push(`- [${idx + 1}] id=${tab.id} | ${title} | ${tab.url} | ${wsStatus}`);
      }
      break;
    }

    case 'go_to_page':
      lines.push(`target id: ${data?.targetId ?? data?.target?.id ?? 'unknown'}`);
      lines.push(`requested url: ${data?.requestedUrl ?? 'unknown'}`);
      if (data?.target?.url) lines.push(`resolved url: ${data.target.url}`);
      if (data?.target?.title) lines.push(`page title: ${data.target.title}`);
      if (data?.completionMode) lines.push(`completion: ${data.completionMode}`);
      if (typeof data?.durationMs === 'number') lines.push(`duration: ${data.durationMs}ms`);
      break;

    case 'browser_page_screenshot':
      if (data?.target?.id) lines.push(`target id: ${data.target.id}`);
      if (data?.target?.url) lines.push(`page url: ${data.target.url}`);
      if (data?.target?.title) lines.push(`page title: ${data.target.title}`);
      if (data?.width && data?.height) lines.push(`dimensions: ${data.width}x${data.height}`);
      if (data?.outputPath) lines.push(`output path: ${data.outputPath}`);
      if (typeof data?.outputSizeBytes === 'number') lines.push(`file size: ${formatBytes(data.outputSizeBytes)}`);
      lines.push(`inline image: ${data?.inlineAttached ? 'attached' : 'not attached'}`);
      break;
  }

  const warnings = Array.isArray(data?.warnings) ? data.warnings : [];
  if (warnings.length > 0) {
    lines.push('', 'warnings:');
    for (const w of warnings) {
      lines.push(`- ${w}`);
    }
  }

  return lines;
}

export function renderBrowserResult(
  toolName: string,
  result: any,
  options: BrowserRenderOptions = {},
  theme?: any,
  context?: any,
): Component {
  const isError = Boolean(
    context?.isError ||
      result?.isError ||
      result?.details?.status === 'failure' ||
      result?.details?.error,
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
      const hint = getKeyHint(theme, isExpanded ? 'collapse' : 'expand');
      const bodyLines: string[] = [];

      if (options?.isPartial) {
        bodyLines.push(`${toolName} · running…`);
      } else if (isError) {
        const errorMsg =
          result?.details?.error?.message ??
          result?.details?.error ??
          result?.content?.[0]?.text ??
          `${toolName} failed`;
        bodyLines.push(`${RED}Error: ${stripAnsi(String(errorMsg))}${RESET}`);
        bodyLines.push(hint);
      } else {
        const data = result?.details?.data ?? result?.details;
        let summary = '';
        switch (toolName) {
          case 'browser_cdp_status':
            summary = buildCdpStatusSummary(data);
            break;
          case 'browser_tabs_list':
            summary = buildTabsListSummary(data);
            break;
          case 'go_to_page':
            summary = buildGoToPageSummary(data);
            break;
          case 'browser_page_screenshot':
            summary = buildPageScreenshotSummary(data);
            break;
          default:
            summary = `${toolName} complete`;
        }

        bodyLines.push(summary);
        bodyLines.push(hint);

        if (isExpanded) {
          const detailLines = buildBrowserExpandedLines(toolName, data);
          if (detailLines.length > 0) {
            bodyLines.push('');
            bodyLines.push(...detailLines);
          }
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
