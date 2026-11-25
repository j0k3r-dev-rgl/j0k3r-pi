const RESET = '\x1b[0m';
const MUTED_FALLBACK = '\x1b[38;2;122;167;184m';
const FG_RESET = '\x1b[39m';
const HAS_SGR_RE = /\x1b\[[0-9;]*m/;
const PURE_FG_SGR_RE = /^\x1b\[(?:3[0-7]|9[0-7]|38;[0-9;]+)m$/;
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const ZERO_WIDTH_RE = /^(?:\p{Default_Ignorable_Code_Point}|\p{Control}|\p{Mark}|\p{Surrogate})+$/u;
const WIDE_CHAR_RE = /[\u1100-\u115f\u231a-\u231b\u2329-\u232a\u23e9-\u23ec\u23f0\u23f3\u25fd-\u25fe\u2614-\u2615\u2648-\u2653\u267f\u2693\u26a1\u26aa-\u26ab\u26bd-\u26be\u26c4-\u26c5\u26ce\u26d4\u26ea\u26f2-\u26f3\u26f5\u26fa\u26fd\u2705\u270a-\u270b\u2728\u274c\u274e\u2753-\u2755\u2757\u2795-\u2797\u27b0\u27bf\u2b1b-\u2b1c\u2b50\u2b55\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]|\p{Extended_Pictographic}/u;

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

function stripControl(str: string): string {
  if (!str.includes('\x1b')) return str;
  let out = '';
  let i = 0;
  while (i < str.length) {
    const seq = matchEscapeAt(str, i);
    if (seq) {
      i += seq.length;
      continue;
    }
    out += str[i];
    i++;
  }
  return out;
}

function graphemeWidth(segment: string): number {
  if (segment === '\t') return 3;
  if (segment.length === 1) {
    const code = segment.charCodeAt(0);
    if (code >= 0x20 && code <= 0x7e) return 1;
  }
  if (ZERO_WIDTH_RE.test(segment)) return 0;
  return WIDE_CHAR_RE.test(segment) ? 2 : 1;
}

function visibleWidth(str: string): number {
  if (!str) return 0;
  let width = 0;
  for (const { segment } of graphemeSegmenter.segment(stripControl(str))) {
    width += graphemeWidth(segment);
  }
  return width;
}

function truncateWithAnsi(str: string, maxWidth: number, ellipsis = ''): string {
  if (maxWidth <= 0) return '';
  if (visibleWidth(str) <= maxWidth) return str;
  const ell = visibleWidth(ellipsis) < maxWidth ? ellipsis : '';
  const targetWidth = Math.max(0, maxWidth - visibleWidth(ell));
  let visible = 0;
  let result = '';
  let activeOsc8 = false;
  let i = 0;

  while (i < str.length) {
    const seq = matchEscapeAt(str, i);
    if (seq) {
      result += seq;
      if (seq.startsWith('\x1b]8;')) {
        const oscMatch = seq.match(/^\x1b\]8;[^;]*;([^\x07\x1b]*)(?:\x07|\x1b\\)$/);
        if (oscMatch) activeOsc8 = Boolean(oscMatch[1]);
      }
      i += seq.length;
      continue;
    }
    let end = i + 1;
    while (end < str.length && !matchEscapeAt(str, end)) end++;
    let overflowed = false;
    for (const { segment } of graphemeSegmenter.segment(str.slice(i, end))) {
      const w = graphemeWidth(segment);
      if (visible + w > targetWidth) {
        overflowed = true;
        break;
      }
      result += segment;
      visible += w;
    }
    if (overflowed) break;
    i = end;
  }

  if (activeOsc8) result += '\x1b]8;;\x07';
  result += `${RESET}${ell}${ell ? RESET : ''}`;
  return result;
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

type AnsiState = { sgr: string[]; osc8: string };

function applyEscape(state: AnsiState, seq: string): void {
  if (seq.startsWith('\x1b[') && seq.endsWith('m')) {
    const params = seq.slice(2, -1);
    if (params === '' || params.split(';').includes('0')) {
      state.sgr = [];
    } else if (params === '39' && state.sgr.every((entry) => PURE_FG_SGR_RE.test(entry))) {
      state.sgr = [];
    } else {
      state.sgr.push(seq);
    }
    return;
  }
  if (seq.startsWith('\x1b]8;')) {
    const oscMatch = seq.match(/^\x1b\]8;[^;]*;([^\x07\x1b]*)(?:\x07|\x1b\\)$/);
    if (oscMatch) state.osc8 = oscMatch[1] ? seq : '';
  }
}

function applyEscapesInText(state: AnsiState, text: string): void {
  if (!text.includes('\x1b')) return;
  let i = 0;
  while (i < text.length) {
    const seq = matchEscapeAt(text, i);
    if (seq) {
      applyEscape(state, seq);
      i += seq.length;
      continue;
    }
    i++;
  }
}

function openAnsi(state: AnsiState): string {
  return state.sgr.join('') + state.osc8;
}

function closeAnsi(state: AnsiState): string {
  return (state.osc8 ? '\x1b]8;;\x07' : '') + (state.sgr.length > 0 ? RESET : '');
}

function wrapWidth2WithConditionalMargin(line: string): string[] {
  const normalized = line.replace(/\t/g, '   ');
  if (!normalized) return [' '];

  const state: AnsiState = { sgr: [], osc8: '' };
  const out: string[] = [];
  let i = 0;

  while (i < normalized.length) {
    const seq = matchEscapeAt(normalized, i);
    if (seq) {
      applyEscape(state, seq);
      i += seq.length;
      continue;
    }
    let end = i + 1;
    while (end < normalized.length && !matchEscapeAt(normalized, end)) end++;
    for (const { segment } of graphemeSegmenter.segment(normalized.slice(i, end))) {
      const w = graphemeWidth(segment);
      if (w === 0) continue;
      const prefix = openAnsi(state);
      const suffix = closeAnsi(state);
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

function wrapLineToWidth(line: string, width: number): string[] {
  if (width <= 0) return [];
  const normalized = line.replace(/\t/g, '   ');
  if (!normalized) return [''];
  if (visibleWidth(normalized) <= width) return [normalized];

  type Token = { kind: 'space' | 'word'; text: string; width: number };
  const tokens: Token[] = [];
  let pendingEsc = '';
  let i = 0;

  const pushToken = (kind: 'space' | 'word', text: string, w: number, forceNew = false) => {
    const prev = tokens[tokens.length - 1];
    if (!forceNew && prev && prev.kind === kind) {
      prev.text += text;
      prev.width += w;
    } else {
      tokens.push({ kind, text, width: w });
    }
  };

  while (i < normalized.length) {
    const seq = matchEscapeAt(normalized, i);
    if (seq) {
      pendingEsc += seq;
      i += seq.length;
      continue;
    }
    let end = i + 1;
    while (end < normalized.length && !matchEscapeAt(normalized, end)) end++;
    for (const { segment } of graphemeSegmenter.segment(normalized.slice(i, end))) {
      const w = graphemeWidth(segment);
      if (segment === ' ') {
        pushToken('space', pendingEsc + segment, w);
        pendingEsc = '';
      } else if (w >= 2) {
        pushToken('word', pendingEsc + segment, w, true);
        pendingEsc = '';
      } else {
        pushToken('word', pendingEsc + segment, w);
        pendingEsc = '';
      }
    }
    i = end;
  }
  if (pendingEsc) {
    if (tokens.length > 0) {
      tokens[tokens.length - 1].text += pendingEsc;
    } else {
      tokens.push({ kind: 'word', text: pendingEsc, width: 0 });
    }
  }

  const out: string[] = [];
  const state: AnsiState = { sgr: [], osc8: '' };
  let current = '';
  let currentWidth = 0;

  const flushCurrent = () => {
    out.push(current + closeAnsi(state));
    current = '';
    currentWidth = 0;
  };

  for (const token of tokens) {
    if (token.kind === 'space') {
      if (currentWidth === 0 && out.length > 0) {
        applyEscapesInText(state, token.text);
        continue;
      }
      if (currentWidth > 0 && currentWidth + token.width > width) {
        flushCurrent();
        applyEscapesInText(state, token.text);
        continue;
      }
      if (token.width > width) {
        if (current === '') current = openAnsi(state);
        applyEscapesInText(state, token.text);
        const take = Math.min(token.width, width - currentWidth);
        current += ' '.repeat(take);
        currentWidth += take;
        continue;
      }
      if (current === '') current = openAnsi(state);
      current += token.text;
      currentWidth += token.width;
      applyEscapesInText(state, token.text);
      continue;
    }

    if (token.width <= width) {
      if (currentWidth > 0 && currentWidth + token.width > width) {
        flushCurrent();
      }
      if (current === '') current = openAnsi(state);
      current += token.text;
      currentWidth += token.width;
      applyEscapesInText(state, token.text);
      continue;
    }

    if (currentWidth > 0) {
      flushCurrent();
    }
    let j = 0;
    while (j < token.text.length) {
      const seq = matchEscapeAt(token.text, j);
      if (seq) {
        applyEscape(state, seq);
        if (current !== '') current += seq;
        j += seq.length;
        continue;
      }
      let segEnd = j + 1;
      while (segEnd < token.text.length && !matchEscapeAt(token.text, segEnd)) segEnd++;
      for (const { segment } of graphemeSegmenter.segment(token.text.slice(j, segEnd))) {
        const w = graphemeWidth(segment);
        if (w > width) continue;
        if (currentWidth > 0 && currentWidth + w > width) {
          flushCurrent();
        }
        if (current === '') current = openAnsi(state);
        current += segment;
        currentWidth += w;
      }
      j = segEnd;
    }
  }

  if (current || out.length === 0) {
    out.push(state.osc8 ? `${current}\x1b]8;;\x07` : current);
  }
  return out.map((item) => (visibleWidth(item) > width ? truncateWithAnsi(item, width, '') : item));
}

function wrapMarginedLine(line: string, safeWidth: number): string[] {
  if (safeWidth <= 0) return [];
  if (safeWidth === 1) return [' '];
  if (safeWidth === 2) return wrapWidth2WithConditionalMargin(line);
  const innerWidth = safeWidth - 1;
  return wrapLineToWidth(line, innerWidth).map((piece) => ` ${piece}`);
}

function wrapMutedBody(text: string, theme: any, safeWidth: number): string[] {
  if (safeWidth <= 0 || !text) return [];
  if (safeWidth === 1) return [' '];
  const out: string[] = [];
  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    const styled = mutePlainLine(theme, rawLine);
    out.push(...wrapMarginedLine(styled, safeWidth));
  }
  return out;
}

function fg(theme: any, token: string, text: string): string {
  try {
    return typeof theme?.fg === 'function' ? theme.fg(token, text) : text;
  } catch {
    return text;
  }
}

function inlineText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function actionBadge(args: any): string {
  if (!args || typeof args !== 'object') return 'checkpoint';
  const parts: string[] = [];
  if (typeof args.memory_id === 'number' || typeof args.memory_id === 'string') {
    parts.push(`checkpoint #${args.memory_id}`);
  } else {
    parts.push('checkpoint');
  }
  if (args.continue_task === true) parts.push('continue');
  return parts.join(' · ');
}

export function supervisorRotateRenderers() {
  return {
    compactToolRenderingVersion: 1 as const,
    compactLeftMargin: 1 as const,
    renderShell: 'self' as const,

    renderCall(args: any, theme: any, context?: any) {
      return {
        compactLeftMargin: 1 as const,
        invalidate() {},
        render(width: number): string[] {
          const safeWidth = Number.isFinite(width) ? Math.floor(width) : 0;
          try {
            if (safeWidth <= 0) return [];
            if (context?.state?.hasResult) return [];
            if (safeWidth === 1) return [' '];
            const badge = actionBadge(args);
            const title = fg(theme, 'toolTitle', 'supervisor_rotate');
            const tag = fg(theme, 'dim', `[${badge}]`);
            const sep = fg(theme, 'dim', '───');
            const status = fg(theme, 'accent', '● checkpointing…');
            return wrapMarginedLine(`${title} ${tag} ${sep} ${status}`, safeWidth);
          } catch {
            if (safeWidth <= 0) return [];
            return wrapMarginedLine('supervisor_rotate', safeWidth);
          }
        },
      };
    },

    renderResult(
      result: { content?: Array<{ type?: string; text?: string }>; details?: any; isError?: boolean },
      options: { expanded?: boolean; isPartial?: boolean } = {},
      theme: any,
      context?: any,
    ) {
      try {
        if (context?.state) {
          context.state.hasResult = true;
        }
      } catch {
        // Ignore malformed context
      }

      return {
        compactLeftMargin: 1 as const,
        invalidate() {},
        render(width: number): string[] {
          const safeWidth = Number.isFinite(width) ? Math.floor(width) : 0;
          try {
            if (safeWidth <= 0) return [];
            if (safeWidth === 1) return [' '];
            const badge = actionBadge(context?.args);
            const title = fg(theme, 'toolTitle', 'supervisor_rotate');
            const tag = fg(theme, 'dim', `[${badge}]`);
            const sep = fg(theme, 'dim', '───');

            if (options?.isPartial) {
              return wrapMarginedLine(`${title} ${tag} ${sep} ${fg(theme, 'accent', '● rotating…')}`, safeWidth);
            }

            const blocks = Array.isArray(result?.content) ? result.content : [];
            const text = blocks
              .filter((b) => b?.type === 'text' && typeof b.text === 'string')
              .map((b) => b.text as string)
              .join('\n');
            const details = result?.details as { scheduled?: boolean; memoryId?: number; dispatched?: boolean } | undefined;
            const isError = Boolean(context?.isError || result?.isError);

            let statusText: string;
            if (isError) {
              statusText = fg(theme, 'error', `✗ ${inlineText(text) || 'rotation failed'}`);
            } else if (details?.scheduled) {
              const idPart = typeof details.memoryId === 'number' ? ` #${details.memoryId}` : '';
              const dispPart = details.dispatched ? ' · dispatched' : '';
              statusText = fg(theme, 'success', `✓ scheduled${idPart}${dispPart}`);
            } else {
              statusText = fg(theme, 'success', `✓ ${inlineText(text) || 'completed'}`);
            }

            const headerLines = wrapMarginedLine(`${title} ${tag} ${sep} ${statusText}`, safeWidth);
            if (!options?.expanded) {
              return headerLines;
            }

            return [...headerLines, ...wrapMutedBody(text, theme, safeWidth)];
          } catch {
            if (safeWidth <= 0) return [];
            return wrapMarginedLine('supervisor_rotate', safeWidth);
          }
        },
      };
    },
  };
}
