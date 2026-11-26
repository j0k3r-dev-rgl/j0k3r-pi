# Git Sync Awareness Extension

A lightweight, global Pi extension that audits remote synchronization, upstream divergence, collaborator branches, and working tree cleanliness on the first message of each session in a Git worktree.

## Overview

The extension hooks into Pi's session and turn lifecycle to inject non-destructive Git diagnostics directly into the agent context before the agent loop begins. Agents can reuse the first-turn diagnostic instead of immediately repeating the same fetch.

## Architecture

- **`index.ts`**: Thin ExtensionAPI composition root. Registers the custom `git-sync-awareness` message renderer, hooks into `session_start` (resetting turn state), and hooks into `before_agent_start` (injecting the diagnostic report on turn 1).
- **`src/inspector.ts`**: Pure inspection engine. Executes non-destructive Git commands with timeout and error resilience, inspects worktrees and upstream divergence, and formats Markdown diagnostics.
- **`src/render.ts`**: Compact custom message renderer (`createGitSyncMessageRenderer`) with ANSI-aware automatic wrapping, 1-column left margin, muted expanded plain-text body, and left-click expand/collapse toggle.
- **`src/types.ts`**: TypeScript interfaces defining Git synchronization state, branch status, worktree metadata, and inspection options.
- **`test/git-sync-awareness.test.mjs`** & **`test/render.test.mjs`**: Automated unit and renderer test suites using Node.js built-in `node:test` runner.

## Lifecycle & Gating Contract

1. **`session_start`**: Resets the in-memory `hasReported` flag to `false`. Fires on session startup, reload, or resume.
2. **`before_agent_start`**:
   - **Turn 1**: Checks that Git is available and the working directory belongs to a Git worktree. If not, it injects no message and does not fetch. Otherwise, it runs `runGitSyncInspection()`, marks `hasReported = true`, and returns `{ message: { customType: "git-sync-awareness", content: <report>, display: true } }`. The message is rendered in the interactive TUI and provided as initial context to the model.
   - **Turn 2+**: Returns `undefined` (zero overhead on subsequent turns in the same session).

## Inspected Git Properties

1. **Remote Fetch**: Runs `git fetch origin --prune` with a 5000ms bounded timeout. If network is unreachable or offline, catches error gracefully and marks status `OFFLINE / UNFETCHED (using cached tracking refs)` without blocking the session.
2. **Current Branch & Upstream**: Inspects current branch and configured tracking ref (`git rev-parse --abbrev-ref @{upstream}`).
3. **Divergence Analysis**: Computes ahead and behind commit counts via `git rev-list --left-right --count HEAD...@{upstream}`, categorizing as `UP-TO-DATE`, `BEHIND [n]`, `AHEAD [n]`, `DIVERGED`, or `UNTRACKED`.
4. **Commit Preview**: Previews up to 5 incoming commits (`git log HEAD..@{upstream} --oneline -n 5`) when `BEHIND` or `DIVERGED`.
5. **Local Upstream States**: Evaluates divergence for all other local branches (`git for-each-ref`).
6. **Remote Snapshot**: Lists every `origin` remote-tracking branch, including branches already merged into `origin/main`; compares branches that have a local tracking counterpart, marks remote-only branches, and flags branches not merged into `origin/main`.
7. **Working Tree Cleanliness**: Audits `git status --short` for uncommitted, modified, and untracked changes.
8. **Worktree Diagnostics**: Detects base vs linked worktrees (`rev-parse --git-dir --git-common-dir --show-toplevel`) and lists active worktrees (`git worktree list --porcelain`, including `locked`, `prunable`, `detached`, and branches checked out in other worktrees).
9. **Branch Policy & Divergence Metadata (`details`)**: Computes `isBranchPolicyCompliant`, `branchPolicyWarning`, and `requiresDecision` (`BEHIND` / `DIVERGED`) in structured `details` (without performing any Git mutations). In the TUI renderer, `requiresDecision: true` highlights the status indicator/title in red; `formattedReport` and the rendered text intentionally stay concise without printing verbose branch-policy banners or mandatory-gate prose.

## Safety Constraints

- **Strictly Non-Destructive**: Performs no `git pull`, `git merge`, `git checkout`, `git push`, `git rebase`, or stash mutations.
- **Zero External Dependencies**: Implemented entirely with Node.js built-in standard library modules (`node:child_process`, `node:path`, `node:util`).
- **Global Installation**: Placed in `~/.pi/agent/extensions/git-sync-awareness/` where Pi discovers it across projects. If a project also installs its own copy, both copies may run until the project copy is removed.

## Testing

Run all unit and renderer tests directly with the Node.js built-in test runner:
```bash
node --test ~/.pi/agent/extensions/git-sync-awareness/test/*.test.mjs
```
