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
      \`)
    };
  }
  if (specifier === "@earendil-works/pi-coding-agent") {
    return {
      shortCircuit: true,
      url: "data:text/javascript," + encodeURIComponent(\`
        export function keyHint(k, d) { return d; }
        export function getAgentDir() { return "/home/j0k3r/.pi/agent"; }
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
