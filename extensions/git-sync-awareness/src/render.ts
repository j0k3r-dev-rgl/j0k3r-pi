import type { GitSyncDiagnostic, SyncStatus } from './types.js';

// ANSI Styling Constants matching j0k3r-theme neon aesthetic
export const CYAN = '\x1b[1;38;2;0;229;255m';
export const LIME = '\x1b[1;38;2;102;255;102m';
export const PINK = '\x1b[1;38;2;255;45;247m';
export const RED = '\x1b[1;38;2;255;77;109m';
export const AMBER = '\x1b[1;38;2;255;184;77m';
export const VIOLET = '\x1b[1;38;2;153;92;255m';
export const DIM = '\x1b[2m';
export const BOLD = '\x1b[1m';
export const RESET = '\x1b[0m';

const GRAPHEME_SEGMENTER = new Intl.Segmenter('en', { granularity: 'grapheme' });
const ANSI_TOKEN_RE = /(\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-9;?]*[ -/]*[@-~])/g;
const NON_PRINTING_GRAPHEME_RE = /^[\p{Mn}\p{Me}\p{Cf}\p{Cc}]+$/u;
const EMOJI_GRAPHEME_RE = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u200D|\uFE0F/u;

function isWideCodePoint(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    cp === 0x2329 ||
    cp === 0x232a ||
    (cp >= 0x2e80 && cp <= 0x303e) ||
    (cp >= 0x3041 && cp <= 0x33ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xa960 && cp <= 0xa97f) ||
    (cp >= 0xac00 && cp <= 0xd7ff) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe10 && cp <= 0xfe19) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff01 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  );
}

function graphemeWidth(grapheme: string): number {
  if (!grapheme || NON_PRINTING_GRAPHEME_RE.test(grapheme)) return 0;
  if (grapheme.length > 1 && EMOJI_GRAPHEME_RE.test(grapheme)) return 2;
  const cp = grapheme.codePointAt(0);
  if (cp === undefined) return 0;
  if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)) return 0;
  if (isWideCodePoint(cp) || EMOJI_GRAPHEME_RE.test(grapheme)) return 2;
  return 1;
}

/**
 * Remove ANSI CSI and OSC escape sequences from a string.
 */
export function stripAnsi(str: string): string {
  return String(str ?? '').replace(ANSI_TOKEN_RE, '');
}

/**
 * Calculate the visible terminal column width of a string ignoring ANSI/OSC sequences.
 */
export function visibleWidth(str: string): number {
  const plain = stripAnsi(str);
  if (!plain) return 0;
  let width = 0;
  for (const { segment } of GRAPHEME_SEGMENTER.segment(plain)) {
    width += graphemeWidth(segment);
  }
  return width;
}

/**
 * Display-only home abbreviation on separator-bounded home prefixes.
 */
function abbreviateHome(value: string, home: string = process.env.HOME ?? ''): string {
  if (!value || !home || home === '/') return value;
  if (value !== home && !value.startsWith(`${home}/`)) return value;
  return value === home ? '~' : `~${value.slice(home.length)}`;
}

/**
 * Truncate a string to a specified visible width while preserving ANSI/OSC sequences.
 */
export function fit(text: string, width: number): string {
  if (!Number.isFinite(width) || width <= 0) return '';
  const safeWidth = Math.floor(width);
  if (visibleWidth(text) <= safeWidth) return text;

  const parts = text.split(ANSI_TOKEN_RE);
  let result = '';
  let currentWidth = 0;
  let hasAnsi = false;

  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith('\x1b[') || part.startsWith('\x1b]')) {
      result += part;
      hasAnsi = true;
      continue;
    }
    for (const { segment } of GRAPHEME_SEGMENTER.segment(part)) {
      const gw = graphemeWidth(segment);
      if (currentWidth + gw > safeWidth) {
        if (hasAnsi && !result.endsWith(RESET)) result += RESET;
        return result;
      }
      result += segment;
      currentWidth += gw;
    }
  }

  if (hasAnsi && !result.endsWith(RESET)) {
    result += RESET;
  }
  return result;
}

/**
 * Pad a string to a specific visible width, truncating if necessary.
 */
export function pad(text: string, width: number): string {
  if (!Number.isFinite(width) || width <= 0) return '';
  const safeWidth = Math.floor(width);
  const len = visibleWidth(text);
  if (len === safeWidth) return text;
  if (len < safeWidth) return text + ' '.repeat(safeWidth - len);
  return fit(text, safeWidth);
}

/**
 * Wrap one line to fit strictly within `width` visible columns (or `totalWidth === 2` for an
 * intact 2-column grapheme without the left margin) while preserving ANSI SGR styling.
 */
function wrapAnsiLine(line: string, width: number, totalWidth = width + 1): string[] {
  if (!Number.isFinite(width) || width <= 0) return [];
  const safeWidth = Math.floor(width);
  const allowWidth2Wide = totalWidth === 2;
  if (line === '') return [' '];
  if (visibleWidth(line) <= safeWidth) return [` ${line}`];

  const out: string[] = [];
  let current = '';
  let currentWidth = 0;
  let chunkLimit = safeWidth;
  let chunkHasMargin = true;
  let activeSgr = '';

  const flush = () => {
    const terminated = activeSgr && !current.endsWith(RESET) ? `${current}${RESET}` : current;
    if (chunkHasMargin) {
      const fitted = visibleWidth(terminated) <= safeWidth ? terminated : fit(terminated, safeWidth);
      out.push(` ${fitted}`);
    } else {
      out.push(visibleWidth(terminated) <= totalWidth ? terminated : fit(terminated, totalWidth));
    }
    current = activeSgr;
    currentWidth = 0;
    chunkLimit = safeWidth;
    chunkHasMargin = true;
  };

  for (const part of line.split(ANSI_TOKEN_RE)) {
    if (!part) continue;
    if (part.startsWith('\x1b[')) {
      current += part;
      activeSgr = part === RESET ? '' : `${activeSgr}${part}`;
      continue;
    }
    if (part.startsWith('\x1b]')) {
      current += part;
      continue;
    }
    for (const { segment } of GRAPHEME_SEGMENTER.segment(part)) {
      const gw = graphemeWidth(segment);
      if (gw === 0) {
        current += segment;
        continue;
      }
      if (gw > safeWidth) {
        if (!allowWidth2Wide || gw > totalWidth) continue;
        if (currentWidth > 0) flush();
        chunkLimit = totalWidth;
        chunkHasMargin = false;
        current += segment;
        currentWidth = gw;
        continue;
      }
      if (currentWidth + gw > chunkLimit && currentWidth > 0) {
        flush();
      }
      current += segment;
      currentWidth += gw;
    }
  }

  if (current !== activeSgr || out.length === 0) {
    flush();
  }

  return out;
}

function wrapLines(rawLines: string[], width: number, totalWidth = width + 1): string[] {
  if (!Number.isFinite(width) || width <= 0) return [];
  const out: string[] = [];
  for (const line of rawLines) {
    for (const part of String(line).split('\n')) {
      out.push(...wrapAnsiLine(part, width, totalWidth));
    }
  }
  return out;
}

function extractMessageContent(message: any): string {
  if (typeof message?.content === 'string') return message.content;
  if (Array.isArray(message?.content)) {
    return message.content
      .filter((part: any) => part?.type === 'text' && typeof part.text === 'string')
      .map((part: any) => part.text)
      .join('\n');
  }
  return '';
}

/**
 * Format a sync status badge.
 */
export function formatSyncStatusBadge(
  status: SyncStatus,
  ahead = 0,
  behind = 0
): string {
  switch (status) {
    case 'UP-TO-DATE':
      return `${LIME}● UP-TO-DATE${RESET}`;
    case 'BEHIND':
      return behind > 0
        ? `${RED}▼ BEHIND [${behind}]${RESET}`
        : `${RED}▼ BEHIND${RESET}`;
    case 'AHEAD':
      return ahead > 0
        ? `${CYAN}▲ AHEAD [${ahead}]${RESET}`
        : `${CYAN}▲ AHEAD${RESET}`;
    case 'DIVERGED':
      return behind > 0 || ahead > 0
        ? `${RED}▲▼ DIVERGED [behind ${behind}, ahead ${ahead}]${RESET}`
        : `${RED}▲▼ DIVERGED${RESET}`;
    case 'UNTRACKED':
      return `${DIM}○ UNTRACKED${RESET}`;
    default:
      return `${DIM}${status}${RESET}`;
  }
}

/**
 * Format working tree status badge.
 */
export function formatWorkingTreeBadge(workingTree: {
  isClean: boolean;
  modifiedCount?: number;
  untrackedCount?: number;
  stagedCount?: number;
}): string {
  if (workingTree.isClean) {
    return `${LIME}clean${RESET}`;
  }
  const parts: string[] = [];
  if (workingTree.modifiedCount && workingTree.modifiedCount > 0) {
    parts.push(`${workingTree.modifiedCount} modified`);
  }
  if (workingTree.stagedCount && workingTree.stagedCount > 0) {
    parts.push(`${workingTree.stagedCount} staged`);
  }
  if (workingTree.untrackedCount && workingTree.untrackedCount > 0) {
    parts.push(`${workingTree.untrackedCount} untracked`);
  }
  const details = parts.length > 0 ? parts.join(', ') : 'uncommitted changes';
  return `${AMBER}dirty (${details})${RESET}`;
}

/**
 * Format network status badge.
 */
export function formatNetworkStatusBadge(
  fetchSuccess: boolean,
  fetchError?: string
): string {
  if (fetchSuccess) {
    return `${LIME}online${RESET}`;
  }
  return `${AMBER}offline${fetchError ? ` (${fetchError})` : ''}${RESET}`;
}

export interface GitSyncMessageRenderer {
  render(width: number): string[];
  handleMouse?(event: any): { handled?: boolean; render?: boolean } | undefined;
  invalidate(): void;
}

/**
 * Message renderer factory for git-sync-awareness.
 *
 * Compact, transparent, unboxed and hint-free: single inline status row when collapsed,
 * complete unboxed wrapping when expanded, and native `options.expanded` coherence across
 * host rebuilds alongside existing click support.
 */
export function createGitSyncMessageRenderer(
  message: any,
  options: { expanded?: boolean } = {}
): GitSyncMessageRenderer {
  let isExpanded = options?.expanded === true;

  return {
    handleMouse(event: any) {
      if (event?.button !== 'left' || event?.type !== 'click') return undefined;
      isExpanded = !isExpanded;
      return { handled: true, render: true };
    },
    render(width: number): string[] {
      const targetWidth = Number.isFinite(width) ? Math.floor(width) : 80;
      if (targetWidth <= 0) return [];
      if (targetWidth === 1) return [' '];
      const innerWidth = targetWidth - 1;

      const diagnostic: GitSyncDiagnostic | undefined = message?.details;

      // Fallback mode if structured diagnostic is absent
      if (!diagnostic || !diagnostic.currentBranch) {
        const rawContent = extractMessageContent(message) || 'No git diagnostic report available';
        if (!isExpanded) {
          const firstLine = rawContent.split('\n')[0] || '';
          return [` ${fit(`${RED}●${RESET} ${firstLine}`, innerWidth)}`];
        }
        return wrapLines(
          [`${AMBER}git-sync${RESET} ${DIM}─ notice${RESET}`, ...rawContent.split('\n')],
          innerWidth,
          targetWidth
        );
      }

      // Collapsed mode: single inline status row without generated hints
      if (!isExpanded) {
        let dot = `${LIME}●${RESET}`;
        if (diagnostic.requiresDecision) {
          dot = `${RED}●${RESET}`;
        } else if (diagnostic.currentBranch.syncStatus === 'AHEAD') {
          dot = `${CYAN}●${RESET}`;
        } else if (!diagnostic.workingTree.isClean) {
          dot = `${AMBER}●${RESET}`;
        }

        const branch = `${BOLD}${diagnostic.currentBranch.branch}${RESET}`;
        const syncBadge = formatSyncStatusBadge(
          diagnostic.currentBranch.syncStatus,
          diagnostic.currentBranch.ahead,
          diagnostic.currentBranch.behind
        );
        const wtBadge = formatWorkingTreeBadge(diagnostic.workingTree);
        const sep = `${DIM}─${RESET}`;
        return [` ${fit(`${dot} ${branch} ${sep} ${syncBadge} ${sep} ${wtBadge}`, innerWidth)}`];
      }

      // Expanded mode: complete unboxed, background-free sections without preview limits
      const accentColor = diagnostic.requiresDecision ? RED : CYAN;
      const lines: string[] = [];

      lines.push(`${accentColor}git-sync${RESET} ${DIM}─${RESET} ${BOLD}${diagnostic.currentBranch.branch}${RESET}`);

      const upstreamText = diagnostic.currentBranch.upstream
        ? `${CYAN}${diagnostic.currentBranch.upstream}${RESET}`
        : `${DIM}none${RESET}`;
      const syncBadge = formatSyncStatusBadge(
        diagnostic.currentBranch.syncStatus,
        diagnostic.currentBranch.ahead,
        diagnostic.currentBranch.behind
      );
      lines.push(
        `Branch: ${BOLD}${diagnostic.currentBranch.branch}${RESET}  Upstream: ${upstreamText}  Status: ${syncBadge}`
      );

      if (
        diagnostic.currentBranch.incomingCommits &&
        diagnostic.currentBranch.incomingCommits.length > 0
      ) {
        lines.push('');
        lines.push(`${PINK}${BOLD}Incoming Remote Commits (${diagnostic.currentBranch.incomingCommits.length}):${RESET}`);
        for (const commit of diagnostic.currentBranch.incomingCommits) {
          lines.push(`  ${DIM}↓${RESET} ${commit}`);
        }
      }

      lines.push('');
      lines.push(`Working Tree: ${formatWorkingTreeBadge(diagnostic.workingTree)}`);
      if (!diagnostic.workingTree.isClean && diagnostic.workingTree.summaryLines?.length > 0) {
        for (const sLine of diagnostic.workingTree.summaryLines) {
          lines.push(`  ${DIM}${sLine}${RESET}`);
        }
      }

      if (diagnostic.worktree && diagnostic.worktree.worktrees.length > 1) {
        lines.push('');
        lines.push(`${VIOLET}${BOLD}Active Worktrees (${diagnostic.worktree.worktrees.length}):${RESET}`);
        for (const wt of diagnostic.worktree.worktrees) {
          const tags: string[] = [];
          if (wt.isCurrent) tags.push(`${LIME}(current)${RESET}`);
          if (wt.isMain) tags.push(`${CYAN}(base)${RESET}`);
          if (wt.locked) tags.push(`${AMBER}[locked]${RESET}`);
          if (wt.prunable) tags.push(`${RED}[prunable]${RESET}`);

          const tagStr = tags.length > 0 ? ` ${tags.join(' ')}` : '';
          const headAbbr = wt.head ? ` [HEAD ${wt.head.slice(0, 7)}]` : '';
          const displayPath = abbreviateHome(wt.path);
          lines.push(`  • ${displayPath}: branch ${BOLD}${wt.branch || 'detached'}${RESET}${headAbbr}${tagStr}`);
        }
      }

      if (diagnostic.otherLocalBranches && diagnostic.otherLocalBranches.length > 0) {
        lines.push('');
        lines.push(`${CYAN}${BOLD}Other Local Branches (${diagnostic.otherLocalBranches.length}):${RESET}`);
        for (const b of diagnostic.otherLocalBranches) {
          const badge = formatSyncStatusBadge(b.syncStatus, b.ahead, b.behind);
          let extra = '';
          if (b.upstream) {
            extra = ` -> ${CYAN}${b.upstream}${RESET}`;
          } else if (b.baseBranch && (b.behindBase !== undefined || b.aheadBase !== undefined)) {
            let relDesc = '';
            if ((b.behindBase ?? 0) > 0 && !(b.aheadBase ?? 0)) {
              relDesc = `behind ${b.behindBase} vs ${b.baseBranch}`;
            } else if ((b.aheadBase ?? 0) > 0 && !(b.behindBase ?? 0)) {
              relDesc = `ahead ${b.aheadBase} vs ${b.baseBranch}`;
            } else if ((b.aheadBase ?? 0) > 0 && (b.behindBase ?? 0) > 0) {
              relDesc = `ahead ${b.aheadBase}, behind ${b.behindBase} vs ${b.baseBranch}`;
            } else {
              relDesc = `synced with ${b.baseBranch}`;
            }
            extra = ` ${DIM}(${relDesc})${RESET}`;
          }
          lines.push(`  • ${BOLD}${b.branch}${RESET}: ${badge}${extra}`);
        }
      }

      if (
        diagnostic.activeCollaboratorBranches &&
        diagnostic.activeCollaboratorBranches.length > 0
      ) {
        lines.push('');
        lines.push(`${CYAN}${BOLD}Collaborator Branches (${diagnostic.activeCollaboratorBranches.length}):${RESET}`);
        for (const cBranch of diagnostic.activeCollaboratorBranches) {
          lines.push(`  • ${cBranch}`);
        }
      }

      if (diagnostic.remoteBranches && diagnostic.remoteBranches.length > 0) {
        lines.push('');
        lines.push(`${VIOLET}${BOLD}Remote Branches (${diagnostic.remoteBranches.length}):${RESET}`);
        for (const remote of diagnostic.remoteBranches) {
          const local = [diagnostic.currentBranch, ...(diagnostic.otherLocalBranches || [])].find(
            (b) => b.upstream === remote
          );
          const relation = local
            ? `${LIME}local ${local.branch}${RESET}`
            : (diagnostic.remoteOnlyBranches || []).includes(remote)
              ? `${AMBER}remote-only${RESET}`
              : `${DIM}tracking${RESET}`;
          lines.push(`  • ${remote}: ${relation}`);
        }
      }

      return wrapLines(lines, innerWidth, targetWidth);
    },
    invalidate(): void {
      // Invalidation hook for Pi TUI
    },
  };
}
