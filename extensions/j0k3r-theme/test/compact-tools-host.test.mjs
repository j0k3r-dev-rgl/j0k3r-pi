/**
 * Host-aware compact tool rendering test (compact-tool-rendering MINI-002 / MINI-008).
 *
 * Renders through the installed Pi host: extensions load with Pi's documented `loadExtensions`,
 * renderers resolve with `ExtensionRunner.resolveToolRenderers`, and rows are drawn by the real
 * `ToolExecutionComponent`. No package-local Pi mock and no sibling extension import.
 *
 * Fixture owners are generated here, so every inventoried owner/dynamic name is exercised without
 * depending on whether the real owner implementation has already joined. Pi's own built-ins are
 * covered through Pi's own definitions, which is exactly the path the resolver must normalize.
 *
 * Requires PI_COMPACT_TEST_HOST to point at the installed @earendil-works/pi-coding-agent package.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const host = process.env.PI_COMPACT_TEST_HOST;
const skip = host ? false : "PI_COMPACT_TEST_HOST is not set";

const WIDTHS = [0, 1, 2, 10, 23, 24, 40, 80, 120];
const POSITIVE_WIDTHS = WIDTHS.filter((width) => width > 0);

const load = async (relative) => import(pathToFileURL(`${host}/${relative}`).href);
const { loadExtensions } = host ? await load("dist/core/extensions/loader.js") : {};
const { createExtensionRuntime, ExtensionRunner } = host ? await load("dist/core/extensions/index.js") : {};
const { withBuiltInRenderers } = host ? await load("dist/core/tools/renderers/index.js") : {};
const { ToolExecutionComponent } = host ? await load("dist/modes/interactive/components/tool-execution.js") : {};
const { CustomMessageComponent } = host ? await load("dist/modes/interactive/components/custom-message.js") : {};
const { InteractiveMode, SettingsManager, SessionManager } = host ? await load("dist/index.js") : {};
const { initTheme, setTheme } = host ? await load("dist/modes/interactive/theme/theme.js") : {};
const tui = host ? await load("node_modules/@earendil-works/pi-tui/dist/index.js") : {};
if (host) initTheme("dark");

/**
 * Canonical coverage inventory, split by who supplies the definition:
 * - Pi built-ins: Pi's own tool definitions and renderers, plus the four the theme re-registers.
 * - Shipped extensions: Pi's codemode / tool_search / MCP and MCP resource tools.
 * - Extension owners: every tool the inventoried owner extensions register.
 * - Unknown/dynamic: restored and never-registered names.
 */
const BUILT_IN_TOOLS = ["read", "bash", "powershell", "edit", "write", "grep", "find", "ls"];
const SHIPPED_TOOLS = [
	"codemode",
	"tool_search",
	"mcp__docs__search_docs",
	"list_mcp_resources",
	"list_mcp_resource_templates",
	"read_mcp_resource",
];
const OWNER_TOOLS = [
	"agent_todo",
	"api_status",
	"api_auth_status",
	"api_login",
	"api_rest_request",
	"api_swagger",
	"api_graphql",
	"codegraph_status",
	"codegraph_sync",
	"codegraph_explore",
	"codegraph_node",
	"codegraph_impact",
	"codegraph_manage",
	"context7_status",
	"context7_search_library",
	"context7_get_context",
	"context7_resolve_and_get_context",
	"memory_save",
	"memory_search",
	"memory_get",
	"memory_context",
	"memory_delete",
	"memory_restore",
	"memory_deleted_list",
	"memory_entity",
	"memory_relation",
	"memory_history",
	"workspace_services_list",
	"workspace_service_start",
	"workspace_service_stop",
	"workspace_service_logs",
	"workspace_services_status",
	"workspace_service_restart",
	"web_search",
	"web_fetch",
	"discussion_search",
	"research_search",
	"github_code_search",
	"discussion_get",
	"discussion_answers_get",
	"discussion_comments_get",
	"research_get",
	"research_graph_get",
	"github_get",
	"youtube_search",
	"youtube_video_get",
	"youtube_transcript_get",
	"youtube_channel_search",
	"youtube_playlist_get",
	"browser_cdp_status",
	"browser_tabs_list",
	"go_to_page",
	"browser_page_screenshot",
	"screenshot",
	"markdown_to_audio",
	"pdf_extract",
	"skill_registry_generate",
	"skill_registry_resolve",
	"ask_user_question",
	"workflow_check",
	"workflow_record",
	"supervisor_rotate",
	"subagent_run",
	"ask_orchestrator",
	"report_orchestrator",
];
const UNKNOWN_TOOLS = ["unknown_restored_tool", "mcp__late_server__late_tool", "websearch_internal_helper"];

/** Names the fixture extension registers itself. Built-ins stay Pi-owned. */
const FIXTURE_TOOLS = [...SHIPPED_TOOLS, ...OWNER_TOOLS, ...UNKNOWN_TOOLS];
const ALL_TOOLS = [...BUILT_IN_TOOLS, ...FIXTURE_TOOLS];

/** Owner shapes: every shape a real owner can present must normalize to one compact row. */
const SHAPES = ["compliant", "unmarked", "missing-slots", "throwing"];
const shapeOf = (name) => SHAPES[FIXTURE_TOOLS.indexOf(name) % SHAPES.length];
const namesWithShape = (shape) => FIXTURE_TOOLS.filter((name) => shapeOf(name) === shape);

const root = mkdtempSync(join(tmpdir(), "compact-host-"));
process.on("exit", () => rmSync(root, { recursive: true, force: true }));

// Fixture owners. The compliant shape models the pinned contract faithfully: the call slot yields
// nothing once the result exists, so a call/result pair never shows two rows.
const fixtureSource = `
globalThis.__compactFixture = { unmarkedCallbacks: 0 };
const store = globalThis.__compactFixture;

function textComponent(lines) {
  return { render: () => (typeof lines === 'function' ? lines() : lines).slice(), invalidate() {} };
}

function boxedOwner(label) {
  return {
    renderCall: () => { store.unmarkedCallbacks++; return textComponent([
      '\\u256d\\u2500 ' + label + ' \\u2500\\u256e',
      '\\u2502 call \\u2502',
      '\\u2570\\u2500\\u2500\\u2500\\u2500\\u256f',
    ]); },
    renderResult: (_result, options) => { store.unmarkedCallbacks++; return textComponent(options.expanded
      ? ['owner card body']
      : ['... (12 more lines, ctrl+o to expand)']); },
  };
}

function compliantOwner(label) {
  return {
    compactToolRenderingVersion: 1,
    renderShell: 'self',
    // The state check runs at render time, so the pair collapses into one row even though Pi
    // re-runs the call slot before the result slot on the frame that first receives the result.
    renderCall: (_args, _theme, context) =>
      textComponent(() => (context.state.hasResult ? [] : [label + ' running'])),
    renderResult: (result, options, _theme, context) => {
      context.state.hasResult = true;
      const blocks = result.content.filter((block) => block.type === 'text').map((block) => block.text);
      return textComponent(() => {
        const lines = [label + ' summary'];
        if (options.expanded) lines.push(...blocks.join('\\n').split('\\n'));
        return lines;
      });
    },
  };
}

export default function (pi) {
  const SHAPES = ${JSON.stringify(SHAPES)};
  const names = ${JSON.stringify(FIXTURE_TOOLS)};
  // An MCP-style resolver registered before the theme's, exercising load-order precedence.
  pi.registerToolRenderer((toolName, next) => {
    if (!/^mcp__.+?__.+$/.test(toolName)) return next();
    return next() ?? {
      renderCall: () => textComponent(['raw mcp call']),
      renderResult: () => textComponent(['raw mcp result, ctrl+o to expand']),
    };
  });
  for (let index = 0; index < names.length; index++) {
    const definition = {
      name: names[index],
      label: names[index],
      description: 'fixture owner ' + names[index],
      parameters: { type: 'object', properties: {} },
    };
    const shape = SHAPES[index % SHAPES.length];
    if (shape === 'compliant') Object.assign(definition, compliantOwner(names[index]));
    else if (shape === 'unmarked') Object.assign(definition, boxedOwner(names[index]));
    else if (shape === 'missing-slots') {
      definition.compactToolRenderingVersion = 1;
      definition.renderShell = 'self';
      definition.renderCall = () => textComponent(['incomplete owner call']);
    } else {
      definition.compactToolRenderingVersion = 1;
      definition.renderShell = 'self';
      definition.renderCall = () => { throw new Error('owner call renderer failed'); };
      definition.renderResult = () => { throw new Error('owner result renderer failed'); };
    }
    pi.registerTool(definition);
  }
}
`;

const fixturePath = join(root, "fixture-owners.ts");
writeFileSync(fixturePath, fixtureSource);

const themeEntry = new URL("../index.ts", import.meta.url).pathname;

async function buildHarness(entries) {
	const loaded = await loadExtensions(entries, root);
	assert.deepEqual(
		loaded.errors.map((error) => error.message ?? String(error)),
		[],
		"the theme and the fixture owners must both load on the installed host",
	);
	const own = new Map();
	for (const extension of loaded.extensions) {
		for (const [name, registered] of extension.tools) own.set(name, registered.definition);
	}
	const runner = new ExtensionRunner(loaded.extensions, createExtensionRuntime(), root, {}, {});
	return {
		loaded,
		own,
		runner,
		ui: { requestRender() {} },
		resolve: (name) => runner.resolveToolRenderers(name, () => withBuiltInRenderers(name, own.get(name))),
	};
}

let cached;
const harness = async () => (cached ??= await buildHarness([themeEntry, fixturePath]));

let callId = 0;

const stripAnsi = (line) => line.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-9;]*m/g, "");
const nonEmpty = (lines) => lines.filter((line) => stripAnsi(line).trim() !== "");
const GENERATED_CARD = /[\u256d\u256e\u2570\u256f]/;
const HINT = /to expand|to collapse|ctrl\+o|app\.tools\.expand/i;
const BACKGROUND_SGR = /\x1b\[(?:4[0-7]|10[0-7]|48(?:;[0-9;]*)?)m/;

/** Every generated line fits the supplied positive width; width <= 0 emits no cells at all. */
function assertWidthSafe(lines, width, label) {
	assert.ok(Array.isArray(lines), `${label}: render must return an array`);
	if (width <= 0) {
		assert.equal(lines.length, 0, `${label}: width ${width} must emit no lines`);
		return;
	}
	for (const line of lines) {
		assert.ok(
			tui.visibleWidth(line) <= width,
			`${label}: line exceeds width ${width} (${tui.visibleWidth(line)}): ${JSON.stringify(line)}`,
		);
	}
}

const WIDE_GRAPHEME_SEGMENTER = new Intl.Segmenter("en", { granularity: "grapheme" });
function firstPrintingGraphemeWidth(plain) {
	for (const { segment } of WIDE_GRAPHEME_SEGMENTER.segment(plain)) {
		const w = tui.visibleWidth(segment);
		if (w > 0) return w;
	}
	return 0;
}

/**
 * Every generated line in a non-empty tool/notification block has a 1-column left margin (" "),
 * except at total width 2 where omitting the margin is necessary to fit an intact two-column
 * grapheme. Note `ToolExecutionComponent` adds one leading `""` spacer line before
 * `selfRenderContainer` lines; we skip that host spacer line and verify every actual rendered row
 * obeys the margin policy and never double-indents (`"  "`). Pass `allowLeadingContentSpaces: true`
 * when literal body lines intentionally start with spaces (e.g. indented bash commands).
 */
function assertSingleLeftMargin(lines, label, { hasHostSpacer = false, allowLeadingContentSpaces = false, totalWidth } = {}) {
	const actual = hasHostSpacer && lines[0] === "" ? lines.slice(1) : lines;
	for (let i = 0; i < actual.length; i++) {
		const line = actual[i];
		if (line.includes("\u001b_G")) continue; // Pi image escape sequence
		const plain = stripAnsi(line);
		if (totalWidth === 2 && !plain.startsWith(" ")) {
			assert.equal(tui.visibleWidth(plain), 2, `${label}: width-2 unmargined line must fit 2-col grapheme: ${JSON.stringify(plain)}`);
			assert.equal(firstPrintingGraphemeWidth(plain), 2, `${label}: margin omitted at width 2 without wide grapheme: ${JSON.stringify(plain)}`);
			continue;
		}
		assert.ok(plain.startsWith(" "), `${label}: missing 1-col left margin in ${JSON.stringify(plain)}`);
		if (!allowLeadingContentSpaces && plain.length > 1 && (i === 0 || plain.trim().length > 0)) {
			assert.ok(!plain.startsWith("  "), `${label}: doubled left margin in ${JSON.stringify(plain)}`);
		}
	}
}

/**
 * No generated decoration: no card corners, no background fills and no expansion instructions.
 * `allowData` keeps literal returned output (which may quote box characters or the word "expand")
 * intact instead of censoring it.
 */
function assertNoGeneratedDecoration(lines, label, allowData = []) {
	for (const line of lines) {
		const plain = stripAnsi(line);
		if (allowData.some((data) => plain.includes(data))) continue;
		assert.doesNotMatch(line, BACKGROUND_SGR, `${label}: background SGR fill in ${JSON.stringify(line)}`);
		assert.doesNotMatch(plain, GENERATED_CARD, `${label}: card border in ${JSON.stringify(plain)}`);
		assert.doesNotMatch(plain, HINT, `${label}: generated expansion hint in ${JSON.stringify(plain)}`);
	}
}

/** Renders one tool row through Pi's real ToolExecutionComponent across its lifecycle. */
function renderRow(h, fixture, options) {
	const { width, expanded = false, isPartial = false, phase = "completed" } = options;
	const { name, args = {}, text = "", details, isError = false, images = [] } = fixture;
	const component = new ToolExecutionComponent(name, `compact-${++callId}`, args, { outputPad: 0 }, h.resolve(name), h.ui, root);

	if (phase === "streaming") return { component, lines: component.render(width) };

	component.markExecutionStarted();
	component.setArgsComplete();
	if (phase === "running") return { component, lines: component.render(width) };

	const content = [];
	if (text !== "") content.push({ type: "text", text });
	for (const image of images) content.push(image);
	component.updateResult({ content, details, isError }, isPartial);
	const lines = component.render(width);

	if (!expanded) return { component, lines };
	component.setExpanded(true);
	return { component, lines: component.render(width) };
}

test("theme resolver presents every inventoried, shipped, dynamic and unknown tool compactly", { skip }, async () => {
	const h = await harness();
	for (const name of ALL_TOOLS) {
		const resolved = h.resolve(name);
		assert.ok(resolved, `${name}: a renderer must resolve`);
		assert.equal(resolved.renderShell, "self", `${name}: rows must render their own unboxed shell`);
		assert.equal(typeof resolved.renderCall, "function", `${name}: call slot required`);
		assert.equal(typeof resolved.renderResult, "function", `${name}: result slot required`);
	}
});

test("coverage fails when a registered tool is missing from the inventory", { skip }, async () => {
	const h = await harness();
	const unscripted = [...h.own.keys()].filter((name) => !ALL_TOOLS.includes(name));
	assert.deepEqual(
		unscripted,
		[],
		`Tool names outside the coverage inventory: ${unscripted.join(", ")}. Extend the inventory; they must not silently keep a decorative renderer.`,
	);
	// The theme registers exactly the four built-ins it owns as tools; the rest stay Pi-owned.
	assert.deepEqual(
		[...h.own.keys()].sort(),
		["bash", "read", "edit", "write", ...FIXTURE_TOOLS].sort(),
		"the theme must register only the four built-ins it owns, plus the fixture owners",
	);
});

test("unmarked owner callbacks are never executed and never leak card frames or hints", { skip }, async () => {
	const h = await harness();
	const store = globalThis.__compactFixture;
	store.unmarkedCallbacks = 0;
	const [unmarked] = namesWithShape("unmarked");
	assert.ok(unmarked, "the fixture must register at least one unmarked owner");

	for (const width of POSITIVE_WIDTHS) {
		for (const expanded of [false, true]) {
			const label = `${unmarked}@${width}${expanded ? " expanded" : ""}`;
			const { lines } = renderRow(h, { name: unmarked, args: { query: "fixture" }, text: "unmarked owner body" }, { width, expanded });
			assertWidthSafe(lines, width, label);
			assertNoGeneratedDecoration(lines, label);
		}
	}
	assert.equal(store.unmarkedCallbacks, 0, "unmarked owner callbacks must not be invoked");

	const collapsed = nonEmpty(renderRow(h, { name: unmarked, args: {}, text: "body" }, { width: 80 }).lines);
	assert.equal(collapsed.length, 1, `collapsed rows must be a single line, got ${JSON.stringify(collapsed)}`);
	const expanded = renderRow(h, { name: unmarked, args: {}, text: "unmarked owner body" }, { width: 80, expanded: true });
	assert.match(expanded.lines.map(stripAnsi).join("\n"), /unmarked owner body/, "fallback expansion keeps returned text");
});

test("throwing and slot-missing owners stay compact and unboxed", { skip }, async () => {
	const h = await harness();
	const names = [...namesWithShape("throwing"), ...namesWithShape("missing-slots")];
	assert.ok(names.length > 0, "the fixture must include throwing and slot-missing owners");

	for (const name of names) {
		for (const expanded of [false, true]) {
			const { lines } = renderRow(h, { name, args: { action: "list" }, text: "owner result text" }, { width: 40, expanded });
			assertWidthSafe(lines, 40, `${name}${expanded ? " expanded" : ""}`);
			assertNoGeneratedDecoration(lines, name);
		}
		const collapsed = nonEmpty(renderRow(h, { name, args: {}, text: "owner result text" }, { width: 80 }).lines);
		assert.equal(collapsed.length, 1, `${name}: collapsed rows must be one line, got ${JSON.stringify(collapsed)}`);
	}
});

test("compliant owners keep specialized presentation and lossless expansion", { skip }, async () => {
	const h = await harness();
	const body = ["first body line", "", "third body line 漢字", "fourth body line"];
	const names = namesWithShape("compliant");
	assert.ok(names.length > 0, "the fixture must register compliant owners");

	for (const name of names) {
		const collapsed = nonEmpty(renderRow(h, { name, args: {}, text: body.join("\n") }, { width: 60 }).lines);
		assert.equal(collapsed.length, 1, `${name}: one inline row when collapsed`);
		assert.match(stripAnsi(collapsed[0]), new RegExp(`${name} summary`), `${name}: specialized summary must survive`);

		const expanded = renderRow(h, { name, args: {}, text: body.join("\n") }, { width: 60, expanded: true }).lines.map(stripAnsi).join("\n");
		for (const line of body) {
			if (line === "") continue;
			assert.ok(expanded.includes(line), `${name}: expanded output must include ${JSON.stringify(line)}`);
		}
		assert.ok(expanded.indexOf("first body line") < expanded.indexOf("fourth body line"), `${name}: body order preserved`);
	}
});

test("built-in rows are compact, width-safe and lossless in both views", { skip }, async () => {
	const h = await harness();
	const longOutput = Array.from({ length: 30 }, (_, index) => `output line ${index + 1}`).join("\n");
	const cases = {
		read: {
			args: { path: "src/render/compact.ts" },
			text: longOutput,
			details: { truncation: { truncated: true, outputLines: 30, totalLines: 90, maxBytes: 51200 } },
		},
		bash: { args: { command: "node --test test/*.test.mjs", timeout: 120 }, text: longOutput },
		powershell: { args: { command: "Get-ChildItem -Recurse", timeout: 120 }, text: longOutput },
		edit: {
			args: { path: "src/render/compact.ts", edits: [{ oldText: "alpha", newText: "beta" }] },
			text: "Successfully replaced 1 block(s).",
			details: { diff: "--- a/x\n+++ b/x\n@@ -1 +1 @@\n-alpha\n+beta\n" },
		},
		write: {
			args: { path: "src/render/compact.ts", content: "export const value = 1;\n".repeat(8) },
			text: "Successfully wrote to src/render/compact.ts",
		},
		grep: { args: { pattern: "registerToolRenderer", path: "extensions" }, text: longOutput },
		find: { args: { pattern: "*.test.mjs", path: "extensions" }, text: longOutput },
		ls: { args: { path: "extensions/j0k3r-theme" }, text: longOutput },
	};

	for (const [name, fixture] of Object.entries(cases)) {
		for (const width of WIDTHS) {
			for (const expanded of [false, true]) {
				const label = `${name}@${width}${expanded ? " expanded" : ""}`;
				const { lines } = renderRow(h, { name, ...fixture }, { width, expanded });
				assertWidthSafe(lines, width, label);
				if (width > 0) assertNoGeneratedDecoration(lines, label);
			}
		}

		const collapsed = nonEmpty(renderRow(h, { name, ...fixture }, { width: 80 }).lines);
		if (name === "bash") {
			assert.ok(collapsed.length >= 2, "bash: header + full orange command lines");
			assert.ok(collapsed.some((l) => l.includes("\x1b[1;38;2;255;140;0m")), "bash: command uses ORANGE foreground");
			assert.ok(collapsed.map(stripAnsi).join("\n").includes(fixture.args.command), "bash: complete command visible");
		} else {
			assert.equal(collapsed.length, 1, `${name}: collapsed row must be a single line, got ${JSON.stringify(collapsed)}`);
		}

		const expanded = renderRow(h, { name, ...fixture }, { width: 80, expanded: true }).lines.map(stripAnsi).join("\n");
		if (name === "edit") {
			assert.ok(expanded.includes("alpha") && expanded.includes("beta"), "edit: diff content must expand");
		} else if (name === "write") {
			assert.ok(expanded.includes("export const value = 1;"), "write: written content must expand");
		} else if (name === "read") {
			for (const line of fixture.text.split("\n")) {
				assert.ok(expanded.includes(line), `read: expanded output must include ${JSON.stringify(line)}`);
			}
		} else {
			for (const line of fixture.text.split("\n")) {
				assert.ok(expanded.includes(line), `${name}: expanded output must include ${JSON.stringify(line)}`);
			}
		}
	}
});

test("every state renders one inline row (except bash command block): streaming, running, partial, success, error, empty, continuation", { skip }, async () => {
	const h = await harness();
	const states = [
		{ label: "streaming", phase: "streaming" },
		{ label: "running", phase: "running" },
		{ label: "partial", isPartial: true, text: "partial output" },
		{ label: "success", text: "some output\nsecond line" },
		{ label: "error", text: "Command exited with code 1", isError: true },
		{ label: "empty", text: "" },
		{ label: "continuation", text: "page one", details: { nextCursor: "cursor-2" } },
	];

	for (const name of ["read", "bash", "grep", "codemode", "agent_todo", "unknown_restored_tool"]) {
		for (const state of states) {
			const { lines } = renderRow(
				h,
				{ name, args: { command: "true", path: "src" }, text: state.text ?? "", details: state.details, isError: state.isError },
				{ width: 60, phase: state.phase, isPartial: state.isPartial },
			);
			const rows = nonEmpty(lines);
			if (name === "bash" && state.phase !== "streaming") {
				assert.ok(rows.length >= 2 && rows.some((l) => l.includes("\x1b[1;38;2;255;140;0m")), `bash/${state.label}: orange command visible`);
			} else if (name === "bash" && state.phase === "streaming") {
				assert.ok(rows.length >= 1, `bash/${state.label}: renders inline`);
			} else {
				assert.equal(rows.length, 1, `${name}/${state.label}: exactly one inline row, got ${JSON.stringify(rows)}`);
			}
			assertNoGeneratedDecoration(lines, `${name}/${state.label}`);
		}
	}

	const withContinuation = renderRow(
		h,
		{ name: "web_search", args: { query: "q" }, text: "page one", details: { nextCursor: "cursor-2" } },
		{ width: 80, expanded: true },
	).lines.map(stripAnsi).join("\n");
	assert.match(withContinuation, /cursor-2/, "continuation metadata must stay reachable when expanded");
});

test("literal returned data is preserved, never censored to fake compliance", { skip }, async () => {
	const h = await harness();
	const literal = ["╭─────────────╮", "│ boxed data  │", "╰─────────────╯", "to expand is what this tool prints itself"];
	for (const name of ["read", "bash", "unknown_restored_tool"]) {
		const { lines } = renderRow(
			h,
			{ name, args: { path: "notes.txt", command: "cat notes.txt" }, text: literal.join("\n") },
			{ width: 80, expanded: true },
		);
		assertWidthSafe(lines, 80, `${name} literal data`);
		const plain = lines.map(stripAnsi).join("\n");
		for (const line of literal) {
			assert.ok(plain.includes(line), `${name}: literal data line must be preserved: ${JSON.stringify(line)}`);
		}
	}
});

test("width 0/1/2 emit no cells or fit exactly; CJK, combining, emoji and OSC links stay inside the width", { skip }, async () => {
	const h = await harness();
	const text = "wide 漢字 combining é emoji 👨‍👩‍👧 link \x1b]8;;https://example.com/very/long/path\x07label\x1b]8;;\x07 end";
	for (const name of ["read", "bash", "agent_todo", "unknown_restored_tool"]) {
		for (const width of [0, 1, 2]) {
			const { lines } = renderRow(h, { name, args: { path: "very/long/path/overflowing" }, text }, { width });
			assertWidthSafe(lines, width, `${name}@${width}`);
		}
		for (const width of [10, 23, 24, 40, 120]) {
			const { lines } = renderRow(h, { name, args: { path: "very/long/path/overflowing", command: "echo wide" }, text }, { width });
			assertWidthSafe(lines, width, `${name}@${width}`);
			assert.doesNotMatch(lines.join(""), /\x00/, "no placeholder cells emitted");
		}
	}
});

test("collapsed/expanded toggles and resizes stay one stable row", { skip }, async () => {
	const h = await harness();
	const component = new ToolExecutionComponent("read", "toggle-1", { path: "file.ts" }, { outputPad: 0 }, h.resolve("read"), h.ui, root);
	component.markExecutionStarted();
	component.updateResult({ content: [{ type: "text", text: "alpha\nbeta\ngamma" }], details: undefined, isError: false }, false);

	assert.equal(nonEmpty(component.render(80)).length, 1, "collapsed once");
	for (let toggle = 0; toggle < 4; toggle++) {
		component.setExpanded(toggle % 2 === 0);
		const lines = component.render(80).map(stripAnsi).join("\n");
		if (toggle % 2 === 0) {
			for (const line of ["alpha", "beta", "gamma"]) assert.ok(lines.includes(line), `expanded must include ${line}`);
		} else {
			assert.equal(nonEmpty(component.render(80)).length, 1, "collapsed again is one row");
		}
	}
	for (const width of [23, 40, 120, 23]) assertWidthSafe(component.render(width), width, `resize ${width}`);
});

test("native expansion stays Pi-owned: click toggles it and renderers never claim key bindings", { skip }, async () => {
	const h = await harness();
	for (const name of ["read", "bash", "agent_todo", "unknown_restored_tool", "mcp__docs__search_docs"]) {
		const definition = h.resolve(name);
		const context = {
				args: {},
				toolCallId: `ctx-${name}`,
				invalidate: () => {},
				lastComponent: undefined,
				state: {},
				cwd: root,
				executionStarted: false,
				argsComplete: true,
				isPartial: false,
				expanded: false,
				showImages: true,
				isError: false,
				outputPad: 0,
			keyText: () => "ctrl+o",
			keyHint: (_id, description) => `ctrl+o ${description}`,
		};
		const theme = { fg: (_color, text) => text, bg: (_color, text) => text, bold: (text) => text };
		const args = { command: "true", path: "src" };
		const result = { content: [{ type: "text", text: "body" }], details: undefined };

		const callComponent = definition.renderCall(args, theme, context);
		assert.equal(callComponent.handleInput, undefined, `${name}: the call slot must not intercept keyboard expansion`);

		const resultComponent = definition.renderResult(result, { expanded: false, isPartial: false }, theme, context);
		assert.equal(resultComponent.handleInput, undefined, `${name}: the result slot must not intercept keyboard expansion`);
	}

	const component = new ToolExecutionComponent("read", "click-1", { path: "file.ts" }, { outputPad: 0 }, h.resolve("read"), h.ui, root);
	component.markExecutionStarted();
	component.updateResult({ content: [{ type: "text", text: "click body" }], details: undefined, isError: false }, false);
	const height = component.render(80).length;
	const event = { type: "click", button: "left", x: 1, y: height - 1, screenX: 1, screenY: height - 1, width: 80, height };
	component.handleMouse(event);
	assert.match(component.render(80).map(stripAnsi).join("\n"), /click body/, "a fullscreen click must expand through Pi's routing");
	component.handleMouse({ ...event, y: component.render(80).length - 1 });
	assert.equal(nonEmpty(component.render(80)).length, 1, "a second click collapses again");
});

test("registration order keeps owner and MCP resolvers composable", { skip }, async () => {
	const h = await harness();
	for (const name of ["mcp__docs__search_docs", "mcp__late_server__late_tool", "list_mcp_resources"]) {
		const resolved = h.resolve(name);
		assert.equal(resolved.renderShell, "self", `${name}: compact shell required regardless of resolver order`);
		const { lines } = renderRow(h, { name, args: { query: "q" }, text: "mcp body" }, { width: 60 });
		assertWidthSafe(lines, 60, name);
		assertNoGeneratedDecoration(lines, name);
		assert.equal(nonEmpty(lines).length, 1, `${name}: one inline row`);
	}

	const reversed = await buildHarness([fixturePath, themeEntry]);
	for (const name of ["read", "mcp__docs__search_docs", "agent_todo", "unknown_restored_tool"]) {
		const resolved = reversed.resolve(name);
		assert.equal(resolved.renderShell, "self", `${name}: reversed load order must stay compact`);
		assert.equal(typeof resolved.renderResult, "function", `${name}: reversed load order keeps both slots`);
	}
});

test("rows stay compact under a changed theme", { skip }, async () => {
	const h = await harness();
	try {
		setTheme("light");
		for (const name of ["read", "bash", "agent_todo"]) {
			const { lines } = renderRow(h, { name, args: { path: "src/render/compact.ts" }, text: "themed body" }, { width: 60 });
			assertWidthSafe(lines, 60, `${name} light theme`);
			assert.equal(nonEmpty(lines).length, 1, `${name}: one inline row under the light theme`);
			assertNoGeneratedDecoration(lines, `${name} light theme`);
		}
	} finally {
		setTheme("dark");
	}
});

test("image results keep the compact text row and Pi's own image rendering", { skip }, async () => {
	const h = await harness();
	const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
	const images = [{ type: "image", data: png, mimeType: "image/png" }];
	for (const name of ["browser_page_screenshot", "screenshot", "read"]) {
		const collapsed = renderRow(h, { name, args: { path: "shot.png" }, text: "captured", images }, { width: 80 });
		assertWidthSafe(collapsed.lines, 80, `${name} with image`);
		assertNoGeneratedDecoration(collapsed.lines, `${name} with image`);
		// The image protocol sequences Pi emits are not renderer text: exclude them before counting rows.
		const textRows = collapsed.lines.filter((line) => stripAnsi(line).trim() !== "" && !line.includes("\u001b_G"));
		assert.equal(textRows.length, 1, `${name}: one compact text row next to the image, got ${JSON.stringify(textRows)}`);

		// Pi renders the image itself from `result.content`; the renderer only supplies the text row,
		// and the returned text stays reachable when expanded.
		const expanded = renderRow(h, { name, args: { path: "shot.png" }, text: "captured", images }, { width: 80, expanded: true });
		assertWidthSafe(expanded.lines, 80, `${name} expanded with image`);
		assert.match(expanded.lines.map(stripAnsi).join("\n"), /captured/, `${name}: returned text stays reachable`);
	}
});

// ============================================================================
// MINI-009: Joined REAL settled owner extensions + CustomMessageComponent + multiline orange bash
// ============================================================================

const EXTENSIONS_ROOT = resolve(dirname(themeEntry), "..");
const REAL_OWNER_DIRS = [
	"j0k3r-theme",
	"agent-todo",
	"api-tools",
	"codegraph",
	"context7",
	"pi-persistent-memory",
	"workspace-services",
	"websearch",
	"youtube-research",
	"browser-screenshot",
	"utils",
	"pdf-review",
	"skill-registry",
	"ask-user-question",
	"workflow-check",
	"orchestrator-supervisor",
	"subagents",
	"git-sync-awareness",
];
const CHILD_INJECTED_TOOLS = new Set(["ask_orchestrator", "report_orchestrator"]);
const EXPECTED_TOP_LEVEL_OWNER_TOOLS = OWNER_TOOLS.filter((name) => !CHILD_INJECTED_TOOLS.has(name));

let realHarnessCached;
async function realOwnerHarness(reverseOrder = false) {
	if (!reverseOrder && realHarnessCached) return realHarnessCached;
	const realRoot = mkdtempSync(join(tmpdir(), "compact-real-owners-"));
	process.on("exit", () => rmSync(realRoot, { recursive: true, force: true }));
	mkdirSync(join(realRoot, ".pi"), { recursive: true });
	writeFileSync(
		join(realRoot, ".pi", "extensions.json"),
		JSON.stringify({
			"api-tools": true,
			"browser-screenshot": true,
			codegraph: true,
			context7: true,
			"pdf-review": true,
			utils: true,
			websearch: true,
			"workspace-services": true,
			"youtube-research": true,
			"orchestrator-supervisor": false,
		}),
	);
	writeFileSync(join(realRoot, ".pi", "skill-registry.config.json"), JSON.stringify({ enabled: true }));
	writeFileSync(
		join(realRoot, ".pi", "api.json"),
		JSON.stringify({
			enabled: true,
			baseUrl: "https://example.invalid",
			swagger: { enabled: true, framework: "node", url: "https://example.invalid/swagger.json" },
			graphql: { enabled: true, framework: "node", url: "https://example.invalid/graphql" },
		}),
	);

	const entries = REAL_OWNER_DIRS.map((dir) => join(EXTENSIONS_ROOT, dir, "index.ts"));
	const orderedEntries = reverseOrder ? [...entries.slice(1), entries[0]] : entries;

	const prevCwd = process.cwd();
	let loaded;
	try {
		process.chdir(realRoot);
		loaded = await loadExtensions(orderedEntries, realRoot);
	} finally {
		process.chdir(prevCwd);
	}

	assert.deepEqual(
		loaded.errors.map((e) => `${e.path}: ${e.error}`),
		[],
		"all 18 real owner extensions must load cleanly on the installed host",
	);

	const own = new Map();
	const messageRenderers = new Map();
	for (const ext of loaded.extensions) {
		for (const [name, reg] of ext.tools) own.set(name, reg.definition);
		for (const [type, renderer] of ext.messageRenderers) messageRenderers.set(type, renderer);
	}
	const runner = new ExtensionRunner(loaded.extensions, createExtensionRuntime(), realRoot, {}, {});
	const h = {
		realRoot,
		loaded,
		own,
		messageRenderers,
		runner,
		ui: { requestRender() {} },
		resolve: (name) => runner.resolveToolRenderers(name, () => withBuiltInRenderers(name, own.get(name))),
	};
	if (!reverseOrder) realHarnessCached = h;
	return h;
}

test("REAL settled owners register all inventoried top-level tools with compact markers and zero unregistered leaks", { skip }, async () => {
	const h = await realOwnerHarness();
	const expected = new Set(["bash", "read", "edit", "write", ...EXPECTED_TOP_LEVEL_OWNER_TOOLS]);
	const registered = new Set(h.own.keys());

	const missing = [...expected].filter((name) => !registered.has(name));
	assert.deepEqual(missing, [], `missing expected real owner tools: ${missing.join(", ")}`);

	const unexpected = [...registered].filter((name) => !expected.has(name));
	assert.deepEqual(unexpected, [], `unexpected unregistered-inventory tools found: ${unexpected.join(", ")}`);

	for (const name of registered) {
		const def = h.own.get(name);
		assert.equal(def.compactToolRenderingVersion, 1, `${name}: real owner must declare compactToolRenderingVersion: 1`);
		assert.equal(def.renderShell, "self", `${name}: real owner must declare renderShell: "self"`);
		assert.equal(typeof def.renderCall, "function", `${name}: renderCall required`);
		assert.equal(typeof def.renderResult, "function", `${name}: renderResult required`);
	}

	// Render every real registered owner tool (plus api_swagger/api_graphql & built-in/shipped/unknown) through real ToolExecutionComponent
	const realRenderTools = [...registered, "powershell", "grep", "find", "ls", "codemode", "tool_search", "unknown_restored_tool"];
	for (const name of realRenderTools) {
		const def = h.resolve(name);
		assert.equal(def.renderShell, "self", `${name}: resolved renderShell must be self`);
		for (const width of [0, 1, 2, 23, 40, 80]) {
			for (const expanded of [false, true]) {
				const comp = new ToolExecutionComponent(
					name,
					`real-${name}-${width}-${expanded}`,
					{ path: "src/app.ts", command: "echo ok", query: "q", action: "list", agent: "analyst", task: "check", change_dir: "/tmp/c" },
					{ outputPad: 0 },
					def,
					h.ui,
					h.realRoot,
				);
				comp.markExecutionStarted();
				comp.setArgsComplete();
				comp.updateResult({ content: [{ type: "text", text: "first result block\n\nsecond line 漢字" }], details: undefined, isError: false }, false);
				comp.setExpanded(expanded);
				const lines = comp.render(width);
				assertWidthSafe(lines, width, `real:${name}@${width}${expanded ? " exp" : ""}`);
				if (width === 1) {
					assert.deepEqual(lines, ["", " "], `real:${name}@1: single 1-col blank row under host spacer`);
				}
				if (width > 0) {
					assertNoGeneratedDecoration(lines, `real:${name}@${width}${expanded ? " exp" : ""}`);
					assertSingleLeftMargin(lines, `real:${name}@${width}${expanded ? " exp" : ""}`, {
						hasHostSpacer: true,
						allowLeadingContentSpaces: name === "bash",
						totalWidth: width,
					});
					if (!expanded && name !== "bash") {
						const rowCount = nonEmpty(lines).length;
						if (width >= 3) {
							assert.equal(rowCount, 1, `real:${name}@${width}: collapsed must be 1 row, got ${JSON.stringify(nonEmpty(lines))}`);
						} else {
							assert.ok(rowCount <= 1, `real:${name}@${width}: collapsed must be at most 1 row, got ${JSON.stringify(nonEmpty(lines))}`);
						}
					}
					if (expanded && width >= 40) {
						const plain = lines.map(stripAnsi).join("\n");
						assert.ok(plain.includes("first result block") && plain.includes("second line"), `real:${name}: expanded output must be complete`);
					} else if (expanded && width >= 3) {
						const compactPlain = lines.map(stripAnsi).map((l) => l.slice(1)).join("").replace(/\s+/g, "");
						assert.ok(compactPlain.includes("firstresultblock") && compactPlain.includes("secondline"), `real:${name}: wrapped output complete at width ${width}`);
					}
				}
			}
		}
	}

	// Reversed load order keeps every real owner compliant
	const reversed = await realOwnerHarness(true);
	for (const name of realRenderTools) {
		assert.equal(reversed.resolve(name).renderShell, "self", `reversed:${name}: must stay compact`);
	}
});

test("REAL CustomMessageComponent renders subagent-completion and git-sync-awareness unboxed, hint-free, width-safe and coherently expandable", { skip }, async () => {
	const h = await realOwnerHarness();
	const completionRenderer = h.messageRenderers.get("subagent-completion");
	const gitSyncRenderer = h.messageRenderers.get("git-sync-awareness");
	assert.equal(typeof completionRenderer, "function", "subagent-completion message renderer must be registered");
	assert.equal(typeof gitSyncRenderer, "function", "git-sync-awareness message renderer must be registered");

	// 1. subagent-completion via real CustomMessageComponent
	const longResponse = Array.from({ length: 12 }, (_, i) => `completion line ${i + 1} 漢字 👨‍👩‍👧`).join("\n")
		+ "\n╭─ literal box ─╮\nctrl+o to expand is literal data";
	const completionMsg = {
		type: "custom",
		customType: "subagent-completion",
		content: "fallback content",
		display: true,
		details: {
			full_result: longResponse,
			task: {
				id: "subtask_real_comp",
				agent: "deep-researcher",
				status: "completed",
				model: "cliproxy/model-x",
				effort: "high",
				attempt: 2,
			},
		},
	};
	const compWidget = new CustomMessageComponent(completionMsg, completionRenderer);
	const colComp = compWidget.render(120);
	assertNoGeneratedDecoration(colComp, "real subagent-completion collapsed", ["╭─ literal box ─╮", "ctrl+o to expand is literal data"]);
	assertWidthSafe(colComp, 120, "real subagent-completion collapsed");
	assertSingleLeftMargin(colComp, "real subagent-completion collapsed", { hasHostSpacer: true });
	assert.equal(nonEmpty(colComp).length, 1, "subagent-completion collapsed must be 1 row");
	const colPlain = stripAnsi(colComp.join("\n"));
	assert.equal((colPlain.match(/\[subagent\]/g) ?? []).length, 1);
	assert.equal((colPlain.match(/model:/g) ?? []).length, 1);
	assert.equal((colPlain.match(/effort:/g) ?? []).length, 1);
	assert.equal((colPlain.match(/attempt:/g) ?? []).length, 1);
	assert.equal((colPlain.match(/subagent:/g) ?? []).length, 0);

	// Expand/collapse toggles and invalidate()
	for (const exp of [true, false, true]) {
		compWidget.setExpanded(exp);
		compWidget.invalidate();
		const rendered = compWidget.render(60);
		assertWidthSafe(rendered, 60, `real subagent-completion exp=${exp}`);
		assertNoGeneratedDecoration(rendered, `real subagent-completion exp=${exp}`, ["╭─ literal box ─╮", "ctrl+o to expand is literal data"]);
		const plain = stripAnsi(rendered.join("\n"));
		if (exp) {
			assert.ok(plain.includes("completion line 1") && plain.includes("completion line 12"), "complete response reachable");
			assert.ok(plain.includes("╭─ literal box ─╮"), "literal box chars kept");
			assert.ok(plain.includes("ctrl+o to expand is literal data"), "literal hint-like text kept");
		}
	}

	// Missing details fallback never enters CustomMessageComponent's default purple Box
	const legacyComp = new CustomMessageComponent({ type: "custom", customType: "subagent-completion", content: "Legacy content", display: true }, completionRenderer);
	const legacyLines = legacyComp.render(80);
	assertNoGeneratedDecoration(legacyLines, "subagent-completion legacy collapsed");
	assert.equal(nonEmpty(legacyLines).length, 1);
	legacyComp.setExpanded(true);
	assert.match(stripAnsi(legacyComp.render(80).join("\n")), /Legacy content/);

	// Width matrix on subagent-completion renderer
	for (const width of WIDTHS) {
		for (const expanded of [false, true]) {
			const lines = completionRenderer(completionMsg, { expanded }, { fg: (_k, t) => t }).render(width);
			assertWidthSafe(lines, width, `subagent-completion@${width} exp=${expanded}`);
			if (width === 1) assert.deepEqual(lines, [" "], `subagent-completion@1 exp=${expanded}`);
			if (width > 1) assertSingleLeftMargin(lines, `subagent-completion@${width} exp=${expanded}`, { totalWidth: width });
		}
	}

	// 2. git-sync-awareness via real CustomMessageComponent
	const home = process.env.HOME || "/home/j0k3r";
	const gitDiag = {
		timestamp: Date.now(),
		fetchSuccess: true,
		currentBranch: {
			branch: "feature/compact-notif",
			upstream: "origin/feature/compact-notif",
			syncStatus: "BEHIND",
			ahead: 0,
			behind: 7,
			incomingCommits: Array.from({ length: 7 }, (_, i) => `c${i + 1} commit`),
		},
		otherLocalBranches: [],
		remoteBranches: Array.from({ length: 7 }, (_, i) => `origin/r-${i + 1}`),
		remoteOnlyBranches: ["origin/r-7"],
		activeCollaboratorBranches: Array.from({ length: 6 }, (_, i) => `origin/c-${i + 1}`),
		workingTree: {
			isClean: false,
			modifiedCount: 6,
			untrackedCount: 0,
			stagedCount: 0,
			summaryLines: Array.from({ length: 6 }, (_, i) => ` M f-${i + 1}.ts`),
		},
		worktree: {
			isMainWorktree: false,
			currentWorktreePath: `${home}/wt/current`,
			mainWorktreePath: `${home}/wt/main`,
			worktrees: [
				{ path: `${home}/wt/main`, head: "1111111", branch: "main", isCurrent: false, isMain: true },
				{ path: `${home}/wt/current`, head: "2222222", branch: "feature/compact-notif", isCurrent: true, isMain: false },
			],
		},
		isBranchPolicyCompliant: true,
		requiresDecision: true,
		formattedReport: "Behind",
	};
	const gitMsg = { type: "custom", customType: "git-sync-awareness", content: "Behind", display: true, details: gitDiag };
	const gitWidget = new CustomMessageComponent(gitMsg, gitSyncRenderer);
	const gitCol = gitWidget.render(80);
	assertNoGeneratedDecoration(gitCol, "real git-sync collapsed");
	assertWidthSafe(gitCol, 80, "real git-sync collapsed");
	assertSingleLeftMargin(gitCol, "real git-sync collapsed", { hasHostSpacer: true });
	assert.equal(nonEmpty(gitCol).length, 1, "git-sync collapsed must be 1 row");

	// Click + native setExpanded coherence: host setExpanded rebuilds cleanly with options.expanded
	const directInstance = gitSyncRenderer(gitMsg, { expanded: false });
	directInstance.handleMouse({ type: "click", button: "left", x: 1, y: 0 });
	assert.ok(directInstance.render(80).length > 5, "direct click expands");
	gitWidget.setExpanded(true);
	const gitExpPlain = stripAnsi(gitWidget.render(80).join("\n"));
	assertNoGeneratedDecoration(gitWidget.render(80), "real git-sync expanded");
	assert.match(gitExpPlain, /c7 commit/);
	assert.match(gitExpPlain, /f-6\.ts/);
	assert.match(gitExpPlain, /origin\/c-6/);
	assert.match(gitExpPlain, /origin\/r-7/);
	assert.match(gitExpPlain, /~\/wt\/current/);
	gitWidget.setExpanded(false);
	assert.equal(nonEmpty(gitWidget.render(80)).length, 1, "host setExpanded(false) rebuild collapses cleanly");

	// Missing details fallback never enters CustomMessageComponent default purple Box
	const gitFallbackWidget = new CustomMessageComponent(
		{ type: "custom", customType: "git-sync-awareness", content: "⚠️ Git offline\nline 2", display: true },
		gitSyncRenderer,
	);
	assertNoGeneratedDecoration(gitFallbackWidget.render(80), "git-sync fallback collapsed");
	assert.equal(nonEmpty(gitFallbackWidget.render(80)).length, 1);
	gitFallbackWidget.setExpanded(true);
	assertNoGeneratedDecoration(gitFallbackWidget.render(80), "git-sync fallback expanded");
	assert.match(stripAnsi(gitFallbackWidget.render(80).join("\n")), /line 2/);
});

test("REAL bash multiline orange command matrix via ToolExecutionComponent (all states, widths, toggles, literal data)", { skip }, async () => {
	const h = await realOwnerHarness();
	const def = h.resolve("bash");
	const longSegment = "echo " + "w".repeat(95);
	const multilineCommand = `printf 'hello\\nworld'\n\n# ╭─ keep box ─╮ to expand\n${longSegment}`;

	for (const [label, phase, isPartial, isError, details] of [
		["streaming", "streaming", false, false, undefined],
		["running", "running", false, false, undefined],
		["partial", "result", true, false, undefined],
		["completed", "result", false, false, undefined],
		["failed", "result", false, true, undefined],
		["cancelled", "result", false, true, { cancelled: true }],
	]) {
		for (const width of [0, 1, 2, 10, 23, 24, 40, 80]) {
			const comp = new ToolExecutionComponent(
				"bash",
				`bash-ml-${label}-${width}`,
				{ command: multilineCommand, timeout: 120 },
				{ outputPad: 0 },
				def,
				h.ui,
				h.realRoot,
			);
			if (phase !== "streaming") {
				comp.markExecutionStarted();
				comp.setArgsComplete();
			}
			if (phase === "result") {
				comp.updateResult(
					{ content: [{ type: "text", text: "out line 1\n\nout line 3" }], details, isError },
					isPartial,
				);
			}
			const col = comp.render(width);
			assertWidthSafe(col, width, `bash-ml ${label}@${width}`);
			if (width === 1) {
				assert.deepEqual(col, ["", " "], `bash-ml ${label}@1: single 1-col blank row under host spacer`);
			}
			if (width >= 2 && phase !== "streaming") {
				if (width >= 30) {
					assertNoGeneratedDecoration(col, `bash-ml ${label}@${width}`, ["# ╭─ keep box ─╮ to expand"]);
				} else {
					assert.doesNotMatch(col.join("\n"), BACKGROUND_SGR, `bash-ml ${label}@${width}: no background SGR`);
				}
				assertSingleLeftMargin(col, `bash-ml ${label}@${width}`, { hasHostSpacer: true, allowLeadingContentSpaces: true, totalWidth: width });
				assert.ok(col.some((l) => l.includes("\x1b[1;38;2;255;140;0m")), `bash-ml ${label}@${width}: ORANGE command`);
				if (width >= 10) {
					const plain = stripAnsi(col.join("\n"));
					const unmarginedLines = col.slice(1).map((l) => stripAnsi(l).slice(1));
					const unmargined = unmarginedLines.join("\n");
					assert.ok(unmargined.replace(/\n/g, "").includes("printf 'hello\\nworld'") || unmargined.replace(/\s+/g, "").includes("printf'hello\\nworld'"), `${label}@${width}: literal \\n kept`);
					assert.ok(unmargined.replace(/\n/g, "").includes("w".repeat(95)), `${label}@${width}: full long line kept`);
					assert.ok(!plain.includes("…"), `${label}@${width}: no ellipsis`);
					assert.ok(unmarginedLines.includes(""), `${label}@${width}: blank line preserved`);
				}
			}
			comp.setExpanded(true);
			const exp = comp.render(width);
			assertWidthSafe(exp, width, `bash-ml exp ${label}@${width}`);
			if (width >= 20 && phase === "result") {
				const plainExp = stripAnsi(exp.join("\n"));
				assert.ok(plainExp.includes("out line 1") && plainExp.includes("out line 3"), `bash-ml exp ${label}: output complete`);
			}
			comp.setExpanded(false);
		}
	}

	// Exact whitespace/newline/tab/quote/backslash preservation regression on soft-wrap
	const exactCmd = "\n    lead_" + "q".repeat(35) + "   \n\tquote \"a'b\" \\\\ 'x\\ny'\n\n  end   ";
	const exactComp = new ToolExecutionComponent("bash", "bash-exact-ws", { command: exactCmd, timeout: 120 }, { outputPad: 0 }, def, h.ui, h.realRoot);
	exactComp.markExecutionStarted();
	exactComp.setArgsComplete();
	exactComp.updateResult({ content: [{ type: "text", text: "done" }], details: undefined, isError: false }, false);
	for (const exp of [false, true]) {
		exactComp.setExpanded(exp);
		const raw = exactComp.render(20);
		assertWidthSafe(raw, 20, `bash exact-ws exp=${exp}`);
		assertSingleLeftMargin(raw, `bash exact-ws exp=${exp}`, { hasHostSpacer: true, allowLeadingContentSpaces: true });
		const plainLines = raw.map(stripAnsi);
		// Note ToolExecutionComponent adds 1 leading empty spacer line, then header, then command lines
		const cmdStart = plainLines.findIndex((l) => l.startsWith(" $"));
		assert.ok(cmdStart >= 0, `expected header starting with " $", got ${JSON.stringify(plainLines)}`);
		const unmargined = plainLines.slice(cmdStart + 1).map((l) => l.slice(1));
		assert.equal(unmargined[0], "", "leading blank line preserved");
		assert.ok(unmargined[1].startsWith("    lead_"), `leading spaces preserved on wrap: ${JSON.stringify(unmargined[1])}`);
		const unwrappedLead = unmargined.slice(1, 4).join("");
		assert.equal(unwrappedLead, "    lead_" + "q".repeat(35) + "   ", "trailing spaces preserved across soft-wrap");
		const unwrappedTab = unmargined.slice(4, 6).join("");
		assert.equal(unwrappedTab, "   quote \"a'b\" \\\\ 'x\\ny'", "tabs, quotes, backslashes and literal \\n preserved verbatim");
		assert.equal(unmargined[6], "", "internal blank line preserved");
		assert.equal(unmargined[7], "  end   ", "leading/trailing spaces on short line preserved");
	}
});

test("MINI-008: remapped native app.tools.expand keybinding toggles real host tool output expansion and collapse", { skip }, async () => {
	const h = await realOwnerHarness();
	const agentDir = mkdtempSync(join(tmpdir(), "compact-remapped-kb-"));
	const prevAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = agentDir;
	try {
		// Remap app.tools.expand away from default ctrl+o to ctrl+e.
		writeFileSync(join(agentDir, "keybindings.json"), JSON.stringify({ "app.tools.expand": "ctrl+e" }));

		const settingsManager = SettingsManager.inMemory();
		const sessionManager = SessionManager.inMemory(h.realRoot);
		const runtimeHost = {
			session: {
				settingsManager,
				sessionManager,
				modelRegistry: { getAvailable: () => [], getError: () => undefined, isUsingOAuth: () => false },
				resourceLoader: { getThemes: () => ({ themes: [] }) },
				agent: { state: { thinkingLevel: "off" } },
				autoCompactionEnabled: false,
				cwd: h.realRoot,
				isStreaming: false,
				isBashRunning: false,
				getActiveToolNames: () => ["read", "bash"],
				getContextUsage: () => undefined,
				model: undefined,
				extensionRunner: h.runner,
			},
			setBeforeSessionInvalidate() {},
			setRebindSession() {},
		};
		let emitInput;
		const terminal = {
			start(onInput) { emitInput = onInput; },
			stop() {},
			write() {},
			setTitle() {},
			columns: 80,
			rows: 24,
			kittyProtocolActive: false,
			moveBy() {},
			hideCursor() {},
			showCursor() {},
			clearLine() {},
			clearFromCursor() {},
			clearScreen() {},
		};

		const mode = new InteractiveMode(runtimeHost, { terminal });
		mode.ui.start();
		try {
			mode.setupKeyHandlers();
			mode.ui.setFocus(mode.defaultEditor);
			assert.deepEqual(mode.keybindings.getKeys("app.tools.expand"), ["ctrl+e"]);

			const readComp = new ToolExecutionComponent(
				"read",
				"kb-read-1",
				{ path: "src/app.ts" },
				{ outputPad: 0 },
				h.resolve("read"),
				mode.ui,
				h.realRoot,
			);
			readComp.markExecutionStarted();
			readComp.setArgsComplete();
			readComp.updateResult({ content: [{ type: "text", text: "remapped line 1\nremapped line 2\nremapped line 3" }], details: undefined, isError: false }, false);

			const bashComp = new ToolExecutionComponent(
				"bash",
				"kb-bash-1",
				{ command: "echo hi\necho there", timeout: 120 },
				{ outputPad: 0 },
				h.resolve("bash"),
				mode.ui,
				h.realRoot,
			);
			bashComp.markExecutionStarted();
			bashComp.setArgsComplete();
			bashComp.updateResult({ content: [{ type: "text", text: "bash out alpha\nbash out beta" }], details: undefined, isError: false }, false);

			mode.chatContainer.addChild(readComp);
			mode.chatContainer.addChild(bashComp);

			// Old default ctrl+o (\x0f) must NOT expand when remapped to ctrl+e.
			emitInput("\x0f");
			assert.equal(nonEmpty(readComp.render(80)).length, 1, "unmapped ctrl+o leaves read collapsed");
			assert.doesNotMatch(stripAnsi(bashComp.render(80).join("\n")), /bash out alpha/, "unmapped ctrl+o leaves bash output collapsed");

			// Remapped ctrl+e (\x05) expands through InteractiveMode -> CustomEditor.onAction -> setToolsExpanded.
			emitInput("\x05");
			const readExp = stripAnsi(readComp.render(80).join("\n"));
			assert.ok(readExp.includes("remapped line 1") && readExp.includes("remapped line 2") && readExp.includes("remapped line 3"), "remapped ctrl+e expands complete read output");
			const bashExp = stripAnsi(bashComp.render(80).join("\n"));
			assert.ok(bashExp.includes("bash out alpha") && bashExp.includes("bash out beta"), "remapped ctrl+e expands complete bash output");

			// Repeated toggles stay coherent.
			emitInput("\x05");
			assert.equal(nonEmpty(readComp.render(80)).length, 1, "second ctrl+e collapses read back to 1 row");
			assert.doesNotMatch(stripAnsi(bashComp.render(80).join("\n")), /bash out alpha/, "second ctrl+e collapses bash output");

			emitInput("\x05");
			assert.match(stripAnsi(readComp.render(80).join("\n")), /remapped line 3/, "third ctrl+e re-expands read losslessly");
			emitInput("\x05");
			assert.equal(nonEmpty(readComp.render(80)).length, 1, "fourth ctrl+e collapses read again");
		} finally {
			mode.ui.stop();
		}
	} finally {
		if (prevAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = prevAgentDir;
		tui.setKeybindings(new tui.KeybindingsManager({}, {}));
		rmSync(agentDir, { recursive: true, force: true });
	}
});

test("REAL bash CR/CRLF retention and width-2 wide-grapheme exception across theme, fallback, and notifications", { skip }, async () => {
	const h = await realOwnerHarness();
	const bashDef = h.resolve("bash");

	// 1. Raw CR/CRLF retention on real ToolExecutionComponent
	const crCommand = "A\r\nB\rC\r\n\r\nD\r";
	const crComp = new ToolExecutionComponent("bash", "bash-cr-1", { command: crCommand, timeout: 120 }, { outputPad: 0 }, bashDef, h.ui, h.realRoot);
	crComp.markExecutionStarted();
	crComp.setArgsComplete();
	crComp.updateResult({ content: [{ type: "text", text: "ok" }], details: undefined, isError: false }, false);
	for (const exp of [false, true]) {
		crComp.setExpanded(exp);
		const lines = crComp.render(80);
		assertWidthSafe(lines, 80, `bash-cr exp=${exp}`);
		const plain = lines.slice(1).map((l) => stripAnsi(l));
		const cmdStart = plain.findIndex((l) => l.startsWith(" $"));
		const cmdEnd = exp ? plain.findIndex((l, idx) => idx > cmdStart && l.includes("ok")) : plain.length;
		const recovered = plain.slice(cmdStart + 1, cmdEnd).map((l) => l.slice(1)).join("\n");
		assert.equal(recovered, crCommand, `exp=${exp}: exact CR/CRLF command must survive without normalization`);
	}

	// 2. Width 2: A漢B and wide emoji/combining sequences retain every grapheme intact across theme bash, read, unknown fallback, and notifications
	const wideInput = "A漢B👨‍👩‍👧e\u0301";
	const bashWide = new ToolExecutionComponent("bash", "bash-wide-2", { command: wideInput, timeout: 120 }, { outputPad: 0 }, bashDef, h.ui, h.realRoot);
	bashWide.markExecutionStarted();
	bashWide.setArgsComplete();
	bashWide.updateResult({ content: [{ type: "text", text: "Z漢W" }], details: undefined, isError: false }, false);
	bashWide.setExpanded(true);
	const bashLines2 = bashWide.render(2);
	assertWidthSafe(bashLines2, 2, "bash-wide@2");
	assertSingleLeftMargin(bashLines2, "bash-wide@2", { hasHostSpacer: true, allowLeadingContentSpaces: true, totalWidth: 2 });
	const bashPlain2 = bashLines2.slice(1).map(stripAnsi);
	assert.ok(bashPlain2.includes("漢"), "bash@2 must retain 漢 intact");
	assert.ok(bashPlain2.includes("👨‍👩‍👧"), "bash@2 must retain 👨‍👩‍👧 intact");
	assert.ok(bashPlain2.includes(" e\u0301"), "bash@2 must keep 1-col margin for e\\u0301");
	assert.ok(bashPlain2.includes(" A") && bashPlain2.includes(" B"), "bash@2 must keep 1-col margin for A and B");
	assert.ok(bashPlain2.includes(" Z") && bashPlain2.includes(" W"), "bash@2 expanded output keeps 1-col margin for Z and W");

	for (const toolName of ["read", "unknown_restored_tool"]) {
		const comp = new ToolExecutionComponent(toolName, `wide-${toolName}`, { path: "f.ts" }, { outputPad: 0 }, h.resolve(toolName), h.ui, h.realRoot);
		comp.markExecutionStarted();
		comp.setArgsComplete();
		comp.updateResult({ content: [{ type: "text", text: wideInput }], details: undefined, isError: false }, false);
		comp.setExpanded(true);
		const lines2 = comp.render(2);
		assertWidthSafe(lines2, 2, `${toolName}-wide@2`);
		assertSingleLeftMargin(lines2, `${toolName}-wide@2`, { hasHostSpacer: true, totalWidth: 2 });
		const plain2 = lines2.slice(1).map(stripAnsi);
		assert.ok(plain2.includes("漢"), `${toolName}@2 must retain 漢`);
		assert.ok(plain2.includes("👨‍👩‍👧"), `${toolName}@2 must retain 👨‍👩‍👧`);
		assert.ok(plain2.includes(" e\u0301"), `${toolName}@2 must retain e\\u0301 with margin`);
		assert.ok(plain2.includes(" A") && plain2.includes(" B"), `${toolName}@2 must retain A and B with margin`);
	}

	// 3. Notifications (subagent-completion + git-sync-awareness) at width 2
	const completionRenderer = h.messageRenderers.get("subagent-completion");
	const compMsg2 = completionRenderer({
		customType: "subagent-completion",
		content: "",
		details: { full_result: wideInput, task: { id: "t-w2", agent: "analyst", status: "completed" } },
	}, { expanded: true }, { fg: (_k, t) => t }).render(2);
	assertWidthSafe(compMsg2, 2, "subagent-completion-wide@2");
	assertSingleLeftMargin(compMsg2, "subagent-completion-wide@2", { totalWidth: 2 });
	const compPlain2 = compMsg2.map(stripAnsi);
	assert.ok(compPlain2.includes("漢") && compPlain2.includes("👨‍👩‍👧") && compPlain2.includes(" A") && compPlain2.includes(" B"), "subagent-completion@2 keeps wide and narrow graphemes");

	const gitSyncRenderer = h.messageRenderers.get("git-sync-awareness");
	const gitMsg2 = gitSyncRenderer({
		customType: "git-sync-awareness",
		content: wideInput,
	}, { expanded: true }).render(2);
	assertWidthSafe(gitMsg2, 2, "git-sync-wide@2");
	assertSingleLeftMargin(gitMsg2, "git-sync-wide@2", { totalWidth: 2 });
	const gitPlain2 = gitMsg2.map(stripAnsi);
	assert.ok(gitPlain2.includes("漢") && gitPlain2.includes("👨‍👩‍👧") && gitPlain2.includes(" A") && gitPlain2.includes(" B"), "git-sync-awareness@2 keeps wide and narrow graphemes");
});
