export const RESET = '\x1b[0m';
export const YELLOW = '\x1b[1;38;2;255;230;0m'; // Electric Solar Yellow (#ffe600)
export const RED = '\x1b[1;38;2;255;77;109m';    // Neon Red (#ff4d6d)
export const LIME = '\x1b[1;38;2;102;255;102m';  // Lime (#66ff66)
export const AMBER = '\x1b[1;38;2;255;184;77m';  // Amber (#ffb84d)
export const DIM = '\x1b[2m';

const ANSI_REGEX = /\u001b\][^\u001b\u0007]*(?:\u001b\\|\u0007)|\u001b\[[0-?]*[ -/]*[@-~]/g;

export function electric(color: string, text: string): string {
  return `${color}${text}${RESET}`;
}

export function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, '');
}

export function isFullWidthCodePoint(codePoint: number): boolean {
  return (
    codePoint >= 0x1100 &&
    (codePoint <= 0x115f ||
      codePoint === 0x2329 ||
      codePoint === 0x232a ||
      (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
      (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
      (codePoint >= 0xff00 && codePoint <= 0xff60) ||
      (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
      (codePoint >= 0x1f300 && codePoint <= 0x1f64f) ||
      (codePoint >= 0x1f900 && codePoint <= 0x1f9ff) ||
      (codePoint >= 0x20000 && codePoint <= 0x3fffd))
  );
}

export function charWidth(char: string): number {
  const cp = char.codePointAt(0);
  if (cp === undefined) return 0;
  if (
    cp === 0x00ad ||
    cp === 0x200b ||
    cp === 0x200c ||
    cp === 0x200d ||
    cp === 0xfeff ||
    (cp >= 0x0300 && cp <= 0x036f) ||
    (cp >= 0xfe00 && cp <= 0xfe0f)
  ) {
    return 0;
  }
  return isFullWidthCodePoint(cp) ? 2 : 1;
}

export function visibleWidth(text: string): number {
  const clean = stripAnsi(text);
  let w = 0;
  let i = 0;
  while (i < clean.length) {
    const cp = clean.codePointAt(i);
    const charLen = cp && cp > 0xffff ? 2 : 1;
    const ch = clean.slice(i, i + charLen);
    w += charWidth(ch);
    i += charLen;
  }
  return w;
}

export function truncateToWidth(text: string, maxWidth: number, ellipsis = ''): string {
  if (maxWidth <= 0) return '';
  if (visibleWidth(text) <= maxWidth) return text;

  const ellipsisW = visibleWidth(ellipsis);
  const targetWidth = Math.max(0, maxWidth - ellipsisW);

  let result = '';
  let currentW = 0;
  let i = 0;

  while (i < text.length) {
    if (text[i] === '\u001b') {
      const remaining = text.slice(i);
      const match = remaining.match(ANSI_REGEX);
      if (match && match.index === 0) {
        result += match[0];
        i += match[0].length;
        continue;
      }
    }
    const cp = text.codePointAt(i);
    const charLen = cp && cp > 0xffff ? 2 : 1;
    const ch = text.slice(i, i + charLen);
    const cw = charWidth(ch);

    if (currentW + cw > targetWidth) {
      break;
    }
    result += ch;
    currentW += cw;
    i += charLen;
  }

  return result + ellipsis;
}

export function fit(text: string, width: number): string {
  return truncateToWidth(text, Math.max(0, width), '');
}

export function pad(text: string, width: number): string {
  const vis = visibleWidth(text);
  if (vis <= width) {
    return text + ' '.repeat(width - vis);
  }
  const fitted = fit(text, width);
  const visFitted = visibleWidth(fitted);
  return fitted + ' '.repeat(Math.max(0, width - visFitted));
}

function hardWrapWord(word: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let current = '';
  let currentW = 0;

  let i = 0;
  while (i < word.length) {
    if (word[i] === '\u001b') {
      const remaining = word.slice(i);
      const match = remaining.match(ANSI_REGEX);
      if (match && match.index === 0) {
        current += match[0];
        i += match[0].length;
        continue;
      }
    }
    const cp = word.codePointAt(i);
    const charLen = cp && cp > 0xffff ? 2 : 1;
    const ch = word.slice(i, i + charLen);
    const cw = charWidth(ch);
    if (currentW + cw > maxWidth && currentW > 0) {
      lines.push(current);
      current = '';
      currentW = 0;
    }
    current += ch;
    currentW += cw;
    i += charLen;
  }
  if (current || lines.length === 0) {
    lines.push(current);
  }
  return lines;
}

export function wrapLine(line: string, maxWidth: number): string[] {
  if (maxWidth <= 0) return [''];
  if (visibleWidth(line) <= maxWidth) return [line];

  const words = line.split(/(\s+)/);
  const result: string[] = [];
  let current = '';
  let currentW = 0;

  for (const token of words) {
    if (!token) continue;
    const tokenW = visibleWidth(token);

    if (tokenW > maxWidth) {
      if (current) {
        result.push(current);
        current = '';
        currentW = 0;
      }
      const chunks = hardWrapWord(token, maxWidth);
      for (let c = 0; c < chunks.length - 1; c++) {
        result.push(chunks[c]);
      }
      current = chunks[chunks.length - 1];
      currentW = visibleWidth(current);
      continue;
    }

    if (currentW + tokenW > maxWidth) {
      if (token.trim() === '') {
        continue;
      }
      result.push(current);
      current = token;
      currentW = tokenW;
    } else {
      current += token;
      currentW += tokenW;
    }
  }

  if (current) {
    result.push(current);
  }

  return result.length > 0 ? result : [''];
}

export function toolHint(action: string, customKey?: string): string {
  const k = customKey || 'Ctrl+O';
  return `${electric(DIM, k)} ${electric(DIM, action)}`;
}

export function boxLine(content: string, innerWidth: number, borderColor: string = YELLOW): string {
  const innerContentWidth = Math.max(0, innerWidth - 2);
  return `${electric(borderColor, '│')} ${pad(content, innerContentWidth)} ${electric(borderColor, '│')}`;
}

export function cardTopBorder(
  toolName: string,
  actionOrTarget: string | undefined,
  innerWidth: number,
  borderColor: string = YELLOW,
  titleColor: string = YELLOW
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
  return `${electric(borderColor, '╭')}${electric(borderColor, '─'.repeat(leftDash))}${electric(titleColor, titleText)}${electric(borderColor, '─'.repeat(rightDash))}${electric(borderColor, '╮')}`;
}

export function cardBottomBorder(innerWidth: number, borderColor: string = YELLOW): string {
  return `${electric(borderColor, '╰')}${electric(borderColor, '─'.repeat(innerWidth))}${electric(borderColor, '╯')}`;
}

export function frameContent(
  lines: string[],
  innerWidth: number,
  borderColor: string = YELLOW,
  wrap = true
): string[] {
  const innerContentWidth = Math.max(0, innerWidth - 2);
  const framed: string[] = [];
  for (const rawLine of lines) {
    const subLines = rawLine.split(/\r?\n/);
    for (const sub of subLines) {
      if (wrap && visibleWidth(sub) > innerContentWidth) {
        const wrapped = wrapLine(sub, innerContentWidth);
        for (const segment of wrapped) {
          framed.push(boxLine(segment, innerWidth, borderColor));
        }
      } else {
        framed.push(boxLine(sub, innerWidth, borderColor));
      }
    }
  }
  return framed;
}
