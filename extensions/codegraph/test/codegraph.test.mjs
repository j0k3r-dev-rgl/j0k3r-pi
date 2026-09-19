import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const loaderCode = `
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "@earendil-works/pi-tui") {
    return {
      shortCircuit: true,
      url: "data:text/javascript," + encodeURIComponent(\`
        export class Text {
          constructor(text = "", x = 0, y = 0) { this.text = text; }
          setText(t) { this.text = t; }
          render() { return [this.text]; }
        }
        export function visibleWidth(str) { return str.replace(/\\\\x1b\\\\[[0-9;]*m/g, "").length; }
        export function truncateToWidth(str, width, ellipsis = "") {
          const vis = str.replace(/\\\\x1b\\\\[[0-9;]*m/g, "");
          if (vis.length <= width) return str;
          return vis.slice(0, width) + ellipsis;
        }
        export function wrapTextWithAnsi(str, width) {
          const words = str.split(" ");
          const lines = [];
          let cur = "";
          for (const w of words) {
            if ((cur + " " + w).trim().length > width) {
              if (cur) lines.push(cur);
              cur = w;
            } else {
              cur = cur ? cur + " " + w : w;
            }
          }
          if (cur) lines.push(cur);
          return lines.length ? lines : [str];
        }
      \`)
    };
  }
  if (specifier === "@earendil-works/pi-coding-agent") {
    return {
      shortCircuit: true,
      url: "data:text/javascript," + encodeURIComponent(\`
        export const DEFAULT_MAX_BYTES = 50000;
        export const DEFAULT_MAX_LINES = 2000;
        export function formatSize(bytes) { return bytes + "B"; }
        export function truncateHead(content, opts) {
          return { content, truncated: false, outputLines: 1, totalLines: 1, outputBytes: 1, totalBytes: 1 };
        }
      \`)
    };
  }
  if (specifier === "@earendil-works/pi-ai") {
    return {
      shortCircuit: true,
      url: "data:text/javascript," + encodeURIComponent(\`
        export function StringEnum(values, opts) { return { values, ...opts }; }
      \`)
    };
  }
  if (specifier === "typebox") {
    return {
      shortCircuit: true,
      url: "data:text/javascript," + encodeURIComponent(\`
        export const Type = {
          Object: (props) => ({ type: "object", properties: props }),
          String: (opts) => ({ type: "string", ...opts }),
          Optional: (item) => ({ ...item, optional: true }),
          Integer: (opts) => ({ type: "integer", ...opts }),
        };
      \`)
    };
  }
  if (context.parentURL && (specifier.startsWith("./") || specifier.startsWith("../"))) {
    const parentPath = fileURLToPath(context.parentURL);
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

test("MINI-002: isExtensionEnabled and codegraphExtension opt-in guard", async () => {
  const { default: codegraphExtension, isExtensionEnabled } = await import("../index.ts");
  const tmp = mkdtempSync(join(tmpdir(), "codegraph-optin-test-"));
  try {
    // 1. Missing .pi/extensions.json
    assert.equal(isExtensionEnabled("codegraph", tmp), false);
    const registered1 = [];
    const mockPi1 = { registerTool: (tool) => registered1.push(tool) };
    codegraphExtension(mockPi1, { cwd: tmp });
    assert.equal(registered1.length, 0, "No tools registered when config absent");

    // 2. Disabled or omitted
    const piDir = join(tmp, ".pi");
    mkdirSync(piDir, { recursive: true });
    const configPath = join(piDir, "extensions.json");
    writeFileSync(configPath, JSON.stringify({ codegraph: false }), "utf8");
    assert.equal(isExtensionEnabled("codegraph", tmp), false);
    const registered2 = [];
    const mockPi2 = { registerTool: (tool) => registered2.push(tool) };
    codegraphExtension(mockPi2, { cwd: tmp });
    assert.equal(registered2.length, 0, "No tools registered when codegraph: false");

    // 3. Corrupt/unparseable JSON
    writeFileSync(configPath, "{ not-valid-json", "utf8");
    assert.equal(isExtensionEnabled("codegraph", tmp), false);
    const registered3 = [];
    const mockPi3 = { registerTool: (tool) => registered3.push(tool) };
    assert.doesNotThrow(() => codegraphExtension(mockPi3, { cwd: tmp }));
    assert.equal(registered3.length, 0, "No tools registered on malformed json");

    // 4. Enabled: {"codegraph": true}
    writeFileSync(configPath, JSON.stringify({ codegraph: true }), "utf8");
    assert.equal(isExtensionEnabled("codegraph", tmp), true);
    const registered4 = [];
    const mockPi4 = { registerTool: (tool) => registered4.push(tool) };
    codegraphExtension(mockPi4, { cwd: tmp });
    assert.equal(registered4.length, 4, "All four tools registered when codegraph: true");
    const names = registered4.map((t) => t.name).sort();
    assert.deepEqual(names, ["codegraph_explore", "codegraph_manage", "codegraph_status", "codegraph_sync"]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("MINI-003: Local theme primitives and ANSI tokens in theme.ts", async () => {
  const theme = await import("../src/render/theme.ts");
  assert.equal(theme.PINK, "\x1b[1;38;2;255;45;247m");
  assert.equal(theme.RED, "\x1b[1;38;2;255;77;109m");

  const top = theme.cardTopBorder("codegraph_explore", "query", 40, theme.PINK, theme.PINK);
  assert.ok(top.includes("╭"));
  assert.ok(top.includes("╮"));
  assert.ok(top.includes("codegraph_explore [query]"));
  assert.ok(top.includes(theme.PINK));

  const bottom = theme.cardBottomBorder(40, theme.PINK);
  assert.ok(bottom.includes("╰"));
  assert.ok(bottom.includes("╯"));
  assert.ok(bottom.includes(theme.PINK));

  const lines = theme.frameContent(["test content line"], 40, theme.PINK);
  assert.equal(lines.length, 1);
  assert.ok(lines[0].includes("│"));
  assert.ok(lines[0].includes("test content line"));

  const hint = theme.toolHint("to expand");
  assert.ok(hint.includes("Ctrl+O"));
  assert.ok(hint.includes("to expand"));
});

test("MINI-004: All tools register renderShell: 'self'", async () => {
  const registered = [];
  const mockPi = { registerTool: (tool) => registered.push(tool) };
  const { registerCodeGraphTools } = await import("../src/tools/index.ts");
  registerCodeGraphTools(mockPi);

  assert.equal(registered.length, 4);
  const names = registered.map((t) => t.name).sort();
  assert.deepEqual(names, ["codegraph_explore", "codegraph_manage", "codegraph_status", "codegraph_sync"]);
  for (const tool of registered) {
    assert.equal(tool.renderShell, "self", `${tool.name} must specify renderShell: "self"`);
  }
});

test("MINI-004: Tool call and result rendering with local pink card components", async () => {
  const {
    renderExploreCall,
    renderExploreResult,
    renderStatusCall,
    renderStatusResult,
    renderManageCall,
    renderManageResult,
  } = await import("../src/render/index.ts");
  const { PINK, RED } = await import("../src/render/theme.ts");

  // 1. Explore Call
  const ctxExplore = { state: {} };
  const callComp = renderExploreCall({ query: "myFunc", path: "src" }, {}, ctxExplore);
  assert.ok(callComp);
  const callRender = callComp.render(60);
  assert.ok(callRender[0].includes("codegraph_explore [myFunc in src]"));
  assert.ok(callRender[0].includes(PINK));
  assert.ok(callRender.some((l) => l.includes("Exploring CodeGraph index…")));

  // 2. Explore Result (collapsed)
  const resultCollapsed = renderExploreResult(
    { content: [{ type: "text", text: "Found 2 files" }], details: { path: "src", query: "myFunc" } },
    { expanded: false, isPartial: false },
    {},
    ctxExplore,
  );
  const collapsedRender = resultCollapsed.render(60);
  assert.ok(collapsedRender.some((l) => l.includes("✓ CodeGraph exploration complete")));
  assert.ok(collapsedRender.some((l) => l.includes("Ctrl+O") && l.includes("to expand")));
  assert.ok(collapsedRender.every((l) => !l.includes(RED)));

  // 3. Explore Result (error)
  const ctxErr = { state: {}, isError: true };
  const resultErr = renderExploreResult(
    { content: [{ type: "text", text: "Index error" }] },
    { expanded: false, isPartial: false },
    {},
    ctxErr,
  );
  const errRender = resultErr.render(60);
  assert.ok(errRender.some((l) => l.includes("Index error")));
  assert.ok(errRender[0].includes(RED));

  // 4. Explore Result (expanded)
  const ctxExpanded = { state: {} };
  const resultExpanded = renderExploreResult(
    { content: [{ type: "text", text: "# Architecture Details\nSymbol: myFunc" }], details: { path: "src", query: "myFunc" } },
    { expanded: true, isPartial: false },
    {},
    ctxExpanded,
  );
  const expRender = resultExpanded.render(60);
  assert.ok(expRender.some((l) => l.includes("Architecture Details")));
  assert.ok(expRender.some((l) => l.includes("Ctrl+O") && l.includes("to collapse")));

  // 5. Status Call & Result
  const ctxStatus = { state: {} };
  const statusCallComp = renderStatusCall({ path: "my-project" }, {}, ctxStatus);
  const statusCallRender = statusCallComp.render(60);
  assert.ok(statusCallRender[0].includes("codegraph_status [my-project]"));

  const statusResultComp = renderStatusResult(
    { content: [{ type: "text", text: "{}" }], details: { path: "my-project", status: { initialized: true } } },
    { expanded: false, isPartial: false },
    {},
    ctxStatus,
  );
  const statusResultRender = statusResultComp.render(60);
  assert.ok(statusResultRender.some((l) => l.includes("CodeGraph: indexed")));

  // 6. Manage Call & Result
  const ctxManage = { state: {} };
  const manageCallComp = renderManageCall({ action: "sync", path: "my-project" }, {}, ctxManage);
  const manageCallRender = manageCallComp.render(60);
  assert.ok(manageCallRender[0].includes("codegraph_manage [sync my-project]"));

  const manageResultComp = renderManageResult(
    { content: [{ type: "text", text: "Synced" }], details: { action: "sync", path: "my-project", executed: true } },
    { expanded: false, isPartial: false },
    {},
    ctxManage,
  );
  const manageResultRender = manageResultComp.render(60);
  assert.ok(manageResultRender.some((l) => l.includes("✓ CodeGraph sync complete")));
});

test("MINI-001: codegraph_sync tool execution states, concurrency, and debounce", async () => {
  const { registerSyncTool, _resetSyncState } = await import("../src/tools/sync.ts");

  let tool;
  const mockPi = {
    execCalls: [],
    execHandlers: new Map(),
    registerTool: (t) => { tool = t; },
    exec: async (cmd, args, opts) => {
      mockPi.execCalls.push({ cmd, args, opts });
      const handler = mockPi.execHandlers.get(args[0]) || (async () => ({ code: 0, stdout: "Synced 4 files", stderr: "" }));
      return await handler(cmd, args, opts);
    },
  };

  registerSyncTool(mockPi);
  assert.ok(tool);
  assert.equal(tool.name, "codegraph_sync");
  assert.equal(tool.executionMode, "sequential");
  assert.equal(tool.renderShell, "self");

  // 1. Successful execution in non-TUI context (ctx.mode !== "tui")
  _resetSyncState();
  mockPi.execCalls = [];
  mockPi.execHandlers.set("sync", async () => ({ code: 0, stdout: "Sync completed in 12ms", stderr: "" }));
  const resSuccess = await tool.execute("call1", { path: "/project/a" }, undefined, undefined, { cwd: "/project/a", mode: "non-tui" });
  assert.equal(resSuccess.details.executed, true);
  assert.equal(resSuccess.details.path, "/project/a");
  assert.ok(resSuccess.content[0].text.includes("Sync completed"));
  assert.equal(mockPi.execCalls.length, 1);

  // 2. Debounce within 5 seconds returns cached result
  const resDebounced = await tool.execute("call2", { path: "/project/a" }, undefined, undefined, { cwd: "/project/a", mode: "non-tui" });
  assert.equal(resDebounced.details.cached, true);
  assert.equal(resDebounced.details.executed, true);
  assert.equal(mockPi.execCalls.length, 1, "Exec CLI not called again due to debounce");

  // 3. Not indexed repository handling
  _resetSyncState();
  mockPi.execCalls = [];
  mockPi.execHandlers.set("sync", async () => ({ code: 1, stdout: "CodeGraph isn't available here", stderr: "" }));
  const resNotIndexed = await tool.execute("call3", { path: "/project/b" }, undefined, undefined, { cwd: "/project/b", mode: "non-tui" });
  assert.equal(resNotIndexed.details.executed, false);
  assert.equal(resNotIndexed.details.notIndexed, true);
  assert.ok(resNotIndexed.content[0].text.includes("isn't available here"));

  // 4. Lock held / contention handling
  _resetSyncState();
  mockPi.execCalls = [];
  mockPi.execHandlers.set("sync", async () => ({ code: 1, stdout: "", stderr: "Error: .codegraph/lock is held by process 1234" }));
  const resLockHeld = await tool.execute("call4", { path: "/project/c" }, undefined, undefined, { cwd: "/project/c", mode: "non-tui" });
  assert.equal(resLockHeld.details.executed, false);
  assert.equal(resLockHeld.details.lockHeld, true);
  assert.ok(resLockHeld.content[0].text.includes(".codegraph/lock"));

  // 5. In-flight promise coalescing (concurrent calls share execution)
  _resetSyncState();
  mockPi.execCalls = [];
  let finishSync;
  mockPi.execHandlers.set("sync", () => new Promise((resolve) => {
    finishSync = () => resolve({ code: 0, stdout: "Synced concurrent", stderr: "" });
  }));

  const promise1 = tool.execute("call5a", { path: "/project/d" }, undefined, undefined, { cwd: "/project/d", mode: "non-tui" });
  const promise2 = tool.execute("call5b", { path: "/project/d" }, undefined, undefined, { cwd: "/project/d", mode: "non-tui" });
  finishSync();
  const [res1, res2] = await Promise.all([promise1, promise2]);
  assert.equal(mockPi.execCalls.length, 1, "Concurrent calls should execute CLI exactly once");
  assert.equal(res1.details.executed, true);
  assert.equal(res2.details.executed, true);

  // 6. AbortSignal cancellation
  _resetSyncState();
  const controller = new AbortController();
  controller.abort();
  const resCancelled = await tool.execute("call6", { path: "/project/e" }, controller.signal, undefined, { cwd: "/project/e", mode: "non-tui" });
  assert.equal(resCancelled.details.executed, false);
  assert.ok(resCancelled.content[0].text.includes("cancelled"));
});

test("MINI-002: codegraph_sync pink card call and result rendering", async () => {
  const { renderSyncCall, renderSyncResult } = await import("../src/render/index.ts");
  const { PINK, RED } = await import("../src/render/theme.ts");

  // 1. Call rendering
  const ctxSync = { state: {} };
  const callComp = renderSyncCall({ path: "/project/test" }, {}, ctxSync);
  const callRender = callComp.render(60);
  assert.ok(callRender[0].includes("codegraph_sync [/project/test]"));
  assert.ok(callRender[0].includes(PINK));
  assert.ok(callRender.some((l) => l.includes("Syncing CodeGraph index…")));

  // 2. Result rendering - Collapsed success
  const resSuccess = renderSyncResult(
    { content: [{ type: "text", text: "Synced 5 files" }], details: { path: "/project/test", executed: true } },
    { expanded: false, isPartial: false },
    {},
    ctxSync,
  );
  const collapsedRender = resSuccess.render(60);
  assert.ok(collapsedRender.some((l) => l.includes("✓ CodeGraph sync complete")));
  assert.ok(collapsedRender.some((l) => l.includes("Ctrl+O") && l.includes("to expand")));
  assert.ok(collapsedRender.every((l) => !l.includes(RED)));

  // 3. Result rendering - Collapsed cached
  const resCached = renderSyncResult(
    { content: [{ type: "text", text: "Synced 5 files" }], details: { path: "/project/test", executed: true, cached: true } },
    { expanded: false, isPartial: false },
    {},
    ctxSync,
  );
  const cachedRender = resCached.render(60);
  assert.ok(cachedRender.some((l) => l.includes("✓ CodeGraph sync complete (cached)")));

  // 4. Result rendering - Expanded success
  const resExpanded = renderSyncResult(
    { content: [{ type: "text", text: "Synced 5 files" }], details: { path: "/project/test", executed: true, durationMs: 42 } },
    { expanded: true, isPartial: false },
    {},
    ctxSync,
  );
  const expRender = resExpanded.render(60);
  assert.ok(expRender.some((l) => l.includes("Synced 5 files")));
  assert.ok(expRender.some((l) => l.includes("Duration: 42ms")));
  assert.ok(expRender.some((l) => l.includes("Ctrl+O") && l.includes("to collapse")));

  // 5. Result rendering - Not indexed
  const resNotIndexed = renderSyncResult(
    { content: [{ type: "text", text: "Not indexed" }], details: { path: "/project/test", executed: false, notIndexed: true } },
    { expanded: false, isPartial: false },
    {},
    ctxSync,
  );
  const notIndexedRender = resNotIndexed.render(60);
  assert.ok(notIndexedRender.some((l) => l.includes("⚠ CodeGraph: not indexed")));

  // 6. Result rendering - Lock held
  const resLockHeld = renderSyncResult(
    { content: [{ type: "text", text: "Lock held" }], details: { path: "/project/test", executed: false, lockHeld: true } },
    { expanded: false, isPartial: false },
    {},
    ctxSync,
  );
  const lockHeldRender = resLockHeld.render(60);
  assert.ok(lockHeldRender.some((l) => l.includes("⚠ CodeGraph: index locked")));

  // 7. Result rendering - Error (red border)
  const ctxErr = { state: {}, isError: true };
  const resErr = renderSyncResult(
    { content: [{ type: "text", text: "Sync failed unexpectedly" }] },
    { expanded: false, isPartial: false },
    {},
    ctxErr,
  );
  const errRender = resErr.render(60);
  assert.ok(errRender.some((l) => l.includes("Sync failed unexpectedly")));
  assert.ok(errRender[0].includes(RED));
});

test("MINI-003: Orchestrator and tool prompt guidelines alignment", async () => {
  const registered = [];
  const mockPi = { registerTool: (tool) => registered.push(tool) };
  const { registerCodeGraphTools } = await import("../src/tools/index.ts");
  registerCodeGraphTools(mockPi);

  const syncTool = registered.find((t) => t.name === "codegraph_sync");
  assert.ok(syncTool);
  assert.ok(Array.isArray(syncTool.promptGuidelines));
  assert.equal(syncTool.promptGuidelines.length, 3);
  assert.ok(syncTool.promptGuidelines.some((g) => g.includes("before starting code exploration or research workflows")));
  assert.ok(syncTool.promptGuidelines.some((g) => g.includes("after modifying project files")));
  assert.ok(syncTool.promptGuidelines.some((g) => g.includes("safe, non-destructive, and requires no TUI confirmation")));

  const manageTool = registered.find((t) => t.name === "codegraph_manage");
  assert.ok(manageTool);
  assert.ok(Array.isArray(manageTool.promptGuidelines));
  assert.ok(manageTool.promptGuidelines.some((g) => g.includes("codegraph_sync")));
  assert.ok(manageTool.promptGuidelines.some((g) => g.includes("Reserve codegraph_manage strictly for administrative lifecycle operations")));
});
