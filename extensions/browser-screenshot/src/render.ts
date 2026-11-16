export type Component = {
  compactLeftMargin?: number;
  render(width: number): string[];
  invalidate(): void;
};

export interface BrowserRenderOptions {
  expanded?: boolean;
  isPartial?: boolean;
}

export const RESET = '\x1b[0m';
/** Short inline row separator; not a card frame. */
export const ROW_SEPARATOR = ' ─ ';
/** Presentation-only marker: declares compact, unboxed, single-row compliance with 1-col margin. */
export const COMPACT_TOOL_RENDERING = { compactToolRenderingVersion: 1, compactLeftMargin: 1 } as const;

export interface BrowserRowState {
  hasResult?: boolean;
  isError?: boolean;
  isPartial?: boolean;
  expanded?: boolean;
  badge?: string;
}
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
  if (width <= 0) return '';
  const vis = visibleWidth(text);
  if (vis === width) return text;
  if (vis < width) return text + ' '.repeat(width - vis);
  const fitted = fit(text, width);
  const visFitted = visibleWidth(fitted);
  return visFitted < width ? fitted + ' '.repeat(width - visFitted) : fitted;
}

/** One compact inline row, composed of non-empty parts and clipped to width. */
export function rowLine(parts: Array<string | undefined | null>, width: number): string[] {
  if (width <= 0) return [];
  const line = parts
    .filter((part): part is string => Boolean(part && part.trim()))
    .map((part) => part.replace(/[\r\n]+/g, ' '))
    .join(ROW_SEPARATOR);
  return [fit(line, width)];
}

/**
 * Hard-wrap one over-long token in linear time. Re-measuring the whole remainder
 * per chunk made pathological single-line payloads quadratic.
 */
function hardChunks(text: string, width: number): string[] {
  const out: string[] = [];
  let current = '';
  let currentWidth = 0;
  let index = 0;
  while (index < text.length) {
    if (text[index] === '\x1b') {
      const match = text.slice(index).match(/^\x1b\[[0-9;]*[a-zA-Z]/);
      if (match) {
        current += match[0];
        index += match[0].length;
        continue;
      }
    }
    const char = text[index];
    const w = charWidth(char);
    if (currentWidth > 0 && currentWidth + w > width) {
      out.push(current);
      current = '';
      currentWidth = 0;
    }
    if (w <= width) {
      current += char;
      currentWidth += w;
    }
    index += 1;
  }
  if (current || out.length === 0) out.push(current);
  return out;
}

/** Wrap expanded content losslessly, preserving blank-line meaning. */
export function expandedLines(text: string, width: number): string[] {
  if (width <= 0) return [];
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (raw === '') {
      out.push('');
      continue;
    }
    if (visibleWidth(raw) <= width) {
      out.push(raw);
      continue;
    }
    const words = raw.split(/\s+/).filter(Boolean);
    let current = '';
    for (const word of words) {
      if (visibleWidth(word) > width) {
        if (current) {
          out.push(current);
          current = '';
        }
        out.push(...hardChunks(word, width));
        continue;
      }
      if (!current) {
        current = word;
        continue;
      }
      const candidate = `${current} ${word}`;
      if (visibleWidth(candidate) <= width) current = candidate;
      else {
        out.push(current);
        current = word;
      }
    }
    if (current) out.push(current);
  }
  return out;
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

export function renderBrowserCall(
  toolName: string,
  args: any,
  theme?: any,
  context?: any,
): Component {
  const state: BrowserRowState = context ? (context.state ??= {}) : {};
  const badge = extractBrowserBadge(toolName, args);
  if (context?.state) context.state.badge = badge;
  return {
    compactLeftMargin: 1,
    invalidate() {},
    render(width: number): string[] {
      if (state.hasResult) return [];
      const safeWidth = Number.isFinite(width) ? Math.floor(width) : 0;
      if (safeWidth <= 0) return [];
      if (safeWidth === 1) return [' '];
      return rowLine([theme?.fg?.('toolTitle', toolName) ?? toolName, badge, `${DIM}running…${RESET}`], safeWidth - 1).map((line) => ` ${line}`);
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
  const state: BrowserRowState = context ? (context.state ??= {}) : {};
  const isError = Boolean(
    context?.isError ||
      result?.isError ||
      result?.details?.status === 'failure' ||
      result?.details?.error,
  );
  state.hasResult = true;
  state.isError = isError;
  state.isPartial = Boolean(options?.isPartial);
  state.expanded = Boolean(options?.expanded);

  const data = result?.details?.data ?? result?.details;

  return {
    compactLeftMargin: 1,
    invalidate() {},
    render(width: number): string[] {
      const safeWidth = Number.isFinite(width) ? Math.floor(width) : 0;
      if (safeWidth <= 0) return [];
      if (safeWidth === 1) return [' '];
      const innerWidth = safeWidth - 1;

      let head: Array<string | undefined>;
      if (state.isPartial) {
        head = [theme?.fg?.('toolTitle', toolName) ?? toolName, state.badge, `${DIM}running…${RESET}`];
      } else if (isError) {
        const errorMsg =
          result?.details?.error?.message ??
          result?.details?.error ??
          result?.content?.[0]?.text ??
          `${toolName} failed`;
        head = [theme?.fg?.('error', toolName) ?? toolName, `error · ${fit(stripAnsi(String(errorMsg)), 140)}`];
      } else {
        let summary = `${toolName} complete`;
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
        }
        head = [theme?.fg?.('toolTitle', toolName) ?? toolName, summary];
      }

      const lines = rowLine(head, innerWidth).map((line) => ` ${line}`);
      if (!state.expanded || state.isPartial) return lines;

      // Returned content always stays reachable: metadata first, then every text block.
      const contentParts = (result?.content ?? [])
        .filter((part: any) => part?.type === 'text' && typeof part.text === 'string')
        .flatMap((part: any) => expandedLines(part.text, innerWidth));
      const metaLines = isError
        ? []
        : buildBrowserExpandedLines(toolName, data).flatMap((line) => (line === '' ? [''] : expandedLines(line, innerWidth)));
      const detailLines = [...metaLines, ...(metaLines.length > 0 && contentParts.length > 0 ? [''] : []), ...contentParts];
      if (detailLines.length === 0) return lines;
      return [...lines, ...detailLines.map((line) => ` ${line}`)];
    },
  };
}
