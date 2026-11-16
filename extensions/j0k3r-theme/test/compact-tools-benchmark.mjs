/**
 * Compact tool rendering benchmark (compact-tool-rendering MINI-008).
 *
 * Renders tool rows through Pi's real `ToolExecutionComponent` using renderers resolved exactly
 * like the installed host does (`ExtensionRunner.resolveToolRenderers` -> `withBuiltInRenderers`).
 * Only Pi's documented host packages are used: no sibling extension import and no package-local
 * Pi mock.
 *
 * It measures deterministic layout work (rows, cells, ANSI bytes) and elapsed render time for
 * representative frames. Rows/cells/ANSI bytes are the regression signal; elapsed time is reported
 * honestly and is not an asserted threshold.
 *
 * Usage:
 *   PI_COMPACT_TEST_HOST=/path/to/@earendil-works/pi-coding-agent node test/compact-tools-benchmark.mjs
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const host = process.env.PI_COMPACT_TEST_HOST;
if (!host) {
  console.error("PI_COMPACT_TEST_HOST must point at the installed @earendil-works/pi-coding-agent package");
  process.exit(2);
}

const ITERATIONS = Number(process.env.PI_COMPACT_BENCH_ITERATIONS ?? 120);
const WIDTHS = [23, 40, 80, 120];

const { loadExtensions } = await import(pathToFileURL(`${host}/dist/core/extensions/loader.js`).href);
const { createExtensionRuntime, ExtensionRunner } = await import(
  pathToFileURL(`${host}/dist/core/extensions/index.js`).href
);
const { withBuiltInRenderers } = await import(
  pathToFileURL(`${host}/dist/core/tools/renderers/index.js`).href
);
const { ToolExecutionComponent } = await import(
  pathToFileURL(`${host}/dist/modes/interactive/components/tool-execution.js`).href
);
const { initTheme } = await import(pathToFileURL(`${host}/dist/modes/interactive/theme/theme.js`).href);
const tui = await import(pathToFileURL(`${host}/node_modules/@earendil-works/pi-tui/dist/index.js`).href);

initTheme("dark");

const entry = new URL("../index.ts", import.meta.url).pathname;
const root = mkdtempSync(join(tmpdir(), "compact-bench-"));
const cleanup = () => rmSync(root, { recursive: true, force: true });
process.on("exit", cleanup);

// Third-party-style owners: unmarked definitions with their own boxed renderers, the exact shape
// that reaches Pi without the theme's universal presentation resolver.
const fixture = join(root, "fixture-owners.ts");
const boxed = (label) => ({
  renderCall: (_args, theme) => new (class {
    render() {
      return [theme.bg("toolPendingBg", `╭─ ${label} ──────────╮`), theme.bg("toolPendingBg", "│ call │"), theme.bg("toolPendingBg", "╰──────────────────╯")];
    }
    invalidate() {}
  })(),
  renderResult: (_result, options, theme) => new (class {
    render() {
      return options.expanded
        ? ["result body line 1", "result body line 2"]
        : [theme.fg("muted", "... (12 more lines, ctrl+o to expand)")];
    }
    invalidate() {}
  })(),
});
writeFileSync(
  fixture,
  `const boxed = ${boxed.toString()};
export default function (pi) {
  for (const name of ["agent_todo", "codegraph_node", "web_search", "subagent_run", "tool_search"]) {
    pi.registerTool({ name, label: name, description: name, parameters: { type: "object", properties: {} }, ...boxed(name) });
  }
  pi.registerTool({ name: "broken_owner", label: "broken_owner", description: "broken_owner", parameters: { type: "object", properties: {} },
    renderCall: () => { throw new Error("owner call renderer failed"); },
    renderResult: () => { throw new Error("owner result renderer failed"); } });
}
`,
);

const loaded = await loadExtensions([entry, fixture], root);
if (loaded.errors.length > 0) {
  console.error("extension load errors", loaded.errors);
  process.exit(1);
}
const runner = new ExtensionRunner(loaded.extensions, createExtensionRuntime(), root, {}, {});
const own = new Map();
for (const extension of loaded.extensions) for (const [name, registered] of extension.tools) own.set(name, registered.definition);
const resolve = (name) => runner.resolveToolRenderers(name, () => withBuiltInRenderers(name, own.get(name)));

const LONG_OUTPUT = Array.from({ length: 40 }, (_, index) => `line ${index + 1} of tool output 漢字`).join("\n");
const CASES = [
  { name: "read", args: { path: "/home/j0k3r/.pi/agent/extensions/j0k3r-theme/src/render/compact.ts" }, text: LONG_OUTPUT, details: { truncation: { truncated: true, outputLines: 40, totalLines: 90 } } },
  { name: "bash", args: { command: "node --test test/*.test.mjs", timeout: 120 }, text: LONG_OUTPUT, details: undefined },
  { name: "bash", args: { command: "echo 'multiline step 1'\n\necho 'multiline step 2' && " + "x".repeat(90), timeout: 120 }, text: LONG_OUTPUT, details: undefined },
  { name: "bash", args: { command: "false", timeout: 120 }, text: "Command exited with code 1", details: undefined, isError: true },
  { name: "powershell", args: { command: "Get-ChildItem -Recurse", timeout: 120 }, text: LONG_OUTPUT, details: undefined },
  { name: "edit", args: { path: "/home/j0k3r/.pi/agent/extensions/j0k3r-theme/src/render/compact.ts", edits: [{ oldText: "a", newText: "b" }] }, text: "Successfully replaced 1 block(s).", details: { diff: "--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-a\n+b\n" } },
  { name: "write", args: { path: "/home/j0k3r/.pi/agent/extensions/j0k3r-theme/src/render/compact.ts", content: "export const x = 1;\n".repeat(12) }, text: "Successfully wrote to src/render/compact.ts", details: undefined },
  { name: "grep", args: { pattern: "registerToolRenderer", path: "/home/j0k3r/.pi/agent/extensions" }, text: LONG_OUTPUT, details: undefined },
  { name: "find", args: { pattern: "*.test.mjs", path: "/home/j0k3r/.pi/agent/extensions" }, text: LONG_OUTPUT, details: undefined },
  { name: "ls", args: { path: "/home/j0k3r/.pi/agent/extensions/j0k3r-theme" }, text: LONG_OUTPUT, details: undefined },
  { name: "codemode", args: { code: "return tools.list()" }, text: LONG_OUTPUT, details: undefined },
  { name: "tool_search", args: { query: "codegraph" }, text: "Loaded 3 tools.", details: undefined },
  { name: "mcp__docs__search", args: { query: "rendering" }, text: LONG_OUTPUT, details: undefined },
  { name: "list_mcp_resources", args: {}, text: LONG_OUTPUT, details: undefined },
  { name: "agent_todo", args: { action: "list" }, text: LONG_OUTPUT, details: undefined },
  { name: "codegraph_node", args: { name: "registerToolRenderer" }, text: LONG_OUTPUT, details: undefined },
  { name: "web_search", args: { query: "pi tool renderer" }, text: LONG_OUTPUT, details: undefined },
  { name: "subagent_run", args: { agent: "02-apply", task: "fixture" }, text: LONG_OUTPUT, details: undefined },
  { name: "unknown_restored_tool", args: { value: "restored" }, text: LONG_OUTPUT, details: undefined },
  { name: "broken_owner", args: {}, text: "owner result text", details: undefined },
];

const escapeBytes = (lines) => lines.reduce((total, line) => total + (line.match(/\x1b\[/g)?.length ?? 0), 0);
const cells = (lines) => lines.reduce((total, line) => total + tui.visibleWidth(line), 0);

const ui = { requestRender() {} };
let toolCallId = 0;

function framesFor(testCase, width) {
  const definition = resolve(testCase.name);
  const component = new ToolExecutionComponent(
    testCase.name,
    `bench-${++toolCallId}`,
    testCase.args,
    { outputPad: 0 },
    definition,
    ui,
    root,
  );
  const result = {
    content: [{ type: "text", text: testCase.text }],
    details: testCase.details,
    isError: testCase.isError ?? false,
  };
  const frames = [];
  frames.push({ phase: "streaming", lines: component.render(width) });
  component.markExecutionStarted();
  component.setArgsComplete();
  frames.push({ phase: "running", lines: component.render(width) });
  component.updateResult(result, true);
  frames.push({ phase: "partial", lines: component.render(width) });
  component.updateResult(result, false);
  frames.push({ phase: "collapsed", lines: component.render(width) });
  component.setExpanded(true);
  frames.push({ phase: "expanded", lines: component.render(width) });
  frames.push({ phase: "collapsed-again", lines: (component.setExpanded(false), component.render(width)) });
  return frames;
}

function measure(width) {
  const rows = [];
  for (const testCase of CASES) {
    for (const frame of framesFor(testCase, width)) {
      rows.push({
        tool: testCase.name,
        phase: frame.phase,
        width,
        rows: frame.lines.length,
        cells: cells(frame.lines),
        ansiSequences: escapeBytes(frame.lines),
        overflow: frame.lines.filter((line) => tui.visibleWidth(line) > width).length,
      });
    }
  }
  return rows;
}

const startedAt = performance.now();
const measurements = WIDTHS.flatMap(measure);
const settleMs = performance.now() - startedAt;

const timings = [];
for (let iteration = 0; iteration < ITERATIONS; iteration++) {
  const start = performance.now();
  for (const width of WIDTHS) for (const testCase of CASES) framesFor(testCase, width);
  timings.push(performance.now() - start);
}
timings.sort((a, b) => a - b);
const median = timings[Math.floor(timings.length / 2)];
const tail = timings[Math.min(timings.length - 1, Math.floor(timings.length * 0.95))];
const heap = process.memoryUsage().heapUsed;

const totals = measurements.reduce(
  (accumulator, row) => ({
    rows: accumulator.rows + row.rows,
    cells: accumulator.cells + row.cells,
    ansiSequences: accumulator.ansiSequences + row.ansiSequences,
    overflow: accumulator.overflow + row.overflow,
  }),
  { rows: 0, cells: 0, ansiSequences: 0, overflow: 0 },
);

const perTool = new Map();
for (const row of measurements) {
  const key = `${row.tool}@${row.width}`;
  const entry = perTool.get(key) ?? { rows: 0, cells: 0 };
  entry.rows += row.rows;
  entry.cells += row.cells;
  perTool.set(key, entry);
}

console.log("compact-tool-rendering benchmark");
console.log(`frames=${measurements.length} widths=${WIDTHS.join(",")} cases=${CASES.length} iterations=${ITERATIONS}`);
console.log(`totals rows=${totals.rows} cells=${totals.cells} ansi=${totals.ansiSequences} overflow=${totals.overflow}`);
console.log(`timing median=${median.toFixed(2)}ms p95=${tail.toFixed(2)}ms settle=${settleMs.toFixed(2)}ms heap=${(heap / 1048576).toFixed(1)}MB`);
console.log("per-tool rows (sum of six frames per width):");
for (const [key, value] of [...perTool.entries()].sort()) console.log(`  ${key} rows=${value.rows} cells=${value.cells}`);
console.log(
  `JSON ${JSON.stringify({
    widths: WIDTHS,
    frames: measurements.length,
    totals,
    timing: { median, p95: tail, settle: settleMs },
    heapUsed: heap,
    perTool: Object.fromEntries(perTool),
  })}`,
);
