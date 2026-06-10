const ANSI_RE = /\u001b\][^\u001b\u0007]*(?:\u001b\\|\u0007)|\u001b\[[0-?]*[ -/]*[@-~]/g;
const ANSI_TOKEN_RE = /(?:\u001b\][^\u001b\u0007]*(?:\u001b\\|\u0007)|\u001b\[[0-?]*[ -/]*[@-~])/g;
const RESET = '\u001b[0m';

function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(ANSI_TOKEN_RE)) {
    const index = match.index ?? 0;
    if (index > lastIndex) tokens.push(...[...text.slice(lastIndex, index)]);
    tokens.push(match[0]);
    lastIndex = index + match[0].length;
  }
  if (lastIndex < text.length) tokens.push(...[...text.slice(lastIndex)]);
  return tokens;
}

function isAnsi(token: string): boolean {
  return token.startsWith('\u001b');
}

export function visibleWidth(text: string): number {
  return [...text.replace(ANSI_RE, '')].length;
}

export function truncateToWidth(text: string, width: number): string {
  if (width <= 0) return '';
  if (visibleWidth(text) <= width) return text;
  if (width === 1) return '…';
  if (width === 2) {
    const tokens = tokenize(text);
    let out = '';
    let visible = 0;
    let sawAnsi = false;
    for (const token of tokens) {
      if (isAnsi(token)) {
        sawAnsi = true;
        out += token;
        continue;
      }
      if (visible >= 2) break;
      out += token;
      visible += 1;
    }
    if (sawAnsi && text.includes(RESET) && !out.endsWith(RESET)) out += RESET;
    return out;
  }

  const target = width - 1;
  const tokens = tokenize(text);
  let out = '';
  let visible = 0;
  let sawAnsi = false;

  for (const token of tokens) {
    if (isAnsi(token)) {
      sawAnsi = true;
      out += token;
      continue;
    }
    if (visible >= target) break;
    out += token;
    visible += 1;
  }

  out += '…';
  if (sawAnsi && text.includes(RESET) && !out.endsWith(RESET)) out += RESET;
  return out;
}

export function padRightVisible(text: string, width: number): string {
  const clipped = truncateToWidth(text, width);
  const pad = width - visibleWidth(clipped);
  return pad > 0 ? `${clipped}${' '.repeat(pad)}` : clipped;
}

export function fitWithRightSuffix(left: string, suffix: string, width: number): string {
  if (width <= 0) return '';
  const suffixWidth = visibleWidth(suffix);
  if (suffixWidth >= width) return truncateToWidth(suffix, width);

  const leftWidth = width - suffixWidth - 1;
  if (leftWidth <= 1) return suffix;
  return `${truncateToWidth(left, leftWidth)} ${suffix}`;
}
