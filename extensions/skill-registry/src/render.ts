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
      return rowLine([theme?.fg?.('toolTitle', toolName) ?? toolName, badge, `${DIM}running…${RESET}`], safeWidth - 1).map((line) => ` ${line}`);
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
        head = [theme?.fg?.('error', toolName) ?? toolName, `error · ${fit(stripAnsi(String(errorMsg)), 140)}`];
      } else {
        const summary =
          toolName === 'skill_registry_generate'
            ? buildGenerateSummary(result)
            : buildResolveSummary(result);
        head = [theme?.fg?.('toolTitle', toolName) ?? toolName, summary];
      }

      const lines = rowLine(head, innerWidth).map((line) => ` ${line}`);
      if (!state.expanded || state.isPartial) return lines;

      const contentParts = (result?.content ?? [])
        .filter((part: any) => part?.type === 'text' && typeof part.text === 'string')
        .flatMap((part: any) => expandedLines(part.text, innerWidth));

      const detailLines = isError
        ? contentParts
        : toolName === 'skill_registry_generate'
          ? contentParts
          : [
              ...formatResolveExpandedLines(result?.details).flatMap((line) =>
                line === '' ? [''] : expandedLines(line, innerWidth),
              ),
              ...(contentParts.length > 0 ? ['', ...contentParts] : []),
            ];

      if (detailLines.length === 0) return lines;
      return [...lines, ...detailLines.map((line: string) => ` ${line}`)];
    },
  };
}
