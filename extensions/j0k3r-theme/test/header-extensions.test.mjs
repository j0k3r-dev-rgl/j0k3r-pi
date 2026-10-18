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
        export function matchesKey(data, key) { return data === key; }
        export function visibleWidth(str) { return str.replace(/\\\\x1b\\\\[[0-9;]*m/g, "").length; }
        export function truncateToWidth(str) { return str; }
        export function wrapTextWithAnsi(str) { return [str]; }
      \`)
    };
  }
  if (specifier === "@earendil-works/pi-coding-agent") {
    return {
      shortCircuit: true,
      url: "data:text/javascript," + encodeURIComponent(\`
        export function keyHint(k, d) { return d; }
        export function getAgentDir() { return "/home/j0k3r/.pi/agent"; }
        export class CustomEditor { constructor() {} }
        export function createBashToolDefinition() { return { execute() {} }; }
        export function createEditToolDefinition() { return { execute() {} }; }
        export function createReadToolDefinition() { return { execute() {} }; }
        export function createWriteToolDefinition() { return { execute() {} }; }
        export function truncateToVisualLines() { return { lines: [], truncated: false }; }
        export function formatSize(value) { return String(value); }
        export function getLanguageFromPath() { return "text"; }
        export function highlightCode(value) { return value; }
        export function renderDiff(value) { return value; }
        export const SettingsManager = { create: () => ({ isProjectTrusted: () => true }) };
        export class DefaultPackageManager {
          constructor(opts) { this.cwd = opts.cwd; }
          async resolve() {
            return {
              extensions: [
                { path: "/home/j0k3r/.pi/agent/extensions/codegraph/index.ts", enabled: true },
                { path: "/home/j0k3r/.pi/agent/extensions/api-tools/index.ts", enabled: true },
                { path: "/home/j0k3r/.pi/agent/extensions/tools-manager/index.ts", enabled: true },
                { path: "/home/j0k3r/projects/pi-subagents-j0k3r/index.ts", enabled: true, metadata: { origin: "package", source: "/home/j0k3r/projects/pi-subagents-j0k3r" } },
              ],
              skills: []
            };
          }
        }
      \`)
    };
  }
  if (specifier.endsWith(".js") && specifier.startsWith(".")) {
    try {
      const resolvedUrl = new URL(specifier, context.parentURL);
      const filePath = fileURLToPath(resolvedUrl);
      if (!existsSync(filePath)) {
        const tsPath = filePath.replace(/\\.js$/, ".ts");
        if (existsSync(tsPath)) {
          return {
            shortCircuit: true,
            url: pathToFileURL(tsPath).href,
          };
        }
      }
    } catch {}
  }
  return nextResolve(specifier, context);
}
`;

register("data:text/javascript," + encodeURIComponent(loaderCode));

const {
  isExtensionActive,
  loadExtensionsConfig,
  getExtensionDisplayName,
  detectResourcesSync,
  resolveViaPackageManager,
} = await import("../index.ts");

const { selectQuotaAccount, selectModelPools, fetchModelQuota, formatQuota, QUOTA_REFRESH_MS } = await import("../src/quota.ts");
const { J0k3rThemeFooter } = await import("../src/J0k3rThemeFooter.ts");

test("quota account is chosen only for an exact unique prefixed model", () => {
  const accounts = [
    { id: "one", provider: "antigravity", pools: [{ label: "5h", availablePercentage: 72 }] },
    { id: "two", provider: "codex", pools: [{ label: "weekly", availablePercentage: 40 }] },
  ];
  const models = new Map([["one", ["main/gemini-3"]], ["two", ["second/gpt-5"]]]);
  assert.equal(selectQuotaAccount("cliproxyapi", "main/gemini-3", accounts, models)?.id, "one");
  assert.equal(selectQuotaAccount("cliproxyapi", "main/gpt-5", accounts, models), undefined);
  models.set("two", ["main/gemini-3"]);
  assert.equal(selectQuotaAccount("cliproxyapi", "main/gemini-3", accounts, models), undefined);
  assert.equal(selectQuotaAccount("opencode-go", "glm-5", [{ id: "opencode-go", pools: [] }], models)?.id, "opencode-go");
});

test("fetchModelQuota follows the active CPA model to its unique auth quota", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.CLIPROXYAPI_MANAGEMENT_KEY;
  process.env.CLIPROXYAPI_MANAGEMENT_KEY = "test-key";
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/auth-files")) return Response.json({ files: [
      { id: "auth-a", name: "a", auth_index: "index-a", provider: "antigravity", email: "a@example.org" },
      { id: "b", name: "b", auth_index: "index-b", provider: "antigravity", email: "b@example.org" },
    ] });
    if (url.includes("/auth-files/models")) return Response.json({ models: [
      { id: url.includes("name=a") ? "main/gemini-3" : "other/gemini-3" },
    ] });
    return Response.json({ status_code: 200, body: JSON.stringify({ groups: [
      { displayName: "Gemini", buckets: [{ remainingFraction: 0.72, window: "5h" }] },
    ] }) });
  };
  try {
    assert.equal(await fetchModelQuota("cliproxyapi", "main/gemini-3"), "quota 5 hs ━━━━━━── 72%");
    assert.equal(await fetchModelQuota("cliproxyapi", "missing/gemini-3"), undefined);
    assert.equal(await fetchModelQuota("opencode-zen", "model"), undefined);
    assert.ok(calls.some((url) => url.includes("/auth-files/models?name=a")));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.CLIPROXYAPI_MANAGEMENT_KEY;
    else process.env.CLIPROXYAPI_MANAGEMENT_KEY = originalKey;
  }
});

test("quota refresh interval is 30 seconds and pools include thin eight-cell availability bars", () => {
  assert.equal(QUOTA_REFRESH_MS, 30_000);
  assert.equal(formatQuota([
    { windowLabel: "5h", label: "rolling", availablePercentage: 72 },
    { windowLabel: "7d", label: "weekly", availablePercentage: 25 },
  ]), "quota 5h ━━━━━━── 72% · 7d ━━────── 25%");
  assert.equal(formatQuota([{ windowLabel: "5h", label: "rolling", availablePercentage: 0 }]), "quota 5h ──────── 0%");
});

test("quota shows a compact countdown for each valid future reset", () => {
  const now = Date.parse("2026-09-23T12:00:00Z");
  const pool = (resetAt) => ({ windowLabel: "5h", label: "rolling", availablePercentage: 72, resetAt });
  assert.equal(formatQuota([pool("2026-09-23T14:15:00Z")], now), "quota 5h ━━━━━━── 72% ↻ 2h 15m");
  assert.equal(formatQuota([pool("2026-09-25T15:00:00Z")], now), "quota 5h ━━━━━━── 72% ↻ 2d 3h");
  assert.equal(formatQuota([pool("2026-09-23T12:01:00Z")], now), "quota 5h ━━━━━━── 72% ↻ 1m");
  assert.equal(formatQuota([pool(null), pool("invalid"), pool("2026-09-23T11:00:00Z")], now),
    "quota 5h ━━━━━━── 72% · 5h ━━━━━━── 72% · 5h ━━━━━━── 72%");
});

test("quota appears above memory status only when it fits without displacing the top line", () => {
  const theme = { bold: (s) => s, fg: (_color, s) => s };
  const ctx = {
    cwd: "/tmp/example", model: { provider: "cliproxyapi", id: "main/gpt-5", contextWindow: 100000 },
    sessionManager: { getLeafId: () => null, getBranch: () => [] },
    getContextUsage: () => null,
  };
  const footer = new J0k3rThemeFooter({ requestRender() {} }, theme,
    { getExtensionStatuses: () => new Map([["pi-persistent-memory", "memory · 9 tools"]]) }, ctx, () => "off",
    { dir: "/tmp/example", repoName: "example", branch: "main" });
  footer.setQuota("quota 5h ━━━━━━── 72% · 7d ━━━───── 40%");
  const wide = footer.render(120);
  assert.match(wide[0], /quota 5h ━━━━━━── 72% · 7d ━━━───── 40%/);
  assert.match(wide[1], /memory · 9 tools/);
  const narrow = footer.render(48);
  assert.doesNotMatch(narrow.join("\n"), /quota/);
});

test("footer does not invent a memory status when no extension publishes one", () => {
  const theme = { bold: (s) => s, fg: (_color, s) => s };
  const ctx = {
    cwd: "/tmp/example", model: { provider: "mock", id: "model", contextWindow: 100000 },
    sessionManager: { getLeafId: () => null, getBranch: () => [] },
    getContextUsage: () => null,
  };
  const footer = new J0k3rThemeFooter({ requestRender() {} }, theme,
    { getExtensionStatuses: () => new Map() }, ctx, () => "off",
    { dir: "/tmp/example", repoName: "example", branch: "main" });
  for (const width of [120, 80, 48]) assert.doesNotMatch(footer.render(width).join("\n"), /memory/);
  assert.doesNotMatch(footer.render(120).join("\n"), /engram/i);
});

test("MINI-001: isExtensionActive correctly filters opt-in extensions according to .pi/extensions.json", () => {
  const config = {
    "api-tools": false,
    "codegraph": true,
    "pi-persistent-memory": false,
  };

  assert.equal(isExtensionActive("api-tools", config), false, "api-tools must be inactive when set to false");
  assert.equal(isExtensionActive("codegraph", config), true, "codegraph must be active when set to true");
  assert.equal(isExtensionActive("pi-persistent-memory", config), false, "explicit native Pi resource exclusions must be reflected");
  assert.equal(isExtensionActive("browser-screenshot", config), false, "unspecified opt-in extension must be inactive");
  assert.equal(isExtensionActive("tools-manager", config), true, "core extension must be active by default");
});

test("MINI-002: isExtensionActive treats all opt-in extensions as inactive when config is null", () => {
  assert.equal(isExtensionActive("api-tools", null), false);
  assert.equal(isExtensionActive("codegraph", null), false);
  assert.equal(isExtensionActive("tools-manager", null), true);
  assert.equal(isExtensionActive("j0k3r-theme", null), true);
  assert.equal(isExtensionActive("pi-persistent-memory", null), true, "memory is globally autodiscovered, not an opt-in toggle");
});

test("MINI-003: getExtensionDisplayName cleans local package paths like pi-subagents-j0k3r", () => {
  const name = getExtensionDisplayName({
    path: "/home/j0k3r/projects/pi-subagents-j0k3r/index.ts",
    metadata: { origin: "package", source: "/home/j0k3r/projects/pi-subagents-j0k3r" },
  });
  assert.equal(name, "pi-subagents-j0k3r");
});

test("MINI-004: resolveViaPackageManager filters out deactivated extensions", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "j0k3r-theme-test-"));
  try {
    const piDir = join(tmp, ".pi");
    mkdirSync(piDir, { recursive: true });
    writeFileSync(join(piDir, "extensions.json"), JSON.stringify({ "api-tools": false, "codegraph": true }), "utf8");

    const result = await resolveViaPackageManager(tmp);
    assert.ok(result);
    assert.ok(result.extensionNames.includes("codegraph"), "codegraph should be present");
    assert.ok(result.extensionNames.includes("tools-manager"), "tools-manager should be present");
    assert.ok(result.extensionNames.includes("pi-subagents-j0k3r"), "pi-subagents-j0k3r should be present");
    assert.equal(result.extensionNames.includes("api-tools"), false, "api-tools must NOT be present");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("footer renders token speed alone without inventing memory status or adding delimiters", () => {
  const theme = { bold: (s) => s, fg: (_color, s) => s };
  const ctx = {
    cwd: "/tmp/example", model: { provider: "mock", id: "model", contextWindow: 100000 },
    sessionManager: { getLeafId: () => null, getBranch: () => [] },
    getContextUsage: () => null,
  };

  // Test idle state
  const idleFooter = new J0k3rThemeFooter({ requestRender() {} }, theme,
    { getExtensionStatuses: () => new Map([["tokenSpeed", "\x1b[2m⚡ TPS:\x1b[0m --"]]) }, ctx, () => "off",
    { dir: "/tmp/example", repoName: "example", branch: "main" });
  const idleRendered = idleFooter.render(120)[1];
  assert.match(idleRendered, /⚡ TPS:.*--/);
  assert.doesNotMatch(idleRendered, /memory/);
  const idleRight = idleRendered.split(/\s{2,}/).pop();
  assert.doesNotMatch(idleRight, /┃/);

  // Test active metric state
  const activeFooter = new J0k3rThemeFooter({ requestRender() {} }, theme,
    { getExtensionStatuses: () => new Map([["tokenSpeed", "\x1b[2m⚡ TPS:\x1b[0m \x1b[38;2;102;255;102m42.5 tok/s\x1b[0m"]]) }, ctx, () => "off",
    { dir: "/tmp/example", repoName: "example", branch: "main" });
  const activeRendered = activeFooter.render(120)[1];
  assert.match(activeRendered, /42\.5 tok\/s/);
  assert.ok(activeRendered.includes("\x1b[38;2;102;255;102m42.5 tok/s\x1b[0m"), "native ANSI escape sequences must be preserved");
  assert.doesNotMatch(activeRendered, /memory/);
  const activeRight = activeRendered.split(/\s{2,}/).pop();
  assert.doesNotMatch(activeRight, /┃/);
});

test("footer renders both token speed and memory concurrently in split profiles with delimiter", () => {
  const theme = { bold: (s) => s, fg: (_color, s) => s };
  const ctx = {
    cwd: "/tmp/example", model: { provider: "mock", id: "model", contextWindow: 100000 },
    sessionManager: { getLeafId: () => null, getBranch: () => [] },
    getContextUsage: () => null,
  };
  const statuses = new Map([
    ["tokenSpeed", "\x1b[2m⚡ TPS:\x1b[0m \x1b[38;2;102;255;102m42.5 tok/s\x1b[0m"],
    ["pi-persistent-memory", "memory · 9 tools"],
  ]);
  const footer = new J0k3rThemeFooter({ requestRender() {} }, theme,
    { getExtensionStatuses: () => statuses }, ctx, () => "off",
    { dir: "/tmp/example", repoName: "example", branch: "main" });

  for (const width of [120, 80]) {
    const bottomLine = footer.render(width)[1];
    assert.match(bottomLine, /42\.5 tok\/s/);
    assert.match(bottomLine, /memory/);
    assert.match(bottomLine, /┃/);
  }
});

test("footer compacts token speed by removing parenthetical metadata suffixes before truncating", () => {
  const theme = { bold: (s) => s, fg: (_color, s) => s };
  const ctx = {
    cwd: "/tmp/example", model: { provider: "mock", id: "model", contextWindow: 100000 },
    sessionManager: { getLeafId: () => null, getBranch: () => [] },
    getContextUsage: () => null,
  };
  const statuses = new Map([
    ["tokenSpeed", "\x1b[2m⚡ TPS:\x1b[0m \x1b[38;2;102;255;102m42.5 tok/s\x1b[0m (TTFT: 240 ms)\u200b"],
  ]);
  const footer = new J0k3rThemeFooter({ requestRender() {} }, theme,
    { getExtensionStatuses: () => statuses }, ctx, () => "off",
    { dir: "/tmp/example", repoName: "example", branch: "main" });

  // In 80 columns without memory, full status fits
  const wideLine = footer.render(80)[1];
  assert.match(wideLine, /42\.5 tok\/s/);

  // In narrow width (50 columns with memory), parenthetical TTFT suffix is stripped while tok/s is preserved
  statuses.set("pi-persistent-memory", "memory · 9 tools");
  const compactLine = footer.render(50)[1];
  assert.doesNotMatch(compactLine, /TTFT/);
  assert.match(compactLine, /tok\/s/);
});

test("changing tokenSpeed invalidates bottom-line cache and produces updated render output", () => {
  const theme = { bold: (s) => s, fg: (_color, s) => s };
  const ctx = {
    cwd: "/tmp/example", model: { provider: "mock", id: "model", contextWindow: 100000 },
    sessionManager: { getLeafId: () => null, getBranch: () => [] },
    getContextUsage: () => null,
  };
  const statuses = new Map([
    ["tokenSpeed", "\x1b[2m⚡ TPS:\x1b[0m --"],
  ]);
  const footer = new J0k3rThemeFooter({ requestRender() {} }, theme,
    { getExtensionStatuses: () => statuses }, ctx, () => "off",
    { dir: "/tmp/example", repoName: "example", branch: "main" });

  const line1 = footer.render(120)[1];
  assert.match(line1, /--/);
  assert.doesNotMatch(line1, /42\.5/);

  // Update tokenSpeed in statuses map
  statuses.set("tokenSpeed", "\x1b[2m⚡ TPS:\x1b[0m \x1b[38;2;102;255;102m42.5 tok/s\x1b[0m");

  const line2 = footer.render(120)[1];
  assert.match(line2, /42\.5 tok\/s/);
  assert.doesNotMatch(line2, /--/);
});

test("footer renders gracefully in narrow viewports without exceeding width or throwing", () => {
  const theme = { bold: (s) => s, fg: (_color, s) => s };
  const ctx = {
    cwd: "/tmp/example", model: { provider: "mock", id: "model", contextWindow: 100000 },
    sessionManager: { getLeafId: () => null, getBranch: () => [] },
    getContextUsage: () => null,
  };
  const statuses = new Map([
    ["tokenSpeed", "\x1b[2m⚡ TPS:\x1b[0m \x1b[38;2;102;255;102m42.5 tok/s\x1b[0m"],
    ["pi-persistent-memory", "memory · 9 tools"],
  ]);
  const footer = new J0k3rThemeFooter({ requestRender() {} }, theme,
    { getExtensionStatuses: () => statuses }, ctx, () => "off",
    { dir: "/tmp/example", repoName: "example", branch: "main" });

  for (const width of [45, 40, 30, 20]) {
    const lines = footer.render(width);
    assert.equal(lines.length, 2);
    for (const line of lines) {
      // visibleWidth mock removes ANSI and returns length
      const cleanLen = line.replace(/\x1b\[[0-9;]*m/g, "").length;
      assert.ok(cleanLen <= width, `Rendered line length (${cleanLen}) must not exceed width (${width})`);
    }
  }
});

const multiGroupPools = [
  {
    label: "Gemini Models (5 hs)",
    displayName: "Gemini Models · 5 hs",
    windowLabel: "5 hs",
    availablePercentage: 100,
    resetAt: "2026-09-23T17:01:00Z",
  },
  {
    label: "Gemini Models (Semanal)",
    displayName: "Gemini Models · Semanal",
    windowLabel: "Semanal",
    availablePercentage: 67,
    resetAt: "2026-09-24T02:01:00Z",
  },
  {
    label: "Claude and GPT models (5 hs)",
    displayName: "Claude and GPT models · 5 hs",
    windowLabel: "5 hs",
    availablePercentage: 100,
    resetAt: "2026-09-23T17:01:00Z",
  },
  {
    label: "Claude and GPT models (Semanal)",
    displayName: "Claude and GPT models · Semanal",
    windowLabel: "Semanal",
    availablePercentage: 100,
    resetAt: "2026-09-30T12:00:00Z",
  },
];

test("selectModelPools isolates Gemini pools when given Gemini model ID from multi-group fixture", () => {
  const geminiModels = ["gemini-4-argon-high", "j0k3r/gemini-4-argon-high", "gemini-3.8-flash-high", "GEMINI-PRO"];
  for (const modelId of geminiModels) {
    const pools = selectModelPools(modelId, multiGroupPools);
    assert.equal(pools.length, 2, `Model ${modelId} should select exactly 2 Gemini pools`);
    assert.ok(pools.every((p) => p.displayName.includes("Gemini Models")), `All pools for ${modelId} must be Gemini`);
  }
});

test("selectModelPools isolates Claude/GPT pools when given Claude or GPT model ID from multi-group fixture", () => {
  const claudeModels = ["claude-3-7-sonnet", "j0k3r/claude-opus", "CLAUDE-3-5"];
  for (const modelId of claudeModels) {
    const pools = selectModelPools(modelId, multiGroupPools);
    assert.equal(pools.length, 2, `Model ${modelId} should select exactly 2 Claude/GPT pools`);
    assert.ok(pools.every((p) => p.displayName.includes("Claude and GPT models")));
  }

  const gptModels = ["gpt-4o", "j0k3r/gpt-5-preview", "GPT-4.5"];
  for (const modelId of gptModels) {
    const pools = selectModelPools(modelId, multiGroupPools);
    assert.equal(pools.length, 2, `Model ${modelId} should select exactly 2 Claude/GPT pools`);
    assert.ok(pools.every((p) => p.displayName.includes("Claude and GPT models")));
  }
});

test("selectModelPools falls back to all pools when unrecognized model or single-group fixture", () => {
  // Unrecognized family in multi-group account
  const unknownPools = selectModelPools("custom-unknown-model", multiGroupPools);
  assert.equal(unknownPools.length, 4);
  assert.deepEqual(unknownPools, multiGroupPools);

  // Single-group account without family keywords in pool labels/displayNames
  const singleGroupPools = [
    { label: "5h", displayName: "OpenAI · 5h", windowLabel: "5h", availablePercentage: 80 },
    { label: "weekly", displayName: "OpenAI · weekly", windowLabel: "weekly", availablePercentage: 50 },
  ];
  // Model with 'gemini', but pools don't contain 'gemini'
  const fallbackGemini = selectModelPools("gemini-4-argon", singleGroupPools);
  assert.equal(fallbackGemini.length, 2);
  assert.deepEqual(fallbackGemini, singleGroupPools);

  // Model with 'gpt', but pools don't contain 'gpt'
  const fallbackGpt = selectModelPools("gpt-4o", singleGroupPools);
  assert.equal(fallbackGpt.length, 2);
  assert.deepEqual(fallbackGpt, singleGroupPools);
});

test("fetchModelQuota filters multi-group account pools for active Gemini model and preserves exact selection", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.CLIPROXYAPI_MANAGEMENT_KEY;
  process.env.CLIPROXYAPI_MANAGEMENT_KEY = "test-key";

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/auth-files")) {
      return Response.json({
        files: [
          { id: "auth-multi", name: "antigravity-account", auth_index: "index-1", provider: "antigravity", email: "user@example.org" },
        ],
      });
    }
    if (url.includes("/auth-files/models")) {
      return Response.json({
        models: [
          { id: "j0k3r/gemini-4-argon-high" },
          { id: "j0k3r/claude-3-7-sonnet" },
        ],
      });
    }
    return Response.json({
      status_code: 200,
      body: JSON.stringify({
        groups: [
          {
            displayName: "Gemini Models",
            buckets: [
              { remainingFraction: 1.0, window: "5 hs" },
              { remainingFraction: 0.67, window: "Semanal" },
            ],
          },
          {
            displayName: "Claude and GPT models",
            buckets: [
              { remainingFraction: 1.0, window: "5 hs" },
              { remainingFraction: 1.0, window: "Semanal" },
            ],
          },
        ],
      }),
    });
  };

  try {
    const geminiQuota = await fetchModelQuota("cliproxyapi", "j0k3r/gemini-4-argon-high");
    assert.ok(geminiQuota);
    // Unfiltered would have 4 pool segments (2 "5 hs" and 2 "Semanal"); filtered should have exactly 1 of each
    const occurrences5h = (geminiQuota.match(/5 hs/g) || []).length;
    const occurrencesSemanal = (geminiQuota.match(/Semanal/g) || []).length;
    assert.equal(occurrences5h, 1, "Gemini quota must have only 1 '5 hs' bucket");
    assert.equal(occurrencesSemanal, 1, "Gemini quota must have only 1 'Semanal' bucket");
    assert.match(geminiQuota, /67%/);
    // Width should be ~64 chars, not ~125
    assert.ok(geminiQuota.length < 80, `Formatted width (${geminiQuota.length}) must be compact (< 80 chars)`);

    // Claude model in same account gets Claude/GPT pools
    const claudeQuota = await fetchModelQuota("cliproxyapi", "j0k3r/claude-3-7-sonnet");
    assert.ok(claudeQuota);
    assert.equal((claudeQuota.match(/5 hs/g) || []).length, 1);
    assert.equal((claudeQuota.match(/Semanal/g) || []).length, 1);
    // Both Claude buckets are 100%
    assert.doesNotMatch(claudeQuota, /67%/);

    // Unmapped model returns undefined (zero cross-account guessing)
    const unmapped = await fetchModelQuota("cliproxyapi", "gemini-4-argon-unmapped");
    assert.equal(unmapped, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.CLIPROXYAPI_MANAGEMENT_KEY;
    else process.env.CLIPROXYAPI_MANAGEMENT_KEY = originalKey;
  }
});

test("J0k3rThemeFooter renders filtered Gemini quota at 120 columns while 125-char quota is suppressed", () => {
  const theme = { bold: (s) => s, fg: (_color, s) => s };
  const ctx = {
    cwd: "/tmp/example",
    model: { provider: "cliproxyapi", id: "j0k3r/gemini-4-argon-high", contextWindow: 100000 },
    sessionManager: { getLeafId: () => null, getBranch: () => [] },
    getContextUsage: () => null,
  };
  const footer = new J0k3rThemeFooter(
    { requestRender() {} },
    theme,
    { getExtensionStatuses: () => new Map() },
    ctx,
    () => "off",
    { dir: "/tmp/example", repoName: "example", branch: "main" },
  );

  const fixedNow = Date.parse("2026-09-23T12:00:00Z");

  // Pre-fix unfiltered quota (~125 chars)
  const unfilteredQuota = formatQuota(multiGroupPools, fixedNow);
  assert.ok(unfilteredQuota.length > 110, `Unfiltered quota length is ${unfilteredQuota.length}`);
  footer.setQuota(unfilteredQuota);
  const renderedUnfiltered = footer.render(120);
  assert.doesNotMatch(renderedUnfiltered[0], /quota/, "Unfiltered 125-char quota must be omitted because gap < 2");

  // Filtered quota (~64 chars)
  const filteredPools = selectModelPools("j0k3r/gemini-4-argon-high", multiGroupPools);
  const filteredQuota = formatQuota(filteredPools, fixedNow);
  assert.ok(filteredQuota.length < 80, `Filtered quota length is ${filteredQuota.length}`);
  footer.setQuota(filteredQuota);
  const renderedFiltered = footer.render(120);
  assert.match(renderedFiltered[0], /quota 5 hs ━━━━━━━━ 100% ↻ 5h 1m · Semanal ━━━━━─── 67% ↻ 14h 1m/, "Filtered quota must be rendered on top line");

  // Narrow viewport (< 95 columns, e.g. 48) continues to omit quota
  const narrow = footer.render(48);
  assert.doesNotMatch(narrow.join("\n"), /quota/);
});
