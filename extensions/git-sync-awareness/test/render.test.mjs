import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";
import { fileURLToPath } from "node:url";

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

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("MINI-001: Styling Primitives and ANSI Frame Utilities", async () => {
  const render = await import("../src/render.ts");

  // Verify ANSI constants
  assert.equal(render.CYAN, "\x1b[1;38;2;0;229;255m");
  assert.equal(render.LIME, "\x1b[1;38;2;102;255;102m");
  assert.equal(render.PINK, "\x1b[1;38;2;255;45;247m");
  assert.equal(render.RED, "\x1b[1;38;2;255;77;109m");
  assert.equal(render.AMBER, "\x1b[1;38;2;255;184;77m");
  assert.equal(render.VIOLET, "\x1b[1;38;2;153;92;255m");
  assert.equal(render.DIM, "\x1b[2m");
  assert.equal(render.BOLD, "\x1b[1m");
  assert.equal(render.RESET, "\x1b[0m");

  // stripAnsi
  assert.equal(render.stripAnsi(`${render.CYAN}hello${render.RESET}`), "hello");
  assert.equal(render.stripAnsi("plain text"), "plain text");

  // visibleWidth
  assert.equal(render.visibleWidth("hello"), 5);
  assert.equal(render.visibleWidth(`${render.RED}error${render.RESET}`), 5);
  assert.equal(render.visibleWidth(""), 0);

  // fit
  assert.equal(render.fit("hello", 10), "hello");
  assert.equal(render.fit("hello world", 5), "hello");
  assert.equal(render.visibleWidth(render.fit(`${render.CYAN}long text here${render.RESET}`, 6)), 6);

  // pad
  assert.equal(render.pad("hello", 10), "hello     ");
  assert.equal(render.visibleWidth(render.pad(`${render.LIME}ok${render.RESET}`, 6)), 6);

  // Frame helpers
  const top = render.cardTopBorder("git-sync", "main", 40, render.CYAN);
  assert.match(top, /^.*╭.*git-sync.*main.*╮.*$/);
  assert.equal(render.visibleWidth(top), 42); // 40 inner + 2 border chars

  const line = render.boxLine("test line", 40, render.CYAN);
  assert.match(line, /^.*│.*test line.*│.*$/);
  assert.equal(render.visibleWidth(line), 42);

  const bottom = render.cardBottomBorder(40, render.CYAN);
  assert.match(bottom, /^.*╰.*╯.*$/);
  assert.equal(render.visibleWidth(bottom), 42);

  // Status badges
  assert.match(render.formatSyncStatusBadge("UP-TO-DATE"), /UP-TO-DATE/);
  assert.match(render.formatSyncStatusBadge("BEHIND", 0, 3), /BEHIND.*3/);
  assert.match(render.formatSyncStatusBadge("AHEAD", 2, 0), /AHEAD.*2/);
  assert.match(render.formatSyncStatusBadge("DIVERGED", 2, 3), /DIVERGED/);
  assert.match(render.formatSyncStatusBadge("UNTRACKED"), /UNTRACKED/);

  // Working tree badge
  assert.match(render.formatWorkingTreeBadge({ isClean: true }), /clean/);
  assert.match(render.formatWorkingTreeBadge({ isClean: false, modifiedCount: 2, untrackedCount: 1, stagedCount: 0 }), /dirty/);

  // Zero external imports check
  const renderSource = fs.readFileSync(path.join(__dirname, "../src/render.ts"), "utf8");
  assert.doesNotMatch(renderSource, /from ['"]j0k3r-theme['"]/);
  assert.doesNotMatch(renderSource, /from ['"]@earendil-works\/pi-tui['"]/);
});

test("MINI-002: Message Renderer - Collapsed Mode", async () => {
  const { createGitSyncMessageRenderer } = await import("../src/render.ts");

  const diagnostic = {
    timestamp: Date.now(),
    fetchSuccess: true,
    currentBranch: {
      branch: "main",
      upstream: "origin/main",
      syncStatus: "UP-TO-DATE",
      ahead: 0,
      behind: 0,
      incomingCommits: [],
    },
    otherLocalBranches: [],
    remoteBranches: ["origin/main"],
    remoteOnlyBranches: [],
    activeCollaboratorBranches: [],
    workingTree: {
      isClean: true,
      modifiedCount: 0,
      untrackedCount: 0,
      stagedCount: 0,
      summaryLines: [],
    },
    isBranchPolicyCompliant: true,
    requiresDecision: false,
    formattedReport: "UP-TO-DATE",
  };

  const renderer = createGitSyncMessageRenderer(
    { customType: "git-sync-awareness", content: diagnostic.formattedReport, details: diagnostic },
    { expanded: false }
  );

  const lines = renderer.render(80);
  assert.equal(lines.length, 1, "Collapsed mode must render exactly 1 line");

  const line = lines[0];
  assert.match(line, /main/);
  assert.match(line, /UP-TO-DATE/);
  assert.match(line, /clean/);
  assert.match(line, /ctrl\+o expand/);

  // Narrow width truncation
  const narrowLines = renderer.render(35);
  assert.equal(narrowLines.length, 1);
  assert.ok(narrowLines[0].length > 0);
  assert.match(narrowLines[0], /ctrl\+o/);
});

test("MINI-002: Message Renderer - Expanded Mode (Up-to-Date / Clean)", async () => {
  const { createGitSyncMessageRenderer } = await import("../src/render.ts");

  const diagnostic = {
    timestamp: Date.now(),
    fetchSuccess: true,
    currentBranch: {
      branch: "main",
      upstream: "origin/main",
      syncStatus: "UP-TO-DATE",
      ahead: 0,
      behind: 0,
      incomingCommits: [],
    },
    otherLocalBranches: [],
    remoteBranches: ["origin/main"],
    remoteOnlyBranches: [],
    activeCollaboratorBranches: [],
    workingTree: {
      isClean: true,
      modifiedCount: 0,
      untrackedCount: 0,
      stagedCount: 0,
      summaryLines: [],
    },
    isBranchPolicyCompliant: true,
    requiresDecision: false,
    formattedReport: "All synced",
  };

  const renderer = createGitSyncMessageRenderer(
    { customType: "git-sync-awareness", content: diagnostic.formattedReport, details: diagnostic },
    { expanded: true }
  );

  const lines = renderer.render(80);
  assert.ok(lines.length > 5, "Expanded mode must render a multi-line card");

  const fullText = lines.join("\n");
  assert.match(fullText, /git-sync/);
  assert.match(fullText, /main/);
  assert.match(fullText, /UP-TO-DATE/);
  assert.match(fullText, /Safe to proceed/);
  assert.match(fullText, /ctrl\+o collapse/);
});

test("MINI-002: Message Renderer - Expanded Mode (Behind, Dirty, Worktrees, Commits, Decision Gate)", async () => {
  const { createGitSyncMessageRenderer } = await import("../src/render.ts");

  const diagnostic = {
    timestamp: Date.now(),
    fetchSuccess: true,
    currentBranch: {
      branch: "feature/auth",
      upstream: "origin/feature/auth",
      syncStatus: "BEHIND",
      ahead: 0,
      behind: 2,
      incomingCommits: [
        "abc1234 Add OAuth provider support",
        "def5678 Fix token refresh edge case",
      ],
    },
    otherLocalBranches: [
      { branch: "main", upstream: "origin/main", ahead: 0, behind: 0, syncStatus: "UP-TO-DATE" },
    ],
    remoteBranches: ["origin/main", "origin/feature/auth", "origin/collab/alice-widget"],
    remoteOnlyBranches: ["origin/collab/alice-widget"],
    activeCollaboratorBranches: ["origin/collab/alice-widget"],
    workingTree: {
      isClean: false,
      modifiedCount: 3,
      untrackedCount: 1,
      stagedCount: 0,
      summaryLines: [" M src/auth.ts", " M src/index.ts", " M package.json", "?? notes.txt"],
    },
    worktree: {
      isMainWorktree: false,
      currentWorktreePath: "/repo/worktrees/auth",
      mainWorktreePath: "/repo/main",
      worktrees: [
        { path: "/repo/main", head: "1111111", branch: "main", isCurrent: false, isMain: true },
        { path: "/repo/worktrees/auth", head: "2222222", branch: "feature/auth", isCurrent: true, isMain: false },
      ],
    },
    isBranchPolicyCompliant: true,
    requiresDecision: true,
    formattedReport: "Behind remote",
  };

  const renderer = createGitSyncMessageRenderer(
    { customType: "git-sync-awareness", content: diagnostic.formattedReport, details: diagnostic },
    { expanded: true }
  );

  const lines = renderer.render(80);
  const fullText = lines.join("\n");

  assert.match(fullText, /feature\/auth/);
  assert.match(fullText, /BEHIND \[2\]/);
  assert.match(fullText, /Add OAuth provider support/);
  assert.match(fullText, /Fix token refresh edge case/);
  assert.match(fullText, /dirty/);
  assert.match(fullText, /3 modified/);
  assert.match(fullText, /worktree/i);
  assert.match(fullText, /\(current\)/);
  assert.match(fullText, /\(base\)/);
  assert.match(fullText, /collab\/alice-widget/);
  assert.match(fullText, /MANDATORY DECISION GATE/);
});

test("MINI-002: Message Renderer - Fallback Mode without structured details", async () => {
  const { createGitSyncMessageRenderer } = await import("../src/render.ts");

  // Error message payload without details
  const rendererErrorCollapsed = createGitSyncMessageRenderer(
    {
      customType: "git-sync-awareness",
      content: "⚠️ Git sync awareness failed to inspect repository: network down",
      display: true,
    },
    { expanded: false }
  );

  const collapsedLines = rendererErrorCollapsed.render(80);
  assert.equal(collapsedLines.length, 1);
  assert.match(collapsedLines[0], /failed to inspect repository/);

  const rendererErrorExpanded = createGitSyncMessageRenderer(
    {
      customType: "git-sync-awareness",
      content: "⚠️ Git sync awareness failed to inspect repository: network down",
      display: true,
    },
    { expanded: true }
  );

  const expandedLines = rendererErrorExpanded.render(80);
  assert.ok(expandedLines.length >= 3);
  assert.match(expandedLines.join("\n"), /failed to inspect repository/);
});

test("MINI-003: Extension Registration and Details Attachment", async () => {
  const { default: gitSyncAwarenessExtension } = await import("../index.ts");

  const listeners = {};
  let registeredRenderer = null;

  const mockPi = {
    on: (event, handler) => {
      listeners[event] = handler;
    },
    registerMessageRenderer: (type, renderer) => {
      registeredRenderer = { type, renderer };
    },
  };

  gitSyncAwarenessExtension(mockPi);

  // Message renderer registered
  assert.ok(registeredRenderer, "registerMessageRenderer was called");
  assert.equal(registeredRenderer.type, "git-sync-awareness");
  assert.equal(typeof registeredRenderer.renderer, "function");

  // Diagnostic returned with details attached
  const fakeDiagnostic = {
    timestamp: Date.now(),
    fetchSuccess: true,
    currentBranch: { branch: "main", syncStatus: "UP-TO-DATE", ahead: 0, behind: 0, incomingCommits: [] },
    otherLocalBranches: [],
    remoteBranches: [],
    remoteOnlyBranches: [],
    activeCollaboratorBranches: [],
    workingTree: { isClean: true, modifiedCount: 0, untrackedCount: 0, stagedCount: 0, summaryLines: [] },
    isBranchPolicyCompliant: true,
    requiresDecision: false,
    formattedReport: "ALL_GOOD",
  };

  const result = await listeners["before_agent_start"]({}, { inspectorOverride: async () => fakeDiagnostic });
  assert.ok(result);
  assert.equal(result.message.customType, "git-sync-awareness");
  assert.equal(result.message.content, "ALL_GOOD");
  assert.equal(result.message.display, true);
  assert.deepEqual(result.message.details, fakeDiagnostic, "details property must be attached");

  // Error case without crashing renderer
  const throwingInspector = async () => {
    throw new Error("Disk read failure");
  };

  // Reset session
  await listeners["session_start"]();
  const errResult = await listeners["before_agent_start"]({}, { inspectorOverride: throwingInspector });
  assert.ok(errResult);
  assert.equal(errResult.message.customType, "git-sync-awareness");
  assert.match(errResult.message.content, /Disk read failure/);

  // Test rendering the message produced by the extension
  const rendererInstance = registeredRenderer.renderer(result.message, { expanded: true });
  assert.equal(typeof rendererInstance.render, "function");
  assert.equal(typeof rendererInstance.invalidate, "function");
  const renderedOutput = rendererInstance.render(80);
  assert.ok(Array.isArray(renderedOutput));
  assert.ok(renderedOutput.length > 0);
});
