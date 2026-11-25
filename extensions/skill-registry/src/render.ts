export type Component = {
  compactLeftMargin?: number;
  render(width: number): string[];
  invalidate(): void;
};

export interface SkillRegistryRenderOptions {
  expanded?: boolean;
  isPartial?: boolean;
}

export const RESET = '\x1b[0m';
/** Short inline row separator; not a card frame. */
export const ROW_SEPARATOR = ' ─ ';
/** Presentation-only marker: declares compact, unboxed, single-row compliance with 1-col margin. */
export const COMPACT_TOOL_RENDERING = { compactToolRenderingVersion: 1, compactLeftMargin: 1 } as const;

export interface SkillRegistryRowState {
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
export const MUTED = '\x1b[38;2;122;167;184m';

const ANSI_REGEX = /\u001b\][^\u001b\u0007]*(?:\u001b\\|\u0007)|\u001b\[[0-?]*[ -/]*[@-~]/g;
const ANSI_TOKEN_RE = /(\u001b\][^\u001b\u0007]*(?:\u001b\\|\u0007)|\u001b\[[0-?]*[ -/]*[@-~])/g;
const ANSI_ESCAPE_RE = /\u001b(?:\[|\])/;
const ZERO_WIDTH_CLUSTER_RE = /^(?:\p{Default_Ignorable_Code_Point}|\p{Control}|\p{Mark})+$/u;
const EMOJI_PRESENTATION_RE = /^\p{Emoji_Presentation}/u;
const graphemeSegmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  : undefined;

function segmentText(text: string): string[] {
  if (!graphemeSegmenter) return [...text];
  return [...graphemeSegmenter.segment(text)].map((entry) => entry.segment);
}

function isPrintableAscii(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x20 || code > 0x7e) return false;
  }
  return true;
}

function isFullWidthCodePoint(codePoint: number): boolean {
  return codePoint >= 0x1100 && (
    codePoint <= 0x115f
    || codePoint === 0x231a || codePoint === 0x231b
    || codePoint === 0x2329 || codePoint === 0x232a
    || (codePoint >= 0x23e9 && codePoint <= 0x23ec)
    || codePoint === 0x23f0 || codePoint === 0x23f3
    || (codePoint >= 0x25fd && codePoint <= 0x25fe)
    || (codePoint >= 0x2614 && codePoint <= 0x2615)
    || (codePoint >= 0x2648 && codePoint <= 0x2653)
    || codePoint === 0x267f || codePoint === 0x2693 || codePoint === 0x26a1
    || (codePoint >= 0x26aa && codePoint <= 0x26ab)
    || (codePoint >= 0x26bd && codePoint <= 0x26be)
    || (codePoint >= 0x26c4 && codePoint <= 0x26c5)
    || codePoint === 0x26ce || codePoint === 0x26d4 || codePoint === 0x26ea
    || (codePoint >= 0x26f2 && codePoint <= 0x26f3)
    || codePoint === 0x26f5 || codePoint === 0x26fa || codePoint === 0x26fd
    || codePoint === 0x2705 || (codePoint >= 0x270a && codePoint <= 0x270b)
    || codePoint === 0x2728 || codePoint === 0x274c || codePoint === 0x274e
    || (codePoint >= 0x2753 && codePoint <= 0x2755) || codePoint === 0x2757
    || (codePoint >= 0x2795 && codePoint <= 0x2797) || codePoint === 0x27b0 || codePoint === 0x27bf
    || (codePoint >= 0x2b1b && codePoint <= 0x2b1c) || codePoint === 0x2b50 || codePoint === 0x2b55
    || (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f)
    || (codePoint >= 0xac00 && codePoint <= 0xd7a3)
    || (codePoint >= 0xf900 && codePoint <= 0xfaff)
    || (codePoint >= 0xfe10 && codePoint <= 0xfe19)
    || (codePoint >= 0xfe30 && codePoint <= 0xfe6f)
    || (codePoint >= 0xff00 && codePoint <= 0xff60)
    || (codePoint >= 0xffe0 && codePoint <= 0xffe6)
    || codePoint === 0x1f004 || codePoint === 0x1f0cf
    || (codePoint >= 0x1f1e6 && codePoint <= 0x1f1ff)
    || (codePoint >= 0x1f300 && codePoint <= 0x1fbff)
    || (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  );
}

export function stripAnsi(str: string): string {
  return str.replace(ANSI_REGEX, '');
}

function hasAnsi(text: string): boolean {
  return ANSI_ESCAPE_RE.test(text);
}

function styleMuted(theme: any, text: string): string {
  if (!text) return text;
  if (typeof theme?.fg === 'function') {
    const styled = theme.fg('muted', text);
    if (typeof styled === 'string' && styled !== text) return styled;
  }
  return `${MUTED}${text}${RESET}`;
}

export function charWidth(char: string): number {
  if (char === '\t') return 3;
  if (ZERO_WIDTH_CLUSTER_RE.test(char)) return 0;
  if (EMOJI_PRESENTATION_RE.test(char) || char.includes('\uFE0F') || char.includes('\u200D')) return 2;
  const codePoint = char.codePointAt(0);
  if (codePoint === undefined) return 0;
  return isFullWidthCodePoint(codePoint) ? 2 : 1;
}

export function visibleWidth(str: string): number {
  if (!str) return 0;
  if (isPrintableAscii(str)) return str.length;
  const clean = stripAnsi(str);
  if (isPrintableAscii(clean)) return clean.length;
  let width = 0;
  for (const segment of segmentText(clean)) width += charWidth(segment);
  return width;
}

function firstPrintingGraphemeWidth(plain: string): number {
  for (const segment of segmentText(plain)) {
    const w = charWidth(segment);
    if (w > 0) return w;
  }
  return 0;
}

function needsWidth2MarginOmission(line: string, totalWidth: number): boolean {
  if (totalWidth !== 2) return false;
  const plain = stripAnsi(line);
  if (plain === '') return false;
  return visibleWidth(plain) === 2 && firstPrintingGraphemeWidth(plain) === 2;
}

function formatMarginedLine(line: string, totalWidth: number): string {
  if (totalWidth <= 0) return '';
  if (totalWidth === 1) return ' ';
  if (needsWidth2MarginOmission(line, totalWidth)) return line;
  return ` ${line}`;
}

export function truncateWithAnsi(str: string, maxWidth: number): string {
  if (maxWidth <= 0) return '';
  if (visibleWidth(str) <= maxWidth) return str;

  let visible = 0;
  let result = '';
  for (const part of str.split(ANSI_TOKEN_RE)) {
    if (!part) continue;
    if (part.startsWith('\u001b')) {
      result += part;
      continue;
    }
    for (const segment of segmentText(part)) {
      const w = charWidth(segment);
      if (visible + w > maxWidth) return `${result}${RESET}`;
      result += segment;
      visible += w;
    }
  }
  return `${result}${RESET}`;
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

function wrapAnsiForWidth2(rawLine: string): string[] {
  if (rawLine === '') return [''];
  if (visibleWidth(rawLine) <= 1) return [rawLine];
  const out: string[] = [];
  let current = '';
  let currentWidth = 0;
  let chunkLimit = 1;
  let activeSgr = '';
  let pendingAnsi = '';

  const flush = () => {
    const terminated = activeSgr && !current.endsWith(RESET) ? `${current}${RESET}` : current;
    out.push(terminated);
    current = activeSgr;
    currentWidth = 0;
    chunkLimit = 1;
  };

  const applyPending = () => {
    if (!pendingAnsi) return;
    current += pendingAnsi;
    pendingAnsi = '';
  };

  for (const part of rawLine.split(ANSI_TOKEN_RE)) {
    if (!part) continue;
    if (part.startsWith('\u001b[')) {
      if (part === RESET || part === '\u001b[m') {
        if (pendingAnsi) {
          current += pendingAnsi;
          pendingAnsi = '';
        }
        current += part;
        activeSgr = '';
      } else {
        pendingAnsi += part;
        if (part.endsWith('m')) activeSgr += part;
      }
      continue;
    }
    if (part.startsWith('\u001b]')) {
      pendingAnsi += part;
      continue;
    }
    for (const segment of segmentText(part)) {
      const expanded = segment === '\t' ? [' ', ' ', ' '] : [segment];
      for (const piece of expanded) {
        const gw = charWidth(piece);
        if (gw === 0) {
          applyPending();
          current += piece;
          continue;
        }
        if (gw > 1 && gw <= 2) {
          if (currentWidth > 0) flush();
          applyPending();
          chunkLimit = 2;
          current += piece;
          currentWidth = gw;
          continue;
        }
        if (currentWidth > 0 && currentWidth + gw > chunkLimit) flush();
        applyPending();
        current += piece;
        currentWidth += gw;
      }
    }
  }
  if (pendingAnsi) {
    current += pendingAnsi;
    pendingAnsi = '';
  }
  if (current !== activeSgr || out.length === 0) {
    const terminated = activeSgr && !current.endsWith(RESET) ? `${current}${RESET}` : current;
    out.push(terminated);
  }
  return out;
}

type WrapAtom = { ansi?: string; text?: string; width: number };
type WrapUnit = { isSpace: boolean; parts: WrapAtom[]; width: number };

function tokenizeWrapUnits(rawLine: string): WrapUnit[] {
  const units: WrapUnit[] = [];
  let current: WrapUnit | undefined;
  let pendingAnsi: WrapAtom[] = [];

  const pushAtom = (isSpace: boolean, atom: WrapAtom) => {
    if (!current || current.isSpace !== isSpace) {
      current = { isSpace, parts: [], width: 0 };
      units.push(current);
    }
    if (pendingAnsi.length > 0) {
      current.parts.push(...pendingAnsi);
      pendingAnsi = [];
    }
    current.parts.push(atom);
    current.width += atom.width;
  };

  for (const part of rawLine.split(ANSI_TOKEN_RE)) {
    if (!part) continue;
    if (part.startsWith('\u001b')) {
      if ((part === RESET || part === '\u001b[m') && current) {
        current.parts.push({ ansi: part, width: 0 });
      } else {
        pendingAnsi.push({ ansi: part, width: 0 });
      }
      continue;
    }
    for (const segment of segmentText(part)) {
      if (segment === ' ') pushAtom(true, { text: ' ', width: 1 });
      else if (segment === '\t') pushAtom(true, { text: '   ', width: 3 });
      else pushAtom(false, { text: segment, width: charWidth(segment) });
    }
  }

  if (pendingAnsi.length > 0) {
    if (current) current.parts.push(...pendingAnsi);
    else units.push({ isSpace: false, parts: pendingAnsi, width: 0 });
  }
  return units;
}

function wrapSingleLine(rawLine: string, width: number, allowWidth2Wide = false): string[] {
  if (width <= 0) return [];
  if (rawLine === '') return [''];
  if (visibleWidth(rawLine) <= width) return [rawLine];
  if (isPrintableAscii(rawLine) && !rawLine.includes(' ')) {
    const chunks: string[] = [];
    for (let i = 0; i < rawLine.length; i += width) chunks.push(rawLine.slice(i, i + width));
    return chunks;
  }
  if (allowWidth2Wide && width === 1) return wrapAnsiForWidth2(rawLine);

  const units = tokenizeWrapUnits(rawLine);
  const lines: string[] = [];
  let current = '';
  let currentWidth = 0;
  let activeSgr = '';
  let lineHasContent = false;
  let pendingSpace: WrapUnit | undefined;

  const updateSgr = (code: string) => {
    if (code === RESET || code === '\u001b[m') activeSgr = '';
    else if (code.startsWith('\u001b[') && code.endsWith('m')) activeSgr += code;
  };

  const applyParts = (parts: WrapAtom[]) => {
    for (const part of parts) {
      if (part.ansi !== undefined) {
        updateSgr(part.ansi);
        current += part.ansi;
      } else if (part.text !== undefined) {
        current += part.text;
        currentWidth += part.width;
        lineHasContent = true;
      }
    }
  };

  const applyAnsiOnly = (parts: WrapAtom[]) => {
    for (const part of parts) {
      if (part.ansi !== undefined) updateSgr(part.ansi);
    }
  };

  const flush = () => {
    const terminated = activeSgr && !current.endsWith(RESET) ? `${current}${RESET}` : current;
    lines.push(terminated);
    current = activeSgr;
    currentWidth = 0;
    lineHasContent = false;
  };

  for (const unit of units) {
    if (unit.isSpace) {
      if (currentWidth === 0 && lines.length === 0) {
        if (unit.width <= width) applyParts(unit.parts);
        else applyAnsiOnly(unit.parts);
      } else if (currentWidth > 0) {
        pendingSpace = unit;
      } else {
        applyAnsiOnly(unit.parts);
        current = activeSgr;
      }
      continue;
    }

    const spaceWidth = pendingSpace ? pendingSpace.width : 0;
    if (currentWidth + spaceWidth + unit.width <= width) {
      if (pendingSpace) {
        applyParts(pendingSpace.parts);
        pendingSpace = undefined;
      }
      applyParts(unit.parts);
      continue;
    }

    if (currentWidth > 0) flush();
    if (pendingSpace) {
      applyAnsiOnly(pendingSpace.parts);
      current = activeSgr;
      pendingSpace = undefined;
    }

    if (unit.width <= width) {
      applyParts(unit.parts);
      continue;
    }

    for (const part of unit.parts) {
      if (part.ansi !== undefined) {
        if (part.ansi === RESET || part.ansi === '\u001b[m') {
          current += part.ansi;
          activeSgr = '';
        } else {
          updateSgr(part.ansi);
          current += part.ansi;
        }
      } else if (part.text !== undefined) {
        if (currentWidth > 0 && currentWidth + part.width > width) flush();
        current += part.text;
        currentWidth += part.width;
        lineHasContent = true;
      }
    }
  }

  if (lineHasContent || lines.length === 0) {
    const terminated = activeSgr && !current.endsWith(RESET) ? `${current}${RESET}` : current;
    lines.push(terminated);
  }
  return lines;
}

/** Compact inline header wrapped ANSI-aware without ellipsis clipping. */
export function rowLine(parts: Array<string | undefined | null>, width: number, totalWidth?: number): string[] {
  if (width <= 0) return [];
  const line = parts
    .filter((part): part is string => Boolean(part && part.trim()))
    .map((part) => part.replace(/[\r\n]+/g, ' '))
    .join(ROW_SEPARATOR);
  if (!line) return [];
  return wrapSingleLine(line, width, totalWidth === 2);
}

/** Wrap expanded content losslessly, preserving blank-line meaning. */
export function expandedLines(text: string, width: number, totalWidth?: number): string[] {
  if (width <= 0) return [];
  const allowWidth2Wide = totalWidth === 2;
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (raw === '') {
      out.push('');
      continue;
    }
    out.push(...wrapSingleLine(raw, width, allowWidth2Wide));
  }
  return out;
}

function formatExpandedBody(rawLines: string[], innerWidth: number, totalWidth: number, theme?: any): string[] {
  const out: string[] = [];
  for (const raw of rawLines) {
    if (raw === '') {
      out.push(' ');
      continue;
    }
    const preStyled = hasAnsi(raw);
    for (const wrapped of wrapSingleLine(raw, innerWidth, totalWidth === 2)) {
      const styled = preStyled || wrapped === '' ? wrapped : styleMuted(theme, wrapped);
      out.push(formatMarginedLine(styled, totalWidth));
    }
  }
  return out;
}

export function extractSkillRegistryAction(toolName: string, args: any): string | undefined {
  if (!args || typeof args !== 'object') {
    return toolName === 'skill_registry_generate' ? 'generate' : 'resolve';
  }

  if (toolName === 'skill_registry_generate') {
    if (args.write === false) return 'write: false';
    return 'generate';
  }

  if (toolName === 'skill_registry_resolve') {
    if (typeof args.workflow_phase === 'string' && args.workflow_phase) {
      return `phase: ${args.workflow_phase}`;
    }
    if (Array.isArray(args.paths) && args.paths.length > 0) {
      return `paths: ${args.paths.join(', ')}`;
    }
    if (typeof args.intent === 'string' && args.intent) {
      return `intent: ${args.intent}`;
    }
    return 'resolve';
  }

  return undefined;
}

export function renderSkillRegistryCall(
  toolName: string,
  args: any,
  theme?: any,
  context?: any,
): Component {
  const state: SkillRegistryRowState = context ? (context.state ??= {}) : {};
  const badge = extractSkillRegistryAction(toolName, args);
  if (context?.state) context.state.badge = badge;
  return {
    compactLeftMargin: 1,
    invalidate() {},
    render(width: number): string[] {
      if (state.hasResult) return [];
      const safeWidth = Number.isFinite(width) ? Math.floor(width) : 0;
      if (safeWidth <= 0) return [];
      if (safeWidth === 1) return [' '];
      return rowLine([theme?.fg?.('toolTitle', toolName) ?? toolName, badge, `${DIM}running…${RESET}`], safeWidth - 1, safeWidth).map((line) =>
        formatMarginedLine(line, safeWidth),
      );
    },
  };
}

function buildGenerateSummary(result: any): string {
  const reg = result?.details?.registry;
  const count = reg?.skill_count ?? 0;
  const warnCount = reg?.warnings?.length ?? 0;
  const writeRes = result?.details?.write_result;

  let writeStatus = 'dry run';
  if (writeRes) {
    const jsonStr = writeRes.json_changed ? 'json updated' : 'json unchanged';
    const mdStr = writeRes.markdown_changed ? 'markdown updated' : 'markdown unchanged';
    writeStatus = `${jsonStr}, ${mdStr}`;
  } else if (result?.details?.write_result === null) {
    writeStatus = 'write skipped';
  }

  return `✓ ${count} skill(s), ${warnCount} warning(s) · ${writeStatus}`;
}

function buildResolveSummary(result: any): string {
  const details = result?.details;
  const direct = Array.isArray(details?.matches) ? details.matches.length : 0;
  const related = Array.isArray(details?.related_matches) ? details.related_matches.length : 0;
  const cache = details?.registry_status?.cache ?? 'unknown';
  const warnings = Array.isArray(details?.warnings) ? details.warnings.length : 0;

  let text = `✓ skill registry: ${direct} direct, ${related} related, cache ${cache}`;
  if (warnings > 0) {
    text += `, ${warnings} warn`;
  }
  return text;
}

function formatResolveExpandedLines(details: any): string[] {
  const lines: string[] = [];
  if (details?.registry_status) {
    lines.push(
      `source ${details.registry_status.source}, cache ${details.registry_status.cache} · hash ${String(details.registry_status.live_hash ?? '').slice(0, 10)}...`,
    );
  }
  if (details?.query?.paths?.length) {
    lines.push(`paths: ${details.query.paths.join(', ')}`);
  }

  const matches = Array.isArray(details?.matches) ? details.matches : [];
  if (matches.length > 0) {
    lines.push('', 'direct matches:');
    for (const [index, match] of matches.entries()) {
      const role = index === 0 ? 'primary' : index <= 2 ? 'secondary' : 'direct';
      lines.push(
        `${String(match.score).padStart(3, ' ')} · ${String(match.priority).padStart(2, ' ')} · ${match.name} · ${match.path} · ${role}`,
      );
      if (Array.isArray(match.reasons) && match.reasons.length > 0) {
        const topReasons = match.reasons.slice(0, 3).map((r: any) => r.detail ?? r);
        lines.push(`  - reasons: ${topReasons.join(', ')}`);
      }
      if (match.read_before_acting) {
        lines.push(`  - ${match.read_before_acting}`);
      }
    }
  }

  const related = Array.isArray(details?.related_matches) ? details.related_matches : [];
  if (related.length > 0) {
    lines.push('', 'related matches:');
    for (const match of related) {
      lines.push(`  - ${match.name} · ${match.path}`);
      if (match.related_from?.length) {
        lines.push(`    - related from: ${match.related_from.join(', ')}`);
      }
      if (match.relation_reasons?.length) {
        lines.push(`    - reasons: ${match.relation_reasons.join(', ')}`);
      }
      if (match.read_before_acting) {
        lines.push(`    - ${match.read_before_acting}`);
      }
    }
  }

  const guidance = Array.isArray(details?.guidance) ? details.guidance : [];
  if (guidance.length > 0) {
    lines.push('', 'guidance:');
    for (const item of guidance.slice(0, 4)) {
      lines.push(`- ${item}`);
    }
  }

  const warnings = Array.isArray(details?.warnings) ? details.warnings : [];
  if (warnings.length > 0) {
    lines.push('', 'warnings:');
    for (const warning of warnings.slice(0, 20)) {
      lines.push(`- ${warning}`);
    }
    if (warnings.length > 20) {
      lines.push(`- ... and ${warnings.length - 20} more warnings`);
    }
  }

  return lines;
}

export function renderSkillRegistryResult(
  toolName: string,
  result: any,
  options: SkillRegistryRenderOptions = {},
  theme?: any,
  context?: any,
): Component {
  const state: SkillRegistryRowState = context ? (context.state ??= {}) : {};
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
        head = [
          theme?.fg?.('toolTitle', toolName) ?? toolName,
          state.badge,
          `${DIM}running…${RESET}`,
        ];
      } else if (isError) {
        const errorMsg =
          result?.details?.error?.message ??
          result?.details?.error ??
          result?.content?.[0]?.text ??
          'tool failed';
        head = [
          theme?.fg?.('error', toolName) ?? toolName,
          `error · ${stripAnsi(String(errorMsg)).replace(/\s+/g, ' ').trim()}`,
        ];
      } else {
        const summary =
          toolName === 'skill_registry_generate'
            ? buildGenerateSummary(result)
            : buildResolveSummary(result);
        head = [theme?.fg?.('toolTitle', toolName) ?? toolName, summary];
      }

      const lines = rowLine(head, innerWidth, safeWidth).map((line) => formatMarginedLine(line, safeWidth));
      if (!state.expanded || state.isPartial) return lines;

      const contentRawLines = (result?.content ?? [])
        .filter((part: any) => part?.type === 'text' && typeof part.text === 'string')
        .flatMap((part: any) => String(part.text).split(/\r?\n/));

      const rawDetailLines = isError
        ? contentRawLines
        : toolName === 'skill_registry_generate'
          ? contentRawLines
          : [
              ...formatResolveExpandedLines(result?.details),
              ...(contentRawLines.length > 0 ? ['', ...contentRawLines] : []),
            ];

      if (rawDetailLines.length === 0) return lines;
      return [...lines, ...formatExpandedBody(rawDetailLines, innerWidth, safeWidth, theme)];
    },
  };
}
