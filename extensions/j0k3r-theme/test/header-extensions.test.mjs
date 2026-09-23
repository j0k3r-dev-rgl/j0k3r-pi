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

const { selectQuotaAccount, fetchModelQuota, formatQuota, QUOTA_REFRESH_MS } = await import("../src/quota.ts");
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

test("quota appears above Engram only when it fits without displacing the top line", () => {
  const theme = { bold: (s) => s, fg: (_color, s) => s };
  const ctx = {
    cwd: "/tmp/example", model: { provider: "cliproxyapi", id: "main/gpt-5", contextWindow: 100000 },
    sessionManager: { getLeafId: () => null, getBranch: () => [] },
    getContextUsage: () => null,
  };
  const footer = new J0k3rThemeFooter({ requestRender() {} }, theme,
    { getExtensionStatuses: () => new Map([["engram", "engram"]]) }, ctx, () => "off",
    { dir: "/tmp/example", repoName: "example", branch: "main" });
  footer.setQuota("quota 5h ━━━━━━── 72% · 7d ━━━───── 40%");
  const wide = footer.render(120);
  assert.match(wide[0], /quota 5h ━━━━━━── 72% · 7d ━━━───── 40%/);
  assert.match(wide[1], /engram/);
  const narrow = footer.render(48);
  assert.doesNotMatch(narrow.join("\n"), /quota/);
});

test("MINI-001: isExtensionActive correctly filters opt-in extensions according to .pi/extensions.json", () => {
  const config = {
    "api-tools": false,
    "codegraph": true,
    "engram": true,
  };

  assert.equal(isExtensionActive("api-tools", config), false, "api-tools must be inactive when set to false");
  assert.equal(isExtensionActive("codegraph", config), true, "codegraph must be active when set to true");
  assert.equal(isExtensionActive("gentle-engram", config), true, "gentle-engram must map to engram key");
  assert.equal(isExtensionActive("browser-screenshot", config), false, "unspecified opt-in extension must be inactive");
  assert.equal(isExtensionActive("tools-manager", config), true, "core extension must be active by default");
});

test("MINI-002: isExtensionActive treats all opt-in extensions as inactive when config is null", () => {
  assert.equal(isExtensionActive("api-tools", null), false);
  assert.equal(isExtensionActive("codegraph", null), false);
  assert.equal(isExtensionActive("tools-manager", null), true);
  assert.equal(isExtensionActive("j0k3r-theme", null), true);
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
