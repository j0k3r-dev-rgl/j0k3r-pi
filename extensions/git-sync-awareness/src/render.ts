import type {
  GitSyncDiagnostic,
  SyncStatus,
  WorkingTreeStatus,
  WorktreeDiagnostic,
} from './types.js';

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

/**
 * Remove ANSI escape sequences from a string.
 */
export function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

/**
 * Calculate the visible column width of a string ignoring ANSI codes.
 */
export function visibleWidth(str: string): number {
  return stripAnsi(str).length;
}

/**
 * Truncate a string to a specified visible width while preserving ANSI sequences.
 */
export function fit(text: string, width: number): string {
  if (width <= 0) return '';
  if (visibleWidth(text) <= width) return text;

  const ansiRegex = /(\x1b\[[0-9;]*[a-zA-Z])/g;
  const parts = text.split(ansiRegex);
  let result = '';
  let currentWidth = 0;
  let hasAnsi = false;

  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith('\x1b[')) {
      result += part;
      hasAnsi = true;
    } else {
      const remaining = width - currentWidth;
      if (part.length <= remaining) {
        result += part;
        currentWidth += part.length;
      } else {
        result += part.slice(0, remaining);
        currentWidth += remaining;
        break;
      }
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
  const len = visibleWidth(text);
  if (len >= width) {
    return fit(text, width);
  }
  return text + ' '.repeat(width - len);
}

/**
 * Render a single boxed row enclosed by vertical Unicode borders.
 */
export function boxLine(content: string, innerWidth: number, borderColor = CYAN): string {
  const safeInner = Math.max(10, innerWidth);
  const contentWidth = Math.max(0, safeInner - 2);
  const paddedContent = pad(content, contentWidth);
  return `${borderColor}│${RESET} ${paddedContent} ${borderColor}│${RESET}`;
}

/**
 * Render the rounded top border of a card with optional title and subtitle.
 */
export function cardTopBorder(
  title: string,
  subtitle: string,
  innerWidth: number,
  borderColor = CYAN
): string {
  const safeInner = Math.max(10, innerWidth);
  const prefix = `${borderColor}╭─${RESET}`;
  let titleSub = '';
  if (title) {
    titleSub += ` ${BOLD}${title}${RESET}`;
  }
  if (subtitle) {
    titleSub += ` ${DIM}${subtitle}${RESET}`;
  }
  if (titleSub) {
    titleSub += ' ';
  }

  let midWidth = visibleWidth(titleSub);
  if (midWidth > safeInner - 3) {
    titleSub = fit(titleSub, Math.max(0, safeInner - 3));
    midWidth = visibleWidth(titleSub);
  }

  const dashesCount = Math.max(1, (safeInner + 2) - 2 - midWidth - 1);
  const dashes = `${borderColor}${'─'.repeat(dashesCount)}╮${RESET}`;
  return `${prefix}${titleSub}${dashes}`;
}

/**
 * Render the rounded bottom border of a card.
 */
export function cardBottomBorder(innerWidth: number, borderColor = CYAN): string {
  const safeInner = Math.max(10, innerWidth);
  return `${borderColor}╰${'─'.repeat(safeInner)}╯${RESET}`;
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

/**
 * Format the Decision Gate inner mini-box.
 */
function renderDecisionGateBox(
  diagnostic: GitSyncDiagnostic,
  boxWidth: number
): string[] {
  const inner = Math.max(10, boxWidth - 2);
  const isSafe = !diagnostic.requiresDecision;
  const borderColor = isSafe ? LIME : RED;

  let reason = 'Action required before proceeding: pull remote or resolve working tree';
  if (diagnostic.currentBranch.syncStatus === 'BEHIND') {
    reason = `Branch is ${diagnostic.currentBranch.behind} commits behind remote upstream.`;
  } else if (diagnostic.currentBranch.syncStatus === 'DIVERGED') {
    reason = `Branch diverged (ahead ${diagnostic.currentBranch.ahead}, behind ${diagnostic.currentBranch.behind}).`;
  } else if (!diagnostic.workingTree.isClean) {
    reason = 'Working tree has uncommitted local changes.';
  }

  const lines: string[] = [];

  if (isSafe) {
    const top = `${borderColor}╭─ ${LIME}✔ Safe to proceed${RESET} ${borderColor}${'─'.repeat(Math.max(1, inner - 19))}╮${RESET}`;
    const mid = `${borderColor}│${RESET} ${pad('Working tree clean and synchronized with upstream.', inner - 2)} ${borderColor}│${RESET}`;
    const bot = `${borderColor}╰${'─'.repeat(inner)}╯${RESET}`;
    lines.push(top, mid, bot);
  } else {
    const top = `${borderColor}╭─ ${RED}⚠ MANDATORY DECISION GATE${RESET} ${borderColor}${'─'.repeat(Math.max(1, inner - 27))}╮${RESET}`;
    const mid1 = `${borderColor}│${RESET} ${pad(`${RED}${BOLD}Review or synchronize before continuing:${RESET}`, inner - 2)} ${borderColor}│${RESET}`;
    const mid2 = `${borderColor}│${RESET} ${pad(reason, inner - 2)} ${borderColor}│${RESET}`;
    const bot = `${borderColor}╰${'─'.repeat(inner)}╯${RESET}`;
    lines.push(top, mid1, mid2, bot);
  }

  return lines;
}

export interface GitSyncMessageRenderer {
  render(width: number): string[];
  handleMouse?(event: any): { handled?: boolean; render?: boolean } | undefined;
  invalidate(): void;
}

/**
 * Message renderer factory for git-sync-awareness.
 */
export function createGitSyncMessageRenderer(
  message: any,
  options: { expanded?: boolean } = {}
): GitSyncMessageRenderer {
  let isExpanded = options.expanded === true;

  return {
    handleMouse(event: any) {
      if (event?.button !== 'left' || event?.type !== 'click') return undefined;
      isExpanded = !isExpanded;
      return { handled: true, render: true };
    },
    render(width: number): string[] {
      const targetWidth = width > 0 ? width : 80;
      const diagnostic: GitSyncDiagnostic | undefined = message?.details;

      // Fallback mode if structured diagnostic is absent
      if (!diagnostic || !diagnostic.currentBranch) {
        const rawContent = String(message?.content || 'No git diagnostic report available');
        if (!isExpanded) {
          const firstLine = rawContent.split('\n')[0] || '';
          return [fit(`${RED}●${RESET} ${firstLine} ${DIM}(click or ctrl+o expand)${RESET}`, targetWidth)];
        }
        const innerWidth = Math.max(10, targetWidth - 2);
        const lines: string[] = [];
        lines.push(cardTopBorder('git-sync', 'notice', innerWidth, AMBER));
        for (const line of rawContent.split('\n')) {
          lines.push(boxLine(line, innerWidth, AMBER));
        }
        lines.push(cardBottomBorder(innerWidth, AMBER));
        lines.push(`${DIM}(click or ctrl+o collapse)${RESET}`);
        return lines;
      }

      // Collapsed mode: single line status
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
        const hint = `${DIM}(click or ctrl+o expand)${RESET}`;

        if (targetWidth < 40) {
          const shortHint = `${DIM}(ctrl+o)${RESET}`;
          const shortBranch = fit(diagnostic.currentBranch.branch, 8);
          return [fit(`${dot} ${shortBranch} ${syncBadge} ${shortHint}`, targetWidth)];
        }

        const fullLine = `${dot} ${branch}  ${syncBadge}  ${wtBadge}  ${hint}`;
        return [fit(fullLine, targetWidth)];
      }

      // Expanded mode: multi-line rounded card
      const innerWidth = Math.max(20, targetWidth - 2);
      const cardBorderColor = diagnostic.requiresDecision ? RED : CYAN;
      const lines: string[] = [];

      // Top Border
      lines.push(cardTopBorder('git-sync', diagnostic.currentBranch.branch, innerWidth, cardBorderColor));

      // Branch and Upstream Status
      const upstreamText = diagnostic.currentBranch.upstream
        ? `${CYAN}${diagnostic.currentBranch.upstream}${RESET}`
        : `${DIM}none${RESET}`;
      const syncBadge = formatSyncStatusBadge(
        diagnostic.currentBranch.syncStatus,
        diagnostic.currentBranch.ahead,
        diagnostic.currentBranch.behind
      );
      lines.push(
        boxLine(
          `Branch: ${BOLD}${diagnostic.currentBranch.branch}${RESET}  Upstream: ${upstreamText}  Status: ${syncBadge}`,
          innerWidth,
          cardBorderColor
        )
      );

      // Branch Policy Warning
      if (!diagnostic.isBranchPolicyCompliant && diagnostic.branchPolicyWarning) {
        lines.push(
          boxLine(
            `${AMBER}⚠ Policy: ${diagnostic.branchPolicyWarning}${RESET}`,
            innerWidth,
            cardBorderColor
          )
        );
      }

      // Incoming Remote Commits
      if (
        diagnostic.currentBranch.incomingCommits &&
        diagnostic.currentBranch.incomingCommits.length > 0
      ) {
        lines.push(boxLine('', innerWidth, cardBorderColor));
        lines.push(
          boxLine(
            `${PINK}${BOLD}Incoming Remote Commits (${diagnostic.currentBranch.incomingCommits.length}):${RESET}`,
            innerWidth,
            cardBorderColor
          )
        );
        for (const commit of diagnostic.currentBranch.incomingCommits.slice(0, 5)) {
          lines.push(boxLine(`  ${DIM}↓${RESET} ${commit}`, innerWidth, cardBorderColor));
        }
        if (diagnostic.currentBranch.incomingCommits.length > 5) {
          lines.push(
            boxLine(
              `  ${DIM}... +${diagnostic.currentBranch.incomingCommits.length - 5} more remote commits${RESET}`,
              innerWidth,
              cardBorderColor
            )
          );
        }
      }

      // Working Tree Breakdown
      lines.push(boxLine('', innerWidth, cardBorderColor));
      lines.push(
        boxLine(
          `Working Tree: ${formatWorkingTreeBadge(diagnostic.workingTree)}`,
          innerWidth,
          cardBorderColor
        )
      );
      if (!diagnostic.workingTree.isClean && diagnostic.workingTree.summaryLines?.length > 0) {
        for (const sLine of diagnostic.workingTree.summaryLines.slice(0, 4)) {
          lines.push(boxLine(`  ${DIM}${sLine}${RESET}`, innerWidth, cardBorderColor));
        }
        if (diagnostic.workingTree.summaryLines.length > 4) {
          lines.push(
            boxLine(
              `  ${DIM}... +${diagnostic.workingTree.summaryLines.length - 4} more changed files${RESET}`,
              innerWidth,
              cardBorderColor
            )
          );
        }
      }

      // Active Worktrees
      if (diagnostic.worktree && diagnostic.worktree.worktrees.length > 1) {
        lines.push(boxLine('', innerWidth, cardBorderColor));
        lines.push(
          boxLine(
            `${VIOLET}${BOLD}Active Worktrees (${diagnostic.worktree.worktrees.length}):${RESET}`,
            innerWidth,
            cardBorderColor
          )
        );
        for (const wt of diagnostic.worktree.worktrees) {
          const tags: string[] = [];
          if (wt.isCurrent) tags.push(`${LIME}(current)${RESET}`);
          if (wt.isMain) tags.push(`${CYAN}(base)${RESET}`);
          if (wt.locked) tags.push(`${AMBER}[locked]${RESET}`);
          if (wt.prunable) tags.push(`${RED}[prunable]${RESET}`);

          const tagStr = tags.length > 0 ? ` ${tags.join(' ')}` : '';
          const headAbbr = wt.head ? ` [HEAD ${wt.head.slice(0, 7)}]` : '';
          lines.push(
            boxLine(
              `  • ${wt.path}: branch ${BOLD}${wt.branch || 'detached'}${RESET}${headAbbr}${tagStr}`,
              innerWidth,
              cardBorderColor
            )
          );
        }
      }

      // Other Local Branches
      if (diagnostic.otherLocalBranches && diagnostic.otherLocalBranches.length > 0) {
        lines.push(boxLine('', innerWidth, cardBorderColor));
        lines.push(
          boxLine(
            `${CYAN}${BOLD}Other Local Branches (${diagnostic.otherLocalBranches.length}):${RESET}`,
            innerWidth,
            cardBorderColor
          )
        );
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
          lines.push(
            boxLine(
              `  • ${BOLD}${b.branch}${RESET}: ${badge}${extra}`,
              innerWidth,
              cardBorderColor
            )
          );
        }
      }

      // Collaborator Branches (unmerged into main)
      if (
        diagnostic.activeCollaboratorBranches &&
        diagnostic.activeCollaboratorBranches.length > 0
      ) {
        lines.push(boxLine('', innerWidth, cardBorderColor));
        lines.push(
          boxLine(
            `${CYAN}${BOLD}Collaborator Branches (${diagnostic.activeCollaboratorBranches.length}):${RESET}`,
            innerWidth,
            cardBorderColor
          )
        );
        for (const cBranch of diagnostic.activeCollaboratorBranches.slice(0, 4)) {
          lines.push(boxLine(`  • ${cBranch}`, innerWidth, cardBorderColor));
        }
      }

      // Remote Branches (origin)
      if (diagnostic.remoteBranches && diagnostic.remoteBranches.length > 0) {
        lines.push(boxLine('', innerWidth, cardBorderColor));
        lines.push(
          boxLine(
            `${VIOLET}${BOLD}Remote Branches (${diagnostic.remoteBranches.length}):${RESET}`,
            innerWidth,
            cardBorderColor
          )
        );
        for (const remote of diagnostic.remoteBranches.slice(0, 5)) {
          const local = [diagnostic.currentBranch, ...(diagnostic.otherLocalBranches || [])].find(
            (b) => b.upstream === remote
          );
          const relation = local
            ? `${LIME}local ${local.branch}${RESET}`
            : (diagnostic.remoteOnlyBranches || []).includes(remote)
              ? `${AMBER}remote-only${RESET}`
              : `${DIM}tracking${RESET}`;
          lines.push(
            boxLine(
              `  • ${remote}: ${relation}`,
              innerWidth,
              cardBorderColor
            )
          );
        }
        if (diagnostic.remoteBranches.length > 5) {
          lines.push(
            boxLine(
              `  ${DIM}... +${diagnostic.remoteBranches.length - 5} more remote branches${RESET}`,
              innerWidth,
              cardBorderColor
            )
          );
        }
      }

      // Decision Gate Box
      lines.push(boxLine('', innerWidth, cardBorderColor));
      const contentInner = Math.max(10, innerWidth - 2);
      const gateLines = renderDecisionGateBox(diagnostic, contentInner);
      for (const gLine of gateLines) {
        lines.push(boxLine(gLine, innerWidth, cardBorderColor));
      }

      // Bottom Border
      lines.push(cardBottomBorder(innerWidth, cardBorderColor));

      // Key hint footer
      lines.push(`${DIM}(click or ctrl+o collapse)${RESET}`);

      return lines;
    },
    invalidate(): void {
      // Invalidation hook for Pi TUI
    },
  };
}
