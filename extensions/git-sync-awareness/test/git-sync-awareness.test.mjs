import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

// Custom loader to resolve .js imports to .ts when running tests
const loaderCode = `
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  if (context.parentURL && (specifier.startsWith("./") || specifier.startsWith("../"))) {
    const resolvedUrl = new URL(specifier, context.parentURL);
    const resolvedPath = fileURLToPath(resolvedUrl);
    if (!existsSync(resolvedPath) && resolvedPath.endsWith(".js")) {
      const tsPath = resolvedPath.slice(0, -3) + ".ts";
      if (existsSync(tsPath)) {
        return { shortCircuit: true, url: pathToFileURL(tsPath).href };
      }
    }
  }
  return nextResolve(specifier, context);
}
`;

register("data:text/javascript," + encodeURIComponent(loaderCode));

test("MINI-001: Git Inspection Engine - UP-TO-DATE and clean state", async () => {
  const { runGitSyncInspection, parseAheadBehind } = await import("../src/inspector.ts");

  assert.deepEqual(parseAheadBehind("0\t0"), { ahead: 0, behind: 0, syncStatus: "UP-TO-DATE" });

  const mockExec = async (cmd, args) => {
    const full = [cmd, ...args].join(" ");
    if (full.includes("rev-parse --is-inside-work-tree")) return { stdout: "true\n", stderr: "", exitCode: 0 };
    if (full.includes("fetch origin --prune")) return { stdout: "", stderr: "", exitCode: 0 };
    if (full.includes("branch --show-current")) return { stdout: "feature/test-sync\n", stderr: "", exitCode: 0 };
    if (full.includes("rev-parse --abbrev-ref @{upstream}")) return { stdout: "origin/feature/test-sync\n", stderr: "", exitCode: 0 };
    if (full.includes("rev-list --left-right --count HEAD...@{upstream}")) return { stdout: "0\t0\n", stderr: "", exitCode: 0 };
    if (full.includes("for-each-ref")) return { stdout: "main origin/main\nfeature/test-sync origin/feature/test-sync\n", stderr: "", exitCode: 0 };
    if (full.includes("rev-list --left-right --count main...origin/main")) return { stdout: "0\t0\n", stderr: "", exitCode: 0 };
    if (full.includes("branch -r --no-merged origin/main")) return { stdout: "  origin/feature/test-sync\n", stderr: "", exitCode: 0 };
    if (full.includes("branch -r --format=%(refname:short)")) return { stdout: "origin/main\norigin/feature/test-sync\n", stderr: "", exitCode: 0 };
    if (full.includes("status --short")) return { stdout: "", stderr: "", exitCode: 0 };
    return { stdout: "", stderr: "", exitCode: 0 };
  };

  const diag = await runGitSyncInspection({ execFn: mockExec });
  assert.equal(diag.fetchSuccess, true);
  assert.equal(diag.currentBranch.branch, "feature/test-sync");
  assert.equal(diag.currentBranch.upstream, "origin/feature/test-sync");
  assert.equal(diag.currentBranch.syncStatus, "UP-TO-DATE");
  assert.equal(diag.currentBranch.ahead, 0);
  assert.equal(diag.currentBranch.behind, 0);
  assert.equal(diag.workingTree.isClean, true);
  assert.equal(diag.requiresDecision, false);
  assert.match(diag.formattedReport, /UP-TO-DATE/);
  assert.doesNotMatch(diag.formattedReport, /Branch Policy|Recommended Action|Decision Gate|Safe to proceed/i);
});

test("MINI-001: Git Inspection Engine - BEHIND state with preview commits triggers decision gate", async () => {
  const { runGitSyncInspection, parseAheadBehind } = await import("../src/inspector.ts");

  assert.deepEqual(parseAheadBehind("0\t3"), { ahead: 0, behind: 3, syncStatus: "BEHIND" });

  const mockExec = async (cmd, args) => {
    const full = [cmd, ...args].join(" ");
    if (full.includes("rev-parse --is-inside-work-tree")) return { stdout: "true\n", stderr: "", exitCode: 0 };
    if (full.includes("fetch origin --prune")) return { stdout: "", stderr: "", exitCode: 0 };
    if (full.includes("branch --show-current")) return { stdout: "feature/test-sync\n", stderr: "", exitCode: 0 };
    if (full.includes("rev-parse --abbrev-ref @{upstream}")) return { stdout: "origin/feature/test-sync\n", stderr: "", exitCode: 0 };
    if (full.includes("rev-list --left-right --count HEAD...@{upstream}")) return { stdout: "0\t2\n", stderr: "", exitCode: 0 };
    if (full.includes("log HEAD..@{upstream} --oneline -n 5")) {
      return { stdout: "abc1234 Fix race condition (@CinloDev)\ndef5678 Add schema validator (@CinloDev)\n", stderr: "", exitCode: 0 };
    }
    if (full.includes("for-each-ref")) return { stdout: "", stderr: "", exitCode: 0 };
    if (full.includes("branch -r --no-merged origin/main")) return { stdout: "", stderr: "", exitCode: 0 };
    if (full.includes("branch -r --format=%(refname:short)")) return { stdout: "origin/main\n", stderr: "", exitCode: 0 };
    if (full.includes("status --short")) return { stdout: "", stderr: "", exitCode: 0 };
    return { stdout: "", stderr: "", exitCode: 0 };
  };

  const diag = await runGitSyncInspection({ execFn: mockExec });
  assert.equal(diag.currentBranch.syncStatus, "BEHIND");
  assert.equal(diag.currentBranch.behind, 2);
  assert.equal(diag.currentBranch.ahead, 0);
  assert.equal(diag.currentBranch.incomingCommits.length, 2);
  assert.equal(diag.requiresDecision, true);
  assert.match(diag.formattedReport, /BEHIND \[2\]/);
  assert.doesNotMatch(diag.formattedReport, /MANDATORY DECISION GATE|Prompt user|Automatic pull/i);
  assert.match(diag.formattedReport, /Fix race condition/);
});

test("MINI-001: Git Inspection Engine - AHEAD and DIVERGED states", async () => {
  const { parseAheadBehind } = await import("../src/inspector.ts");

  assert.deepEqual(parseAheadBehind("2\t0"), { ahead: 2, behind: 0, syncStatus: "AHEAD" });
  assert.deepEqual(parseAheadBehind("3\t4"), { ahead: 3, behind: 4, syncStatus: "DIVERGED" });
});

test("MINI-001: Git Inspection Engine - UNTRACKED branch", async () => {
  const { runGitSyncInspection } = await import("../src/inspector.ts");

  const mockExec = async (cmd, args) => {
    const full = [cmd, ...args].join(" ");
    if (full.includes("rev-parse --is-inside-work-tree")) return { stdout: "true\n", stderr: "", exitCode: 0 };
    if (full.includes("fetch origin --prune")) return { stdout: "", stderr: "", exitCode: 0 };
    if (full.includes("branch --show-current")) return { stdout: "feature/untracked-work\n", stderr: "", exitCode: 0 };
    if (full.includes("rev-parse --abbrev-ref @{upstream}")) {
      const err = new Error("fatal: no upstream configured for branch 'feature/untracked-work'");
      err.exitCode = 128;
      throw err;
    }
    if (full.includes("for-each-ref")) return { stdout: "", stderr: "", exitCode: 0 };
    if (full.includes("branch -r --no-merged origin/main")) return { stdout: "", stderr: "", exitCode: 0 };
    if (full.includes("branch -r --format=%(refname:short)")) return { stdout: "origin/main\n", stderr: "", exitCode: 0 };
    if (full.includes("status --short")) return { stdout: "", stderr: "", exitCode: 0 };
    return { stdout: "", stderr: "", exitCode: 0 };
  };

  const diag = await runGitSyncInspection({ execFn: mockExec });
  assert.equal(diag.currentBranch.syncStatus, "UNTRACKED");
  assert.equal(diag.currentBranch.upstream, undefined);
  assert.match(diag.formattedReport, /UNTRACKED/);
});

test("MINI-001: Git Inspection Engine - Offline/fetch failure fallback", async () => {
  const { runGitSyncInspection } = await import("../src/inspector.ts");

  const mockExec = async (cmd, args) => {
    const full = [cmd, ...args].join(" ");
    if (full.includes("rev-parse --is-inside-work-tree")) return { stdout: "true\n", stderr: "", exitCode: 0 };
    if (full.includes("fetch origin --prune")) {
      throw new Error("Could not resolve host: github.com");
    }
    if (full.includes("branch --show-current")) return { stdout: "main\n", stderr: "", exitCode: 0 };
    if (full.includes("rev-parse --abbrev-ref @{upstream}")) return { stdout: "origin/main\n", stderr: "", exitCode: 0 };
    if (full.includes("rev-list --left-right --count HEAD...@{upstream}")) return { stdout: "0\t0\n", stderr: "", exitCode: 0 };
    if (full.includes("for-each-ref")) return { stdout: "main origin/main\n", stderr: "", exitCode: 0 };
    if (full.includes("branch -r --no-merged origin/main")) return { stdout: "", stderr: "", exitCode: 0 };
    if (full.includes("branch -r --format=%(refname:short)")) return { stdout: "origin/main\n", stderr: "", exitCode: 0 };
    if (full.includes("status --short")) return { stdout: "", stderr: "", exitCode: 0 };
    return { stdout: "", stderr: "", exitCode: 0 };
  };

  const diag = await runGitSyncInspection({ execFn: mockExec });
  assert.equal(diag.fetchSuccess, false);
  assert.match(diag.fetchError, /Could not resolve host/);
  assert.equal(diag.currentBranch.syncStatus, "UP-TO-DATE");
  assert.match(diag.formattedReport, /OFFLINE \/ UNFETCHED \(using cached tracking refs/);
});

test("MINI-001: Git Inspection Engine - Working tree dirty state", async () => {
  const { runGitSyncInspection } = await import("../src/inspector.ts");

  const mockExec = async (cmd, args) => {
    const full = [cmd, ...args].join(" ");
    if (full.includes("rev-parse --is-inside-work-tree")) return { stdout: "true\n", stderr: "", exitCode: 0 };
    if (full.includes("fetch origin --prune")) return { stdout: "", stderr: "", exitCode: 0 };
    if (full.includes("branch --show-current")) return { stdout: "main\n", stderr: "", exitCode: 0 };
    if (full.includes("rev-parse --abbrev-ref @{upstream}")) return { stdout: "origin/main\n", stderr: "", exitCode: 0 };
    if (full.includes("rev-list --left-right --count HEAD...@{upstream}")) return { stdout: "0\t0\n", stderr: "", exitCode: 0 };
    if (full.includes("for-each-ref")) return { stdout: "", stderr: "", exitCode: 0 };
    if (full.includes("branch -r --no-merged origin/main")) return { stdout: "", stderr: "", exitCode: 0 };
    if (full.includes("branch -r --format=%(refname:short)")) return { stdout: "origin/main\n", stderr: "", exitCode: 0 };
    if (full.includes("status --short")) return { stdout: " M src/index.ts\n?? new-file.txt\n", stderr: "", exitCode: 0 };
    return { stdout: "", stderr: "", exitCode: 0 };
  };

  const diag = await runGitSyncInspection({ execFn: mockExec });
  assert.equal(diag.workingTree.isClean, false);
  assert.equal(diag.workingTree.modifiedCount, 1);
  assert.equal(diag.workingTree.untrackedCount, 1);
  assert.equal(diag.requiresDecision, true);
  assert.match(diag.formattedReport, /dirty \[1 modified, 1 untracked\]/);
});

test("MINI-001: Git Inspection Engine - Remote-only collaborator branches listed", async () => {
  const { runGitSyncInspection } = await import("../src/inspector.ts");

  const mockExec = async (cmd, args) => {
    const full = [cmd, ...args].join(" ");
    if (full.includes("rev-parse --is-inside-work-tree")) return { stdout: "true\n", stderr: "", exitCode: 0 };
    if (full.includes("fetch origin --prune")) return { stdout: "", stderr: "", exitCode: 0 };
    if (full.includes("branch --show-current")) return { stdout: "main\n", stderr: "", exitCode: 0 };
    if (full.includes("rev-parse --abbrev-ref @{upstream}")) return { stdout: "origin/main\n", stderr: "", exitCode: 0 };
    if (full.includes("rev-list --left-right --count HEAD...@{upstream}")) return { stdout: "0\t0\n", stderr: "", exitCode: 0 };
    if (full.includes("for-each-ref")) return { stdout: "main origin/main\n", stderr: "", exitCode: 0 };
    if (full.includes("branch -r --no-merged origin/main")) {
      return { stdout: "  origin/feature/catalog-grid\n  origin/fix/media-upload\n", stderr: "", exitCode: 0 };
    }
    if (full.includes("branch -r --format=%(refname:short)")) {
      return { stdout: "origin/main\norigin/feature/catalog-grid\norigin/fix/media-upload\n", stderr: "", exitCode: 0 };
    }
    if (full.includes("status --short")) return { stdout: "", stderr: "", exitCode: 0 };
    return { stdout: "", stderr: "", exitCode: 0 };
  };

  const diag = await runGitSyncInspection({ execFn: mockExec });
  assert.deepEqual(diag.remoteOnlyBranches, ["origin/feature/catalog-grid", "origin/fix/media-upload"]);
  assert.deepEqual(diag.activeCollaboratorBranches, ["origin/feature/catalog-grid", "origin/fix/media-upload"]);
  assert.match(diag.formattedReport, /origin\/feature\/catalog-grid/);
  assert.match(diag.formattedReport, /origin\/fix\/media-upload/);
});

test("Remote snapshot lists merged and unmerged branches and compares matching local upstreams", async () => {
  const { runGitSyncInspection } = await import("../src/inspector.ts");
  const mockExec = async (cmd, args) => {
    const full = [cmd, ...args].join(" ");
    if (full.includes("rev-parse --is-inside-work-tree")) return { stdout: "true\n", stderr: "", exitCode: 0 };
    if (full.includes("fetch origin --prune")) return { stdout: "", stderr: "", exitCode: 0 };
    if (full.includes("branch --show-current")) return { stdout: "main\n", stderr: "", exitCode: 0 };
    if (full.includes("rev-parse --abbrev-ref @{upstream}")) return { stdout: "origin/main\n", stderr: "", exitCode: 0 };
    if (full.includes("rev-list --left-right --count HEAD...@{upstream}")) return { stdout: "0\t0\n", stderr: "", exitCode: 0 };
    if (full.includes("for-each-ref")) return { stdout: "main origin/main\nfeature/local origin/feature/local\n", stderr: "", exitCode: 0 };
    if (full.includes("rev-list --left-right --count feature/local...origin/feature/local")) return { stdout: "1\t2\n", stderr: "", exitCode: 0 };
    if (full.includes("branch -r --no-merged origin/main")) return { stdout: "  origin/feature/local\n", stderr: "", exitCode: 0 };
    if (full.includes("branch -r --format=%(refname:short)")) {
      return { stdout: "origin/main\norigin/feature/local\norigin/docs/merged\n", stderr: "", exitCode: 0 };
    }
    if (full.includes("status --short")) return { stdout: "", stderr: "", exitCode: 0 };
    return { stdout: "", stderr: "", exitCode: 0 };
  };

  const diag = await runGitSyncInspection({ execFn: mockExec });
  assert.deepEqual(diag.remoteBranches, ["origin/main", "origin/feature/local", "origin/docs/merged"]);
  assert.match(diag.formattedReport, /#### Remote Branches \(origin\)/);
  assert.match(diag.formattedReport, /`origin\/main`: local `main` — `UP-TO-DATE`/);
  assert.match(diag.formattedReport, /`origin\/feature\/local`: local `feature\/local` — `DIVERGED \(ahead 1, behind 2\)`.*unmerged into main/);
  assert.match(diag.formattedReport, /`origin\/docs\/merged`: remote-only/);
});

test("MINI-001: Git Inspection Engine - DIVERGED state with incoming commits and decision gate", async () => {
  const { runGitSyncInspection } = await import("../src/inspector.ts");

  const mockExec = async (cmd, args) => {
    const full = [cmd, ...args].join(" ");
    if (full.includes("rev-parse --is-inside-work-tree")) return { stdout: "true\n", stderr: "", exitCode: 0 };
    if (full.includes("fetch origin --prune")) return { stdout: "", stderr: "", exitCode: 0 };
    if (full.includes("branch --show-current")) return { stdout: "feature/diverged-branch\n", stderr: "", exitCode: 0 };
    if (full.includes("rev-parse --abbrev-ref @{upstream}")) return { stdout: "origin/feature/diverged-branch\n", stderr: "", exitCode: 0 };
    if (full.includes("rev-list --left-right --count HEAD...@{upstream}")) return { stdout: "2\t3\n", stderr: "", exitCode: 0 };
    if (full.includes("log HEAD..@{upstream} --oneline -n 5")) {
      return { stdout: "1111111 Collaborator commit 1\n2222222 Collaborator commit 2\n", stderr: "", exitCode: 0 };
    }
    if (full.includes("for-each-ref")) return { stdout: "", stderr: "", exitCode: 0 };
    if (full.includes("branch -r --no-merged origin/main")) return { stdout: "", stderr: "", exitCode: 0 };
    if (full.includes("branch -r --format=%(refname:short)")) return { stdout: "origin/main\n", stderr: "", exitCode: 0 };
    if (full.includes("status --short")) return { stdout: "", stderr: "", exitCode: 0 };
    return { stdout: "", stderr: "", exitCode: 0 };
  };

  const diag = await runGitSyncInspection({ execFn: mockExec });
  assert.equal(diag.currentBranch.syncStatus, "DIVERGED");
  assert.equal(diag.currentBranch.ahead, 2);
  assert.equal(diag.currentBranch.behind, 3);
  assert.equal(diag.requiresDecision, true);
  assert.match(diag.formattedReport, /DIVERGED \(ahead 2, behind 3\)/);
  assert.doesNotMatch(diag.formattedReport, /MANDATORY DECISION GATE|Prompt user|Automatic merge/i);
});

test("MINI-001: Git Inspection Engine - Non-compliant branch naming policy warning", async () => {
  const { checkBranchPolicy } = await import("../src/inspector.ts");

  assert.equal(checkBranchPolicy("feature/test-1").isCompliant, true);
  assert.equal(checkBranchPolicy("fix/bug-123").isCompliant, true);
  assert.equal(checkBranchPolicy("refactor/core-cleanup").isCompliant, true);
  assert.equal(checkBranchPolicy("docs/readme-update").isCompliant, true);

  const mainCheck = checkBranchPolicy("main");
  assert.equal(mainCheck.isCompliant, true);
  assert.match(mainCheck.warning, /Direct commits for feature work are prohibited/);

  const nonCompliant = checkBranchPolicy("my-random-branch");
  assert.equal(nonCompliant.isCompliant, false);
  assert.match(nonCompliant.warning, /does not follow canonical naming convention/);
});

test("Skip inspection without a Git executable or repository", async () => {
  const { runGitSyncInspection } = await import("../src/inspector.ts");

  for (const failure of ["missing-git", "not-a-repository"]) {
    const calls = [];
    const mockExec = async (_cmd, args) => {
      calls.push(args.join(" "));
      if (failure === "missing-git") throw new Error("spawn git ENOENT");
      return { stdout: "", stderr: "fatal: not a git repository", exitCode: 128 };
    };

    assert.equal(await runGitSyncInspection({ execFn: mockExec }), null);
    assert.deepEqual(calls, ["rev-parse --is-inside-work-tree"], `No fetch or further queries for ${failure}`);
  }
});

test("MINI-002: Pi Extension - Handles unexpected inspection exception gracefully", async () => {
  const { default: gitSyncAwarenessExtension } = await import("../index.ts");

  const listeners = {};
  const mockPi = {
    on: (event, handler) => {
      listeners[event] = handler;
    },
  };

  gitSyncAwarenessExtension(mockPi);

  const throwingInspector = async () => {
    throw new Error("Simulated critical failure during git query");
  };

  const result = await listeners["before_agent_start"]({}, { inspectorOverride: throwingInspector });
  assert.ok(result);
  assert.equal(result.message.customType, "git-sync-awareness");
  assert.equal(result.message.display, true);
  assert.match(result.message.content, /failed to inspect repository: Simulated critical failure/);
});

test("First turn injects nothing outside a Git repository", async () => {
  const { default: gitSyncAwarenessExtension } = await import("../index.ts");
  const listeners = {};
  gitSyncAwarenessExtension({ on: (event, handler) => { listeners[event] = handler; } });

  let calls = 0;
  const inspectorOverride = async () => { calls++; return null; };
  assert.equal(await listeners.before_agent_start({}, { inspectorOverride }), undefined);
  assert.equal(await listeners.before_agent_start({}, { inspectorOverride }), undefined);
  assert.equal(calls, 1);
});

test("MINI-002: Pi Extension Lifecycle and First-Turn Gating", async () => {
  const { default: gitSyncAwarenessExtension } = await import("../index.ts");

  const listeners = {};
  const mockPi = {
    on: (event, handler) => {
      listeners[event] = handler;
    },
  };

  gitSyncAwarenessExtension(mockPi, { cwd: "/mock/dir" });

  assert.ok(listeners["session_start"], "session_start listener registered");
  assert.ok(listeners["before_agent_start"], "before_agent_start listener registered");

  // Mock inspector response
  let inspectionCallCount = 0;
  const mockInspection = async () => {
    inspectionCallCount++;
    return {
      formattedReport: "MOCK_REPORT",
      fetchSuccess: true,
      currentBranch: { branch: "main", syncStatus: "UP-TO-DATE", ahead: 0, behind: 0 },
      otherLocalBranches: [],
      remoteOnlyBranches: [],
      activeCollaboratorBranches: [],
      workingTree: { isClean: true, modifiedCount: 0, untrackedCount: 0, stagedCount: 0, summaryLines: [] },
      requiresDecision: false,
    };
  };

  // Re-import extension with injected/mockable runner or test the gating mechanism
  // First turn:
  const turn1Result = await listeners["before_agent_start"]({}, { inspectorOverride: mockInspection });
  assert.ok(turn1Result, "turn 1 returned a result");
  assert.equal(turn1Result.message.customType, "git-sync-awareness");
  assert.equal(turn1Result.message.display, true);

  // Second turn: should return undefined (gated)
  const turn2Result = await listeners["before_agent_start"]({}, { inspectorOverride: mockInspection });
  assert.equal(turn2Result, undefined, "turn 2 returned undefined");

  // Third turn: still undefined
  const turn3Result = await listeners["before_agent_start"]({}, { inspectorOverride: mockInspection });
  assert.equal(turn3Result, undefined, "turn 3 returned undefined");

  // session_start fires (reload, resume, or new session):
  await listeners["session_start"]();

  // Next turn after session_start: runs again once!
  const postResetResult = await listeners["before_agent_start"]({}, { inspectorOverride: mockInspection });
  assert.ok(postResetResult, "first turn after session_start reset returned a result");
  assert.equal(postResetResult.message.customType, "git-sync-awareness");

  // Follow-up turn: gated again
  const postResetTurn2 = await listeners["before_agent_start"]({}, { inspectorOverride: mockInspection });
  assert.equal(postResetTurn2, undefined, "second turn after reset is gated");
});

test("MINI-001: Exports Worktree types and parser from index.ts", async () => {
  const index = await import("../index.ts");
  assert.equal(typeof index.parseWorktreeListPorcelain, "function");
  assert.equal(typeof index.runGitSyncInspection, "function");
  assert.equal(typeof index.formatDiagnosticReport, "function");
});

test("MINI-002: Worktree Porcelain Parser - parses single main worktree", async () => {
  const { parseWorktreeListPorcelain } = await import("../src/inspector.ts");
  assert.equal(typeof parseWorktreeListPorcelain, "function");

  const porcelain = [
    "worktree /home/user/repo",
    "HEAD 1111111111111111111111111111111111111111",
    "branch refs/heads/main",
    "",
  ].join("\n");

  const entries = parseWorktreeListPorcelain(porcelain, "/home/user/repo", "/home/user/repo");
  assert.equal(entries.length, 1);
  assert.equal(entries[0].path, "/home/user/repo");
  assert.equal(entries[0].head, "1111111111111111111111111111111111111111");
  assert.equal(entries[0].branch, "main");
  assert.equal(entries[0].isMain, true);
  assert.equal(entries[0].isCurrent, true);
  assert.equal(entries[0].detached, undefined);
  assert.equal(entries[0].locked, undefined);
  assert.equal(entries[0].prunable, undefined);
});

test("MINI-002: Worktree Porcelain Parser - multi-worktree with detached, locked, and prunable checkouts", async () => {
  const { parseWorktreeListPorcelain } = await import("../src/inspector.ts");

  const porcelain = [
    "worktree /home/user/repo",
    "HEAD 1111111111111111111111111111111111111111",
    "branch refs/heads/main",
    "",
    "worktree /home/user/repo-linked",
    "HEAD 2222222222222222222222222222222222222222",
    "branch refs/heads/feature/worktree-sync",
    "",
    "worktree /home/user/repo-locked",
    "HEAD 3333333333333333333333333333333333333333",
    "branch refs/heads/fix/locked-issue",
    "locked maintenance in progress",
    "",
    "worktree /home/user/repo-detached",
    "HEAD 4444444444444444444444444444444444444444",
    "detached",
    "prunable gitdir file missing",
    "",
  ].join("\n");

  const entries = parseWorktreeListPorcelain(porcelain, "/home/user/repo-linked", "/home/user/repo");
  assert.equal(entries.length, 4);

  // Entry 0: main repository
  assert.equal(entries[0].path, "/home/user/repo");
  assert.equal(entries[0].branch, "main");
  assert.equal(entries[0].isMain, true);
  assert.equal(entries[0].isCurrent, false);

  // Entry 1: current linked worktree
  assert.equal(entries[1].path, "/home/user/repo-linked");
  assert.equal(entries[1].branch, "feature/worktree-sync");
  assert.equal(entries[1].isMain, false);
  assert.equal(entries[1].isCurrent, true);

  // Entry 2: locked worktree
  assert.equal(entries[2].path, "/home/user/repo-locked");
  assert.equal(entries[2].branch, "fix/locked-issue");
  assert.equal(entries[2].locked, "maintenance in progress");

  // Entry 3: detached and prunable worktree
  assert.equal(entries[3].path, "/home/user/repo-detached");
  assert.equal(entries[3].branch, undefined);
  assert.equal(entries[3].detached, true);
  assert.equal(entries[3].prunable, "gitdir file missing");
});

test("MINI-002: Worktree Porcelain Parser - empty and malformed input handling", async () => {
  const { parseWorktreeListPorcelain } = await import("../src/inspector.ts");

  assert.deepEqual(parseWorktreeListPorcelain("", "/repo", "/repo"), []);
  assert.deepEqual(parseWorktreeListPorcelain("   \n\n  ", "/repo", "/repo"), []);
  assert.deepEqual(parseWorktreeListPorcelain("invalid lines without worktree marker", "/repo", "/repo"), []);
});

test("MINI-002: Git Inspection Engine - main worktree detection (git-dir === git-common-dir)", async () => {
  const { runGitSyncInspection } = await import("../src/inspector.ts");

  const mockExec = async (cmd, args) => {
    const full = [cmd, ...args].join(" ");
    if (full.includes("rev-parse --is-inside-work-tree")) return { stdout: "true\n", stderr: "", exitCode: 0 };
    if (full.includes("rev-parse --git-dir --git-common-dir --show-toplevel")) {
      return { stdout: ".git\n.git\n/home/user/repo\n", stderr: "", exitCode: 0 };
    }
    if (full.includes("worktree list --porcelain")) {
      return {
        stdout: "worktree /home/user/repo\nHEAD abcdef0123456789abcdef0123456789abcdef01\nbranch refs/heads/main\n\n",
        stderr: "",
        exitCode: 0,
      };
    }
    if (full.includes("fetch origin --prune")) return { stdout: "", stderr: "", exitCode: 0 };
    if (full.includes("branch --show-current")) return { stdout: "main\n", stderr: "", exitCode: 0 };
    if (full.includes("rev-parse --abbrev-ref @{upstream}")) return { stdout: "origin/main\n", stderr: "", exitCode: 0 };
    if (full.includes("rev-list --left-right --count HEAD...@{upstream}")) return { stdout: "0\t0\n", stderr: "", exitCode: 0 };
    if (full.includes("for-each-ref")) return { stdout: "main origin/main\n", stderr: "", exitCode: 0 };
    if (full.includes("branch -r --no-merged origin/main")) return { stdout: "", stderr: "", exitCode: 0 };
    if (full.includes("branch -r --format=%(refname:short)")) return { stdout: "origin/main\n", stderr: "", exitCode: 0 };
    if (full.includes("status --short")) return { stdout: "", stderr: "", exitCode: 0 };
    return { stdout: "", stderr: "", exitCode: 0 };
  };

  const diag = await runGitSyncInspection({ cwd: "/home/user/repo", execFn: mockExec });
  assert.ok(diag.worktree);
  assert.equal(diag.worktree.isMainWorktree, true);
  assert.equal(diag.worktree.currentWorktreePath, "/home/user/repo");
  assert.equal(diag.worktree.mainWorktreePath, "/home/user/repo");
  assert.equal(diag.worktree.worktrees.length, 1);
  assert.equal(diag.worktree.worktrees[0].isMain, true);
  assert.equal(diag.worktree.worktrees[0].isCurrent, true);
  assert.match(diag.formattedReport, /- \*\*Worktree\*\*: `main` \(base repository\)/);
  assert.doesNotMatch(diag.formattedReport, /#### Active Worktrees/);
});

test("MINI-002: Git Inspection Engine - linked worktree detection (git-dir !== git-common-dir)", async () => {
  const { runGitSyncInspection } = await import("../src/inspector.ts");

  const mockExec = async (cmd, args) => {
    const full = [cmd, ...args].join(" ");
    if (full.includes("rev-parse --is-inside-work-tree")) return { stdout: "true\n", stderr: "", exitCode: 0 };
    if (full.includes("rev-parse --git-dir --git-common-dir --show-toplevel")) {
      return {
        stdout: "/home/user/repo/.git/worktrees/feature-wt\n/home/user/repo/.git\n/home/user/repo-wt\n",
        stderr: "",
        exitCode: 0,
      };
    }
    if (full.includes("worktree list --porcelain")) {
      const wtPorcelain = [
        "worktree /home/user/repo",
        "HEAD 1111111111111111111111111111111111111111",
        "branch refs/heads/main",
        "",
        "worktree /home/user/repo-wt",
        "HEAD 2222222222222222222222222222222222222222",
        "branch refs/heads/feature/task-wt",
        "",
      ].join("\n");
      return { stdout: wtPorcelain, stderr: "", exitCode: 0 };
    }
    if (full.includes("fetch origin --prune")) return { stdout: "", stderr: "", exitCode: 0 };
    if (full.includes("branch --show-current")) return { stdout: "feature/task-wt\n", stderr: "", exitCode: 0 };
    if (full.includes("rev-parse --abbrev-ref @{upstream}")) return { stdout: "origin/feature/task-wt\n", stderr: "", exitCode: 0 };
    if (full.includes("rev-list --left-right --count HEAD...@{upstream}")) return { stdout: "0\t0\n", stderr: "", exitCode: 0 };
    if (full.includes("for-each-ref")) return { stdout: "main origin/main\nfeature/task-wt origin/feature/task-wt\n", stderr: "", exitCode: 0 };
    if (full.includes("branch -r --no-merged origin/main")) return { stdout: "", stderr: "", exitCode: 0 };
    if (full.includes("branch -r --format=%(refname:short)")) return { stdout: "origin/main\norigin/feature/task-wt\n", stderr: "", exitCode: 0 };
    if (full.includes("status --short")) return { stdout: "", stderr: "", exitCode: 0 };
    return { stdout: "", stderr: "", exitCode: 0 };
  };

  const diag = await runGitSyncInspection({ cwd: "/home/user/repo-wt", execFn: mockExec });
  assert.ok(diag.worktree);
  assert.equal(diag.worktree.isMainWorktree, false);
  assert.equal(diag.worktree.currentWorktreePath, "/home/user/repo-wt");
  assert.equal(diag.worktree.mainWorktreePath, "/home/user/repo");
  assert.equal(diag.worktree.worktrees.length, 2);
  assert.equal(diag.worktree.worktrees[0].isMain, true);
  assert.equal(diag.worktree.worktrees[0].isCurrent, false);
  assert.equal(diag.worktree.worktrees[1].isMain, false);
  assert.equal(diag.worktree.worktrees[1].isCurrent, true);
  assert.match(diag.formattedReport, /- \*\*Worktree\*\*: `linked` \(base: `\/home\/user\/repo`\)/);
  assert.match(diag.formattedReport, /#### Active Worktrees/);
  assert.match(diag.formattedReport, /`\/home\/user\/repo`: branch `main` \[HEAD 1111111\] \(base\)/);
  assert.match(diag.formattedReport, /`\/home\/user\/repo-wt`: branch `feature\/task-wt` \[HEAD 2222222\] \(current\)/);
});

test("MINI-002: Git Inspection Engine - fallback when worktree list fails", async () => {
  const { runGitSyncInspection } = await import("../src/inspector.ts");

  const mockExec = async (cmd, args) => {
    const full = [cmd, ...args].join(" ");
    if (full.includes("rev-parse --is-inside-work-tree")) return { stdout: "true\n", stderr: "", exitCode: 0 };
    if (full.includes("rev-parse --git-dir --git-common-dir --show-toplevel")) {
      return { stdout: ".git\n.git\n/home/user/repo\n", stderr: "", exitCode: 0 };
    }
    if (full.includes("worktree list --porcelain")) {
      throw new Error("git worktree list: command not supported (Git 2.5)");
    }
    if (full.includes("fetch origin --prune")) return { stdout: "", stderr: "", exitCode: 0 };
    if (full.includes("branch --show-current")) return { stdout: "main\n", stderr: "", exitCode: 0 };
    if (full.includes("rev-parse --abbrev-ref @{upstream}")) return { stdout: "origin/main\n", stderr: "", exitCode: 0 };
    if (full.includes("rev-list --left-right --count HEAD...@{upstream}")) return { stdout: "0\t0\n", stderr: "", exitCode: 0 };
    if (full.includes("for-each-ref")) return { stdout: "main origin/main\n", stderr: "", exitCode: 0 };
    if (full.includes("branch -r --no-merged origin/main")) return { stdout: "", stderr: "", exitCode: 0 };
    if (full.includes("branch -r --format=%(refname:short)")) return { stdout: "origin/main\n", stderr: "", exitCode: 0 };
    if (full.includes("status --short")) return { stdout: "", stderr: "", exitCode: 0 };
    return { stdout: "", stderr: "", exitCode: 0 };
  };

  const diag = await runGitSyncInspection({ cwd: "/home/user/repo", execFn: mockExec });
  assert.ok(diag.worktree);
  assert.equal(diag.worktree.isMainWorktree, true);
  assert.equal(diag.worktree.currentWorktreePath, "/home/user/repo");
  assert.equal(diag.worktree.worktrees.length, 1);
  assert.equal(diag.worktree.worktrees[0].path, "/home/user/repo");
  assert.match(diag.formattedReport, /- \*\*Worktree\*\*: `main` \(base repository\)/);
});

test("MINI-003: Report Formatting - multi-worktree tags and cross-worktree collision warning", async () => {
  const { formatDiagnosticReport } = await import("../src/inspector.ts");

  const diag = {
    timestamp: Date.now(),
    fetchSuccess: true,
    currentBranch: { branch: "feature/wt-a", syncStatus: "UP-TO-DATE", ahead: 0, behind: 0, incomingCommits: [] },
    otherLocalBranches: [
      { branch: "feature/wt-b", upstream: "origin/feature/wt-b", ahead: 0, behind: 0, syncStatus: "UP-TO-DATE" },
      { branch: "feature/idle", ahead: 0, behind: 0, syncStatus: "UNTRACKED" },
    ],
    remoteBranches: ["origin/main", "origin/feature/wt-a", "origin/feature/wt-b"],
    remoteOnlyBranches: [],
    activeCollaboratorBranches: [],
    workingTree: { isClean: true, modifiedCount: 0, untrackedCount: 0, stagedCount: 0, summaryLines: [] },
    isBranchPolicyCompliant: true,
    requiresDecision: false,
    worktree: {
      isMainWorktree: false,
      currentWorktreePath: "/repo-wt-a",
      mainWorktreePath: "/repo",
      worktrees: [
        { path: "/repo", head: "aaaaaaa111111111111111111111111111111111", branch: "main", isMain: true, isCurrent: false },
        { path: "/repo-wt-a", head: "bbbbbbb222222222222222222222222222222222", branch: "feature/wt-a", isMain: false, isCurrent: true },
        { path: "/repo-wt-b", head: "ccccccc333333333333333333333333333333333", branch: "feature/wt-b", isMain: false, isCurrent: false, locked: "locked for review" },
        { path: "/repo-wt-c", head: "ddddddd444444444444444444444444444444444", isMain: false, isCurrent: false, detached: true, prunable: true },
      ],
    },
  };

  const report = formatDiagnosticReport(diag);

  // Header check
  assert.match(report, /- \*\*Worktree\*\*: `linked` \(base: `\/repo`\)/);

  // Active worktrees check
  assert.match(report, /#### Active Worktrees/);
  assert.match(report, /`\/repo`: branch `main` \[HEAD aaaaaaa\] \(base\)/);
  assert.match(report, /`\/repo-wt-a`: branch `feature\/wt-a` \[HEAD bbbbbbb\] \(current\)/);
  assert.match(report, /`\/repo-wt-b`: branch `feature\/wt-b` \[HEAD ccccccc\] \[locked: locked for review\]/);
  assert.match(report, /`\/repo-wt-c`: branch `detached` \[HEAD ddddddd\] \[prunable\]/);

  // Mutual checkout collision notice
  assert.doesNotMatch(report, /Git prevents checking out branches that are already active in another worktree/);
  assert.match(report, /`feature\/wt-b`: `UP-TO-DATE` \(`origin\/feature\/wt-b`\) \[active in worktree: `\/repo-wt-b`\]/);
  assert.doesNotMatch(report, /`feature\/idle`.*active in worktree/);
});

test("MINI-004: Git Inspection Engine - Untracked other local branch compared against main", async () => {
  const { runGitSyncInspection } = await import("../src/inspector.ts");

  const mockExec = async (cmd, args) => {
    const full = [cmd, ...args].join(" ");
    if (full.includes("rev-parse --is-inside-work-tree")) return { stdout: "true\n", stderr: "", exitCode: 0 };
    if (full.includes("rev-parse --git-dir --git-common-dir")) return { stdout: ".git\n.git\n/test\n", stderr: "", exitCode: 0 };
    if (full.includes("worktree list --porcelain")) return { stdout: "worktree /test\nHEAD abc\nbranch refs/heads/main\n\n", stderr: "", exitCode: 0 };
    if (full.includes("fetch origin --prune")) return { stdout: "", stderr: "", exitCode: 0 };
    if (full.includes("branch --show-current")) return { stdout: "main\n", stderr: "", exitCode: 0 };
    if (full.includes("rev-parse --abbrev-ref @{upstream}")) return { stdout: "origin/main\n", stderr: "", exitCode: 0 };
    if (full.includes("rev-list --left-right --count HEAD...@{upstream}")) return { stdout: "0\t0\n", stderr: "", exitCode: 0 };
    if (full.includes("for-each-ref")) return { stdout: "main origin/main\njev-config \n", stderr: "", exitCode: 0 };
    if (full.includes("rev-list --left-right --count jev-config...main")) return { stdout: "0\t3\n", stderr: "", exitCode: 0 };
    if (full.includes("branch -r --no-merged origin/main")) return { stdout: "", stderr: "", exitCode: 0 };
    if (full.includes("branch -r --format=%(refname:short)")) return { stdout: "origin/main\n", stderr: "", exitCode: 0 };
    if (full.includes("status --short")) return { stdout: "", stderr: "", exitCode: 0 };
    return { stdout: "", stderr: "", exitCode: 0 };
  };

  const diag = await runGitSyncInspection({ execFn: mockExec });
  assert.equal(diag.otherLocalBranches.length, 1);
  const jev = diag.otherLocalBranches[0];
  assert.equal(jev.branch, "jev-config");
  assert.equal(jev.syncStatus, "UNTRACKED");
  assert.equal(jev.baseBranch, "main");
  assert.equal(jev.aheadBase, 0);
  assert.equal(jev.behindBase, 3);

  assert.match(diag.formattedReport, /`jev-config`: `UNTRACKED` \(behind 3 vs main\)/);
});


