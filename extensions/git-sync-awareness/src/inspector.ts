import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import type {
  CurrentBranchStatus,
  ExecFunction,
  GitSyncDiagnostic,
  LocalBranchStatus,
  SyncStatus,
  WorkingTreeStatus,
  WorktreeDiagnostic,
  WorktreeEntry,
} from './types.js';

const execFileAsync = promisify(execFile);

export const defaultExec: ExecFunction = async (cmd, args, options) => {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      cwd: options?.cwd,
      timeout: options?.timeout ?? 5000,
      encoding: 'utf8',
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout || '',
      stderr: err.stderr || err.message || '',
      exitCode: typeof err.code === 'number' ? err.code : 1,
    };
  }
};

export function parseAheadBehind(str: string): { ahead: number; behind: number; syncStatus: SyncStatus } {
  const parts = str.trim().split(/\s+/);
  if (parts.length < 2) {
    return { ahead: 0, behind: 0, syncStatus: 'UP-TO-DATE' };
  }
  const ahead = parseInt(parts[0], 10) || 0;
  const behind = parseInt(parts[1], 10) || 0;

  let syncStatus: SyncStatus = 'UP-TO-DATE';
  if (ahead === 0 && behind > 0) {
    syncStatus = 'BEHIND';
  } else if (ahead > 0 && behind === 0) {
    syncStatus = 'AHEAD';
  } else if (ahead > 0 && behind > 0) {
    syncStatus = 'DIVERGED';
  }

  return { ahead, behind, syncStatus };
}

export function checkBranchPolicy(branch: string): { isCompliant: boolean; warning?: string } {
  if (!branch || branch === 'HEAD') {
    return { isCompliant: true };
  }

  if (branch === 'main') {
    return {
      isCompliant: true,
      warning: 'Currently on main trunk branch. Direct commits for feature work are prohibited by team policy.',
    };
  }

  const validPrefixes = ['feature/', 'fix/', 'refactor/', 'docs/'];
  const hasValidPrefix = validPrefixes.some((prefix) => branch.startsWith(prefix));

  if (!hasValidPrefix) {
    return {
      isCompliant: false,
      warning: `Branch '${branch}' does not follow canonical naming convention (feature/*, fix/*, refactor/*, docs/*).`,
    };
  }

  return { isCompliant: true };
}

export function parseWorkingTree(shortStatus: string): WorkingTreeStatus {
  const lines = shortStatus
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return {
      isClean: true,
      modifiedCount: 0,
      untrackedCount: 0,
      stagedCount: 0,
      summaryLines: [],
    };
  }

  let modifiedCount = 0;
  let untrackedCount = 0;
  let stagedCount = 0;

  for (const line of lines) {
    const x = line[0];
    const y = line[1];
    if (x === '?' && y === '?') {
      untrackedCount++;
    } else {
      if (x && x !== ' ') {
        stagedCount++;
      }
      if (y && y !== ' ') {
        modifiedCount++;
      }
    }
  }

  return {
    isClean: false,
    modifiedCount,
    untrackedCount,
    stagedCount,
    summaryLines: lines.map((l) => l.trim()),
  };
}

export function parseWorktreeListPorcelain(
  stdout: string,
  currentWorktreePath: string,
  mainWorktreePath: string
): WorktreeEntry[] {
  const normCurrent = path.resolve(currentWorktreePath);
  const normMain = path.resolve(mainWorktreePath);

  const rawBlocks = stdout
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);

  const entries: WorktreeEntry[] = [];

  for (let i = 0; i < rawBlocks.length; i++) {
    const lines = rawBlocks[i]
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    let entryPath = '';
    let head = '';
    let branch: string | undefined;
    let detached: boolean | undefined;
    let locked: boolean | string | undefined;
    let prunable: boolean | string | undefined;

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        entryPath = line.slice('worktree '.length).trim();
      } else if (line.startsWith('HEAD ')) {
        head = line.slice('HEAD '.length).trim();
      } else if (line.startsWith('branch ')) {
        let b = line.slice('branch '.length).trim();
        if (b.startsWith('refs/heads/')) {
          b = b.slice('refs/heads/'.length);
        }
        branch = b;
      } else if (line === 'detached') {
        detached = true;
      } else if (line === 'locked') {
        locked = true;
      } else if (line.startsWith('locked ')) {
        const reason = line.slice('locked '.length).trim();
        locked = reason.length > 0 ? reason : true;
      } else if (line === 'prunable') {
        prunable = true;
      } else if (line.startsWith('prunable ')) {
        const reason = line.slice('prunable '.length).trim();
        prunable = reason.length > 0 ? reason : true;
      }
    }

    if (!entryPath) continue;

    const normPath = path.resolve(entryPath);
    const isMain = i === 0 || normPath === normMain;
    const isCurrent = normPath === normCurrent;

    const entry: WorktreeEntry = {
      path: normPath,
      head,
      isCurrent,
      isMain,
    };
    if (branch !== undefined) {
      entry.branch = branch;
    }
    if (detached) {
      entry.detached = true;
    }
    if (locked !== undefined) {
      entry.locked = locked;
    }
    if (prunable !== undefined) {
      entry.prunable = prunable;
    }

    entries.push(entry);
  }

  return entries;
}

export function formatDiagnosticReport(diag: Omit<GitSyncDiagnostic, 'formattedReport'>): string {
  const parts: string[] = [];

  parts.push('### Git Sync Diagnostic (Session Start)');
  const upstreamDisplay = diag.currentBranch.upstream ? ` -> \`${diag.currentBranch.upstream}\`` : ' (no upstream)';
  parts.push(`- **Current Branch**: \`${diag.currentBranch.branch}\`${upstreamDisplay}`);

  let syncDisplay = diag.currentBranch.syncStatus;
  if (diag.currentBranch.syncStatus === 'BEHIND') {
    syncDisplay = `BEHIND [${diag.currentBranch.behind}]`;
  } else if (diag.currentBranch.syncStatus === 'AHEAD') {
    syncDisplay = `AHEAD [${diag.currentBranch.ahead}]`;
  } else if (diag.currentBranch.syncStatus === 'DIVERGED') {
    syncDisplay = `DIVERGED (ahead ${diag.currentBranch.ahead}, behind ${diag.currentBranch.behind})`;
  }
  parts.push(`- **Sync Status**: \`${syncDisplay}\``);

  if (diag.fetchSuccess) {
    parts.push('- **Network**: `ONLINE (fetched origin --prune)`');
  } else {
    parts.push(`- **Network**: \`OFFLINE / UNFETCHED (using cached tracking refs: ${diag.fetchError || 'fetch failed'})\``);
  }

  if (diag.workingTree.isClean) {
    parts.push('- **Working Tree**: `clean`');
  } else {
    const dirtyDesc = [
      diag.workingTree.modifiedCount > 0 ? `${diag.workingTree.modifiedCount} modified` : null,
      diag.workingTree.untrackedCount > 0 ? `${diag.workingTree.untrackedCount} untracked` : null,
      diag.workingTree.stagedCount > 0 ? `${diag.workingTree.stagedCount} staged` : null,
    ]
      .filter(Boolean)
      .join(', ');
    parts.push(`- **Working Tree**: \`dirty [${dirtyDesc}]\``);
  }

  if (diag.worktree) {
    if (diag.worktree.isMainWorktree) {
      parts.push('- **Worktree**: `main` (base repository)');
    } else {
      parts.push(`- **Worktree**: \`linked\` (base: \`${diag.worktree.mainWorktreePath}\`)`);
    }
  }

  if (diag.branchPolicyWarning) {
    parts.push(`- **Branch Policy**: ⚠️ ${diag.branchPolicyWarning}`);
  } else {
    parts.push('- **Branch Policy**: `Compliant`');
  }

  if (diag.currentBranch.incomingCommits.length > 0) {
    parts.push('\n#### Incoming Remote Commits');
    for (const commit of diag.currentBranch.incomingCommits) {
      parts.push(`- ${commit}`);
    }
  }

  if (diag.worktree && diag.worktree.worktrees.length > 1) {
    parts.push('\n#### Active Worktrees');
    for (const wt of diag.worktree.worktrees) {
      const branchDisplay = wt.branch ? `\`${wt.branch}\`` : '`detached`';
      const shortHead = wt.head ? ` [HEAD ${wt.head.slice(0, 7)}]` : '';
      const tags: string[] = [];
      if (wt.isCurrent) tags.push('(current)');
      if (wt.isMain) tags.push('(base)');
      if (wt.locked) {
        tags.push(typeof wt.locked === 'string' ? `[locked: ${wt.locked}]` : '[locked]');
      }
      if (wt.prunable) {
        tags.push(typeof wt.prunable === 'string' ? `[prunable: ${wt.prunable}]` : '[prunable]');
      }
      const tagStr = tags.length > 0 ? ` ${tags.join(' ')}` : '';
      parts.push(`- \`${wt.path}\`: branch ${branchDisplay}${shortHead}${tagStr}`);
    }
    parts.push('\n> **Note**: Git prevents checking out branches that are already active in another worktree.');
  }

  if (diag.otherLocalBranches.length > 0) {
    parts.push('\n#### Other Local Branches');
    for (const b of diag.otherLocalBranches) {
      let bSync = b.syncStatus;
      if (b.syncStatus === 'BEHIND') bSync = `BEHIND [${b.behind}]`;
      if (b.syncStatus === 'AHEAD') bSync = `AHEAD [${b.ahead}]`;
      if (b.syncStatus === 'DIVERGED') bSync = `DIVERGED (ahead ${b.ahead}, behind ${b.behind})`;

      let extra = b.upstream ? ` (\`${b.upstream}\`)` : '';
      if (b.syncStatus === 'UNTRACKED' && b.baseBranch && (b.behindBase !== undefined || b.aheadBase !== undefined)) {
        if ((b.behindBase ?? 0) > 0 && !(b.aheadBase ?? 0)) {
          extra += ` (behind ${b.behindBase} vs ${b.baseBranch})`;
        } else if ((b.aheadBase ?? 0) > 0 && !(b.behindBase ?? 0)) {
          extra += ` (ahead ${b.aheadBase} vs ${b.baseBranch})`;
        } else if ((b.aheadBase ?? 0) > 0 && (b.behindBase ?? 0) > 0) {
          extra += ` (ahead ${b.aheadBase}, behind ${b.behindBase} vs ${b.baseBranch})`;
        } else if (b.aheadBase === 0 && b.behindBase === 0) {
          extra += ` (synced with ${b.baseBranch})`;
        }
      }
      if (diag.worktree) {
        const wtCheckout = diag.worktree.worktrees.find(
          (wt) => !wt.isCurrent && wt.branch === b.branch
        );
        if (wtCheckout) {
          extra += ` [active in worktree: \`${wtCheckout.path}\`]`;
        }
      }
      parts.push(`- \`${b.branch}\`: \`${bSync}\`${extra}`);
    }
  }

  parts.push('\n#### Remote Branches (origin)');
  if (diag.remoteBranches.length === 0) {
    parts.push('- No remote branches detected in local tracking refs.');
  }
  for (const remote of diag.remoteBranches) {
    const local = [diag.currentBranch, ...diag.otherLocalBranches].find((branch) => branch.upstream === remote);
    const relation = local
      ? `local \`${local.branch}\` — \`${local.syncStatus === 'DIVERGED'
        ? `DIVERGED (ahead ${local.ahead}, behind ${local.behind})`
        : local.syncStatus === 'AHEAD' || local.syncStatus === 'BEHIND'
          ? `${local.syncStatus} [${local.syncStatus === 'AHEAD' ? local.ahead : local.behind}]`
          : local.syncStatus}\``
      : diag.remoteOnlyBranches.includes(remote) ? 'remote-only' : 'no tracking local branch';
    const unmerged = diag.activeCollaboratorBranches.includes(remote) ? ' *(unmerged into main)*' : '';
    parts.push(`- \`${remote}\`: ${relation}${unmerged}`);
  }

  parts.push('\n#### Recommended Action / Decision Gate');
  if (diag.currentBranch.syncStatus === 'BEHIND') {
    parts.push(
      `> **MANDATORY DECISION GATE**: Current branch is BEHIND remote by ${diag.currentBranch.behind} commit(s).\n` +
      '> Automatic pull or merge is strictly prohibited.\n' +
      '> Prompt user before proceeding: fast-forward (`git pull --ff-only`), rebase (`git pull --rebase`), or continue as is.'
    );
  } else if (diag.currentBranch.syncStatus === 'DIVERGED') {
    parts.push(
      `> **MANDATORY DECISION GATE**: Current branch has DIVERGED from remote (ahead ${diag.currentBranch.ahead}, behind ${diag.currentBranch.behind}).\n` +
      '> Automatic merge or rebase is strictly prohibited.\n' +
      '> Prompt user for resolution strategy before making file modifications.'
    );
  } else if (!diag.workingTree.isClean) {
    parts.push(
      '> **NOTICE**: Working tree has uncommitted or untracked changes.\n' +
      '> Verify or stash working changes before synchronizing or creating new branches.'
    );
  } else {
    parts.push('> **Status**: Safe to proceed with development.');
  }

  return parts.join('\n');
}

export async function runGitSyncInspection(options?: {
  cwd?: string;
  execFn?: ExecFunction;
  fetchTimeoutMs?: number;
}): Promise<GitSyncDiagnostic | null> {
  const exec = options?.execFn || defaultExec;
  const cwd = options?.cwd;
  const fetchTimeout = options?.fetchTimeoutMs ?? 5000;

  // Outside a Git worktree (or without Git), leave the first turn untouched.
  try {
    const probe = await exec('git', ['rev-parse', '--is-inside-work-tree'], { cwd });
    if (probe.exitCode !== 0 || probe.stdout.trim() !== 'true') return null;
  } catch {
    return null;
  }

  // Worktree awareness detection
  let worktree: WorktreeDiagnostic | undefined;
  try {
    const revRes = await exec('git', ['rev-parse', '--git-dir', '--git-common-dir', '--show-toplevel'], { cwd });
    if (revRes.exitCode === 0 && revRes.stdout.trim()) {
      const lines = revRes.stdout.trim().split('\n').map((l) => l.trim()).filter(Boolean);
      if (lines.length >= 2) {
        const gitDir = lines[0];
        const commonDir = lines[1];
        const baseCwd = cwd || process.cwd();
        const topLevel = lines[2] || (path.isAbsolute(gitDir) ? path.dirname(gitDir) : baseCwd);
        const resolvedGitDir = path.resolve(baseCwd, gitDir);
        const resolvedCommonDir = path.resolve(baseCwd, commonDir);
        const currentWorktreePath = path.resolve(baseCwd, topLevel);
        const isMainWorktree = resolvedGitDir === resolvedCommonDir;
        let mainWorktreePath = isMainWorktree
          ? currentWorktreePath
          : (path.basename(resolvedCommonDir) === '.git' ? path.dirname(resolvedCommonDir) : resolvedCommonDir);

        let worktrees: WorktreeEntry[] = [];
        try {
          const wtRes = await exec('git', ['worktree', 'list', '--porcelain'], { cwd });
          if (wtRes.exitCode === 0 && wtRes.stdout.trim()) {
            worktrees = parseWorktreeListPorcelain(wtRes.stdout, currentWorktreePath, mainWorktreePath);
            if (worktrees.length > 0 && worktrees[0].isMain) {
              mainWorktreePath = worktrees[0].path;
            }
          } else {
            // Graceful fallback single-entry
            worktrees = [
              {
                path: currentWorktreePath,
                head: '',
                isCurrent: true,
                isMain: isMainWorktree,
              },
            ];
          }
        } catch {
          // Graceful fallback single-entry
          worktrees = [
            {
              path: currentWorktreePath,
              head: '',
              isCurrent: true,
              isMain: isMainWorktree,
            },
          ];
        }

        worktree = {
          isMainWorktree,
          currentWorktreePath,
          mainWorktreePath,
          worktrees,
        };
      }
    }
  } catch {
    // Non-blocking degradation
  }

  // 1. Non-destructive fetch origin --prune
  let fetchSuccess = true;
  let fetchError: string | undefined;
  try {
    const res = await exec('git', ['fetch', 'origin', '--prune'], { cwd, timeout: fetchTimeout });
    if (res.exitCode !== 0) {
      fetchSuccess = false;
      fetchError = res.stderr.trim() || `git fetch exited with code ${res.exitCode}`;
    }
  } catch (err: any) {
    fetchSuccess = false;
    fetchError = err.message || String(err);
  }

  // 2. Identify current branch
  let currentBranchName = '';
  try {
    const res = await exec('git', ['branch', '--show-current'], { cwd });
    currentBranchName = res.stdout.trim();
  } catch {
    currentBranchName = '';
  }
  if (!currentBranchName) {
    currentBranchName = 'HEAD';
  }

  // 3. Current branch upstream and ahead/behind
  let upstream: string | undefined;
  let currentAhead = 0;
  let currentBehind = 0;
  let currentSyncStatus: SyncStatus = 'UNTRACKED';
  const incomingCommits: string[] = [];

  try {
    const res = await exec('git', ['rev-parse', '--abbrev-ref', '@{upstream}'], { cwd });
    if (res.exitCode === 0 && res.stdout.trim()) {
      upstream = res.stdout.trim();
    }
  } catch {
    upstream = undefined;
  }

  if (upstream) {
    try {
      const res = await exec('git', ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], { cwd });
      if (res.exitCode === 0) {
        const parsed = parseAheadBehind(res.stdout);
        currentAhead = parsed.ahead;
        currentBehind = parsed.behind;
        currentSyncStatus = parsed.syncStatus;
      }
    } catch {
      currentSyncStatus = 'UNTRACKED';
    }

    if (currentBehind > 0) {
      try {
        const res = await exec('git', ['log', 'HEAD..@{upstream}', '--oneline', '-n', '5'], { cwd });
        if (res.exitCode === 0 && res.stdout.trim()) {
          incomingCommits.push(...res.stdout.trim().split('\n').filter(Boolean));
        }
      } catch {
        // Ignore preview failure
      }
    }
  }

  // 4. Other local branches
  const otherLocalBranches: LocalBranchStatus[] = [];
  const allLocalBranchNames: string[] = [currentBranchName];

  try {
    const res = await exec('git', ['for-each-ref', '--format=%(refname:short) %(upstream:short)', 'refs/heads/'], { cwd });
    if (res.exitCode === 0 && res.stdout.trim()) {
      const lines = res.stdout.trim().split('\n').filter(Boolean);
      for (const line of lines) {
        const [bName, bUpstream] = line.trim().split(/\s+/);
        if (!allLocalBranchNames.includes(bName)) {
          allLocalBranchNames.push(bName);
        }
        if (bName === currentBranchName) continue;

        if (bUpstream) {
          try {
            const countRes = await exec('git', ['rev-list', '--left-right', '--count', `${bName}...${bUpstream}`], { cwd });
            if (countRes.exitCode === 0) {
              const parsed = parseAheadBehind(countRes.stdout);
              otherLocalBranches.push({
                branch: bName,
                upstream: bUpstream,
                ahead: parsed.ahead,
                behind: parsed.behind,
                syncStatus: parsed.syncStatus,
              });
              continue;
            }
          } catch {
            // fallback to untracked
          }
        }
        // Compare against trunk / base branch (e.g. main or master) if no upstream
        let aheadBase: number | undefined;
        let behindBase: number | undefined;
        const candidateBase = allLocalBranchNames.includes('main')
          ? 'main'
          : allLocalBranchNames.includes('master')
            ? 'master'
            : undefined;

        if (candidateBase && candidateBase !== bName) {
          try {
            const baseCountRes = await exec('git', ['rev-list', '--left-right', '--count', `${bName}...${candidateBase}`], { cwd });
            if (baseCountRes.exitCode === 0) {
              const parsedBase = parseAheadBehind(baseCountRes.stdout);
              aheadBase = parsedBase.ahead;
              behindBase = parsedBase.behind;
            }
          } catch {
            // ignore
          }
        }

        otherLocalBranches.push({
          branch: bName,
          upstream: bUpstream || undefined,
          ahead: 0,
          behind: 0,
          syncStatus: 'UNTRACKED',
          baseBranch: candidateBase,
          aheadBase,
          behindBase,
        });
      }
    }
  } catch {
    // Local branches read failed
  }

  // 5. Active collaborator branches not merged into origin/main
  const activeCollaboratorBranches: string[] = [];
  try {
    const res = await exec('git', ['branch', '-r', '--no-merged', 'origin/main'], { cwd });
    if (res.exitCode === 0 && res.stdout.trim()) {
      const lines = res.stdout
        .trim()
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => Boolean(l) && !l.includes('->') && !l.endsWith('/HEAD'));
      activeCollaboratorBranches.push(...lines);
    }
  } catch {
    // Ignore branch listing failure
  }

  // 6. Remote-only branches (remote tracking refs without a local branch counterpart)
  const remoteBranches: string[] = [];
  const remoteOnlyBranches: string[] = [];
  try {
    const res = await exec('git', ['branch', '-r', '--format=%(refname:short)'], { cwd });
    if (res.exitCode === 0 && res.stdout.trim()) {
      const remotes = res.stdout
        .trim()
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.startsWith('origin/') && !l.endsWith('/HEAD'));
      remoteBranches.push(...remotes);
      for (const r of remotes) {
        // e.g. "origin/feature/foo" -> short name "feature/foo"
        const prefix = r.split('/')[0] + '/';
        const shortName = r.slice(prefix.length);
        if (!allLocalBranchNames.includes(shortName)) {
          remoteOnlyBranches.push(r);
        }
      }
    }
  } catch {
    // Ignore remote-only check failure
  }

  // 7. Working tree cleanliness
  let workingTree: WorkingTreeStatus = {
    isClean: true,
    modifiedCount: 0,
    untrackedCount: 0,
    stagedCount: 0,
    summaryLines: [],
  };
  try {
    const res = await exec('git', ['status', '--short'], { cwd });
    if (res.exitCode === 0) {
      workingTree = parseWorkingTree(res.stdout);
    }
  } catch {
    // Ignore status failure
  }

  // 8. Policy check
  const policy = checkBranchPolicy(currentBranchName);
  const requiresDecision =
    currentSyncStatus === 'BEHIND' || currentSyncStatus === 'DIVERGED' || !workingTree.isClean;

  if (worktree && worktree.worktrees.length === 1 && !worktree.worktrees[0].head) {
    if (currentBranchName && currentBranchName !== 'HEAD') {
      worktree.worktrees[0].branch = currentBranchName;
    } else if (currentBranchName === 'HEAD') {
      worktree.worktrees[0].detached = true;
    }
  }

  const currentBranch: CurrentBranchStatus = {
    branch: currentBranchName,
    upstream,
    syncStatus: currentSyncStatus,
    ahead: currentAhead,
    behind: currentBehind,
    incomingCommits,
  };

  const partialDiag: Omit<GitSyncDiagnostic, 'formattedReport'> = {
    timestamp: Date.now(),
    fetchSuccess,
    fetchError,
    currentBranch,
    otherLocalBranches,
    remoteBranches,
    remoteOnlyBranches,
    activeCollaboratorBranches,
    workingTree,
    worktree,
    isBranchPolicyCompliant: policy.isCompliant,
    branchPolicyWarning: policy.warning,
    requiresDecision,
  };

  const formattedReport = formatDiagnosticReport(partialDiag);

  return {
    ...partialDiag,
    formattedReport,
  };
}
