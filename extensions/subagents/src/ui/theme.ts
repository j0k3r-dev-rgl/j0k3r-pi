// Arch-electric cyberpunk theme helpers for pi-subagents-j0k3r

export const RESET = '\x1b[0m';
export const BOLD = '\x1b[1m';
export const DIM = '\x1b[2m';

// Concrete electric accent tokens:
export const CYAN = '\x1b[1;38;2;0;229;255m';       // Electric Cyan (#00e5ff)
export const ARCH_BLUE = '\x1b[1;38;2;23;147;209m';  // Arch Blue (#1793d1)
export const BLUE = ARCH_BLUE;
export const VIOLET = '\x1b[1;38;2;153;92;255m';    // Cyber Violet (#995cff)
export const PINK = '\x1b[1;38;2;255;45;247m';      // Neon Pink (#ff2df7)
export const LIME = '\x1b[1;38;2;102;255;102m';     // Neon Lime (#66ff66)
export const AMBER = '\x1b[1;38;2;255;184;77m';     // Electric Amber (#ffb84d)
export const ORANGE = '\x1b[1;38;2;255;140;0m';     // Neon Orange (#ff8c00)
export const RED = '\x1b[1;38;2;255;77;109m';       // Cyber Red (#ff4d6d)

// Arch Linux icon token:
export const ARCH_ICON = '󰣇';

// Neon gradient color stops for working indicator animation:
const NEON_COLOR_STOPS: [number, number, number][] = [
  [0, 229, 255],   // Electric Cyan (#00e5ff)
  [23, 147, 209],  // Arch Blue (#1793d1)
  [153, 92, 255],  // Cyber Violet (#995cff)
  [255, 45, 247],  // Neon Pink (#ff2df7)
  [255, 184, 77],  // Electric Amber (#ffb84d)
  [102, 255, 102], // Neon Green / Lime (#66ff66)
];

function interpolateColor(
  c1: [number, number, number],
  c2: [number, number, number],
  t: number,
): [number, number, number] {
  return [
    Math.round(c1[0] + (c2[0] - c1[0]) * t),
    Math.round(c1[1] + (c2[1] - c1[1]) * t),
    Math.round(c1[2] + (c2[2] - c1[2]) * t),
  ];
}

export function createArchWorkingFrames(totalFrames = 12): string[] {
  const frames: string[] = [];
  for (let i = 0; i < totalFrames; i++) {
    const colorProgress = i / totalFrames;
    const stopIndex = Math.floor(colorProgress * NEON_COLOR_STOPS.length);
    const nextStopIndex = (stopIndex + 1) % NEON_COLOR_STOPS.length;
    const stopT = colorProgress * NEON_COLOR_STOPS.length - stopIndex;
    const baseColor = interpolateColor(NEON_COLOR_STOPS[stopIndex]!, NEON_COLOR_STOPS[nextStopIndex]!, stopT);

    const wave = Math.sin(colorProgress * Math.PI * 2);
    const normWave = (wave + 1) / 2; // 0..1
    const brightness = 0.4 + 0.6 * Math.pow(normWave, 1.2);

    let r = Math.round(baseColor[0] * brightness);
    let g = Math.round(baseColor[1] * brightness);
    let b = Math.round(baseColor[2] * brightness);

    if (normWave > 0.75) {
      const highlightT = ((normWave - 0.75) / 0.25) * 0.35;
      r = Math.min(255, Math.round(r * (1 - highlightT) + 255 * highlightT));
      g = Math.min(255, Math.round(g * (1 - highlightT) + 255 * highlightT));
      b = Math.min(255, Math.round(b * (1 - highlightT) + 255 * highlightT));
    }

    const bold = brightness > 0.5 ? '1;' : '';
    frames.push(`\x1b[${bold}38;2;${r};${g};${b}m${ARCH_ICON}${RESET}`);
  }
  return frames;
}

export const ARCH_WORKING_FRAMES = createArchWorkingFrames(12);

export function getArchNeonWorkingIcon(frame?: number): string {
  const frameIndex = frame !== undefined
    ? Math.abs(Math.floor(frame)) % ARCH_WORKING_FRAMES.length
    : Math.floor((Date.now() / 60) % ARCH_WORKING_FRAMES.length);
  return ARCH_WORKING_FRAMES[frameIndex] ?? `${CYAN}${ARCH_ICON}${RESET}`;
}

// Cyberpunk separator:
export const CYBER_SEPARATOR = '┃';

// Electric box-drawing characters:
export const BOX_CHARS = {
  topLeft: '┌',
  topRight: '┐',
  vertical: '│',
  bottomLeft: '└',
  bottomRight: '┘',
  horizontal: '─',
} as const;

export function electric(color: string, text: string): string {
  return `${color}${text}${RESET}`;
}

export function electricBorder(text: string): string {
  return `${CYAN}${text}${RESET}`;
}

export function cyberSeparator(color = VIOLET): string {
  return `${color}${CYBER_SEPARATOR}${RESET}`;
}

export function joinWithSeparator(segments: string[], sep = ` ${cyberSeparator()} `): string {
  return segments.filter(Boolean).join(sep);
}

// Pi theme wrappers with graceful fallback to Arch-electric tokens:
export function themeFg(theme: any, colorKey: string, text: string, fallbackColor = ''): string {
  if (typeof theme?.fg === 'function') {
    return theme.fg(colorKey, text);
  }
  return fallbackColor ? `${fallbackColor}${text}${RESET}` : text;
}

export function themeBg(theme: any, colorKey: string, text: string, fallbackColor = ''): string {
  if (typeof theme?.bg === 'function') {
    return theme.bg(colorKey, text);
  }
  return fallbackColor ? `${fallbackColor}${text}${RESET}` : text;
}

export function themeBold(theme: any, text: string): string {
  if (typeof theme?.bold === 'function') {
    return theme.bold(text);
  }
  return `${BOLD}${text}${RESET}`;
}

export function themeAccent(theme: any, text: string): string {
  return themeFg(theme, 'accent', text, CYAN);
}

export function themeDim(theme: any, text: string): string {
  return themeFg(theme, 'dim', text, DIM);
}

export function themeSuccess(theme: any, text: string): string {
  return themeFg(theme, 'success', text, LIME);
}

export function themeWarning(theme: any, text: string): string {
  return themeFg(theme, 'warning', text, AMBER);
}

export function themeError(theme: any, text: string): string {
  return themeFg(theme, 'error', text, RED);
}

export function themeTitle(theme: any, text: string): string {
  if (typeof theme?.fg === 'function') {
    return theme.fg('toolTitle', themeBold(theme, text));
  }
  return `${CYAN}${BOLD}${text}${RESET}`;
}

// Status color mapping for queued, running, stopping, completed, failed, cancelled, interrupted, and unknown:
export type SubagentStatusName =
  | 'queued'
  | 'running'
  | 'stopping'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted'
  | 'unknown'
  | string;

export function getStatusColorToken(status: string): string {
  switch (status.toLowerCase()) {
    case 'completed':
    case 'done':
    case 'success':
      return LIME;
    case 'running':
    case 'active':
      return CYAN;
    case 'queued':
      return AMBER;
    case 'stopping':
    case 'cancelled':
    case 'interrupted':
      return AMBER;
    case 'failed':
    case 'error':
      return RED;
    default:
      return DIM;
  }
}

export function themeStatus(theme: any, status: string, customLabel?: string): string {
  const label = customLabel ?? status;
  const s = status.toLowerCase();
  if (s === 'completed' || s === 'done' || s === 'success') {
    return themeSuccess(theme, label);
  }
  if (s === 'failed' || s === 'error') {
    return themeError(theme, label);
  }
  if (s === 'cancelled' || s === 'interrupted' || s === 'stopping') {
    return themeWarning(theme, label);
  }
  if (s === 'queued') {
    return themeFg(theme, 'warning', label, AMBER);
  }
  if (s === 'running') {
    return themeAccent(theme, label);
  }
  return themeDim(theme, label);
}

// Visible-width-safe string manipulation helpers:
export { stripAnsi, visibleWidth, truncateToWidth } from '../render/text-width.js';
import { stripAnsi, visibleWidth, truncateToWidth } from '../render/text-width.js';

export function padToWidth(text: string, width: number): string {
  const clipped = truncateToWidth(text, width, '');
  const w = visibleWidth(clipped);
  return `${clipped}${' '.repeat(Math.max(0, width - w))}`;
}

export function fitLine(text: string, width: number): string {
  return padToWidth(text, width);
}

export function getToolBorderColor(toolName: string, isError = false): string {
  if (isError) return RED;
  const name = toolName.toLowerCase();
  if (name === 'read') return CYAN;
  if (name === 'bash') return ORANGE;
  if (name === 'edit') return VIOLET;
  if (name === 'write') return PINK;
  if (name.startsWith('memory_') || name.startsWith('mem_')) return AMBER;
  if (name.startsWith('subagent')) return CYAN;
  return CYAN;
}

export function cardTopBorder(
  toolName: string,
  actionOrTarget: string | undefined,
  innerWidth: number,
  borderColor: string = CYAN,
  titleColor: string = CYAN,
): string {
  const cleanAction = actionOrTarget ? actionOrTarget.replace(/[\r\n]+/g, ' ').trim() : undefined;
  let label = cleanAction ? `${toolName} [${cleanAction}]` : toolName;

  const maxTitleWidth = Math.max(4, innerWidth - 4);
  if (visibleWidth(label) + 2 > maxTitleWidth && cleanAction) {
    const maxActionWidth = Math.max(3, maxTitleWidth - visibleWidth(toolName) - 5);
    const truncatedAction = truncateToWidth(cleanAction, maxActionWidth, '…');
    label = `${toolName} [${truncatedAction}]`;
  }

  let titleText = ` ${label} `;
  if (visibleWidth(titleText) > innerWidth) {
    titleText = ` ${truncateToWidth(label, Math.max(1, innerWidth - 2), '…')} `;
  }

  const rest = Math.max(0, innerWidth - visibleWidth(titleText));
  const leftDash = Math.min(2, rest);
  const rightDash = Math.max(0, rest - leftDash);
  return `${electric(borderColor, '╭')}${electric(borderColor, '─'.repeat(leftDash))}${electric(titleColor, titleText)}${electric(borderColor, '─'.repeat(rightDash))}${electric(borderColor, '╮')}`;
}

export function cardBottomBorder(innerWidth: number, borderColor: string = CYAN): string {
  return `${electric(borderColor, '╰')}${electric(borderColor, '─'.repeat(innerWidth))}${electric(borderColor, '╯')}`;
}

export function boxLine(content: string, innerWidth: number, borderColor: string = CYAN): string {
  const innerContentWidth = Math.max(0, innerWidth - 2);
  return `${electric(borderColor, '│')} ${padToWidth(content, innerContentWidth)} ${electric(borderColor, '│')}`;
}

export function metric(label: string, value: string | number, color: string): string {
  return `${electric(DIM, label)} ${electric(color, String(value))}`;
}
export function subagentBadge(theme?: any, options?: { archIcon?: boolean }): string {
  const icon = options?.archIcon !== false ? `${ARCH_ICON} ` : '';
  const label = `${icon}subagent`;
  if (typeof theme?.fg === 'function') {
    return `[${theme.fg('accent', label)}]`;
  }
  return `[${CYAN}${label}${RESET}]`;
}

export function boxedLine(
  line: string,
  innerWidth: number,
  left: string,
  right: string,
  borderFn: (text: string) => string = electricBorder,
): string {
  return `${borderFn(left)}${fitLine(line, innerWidth)}${borderFn(right)}`;
}

export function frameBox(
  title: string,
  lines: string[],
  width: number,
  options?: { borderFn?: (text: string) => string },
): string[] {
  const borderFn = options?.borderFn ?? electricBorder;
  const safeWidth = Math.max(1, Math.floor(width || 1));
  if (safeWidth < 10) {
    const all = title ? [title, ...lines] : lines;
    return all.map((l) => truncateToWidth(l, safeWidth, '…'));
  }
  const innerWidth = safeWidth - 2;
  const contentWidth = Math.max(1, innerWidth - 2);

  let top: string;
  if (title) {
    const maxTitleWidth = Math.max(0, innerWidth - 4);
    const clippedTitle = truncateToWidth(title, maxTitleWidth, '…');
    const titleVisWidth = visibleWidth(clippedTitle);
    const filler = Math.max(0, innerWidth - titleVisWidth - 3);
    top = `${borderFn(BOX_CHARS.topLeft + BOX_CHARS.horizontal)} ${clippedTitle} ${borderFn(BOX_CHARS.horizontal.repeat(filler))}${borderFn(BOX_CHARS.topRight)}`;
  } else {
    top = `${borderFn(BOX_CHARS.topLeft)}${borderFn(BOX_CHARS.horizontal.repeat(innerWidth))}${borderFn(BOX_CHARS.topRight)}`;
  }

  const flatLines = lines.flatMap((l) => l.split('\n'));
  const middle = flatLines.map((l) => `${borderFn(BOX_CHARS.vertical)} ${padToWidth(l, contentWidth)} ${borderFn(BOX_CHARS.vertical)}`);
  const bottom = `${borderFn(BOX_CHARS.bottomLeft)}${borderFn(BOX_CHARS.horizontal.repeat(innerWidth))}${borderFn(BOX_CHARS.bottomRight)}`;

  return [top, ...middle, bottom];
}
