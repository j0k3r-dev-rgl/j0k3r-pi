import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const loaderCode = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "@earendil-works/pi-tui") {
    return {
      shortCircuit: true,
      url: "data:text/javascript," + encodeURIComponent(\`
        export function matchesKey(data, key) { return data === key; }
        export function visibleWidth(str) { return str.replace(/\\x1b\\[[0-9;]*m/g, "").length; }
      \`)
    };
  }
  if (specifier === "@earendil-works/pi-coding-agent") {
    return {
      shortCircuit: true,
      url: "data:text/javascript,export default {};"
    };
  }
  return nextResolve(specifier, context);
}
`;

register("data:text/javascript," + encodeURIComponent(loaderCode));

const { SUPPORTED_EXTENSIONS, ToolsManagerModal } = await import("../src/modal.ts");

const mockTheme = {
  fg: (_color, text) => text,
  bold: (text) => text,
};

test("MINI-001: SUPPORTED_EXTENSIONS contains 10 current opt-in items including codegraph and typesafe", () => {
  assert.equal(SUPPORTED_EXTENSIONS.length, 10);
  assert.equal(SUPPORTED_EXTENSIONS.some((e) => /engram|memory/.test(e.id)), false, "Memory is managed by Pi native resources");
  const codegraph = SUPPORTED_EXTENSIONS.find((e) => e.id === "codegraph");
  assert.ok(codegraph, "codegraph must exist in SUPPORTED_EXTENSIONS");
  assert.deepEqual(codegraph, {
    id: "codegraph",
    name: "codegraph",
    description: "CodeGraph semantic exploration & index management",
  });

  const typesafe = SUPPORTED_EXTENSIONS.find((e) => e.id === "typesafe");
  assert.ok(typesafe, "typesafe must exist in SUPPORTED_EXTENSIONS");
  assert.deepEqual(typesafe, {
    id: "typesafe",
    name: "typesafe",
    description: "TypeSafe System One (Jev) semantic AI evaluation",
  });
});

test("MINI-001: loadCurrentState initializes codegraph to false when config is missing or omits it", () => {
  const tmp = mkdtempSync(join(tmpdir(), "tools-manager-test-"));
  try {
    let doneResult;
    const modal = new ToolsManagerModal(tmp, mockTheme, (res) => { doneResult = res; });
    // Saving config without toggling should output all extensions as false
    modal.saveConfig();
    assert.ok(doneResult);
    assert.equal(doneResult.action, "save");
    assert.equal(doneResult.selected?.codegraph, false);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("MINI-001: clicking on any extension item row (0 to 8) accurately toggles that item's checked state", () => {
  const tmp = mkdtempSync(join(tmpdir(), "tools-manager-test-"));
  try {
    let doneResult;
    const modal = new ToolsManagerModal(tmp, mockTheme, (res) => { doneResult = res; });

    // CodeGraph is row 8, rendered at y = 5 + 2*8 = 21.
    const res = modal.handleMouse({ button: "left", type: "click", x: 10, y: 21 });
    assert.deepEqual(res, { handled: true, render: true });

    modal.saveConfig();
    assert.equal(doneResult.selected?.codegraph, true);

    // Click again to toggle off
    modal.handleMouse({ button: "left", type: "click", x: 10, y: 22 });
    modal.saveConfig();
    assert.equal(doneResult.selected?.codegraph, false);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("MINI-001: clicking on action buttons row (y = 28 for 10 items) invokes saveConfig or dismisses", () => {
  const tmp = mkdtempSync(join(tmpdir(), "tools-manager-test-"));
  try {
    let doneResult;
    const modal = new ToolsManagerModal(tmp, mockTheme, (res) => { doneResult = res; });

    // Buttons row for 10 items is 5 + 10*2 + 3 = 28.
    modal.handleMouse({ button: "left", type: "click", x: 35, y: 28 });
    assert.deepEqual(doneResult, { action: "cancel" });

    // Reset doneResult and click save at y = 28, x = 15.
    doneResult = undefined;
    modal.handleMouse({ button: "left", type: "click", x: 15, y: 28 });
    assert.ok(doneResult);
    assert.equal(doneResult.action, "save");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("MINI-001: saveConfig persists codegraph state into .pi/extensions.json preserving unrelated keys", () => {
  const tmp = mkdtempSync(join(tmpdir(), "tools-manager-test-"));
  try {
    const piDir = join(tmp, ".pi");
    const configPath = join(piDir, "extensions.json");
    mkdirSync(piDir, { recursive: true });
    writeFileSync(configPath, JSON.stringify({ "unrelated-key": 42, "codegraph": false }), "utf8");

    let doneResult;
    const modal = new ToolsManagerModal(tmp, mockTheme, (res) => { doneResult = res; });

    // Toggle codegraph (index 8).
    modal.handleMouse({ button: "left", type: "click", x: 10, y: 21 });
    modal.saveConfig();

    const saved = JSON.parse(readFileSync(configPath, "utf8"));
    assert.equal(saved["unrelated-key"], 42);
    assert.equal(saved["codegraph"], true);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
