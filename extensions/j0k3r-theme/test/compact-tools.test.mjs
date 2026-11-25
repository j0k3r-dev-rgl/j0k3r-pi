/**
 * Theme-local contract tests for the compact tool presentation (compact-tool-rendering MINI-002).
 *
 * These cover the behavior that does not need the installed host: the pinned marker, universal
 * fallback decisions, display-only path abbreviation, the preserved bash timeout wrapper and the
 * compact row's width/lossless rules. Host loader coverage lives in test/compact-tools-host.test.mjs.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";

initTheme("dark");

// Test-harness-only correction: transform mode plus the repo's `.js` -> `.ts` convention keeps this
// extension's TypeScript loadable under `node --test` strip-only mode, without touching manifests,
// tsconfig or production code.
registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier.startsWith(".") && specifier.endsWith(".js")) {
			try {
				const filePath = fileURLToPath(new URL(specifier, context.parentURL));
				if (!existsSync(filePath)) {
					const tsPath = filePath.replace(/\.js$/, ".ts");
					if (existsSync(tsPath)) return { shortCircuit: true, url: pathToFileURL(tsPath).href };
				}
			} catch {}
		}
		return nextResolve(specifier, context);
	},
	load(url, context, nextLoad) {
		const result = nextLoad(url, context);
		if (!url.startsWith("file:") || !url.endsWith(".ts") || result.source === undefined) return result;
		const source = typeof result.source === "string" ? result.source : Buffer.from(result.source).toString("utf8");
		return { ...result, format: "module", source: stripTypeScriptTypes(source, { mode: "transform", sourceUrl: url }) };
	},
});

const {
	COMPACT_TOOL_RENDERING_KEY,
	COMPACT_TOOL_RENDERING_VERSION,
	CompactToolRow,
	abbreviateHome,
	createFallbackRenderers,
	expandedLines,
	isCompactCompliant,
	isSelfRendered,
	resultText,
	summarizeArgs,
	wrapLeftMarginComponent,
} = await import("../src/render/compact.ts");
const { registerCompactToolRenderer } = await import("../src/render/resolver.ts");
const { DEFAULT_BASH_TIMEOUT_SECONDS, applyBashTimeout, registerNativeToolOverrides, resolveBashTimeout } = await import(
	"../src/tools/index.ts",
);
const { bashRenderers, createShellRenderers, powershellRenderers } = await import("../src/render/bashRenderer.ts");
const {
	editRenderers,
	findRenderers,
	grepRenderers,
	lsRenderers,
	readRenderers,
	writeRenderers,
} = await import("../src/render/nativeToolRenderers.ts");

const theme = { fg: (_color, text) => text, bg: (_color, text) => text, bold: (text) => text };
const CUSTOM_MUTED_ANSI = "\x1b[38;2;111;122;133m";
const customTheme = {
	fg: (color, text) => (color === "muted" ? `${CUSTOM_MUTED_ANSI}${text}\x1b[39m` : text),
	bg: (_color, text) => text,
	bold: (text) => text,
};
const ARCH_MUTED_ANSI = "\x1b[38;2;122;167;184m";
const strip = (lines) => lines.map((line) => line.replace(/\x1b\[[0-9;]*m/g, ""));

function context(overrides = {}) {
	return {
		args: {},
		toolCallId: "ctx",
		invalidate: () => {},
		lastComponent: undefined,
		state: {},
		cwd: "/tmp",
		executionStarted: false,
		argsComplete: true,
		isPartial: false,
		expanded: false,
		showImages: true,
		isError: false,
		outputPad: 0,
		keyText: () => "",
		keyHint: () => "",
		...overrides,
	};
}

function fakePi() {
	const tools = new Map();
	const resolvers = [];
	return {
		tools,
		resolvers,
		registerTool: (tool) => tools.set(tool.name, tool),
		registerToolRenderer: (resolver) => resolvers.push(resolver),
		on: () => {},
		registerMarkdownTransformer: () => {},
	};
}

const resolveWith = (resolver, toolName, next) => resolver(toolName, next);

test("only a fully conforming definition is recognized as compact", () => {
	const slots = { renderCall: () => ({ render: () => [], invalidate() {} }), renderResult: () => ({ render: () => [], invalidate() {} }) };
	assert.equal(isCompactCompliant({}), false, "unmarked definitions are not compliant");
	assert.equal(isCompactCompliant({ [COMPACT_TOOL_RENDERING_KEY]: 1 }), true, "the pinned marker is recognized");
	assert.equal(isCompactCompliant({ [COMPACT_TOOL_RENDERING_KEY]: 2 }), false, "only version 1 is pinned");
	assert.equal(isSelfRendered({ [COMPACT_TOOL_RENDERING_KEY]: 1, renderShell: "default", ...slots }), false, "default shell is not self-rendered");
	assert.equal(isSelfRendered({ [COMPACT_TOOL_RENDERING_KEY]: 1, renderShell: "self", ...slots }), true, "marker + self shell + both slots");
	assert.equal(isSelfRendered({ [COMPACT_TOOL_RENDERING_KEY]: 1, renderShell: "self", renderCall: slots.renderCall }), false, "a missing result slot is not compliant");
});

test("theme-owned built-ins carry the pinned marker and self shell", () => {
	const pi = fakePi();
	registerNativeToolOverrides(pi, "/tmp/project");
	assert.deepEqual([...pi.tools.keys()], ["bash", "read", "edit", "write"]);
	for (const [name, tool] of pi.tools) {
		assert.equal(tool[COMPACT_TOOL_RENDERING_KEY], COMPACT_TOOL_RENDERING_VERSION, `${name}: marker`);
		assert.equal(tool.renderShell, "self", `${name}: self shell`);
		assert.equal(typeof tool.renderCall, "function", `${name}: call slot`);
		assert.equal(typeof tool.renderResult, "function", `${name}: result slot`);
	}
});

test("bash keeps its default timeout wrapper and explicit timeouts pass through", () => {
	const pi = fakePi();
	registerNativeToolOverrides(pi, "/tmp/project");
	assert.equal(DEFAULT_BASH_TIMEOUT_SECONDS, 120, "the theme's bash default timeout is unchanged");

	assert.equal(resolveBashTimeout(undefined), DEFAULT_BASH_TIMEOUT_SECONDS, "omitted timeout uses the theme default");
	assert.equal(resolveBashTimeout(0), DEFAULT_BASH_TIMEOUT_SECONDS, "zero is not a valid timeout");
	assert.equal(resolveBashTimeout(-5), DEFAULT_BASH_TIMEOUT_SECONDS, "negative is not a valid timeout");
	assert.equal(resolveBashTimeout(300), 300, "an explicit positive timeout passes through");

	assert.deepEqual(applyBashTimeout({ command: "npm test" }), { command: "npm test", timeout: DEFAULT_BASH_TIMEOUT_SECONDS });
	assert.deepEqual(applyBashTimeout({ command: "npm test", timeout: 30 }), { command: "npm test", timeout: 30 });
	assert.equal(applyBashTimeout({ command: "npm test" }).command, "npm test", "the command is never rewritten");

	// The registered bash definition keeps executing through the theme wrapper.
	assert.equal(typeof pi.tools.get("bash").execute, "function");
});

test("powershell keeps one compact shell row while bash renders concise status plus full orange command", () => {
	const psComponent = createShellRenderers("PS>").renderCall({ command: "echo hi", timeout: 120 }, theme, context());
	const psLines = strip(psComponent.render(80));
	assert.equal(psLines.length, 1, "powershell call slot is one row");
	assert.match(psLines[0], /PS> echo hi/);
	assert.match(psLines[0], /timeout 120s/);

	const bashComponent = bashRenderers.renderCall({ command: "echo first\n\necho third", timeout: 120 }, theme, context());
	const rawBashLines = bashComponent.render(80);
	const plainBashLines = strip(rawBashLines);
	assert.match(plainBashLines[0], /^ \$ .*timeout 120s/);
	assert.equal(plainBashLines[1], " echo first");
	assert.equal(plainBashLines[2], " ");
	assert.equal(plainBashLines[3], " echo third");
	assert.ok(rawBashLines[1].includes("\x1b[1;38;2;255;140;0m"), "command lines use existing ORANGE foreground");
	assert.ok(rawBashLines[3].includes("\x1b[1;38;2;255;140;0m"), "trailing command line uses existing ORANGE foreground");
});

test("bash renders complete multiline/long commands in orange across all states and widths without clipping or hints", () => {
	const longLine = "echo " + "abcdefghij".repeat(6);
	const literalCmd = "printf 'a\\nb'\n\n# ╭─ box ─╮ ctrl+o to expand\n" + longLine;

	// Streaming before command arrives
	const streaming = strip(bashRenderers.renderCall({}, theme, context()).render(80));
	assert.equal(streaming.length, 1);
	assert.match(streaming[0], /^ \$/);

	for (const [label, opts, ctxOverrides] of [
		["partial-collapsed", { expanded: false, isPartial: true }, {}],
		["completed-collapsed", { expanded: false, isPartial: false }, {}],
		["failed-collapsed", { expanded: false, isPartial: false }, { isError: true }],
		["completed-expanded", { expanded: true, isPartial: false }, {}],
	]) {
		const ctx = context({ args: { command: literalCmd, timeout: 120 }, ...ctxOverrides });
		const comp = bashRenderers.renderResult(
			{ content: [{ type: "text", text: "stdout line 1\nstdout line 2" }], details: undefined },
			opts,
			theme,
			ctx,
		);
		assert.deepEqual(comp.render(0), [], `${label}: width 0 emits no cells`);
		assert.deepEqual(comp.render(1), [" "], `${label}: width 1 emits blank one-column row`);
		for (const width of [1, 2, 10, 23, 40, 80]) {
			const raw = comp.render(width);
			for (const line of raw) {
				assert.ok(visibleWidth(line) <= width, `${label}@${width}: overflow`);
				assert.ok(strip([line])[0].startsWith(" "), `${label}@${width}: 1-char left margin required`);
			}
		}
		const raw24 = comp.render(24);
		const plain24Lines = strip(raw24);
		const strippedMargin = plain24Lines.map((l) => l.slice(1)).join("\n");
		assert.ok(strippedMargin.includes("printf 'a\\nb'"), `${label}: literal \\n kept`);
		assert.ok(strippedMargin.includes("# ╭─ box ─╮"), `${label}: literal box text kept`);
		assert.ok(raw24.some((l) => l.includes("\x1b[1;38;2;255;140;0m")), `${label}: orange color applied`);
		// Blank line preserved (1-char left margin + empty inner line = " ")
		assert.ok(plain24Lines.includes(" "), `${label}: blank line preserved`);
		// Full long line preserved without ellipsis
		assert.ok(plain24Lines.map((l) => l.slice(1)).join("").includes("abcdefghij".repeat(6)), `${label}: no command truncation`);
		assert.ok(!strippedMargin.includes("…"), `${label}: no ellipsis`);
		if (opts.expanded) {
			assert.ok(strippedMargin.includes("stdout line 1") && strippedMargin.includes("stdout line 2"), `${label}: output preserved`);
		}
	}
});

test("bash preserves exact leading/trailing spaces, tabs, blank lines, quotes, backslashes and literal \\n even when soft-wrapping", () => {
	const exactCmd = "\n    indented_long_" + "k".repeat(30) + "   \n\t\techo \"a'b\" \\\\ 'x\\ny'\n\n  trailing   \n";
	const snapshotCmd = exactCmd;
	const ctx = context({ args: { command: exactCmd, timeout: 120 } });
	for (const comp of [
		bashRenderers.renderCall({ command: exactCmd, timeout: 120 }, theme, context()),
		bashRenderers.renderResult({ content: [{ type: "text", text: "ok" }], details: undefined }, { expanded: false, isPartial: false }, theme, ctx),
		bashRenderers.renderResult({ content: [{ type: "text", text: "ok" }], details: undefined }, { expanded: true, isPartial: false }, theme, ctx),
	]) {
		const raw20 = comp.render(20);
		for (const line of raw20) {
			assert.ok(visibleWidth(line) <= 20, `overflow at width 20: ${JSON.stringify(line)}`);
			assert.ok(strip([line])[0].startsWith(" "), `1-char left margin missing: ${JSON.stringify(line)}`);
		}
		// Strip ONLY the 1 leading display margin column to recover exact authored command
		const unmargined = strip(raw20).map((l) => l.slice(1));
		// Find command start immediately after the wrapped header (command begins with leading blank line "")
		const cmdStart = unmargined.indexOf("");
		assert.ok(cmdStart >= 1, `wrapped header must precede leading blank command line, got ${JSON.stringify(unmargined)}`);
		const cmdSlice = unmargined.slice(cmdStart);
		assert.equal(cmdSlice[0], "", "leading blank line preserved");
		assert.ok(cmdSlice[1].startsWith("    indented_long_"), `leading spaces preserved on soft-wrap, got ${JSON.stringify(cmdSlice[1])}`);
		const unwrappedLead = cmdSlice.slice(1, 4).join("");
		assert.equal(unwrappedLead, "    indented_long_" + "k".repeat(30) + "   ", "trailing spaces preserved across soft-wrap");
		const unwrappedTab = cmdSlice.slice(4, 6).join("");
		assert.equal(unwrappedTab, "      echo \"a'b\" \\\\ 'x\\ny'", "tabs, quotes, backslashes, and literal \\n preserved");
		assert.equal(cmdSlice[6], "", "internal blank line preserved");
		assert.equal(cmdSlice[7], "  trailing   ", "short line leading/trailing spaces preserved verbatim");
	}
	assert.equal(exactCmd, snapshotCmd, "command string never mutated");
});

test("the universal resolver replaces unmarked definitions without executing their callbacks", () => {
	const pi = fakePi();
	registerCompactToolRenderer(pi);
	const [resolver] = pi.resolvers;
	assert.ok(resolver, "the theme registers one tool renderer resolver");

	let unmarkedCalls = 0;
	const unmarked = {
		renderCall: () => {
			unmarkedCalls++;
			return { render: () => ["╭─ card ─╮"], invalidate() {} };
		},
		renderResult: () => {
			unmarkedCalls++;
			return { render: () => ["... (3 more lines, ctrl+o to expand)"], invalidate() {} };
		},
	};
	const resolved = resolveWith(resolver, "third_party_tool", () => unmarked);
	assert.equal(resolved[COMPACT_TOOL_RENDERING_KEY], COMPACT_TOOL_RENDERING_VERSION, "fallback is marked");
	assert.equal(resolved.renderShell, "self", "fallback owns its shell");

	const collapsed = strip(resolved.renderResult({ content: [{ type: "text", text: "body" }] }, { expanded: false, isPartial: false }, theme, context()).render(80));
	assert.equal(unmarkedCalls, 0, "unmarked callbacks are never invoked");
	assert.equal(collapsed.length, 1, "one compact row");
	assert.doesNotMatch(collapsed.join("\n"), /╭|to expand|ctrl\+o/, "no card frame or expansion hint leaks");
});

test("the universal resolver keeps compliant owners and falls back for every other shape", () => {
	const pi = fakePi();
	registerCompactToolRenderer(pi);
	const [resolver] = pi.resolvers;
	const slots = {
		renderCall: () => ({ render: () => ["owner call"], invalidate() {} }),
		renderResult: () => ({ render: () => ["owner result"], invalidate() {} }),
	};
	const compliant = { [COMPACT_TOOL_RENDERING_KEY]: 1, renderShell: "self", ...slots };
	const kept = resolveWith(resolver, "agent_todo", () => compliant);
	assert.equal(strip(kept.renderResult({ content: [] }, { expanded: false, isPartial: false }, theme, context()).render(80))[0], " owner result", "owner presentation kept with once-only 1-col margin");
	const compliantWithMargin = { [COMPACT_TOOL_RENDERING_KEY]: 1, compactLeftMargin: 1, renderShell: "self", renderCall: () => ({ render: () => [" already-margined call"], invalidate() {} }), renderResult: () => ({ render: () => [" already-margined result"], invalidate() {} }) };
	const keptMargined = resolveWith(resolver, "agent_todo", () => compliantWithMargin);
	assert.equal(strip(keptMargined.renderResult({ content: [] }, { expanded: false, isPartial: false }, theme, context()).render(80))[0], " already-margined result", "marked owner margin is never doubled");

	for (const [label, definition] of [
		["missing marker", { renderShell: "self", ...slots }],
		["default shell", { [COMPACT_TOOL_RENDERING_KEY]: 1, renderShell: "default", ...slots }],
		["missing result slot", { [COMPACT_TOOL_RENDERING_KEY]: 1, renderShell: "self", renderCall: slots.renderCall }],
		["no definition", undefined],
	]) {
		const resolved = resolveWith(resolver, "other_tool", () => definition);
		assert.equal(resolved.renderShell, "self", `${label}: compact shell`);
		const lines = strip(resolved.renderResult({ content: [{ type: "text", text: "kept text" }] }, { expanded: false, isPartial: false }, theme, context()).render(60));
		assert.equal(lines.length, 1, `${label}: one row`);
	}
});

test("a throwing compliant owner degrades to the compact fallback, not Pi's boxed default", () => {
	const pi = fakePi();
	registerCompactToolRenderer(pi);
	const [resolver] = pi.resolvers;
	const throwing = {
		[COMPACT_TOOL_RENDERING_KEY]: 1,
		renderShell: "self",
		renderCall: () => {
			throw new Error("boom");
		},
		renderResult: () => {
			throw new Error("boom");
		},
	};
	const resolved = resolveWith(resolver, "codegraph_status", () => throwing);
	const lines = strip(resolved.renderResult({ content: [{ type: "text", text: "safe text" }] }, { expanded: false, isPartial: false }, theme, context()).render(60));
	assert.equal(lines.length, 1, "one compact row instead of a thrown error");
	assert.match(lines[0], /codegraph_status/, "the tool identity is preserved");
});

test("home abbreviation is display-only and separator-bounded", () => {
	const home = "/home/j0k3r";
	assert.equal(abbreviateHome(`${home}/projects/app.ts`, home), "~/projects/app.ts");
	assert.equal(abbreviateHome(home, home), "~");
	assert.equal(abbreviateHome("/home/j0k3r-other/app.ts", home), "/home/j0k3r-other/app.ts", "a longer account name is untouched");
	assert.equal(abbreviateHome("/var/log/app.ts", home), "/var/log/app.ts");
	assert.equal(abbreviateHome("", home), "");
});

test("the narrow argument summary never serializes nested or private payloads", () => {
	assert.equal(summarizeArgs({ query: "pi renderer", limit: 5 }), "query=pi renderer limit=5");
	assert.equal(summarizeArgs({ nested: { secret: "token" } }), "", "nested structures are omitted");
	assert.equal(summarizeArgs({ a: 1, b: 2, c: 3, d: 4 }), "a=1 b=2 c=3", "entries are capped");
	assert.equal(summarizeArgs(undefined), "");
});

test("result text preserves every text block in order and skips other block types", () => {
	const result = { content: [{ type: "text", text: "one" }, { type: "image", data: "x", mimeType: "image/png" }, { type: "text", text: "two" }] };
	assert.equal(resultText(result), "one\ntwo");
	assert.equal(resultText({}), "");
});

test("the compact row emits no cells at width 0, blank row at width 1, and fits every positive width with 1-col margin", () => {
	const row = new CompactToolRow(() => "read ─ a/very/long/path/that/exceeds/the/width.ts ─ 42 lines");
	assert.deepEqual(row.render(0), [], "width 0 emits no lines");
	assert.deepEqual(row.render(1), [" "], "width 1 emits single blank margin column");
	for (const width of [1, 2, 10, 23, 40, 120]) {
		for (const line of row.render(width)) {
			assert.ok(visibleWidth(line) <= width, `width ${width} fits: ${visibleWidth(line)}`);
			assert.ok(line.startsWith(" "), `width ${width} starts with 1-col left margin`);
		}
	}
});

test("expanded lines wrap long content and keep blank lines instead of slicing them away", () => {
	const lines = expandedLines("alpha\n\nbeta 漢字 漢字 漢字 漢字\ngamma", 8);
	assert.ok(lines.includes(""), "blank lines are preserved");
	assert.ok(lines.join("\n").includes("alpha"));
	assert.ok(lines.join("\n").includes("gamma"));
	for (const line of lines) assert.ok(visibleWidth(line) <= 8, `line fits width 8: ${JSON.stringify(line)}`);
	assert.deepEqual(expandedLines("body", 0), [], "width 0 expands to nothing");
});

test("the fallback reports continuation metadata when expanded", () => {
	const renderers = createFallbackRenderers("web_search");
	const component = renderers.renderResult(
		{ content: [{ type: "text", text: "page one" }], details: { nextCursor: "cursor-2" } },
		{ expanded: true, isPartial: false },
		theme,
		context(),
	);
	const lines = strip(component.render(80));
	assert.ok(lines.some((line) => line.includes("cursor-2")), "continuation stays reachable");
	assert.ok(lines.some((line) => line.includes("page one")), "returned text stays reachable");
});

test("bash retains standalone CR and CRLF verbatim without normalization across states and widths", () => {
	const commands = [
		"A\r\nB",
		"A\rB\r\n\r\nC\r",
		"\r\n\r\n  lead\r   \nend\r\n",
	];
	for (const cmd of commands) {
		const callComp = bashRenderers.renderCall({ command: cmd, timeout: 120 }, theme, context());
		const resComp = bashRenderers.renderResult(
			{ content: [{ type: "text", text: "ok" }], details: undefined },
			{ expanded: false, isPartial: false },
			theme,
			context({ args: { command: cmd, timeout: 120 } }),
		);
		for (const comp of [callComp, resComp]) {
			const lines80 = strip(comp.render(80));
			const unmargined80 = lines80.slice(1).map((l) => l.slice(1)).join("\n");
			assert.equal(unmargined80, cmd, `width 80 must recover exact CR/CRLF command ${JSON.stringify(cmd)}`);

			const lines4 = strip(comp.render(4));
			for (const l of lines4) {
				assert.ok(visibleWidth(l) <= 4);
				assert.ok(l.startsWith(" "), "width 4 keeps 1-col left margin");
			}
			// Determine wrapped header line count using a single-char command render at the same timestamp
			const now = Date.now();
			const headerProbe =
				comp === callComp
					? bashRenderers.renderCall({ command: "x", timeout: 120 }, theme, context({ state: { startedAt: now } }))
					: bashRenderers.renderResult(
							{ content: [{ type: "text", text: "ok" }], details: undefined },
							{ expanded: false, isPartial: false },
							theme,
							context({ args: { command: "x", timeout: 120 }, state: { startedAt: now, endedAt: now } }),
						);
			const headerLen4 = strip(headerProbe.render(4)).length - 1;
			// Undo soft-wraps across physical lines emitted by each logical split
			const combined4 = lines4.slice(headerLen4).map((l) => l.slice(1)).join("");
			assert.equal(combined4, cmd.replace(/\n/g, ""), `width 4 keeps all authored CR characters for ${JSON.stringify(cmd)}`);
		}
	}
});

test("width 2 omits left margin only on lines needing an intact wide grapheme and retains full characters", () => {
	const wideCmd = "A漢B👨‍👩‍👧e\u0301";
	const comp = bashRenderers.renderResult(
		{ content: [{ type: "text", text: "X漢Y👨‍👩‍👧" }], details: undefined },
		{ expanded: true, isPartial: false },
		theme,
		context({ args: { command: wideCmd } }),
	);
	const raw2 = comp.render(2);
	for (const line of raw2) assert.ok(visibleWidth(line) <= 2, `overflow at width 2: ${JSON.stringify(line)}`);
	const plain2 = strip(raw2);
	// Header, ASCII lines, and combining-mark e\u0301 keep 1-col left margin; only wide graphemes omit it
	assert.ok(plain2[0].startsWith(" "), "header keeps left margin at width 2");
	assert.ok(plain2.includes(" A"), "narrow command char retains left margin");
	assert.ok(plain2.includes("漢"), "wide CJK grapheme kept intact without margin at width 2");
	assert.ok(!plain2.includes(" 漢"), "wide CJK grapheme must not be prefixed or truncated");
	assert.ok(plain2.includes(" B"), "narrow char after wide grapheme restores left margin");
	assert.ok(plain2.includes("👨‍👩‍👧"), "wide emoji grapheme kept intact without margin at width 2");
	assert.ok(plain2.includes(" e\u0301"), "width-1 combining grapheme retains left margin");
	assert.ok(plain2.includes(" X") && plain2.includes(" Y"), "expanded output narrow chars retain margin");

	// Reconstruct command portion cleanly by stripping margin only where present
	const cmdStart = plain2.indexOf(" A");
	const outStart = plain2.indexOf(" X");
	assert.ok(cmdStart >= 1 && outStart > cmdStart, "wrapped header precedes command and expanded output");
	const headerPlain2 = plain2.slice(0, cmdStart).map((l) => (l.startsWith(" ") ? l.slice(1) : l)).join("");
	assert.ok(headerPlain2.includes("timeout120s(default)") || headerPlain2.includes("timeout 120s (default)"), `wrapped width-2 header keeps timeout status: ${headerPlain2}`);
	const cmdReconstructed = plain2.slice(cmdStart, outStart).map((l) => (l.startsWith(" ") ? l.slice(1) : l)).join("");
	assert.equal(cmdReconstructed, wideCmd);

	// Normal widths >= 3 always retain 1-col margin even on wide graphemes
	for (const w of [3, 10]) {
		for (const line of strip(comp.render(w))) {
			assert.ok(line.startsWith(" "), `width ${w} must retain 1-col margin on ${JSON.stringify(line)}`);
		}
	}
});

test("D1: plain-text expanded tool bodies use theme muted foreground with #7aa7b8 fallback while preserving syntax/diff/warning/dim ANSI", () => {
	// 1. Custom active theme muted token is used across all plain-text expanded tool bodies
	const plainCases = [
		[
			"read (unhighlighted)",
			readRenderers.renderResult(
				{ content: [{ type: "text", text: "plain notes line" }], details: undefined },
				{ expanded: true, isPartial: false },
				customTheme,
				context({ args: { path: "LICENSE" } }),
			),
			"plain notes line",
		],
		[
			"read (error)",
			readRenderers.renderResult(
				{ content: [{ type: "text", text: "ENOENT missing file" }], details: undefined },
				{ expanded: true, isPartial: false },
				customTheme,
				context({ args: { path: "missing.ts" }, isError: true }),
			),
			"ENOENT missing file",
		],
		[
			"write (unhighlighted + result text)",
			writeRenderers.renderResult(
				{ content: [{ type: "text", text: "Successfully wrote plain file" }], details: undefined },
				{ expanded: true, isPartial: false },
				customTheme,
				context({ args: { path: "NOTES", content: "written plain body" } }),
			),
			"written plain body",
		],
		[
			"edit (plain fallback)",
			editRenderers.renderResult(
				{ content: [{ type: "text", text: "Applied plain edit" }], details: undefined },
				{ expanded: true, isPartial: false },
				customTheme,
				context({ args: { path: "NOTES" } }),
			),
			"Applied plain edit",
		],
		[
			"edit (error)",
			editRenderers.renderResult(
				{ content: [{ type: "text", text: "oldText not found" }], details: undefined },
				{ expanded: true, isPartial: false },
				customTheme,
				context({ args: { path: "src/app.ts" }, isError: true }),
			),
			"oldText not found",
		],
		[
			"grep",
			grepRenderers.renderResult(
				{ content: [{ type: "text", text: "src/a.ts:1:match" }], details: undefined },
				{ expanded: true, isPartial: false },
				customTheme,
				context({ args: { pattern: "match", path: "src" } }),
			),
			"src/a.ts:1:match",
		],
		[
			"find",
			findRenderers.renderResult(
				{ content: [{ type: "text", text: "src/a.ts" }], details: undefined },
				{ expanded: true, isPartial: false },
				customTheme,
				context({ args: { pattern: "*.ts", path: "src" } }),
			),
			"src/a.ts",
		],
		[
			"ls",
			lsRenderers.renderResult(
				{ content: [{ type: "text", text: "index.ts" }], details: undefined },
				{ expanded: true, isPartial: false },
				customTheme,
				context({ args: { path: "src" } }),
			),
			"index.ts",
		],
		[
			"bash output",
			bashRenderers.renderResult(
				{ content: [{ type: "text", text: "stdout plain line" }], details: undefined },
				{ expanded: true, isPartial: false },
				customTheme,
				context({ args: { command: "echo hi" } }),
			),
			"stdout plain line",
		],
		[
			"powershell output",
			powershellRenderers.renderResult(
				{ content: [{ type: "text", text: "ps stdout plain line" }], details: undefined },
				{ expanded: true, isPartial: false },
				customTheme,
				context({ args: { command: "Write-Output hi" } }),
			),
			"ps stdout plain line",
		],
		[
			"fallback",
			createFallbackRenderers("custom_tool").renderResult(
				{ content: [{ type: "text", text: "fallback body text" }], details: undefined },
				{ expanded: true, isPartial: false },
				customTheme,
				context({ args: { key: "val" } }),
			),
			"fallback body text",
		],
	];

	for (const [label, comp, needle] of plainCases) {
		const raw = comp.render(80);
		const bodyOnly = raw.slice(1);
		const target = bodyOnly.find((l) => strip([l])[0].includes(needle));
		assert.ok(target, `${label}: body line containing ${JSON.stringify(needle)} must exist`);
		assert.ok(target.includes(CUSTOM_MUTED_ANSI), `${label}: must apply active theme muted ANSI, got ${JSON.stringify(target)}`);
	}

	// write result text must also use theme muted foreground
	const writeRaw = plainCases[2][1].render(80);
	const writeResultLine = writeRaw.slice(1).find((l) => strip([l])[0].includes("Successfully wrote plain file"));
	assert.ok(writeResultLine?.includes(CUSTOM_MUTED_ANSI), `write result text must use theme muted ANSI, got ${JSON.stringify(writeResultLine)}`);

	// 2. Absent and no-op mock theme fall back to arch-electric #7aa7b8 muted ANSI
	for (const [label, fallbackTheme] of [
		["absent theme", undefined],
		["no-op mock theme", theme],
	]) {
		const comp = grepRenderers.renderResult(
			{ content: [{ type: "text", text: "fallback muted line" }], details: undefined },
			{ expanded: true, isPartial: false },
			fallbackTheme,
			context({ args: { pattern: "x", path: "src" } }),
		);
		const target = comp.render(80).find((l) => strip([l])[0].includes("fallback muted line"));
		assert.ok(target?.includes(ARCH_MUTED_ANSI), `${label}: must fall back to #7aa7b8 ANSI, got ${JSON.stringify(target)}`);
	}

	// 3. Syntax-highlighted code, diffs, amber warnings, dim empty notices, and existing ANSI output are preserved
	const readCodeRaw = readRenderers
		.renderResult(
			{
				content: [{ type: "text", text: "export const answer = 42;" }],
				details: { truncation: { truncated: true, outputLines: 1, totalLines: 5 } },
			},
			{ expanded: true, isPartial: false },
			customTheme,
			context({ args: { path: "src/example.ts" } }),
		)
		.render(80);
	const codeLine = readCodeRaw.find((l) => strip([l])[0].includes("export"));
	assert.ok(codeLine, "highlighted read code line present");
	assert.ok(/\x1b\[[0-9;]*m/.test(codeLine), `highlighted code retains syntax ANSI: ${JSON.stringify(codeLine)}`);
	assert.ok(!codeLine.includes(CUSTOM_MUTED_ANSI) && !codeLine.includes(ARCH_MUTED_ANSI), `highlighted code must not be overwritten with muted: ${JSON.stringify(codeLine)}`);
	const amberWarningLine = readCodeRaw.find((l) => strip([l])[0].includes("[Truncated:"));
	assert.ok(amberWarningLine?.includes("\x1b[1;38;2;255;184;77m"), "amber truncation warning preserved");

	const editDiffRaw = editRenderers
		.renderResult(
			{
				content: [{ type: "text", text: "ok" }],
				details: { diff: "--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-const a = 1;\n+const a = 2;\n" },
			},
			{ expanded: true, isPartial: false },
			customTheme,
			context({ args: { path: "x.ts" } }),
		)
		.render(80);
	const diffBodyLines = editDiffRaw.slice(1);
	assert.ok(diffBodyLines.length > 0, "diff lines rendered");
	assert.ok(diffBodyLines.some((dl) => /\x1b\[[0-9;]*m/.test(dl)), "diff retains ANSI foreground styling");
	for (const dl of diffBodyLines) {
		assert.ok(!dl.includes(CUSTOM_MUTED_ANSI), `diff ANSI must not be overwritten with custom muted: ${JSON.stringify(dl)}`);
	}

	// Dim empty notices preserved across bash, edit, write, and grep
	for (const [label, comp, expectedNotice] of [
		[
			"bash empty",
			bashRenderers.renderResult({ content: [{ type: "text", text: "" }], details: undefined }, { expanded: true, isPartial: false }, customTheme, context({ args: { command: "true" } })),
			"(no output)",
		],
		[
			"edit empty",
			editRenderers.renderResult({ content: [{ type: "text", text: "" }], details: undefined }, { expanded: true, isPartial: false }, customTheme, context({ args: { path: "x.ts" } })),
			"(no diff output)",
		],
		[
			"write empty",
			writeRenderers.renderResult({ content: [{ type: "text", text: "" }], details: undefined }, { expanded: true, isPartial: false }, customTheme, context({ args: { path: "x.txt", content: "" } })),
			"(empty file)",
		],
		[
			"grep empty",
			grepRenderers.renderResult({ content: [{ type: "text", text: "" }], details: undefined }, { expanded: true, isPartial: false }, customTheme, context({ args: { pattern: "missing", path: "src" } })),
			"(no output)",
		],
	]) {
		const raw = comp.render(80);
		const noticeLine = raw.slice(1).find((l) => strip([l])[0].includes(expectedNotice));
		assert.ok(noticeLine?.includes("\x1b[2m"), `${label}: dim empty notice preserved`);
		assert.ok(!noticeLine?.includes(CUSTOM_MUTED_ANSI), `${label}: dim empty notice not overwritten with muted`);
	}

	// Existing ANSI in bash stdout preserved while plain sibling lines get muted
	const mixedBashRaw = bashRenderers
		.renderResult(
			{ content: [{ type: "text", text: "plain line\n\x1b[32mGREEN_PASS\x1b[0m" }], details: undefined },
			{ expanded: true, isPartial: false },
			customTheme,
			context({ args: { command: "test" } }),
		)
		.render(80);
	const plainOut = mixedBashRaw.find((l) => strip([l])[0].includes("plain line"));
	const greenOut = mixedBashRaw.find((l) => strip([l])[0].includes("GREEN_PASS"));
	assert.ok(plainOut?.includes(CUSTOM_MUTED_ANSI), "plain bash output line is muted");
	assert.ok(greenOut?.includes("\x1b[32m") && !greenOut?.includes(CUSTOM_MUTED_ANSI), "existing ANSI in bash output is preserved");
});

test("D2: collapsed headers and bodies wrap automatically across widths without ellipsis clipping or trailing loss", () => {
	const longHeader = "read ─ a/very/long/path/that/exceeds/the/narrow/terminal/width/end_marker.ts ─ ✓ 42 lines";
	const row = new CompactToolRow(() => longHeader);
	assert.deepEqual(row.render(0), [], "width 0 emits []");
	assert.deepEqual(row.render(1), [" "], "width 1 emits [' ']");

	for (const width of [10, 24, 40]) {
		const raw = row.render(width);
		assert.ok(raw.length > 1, `width ${width} must wrap overflowing header across multiple lines`);
		for (const line of raw) {
			assert.ok(visibleWidth(line) <= width, `width ${width} overflow: ${JSON.stringify(line)}`);
			assert.ok(line.startsWith(" "), `width ${width} keeps 1-col left margin`);
		}
		const joined = raw.map((l) => l.slice(1)).join(" ");
		assert.ok(!joined.includes("…"), `width ${width} must not clip with ellipsis`);
		assert.ok(joined.includes("end_marker.ts") || raw.map((l) => l.slice(1)).join("").includes("end_marker.ts"), `width ${width} keeps trailing path`);
		assert.ok(raw.map((l) => l.slice(1)).join("").includes("42 lines") || joined.includes("42 lines"), `width ${width} keeps trailing status`);
	}

	// Width 2 preserves intact wide graphemes in headers via conditional margin omission
	const wideHeaderRow = new CompactToolRow(() => "A漢B👨‍👩‍👧");
	const wide2 = wideHeaderRow.render(2);
	for (const line of wide2) assert.ok(visibleWidth(line) <= 2, `header width 2 overflow: ${JSON.stringify(line)}`);
	assert.ok(wide2.includes(" A") && wide2.includes("漢") && wide2.includes(" B") && wide2.includes("👨‍👩‍👧"), `width 2 header wide graphemes intact: ${JSON.stringify(wide2)}`);

	// Native and fallback collapsed headers wrap without ellipsis clipping
	const renderersToCheck = [
		["read", readRenderers.renderResult({ content: [{ type: "text", text: "ok" }], details: undefined }, { expanded: false, isPartial: false }, customTheme, context({ args: { path: "src/very/deep/nested/directory/final_file_name.ts" } }))],
		["grep", grepRenderers.renderResult({ content: [{ type: "text", text: "a\nb" }], details: undefined }, { expanded: false, isPartial: false }, customTheme, context({ args: { pattern: "superLongSearchPatternToken", path: "packages/sub/dir" } }))],
		["powershell", powershellRenderers.renderCall({ command: "Get-ChildItem -Path C:\\very\\long\\directory\\name -Recurse", timeout: 45 }, customTheme, context())],
		["fallback", createFallbackRenderers("very_long_custom_tool_name").renderResult({ content: [{ type: "text", text: "x" }], details: undefined }, { expanded: false, isPartial: false }, customTheme, context({ args: { target: "long-value-tail-marker" } }))],
	];
	for (const [label, comp] of renderersToCheck) {
		const raw = comp.render(24);
		assert.ok(raw.length > 1, `${label}@24: overflowing collapsed header must wrap`);
		for (const line of raw) {
			assert.ok(visibleWidth(line) <= 24, `${label}@24 overflow: ${JSON.stringify(line)}`);
			assert.ok(strip([line])[0].startsWith(" "), `${label}@24 1-col margin`);
		}
		const flat = strip(raw).map((l) => l.slice(1)).join("");
		assert.ok(!flat.includes("…"), `${label}@24 must not emit ellipsis: ${flat}`);
	}

	// wrapLeftMarginComponent also wraps overflowing lines from non-margined owner components
	const overflowingOwner = { render: () => ["owner_prefix_1234567890_trailing_suffix"], invalidate() {} };
	const margined = wrapLeftMarginComponent(overflowingOwner);
	const wrappedOwner = margined.render(16);
	assert.ok(wrappedOwner.length > 1, "wrapLeftMarginComponent wraps overflowing lines");
	for (const line of wrappedOwner) {
		assert.ok(visibleWidth(line) <= 16);
		assert.ok(line.startsWith(" "));
	}
	assert.equal(wrappedOwner.map((l) => l.slice(1)).join(""), "owner_prefix_1234567890_trailing_suffix");
});

test("D4: bash and powershell display truthful timeout status and live elapsed/remaining while running", () => {
	const realNow = Date.now;
	let fakeNow = 1_000_000;
	Date.now = () => fakeNow;
	try {
		// 1. Explicit positive timeout on bash: running elapsed + remaining, then completed
		const bashExplicitState = {};
		const bashExplicitCall = bashRenderers.renderCall({ command: "sleep 10", timeout: 30 }, customTheme, context({ state: bashExplicitState }));
		const bashCall0 = strip(bashExplicitCall.render(120))[0];
		assert.match(bashCall0, /timeout 30s/, "bash explicit call shows timeout 30s");
		assert.doesNotMatch(bashCall0, /\(default\)/, "explicit timeout is not labeled default");
		assert.match(bashCall0, /0\.0s elapsed/, "bash explicit call shows live elapsed");
		assert.match(bashCall0, /30\.0s remaining/, "bash explicit call shows live remaining");

		// Advance clock 10s while still running
		fakeNow += 10_000;
		const bashCall10 = strip(bashExplicitCall.render(120))[0];
		assert.match(bashCall10, /10\.0s elapsed/, "elapsed advances live while running");
		assert.match(bashCall10, /20\.0s remaining/, "remaining counts down live while running");

		// Partial result keeps elapsed/remaining live
		const bashPartial = bashRenderers.renderResult(
			{ content: [{ type: "text", text: "working..." }], details: undefined },
			{ expanded: false, isPartial: true },
			customTheme,
			context({ args: { command: "sleep 10", timeout: 30 }, state: bashExplicitState }),
		);
		fakeNow += 5_000;
		const bashPartial15 = strip(bashPartial.render(120))[0];
		assert.match(bashPartial15, /timeout 30s/, "bash partial result shows timeout 30s");
		assert.match(bashPartial15, /15\.0s elapsed/, "bash partial result shows live elapsed");
		assert.match(bashPartial15, /15\.0s remaining/, "bash partial result shows live remaining");

		// Advance past timeout: remaining clamps cleanly at 0.0s
		fakeNow += 25_000;
		const bashPartialOver = strip(bashPartial.render(120))[0];
		assert.match(bashPartialOver, /40\.0s elapsed/, "elapsed keeps advancing past timeout");
		assert.match(bashPartialOver, /0\.0s remaining/, "remaining clamps cleanly at 0.0s");

		// Completed result shows timeout 30s + Took duration and clears interval
		const bashDone = bashRenderers.renderResult(
			{ content: [{ type: "text", text: "done" }], details: undefined },
			{ expanded: false, isPartial: false },
			customTheme,
			context({ args: { command: "sleep 10", timeout: 30 }, state: bashExplicitState }),
		);
		const bashDoneLine = strip(bashDone.render(120))[0];
		assert.match(bashDoneLine, /timeout 30s/, "bash completed result keeps timeout 30s");
		assert.match(bashDoneLine, /Took 40\.0s/, "bash completed result shows final elapsed");
		assert.equal(bashExplicitState.interval, undefined, "timer cleared on completion");

		// 2. Omitted / non-positive timeout on bash: displays timeout 120s (default) + live elapsed/remaining
		for (const omitted of [undefined, 0, -10]) {
			const st = {};
			const call = bashRenderers.renderCall({ command: "echo default", timeout: omitted }, customTheme, context({ state: st }));
			const line0 = strip(call.render(120))[0];
			assert.match(line0, /timeout 120s \(default\)/, `bash timeout=${omitted} call shows timeout 120s (default)`);
			assert.match(line0, /0\.0s elapsed/, `bash timeout=${omitted} call shows elapsed`);
			assert.match(line0, /2m 0s remaining/, `bash timeout=${omitted} call shows 120s remaining`);

			fakeNow += 20_000;
			const line20 = strip(call.render(120))[0];
			assert.match(line20, /20\.0s elapsed/, `bash timeout=${omitted} elapsed advances`);
			assert.match(line20, /1m 40s remaining/, `bash timeout=${omitted} remaining counts down`);

			const done = bashRenderers.renderResult(
				{ content: [{ type: "text", text: "ok" }], details: undefined },
				{ expanded: false, isPartial: false },
				customTheme,
				context({ args: { command: "echo default", timeout: omitted }, state: st }),
			);
			const doneLine = strip(done.render(120))[0];
			assert.match(doneLine, /timeout 120s \(default\)/, `bash timeout=${omitted} result keeps timeout 120s (default)`);
		}

		// 3. Powershell: explicit timeout shows timeout Xs + elapsed/remaining; omitted/non-positive shows no timeout
		const psExplicitState = {};
		const psExplicitCall = powershellRenderers.renderCall({ command: "Start-Sleep 5", timeout: 45 }, customTheme, context({ state: psExplicitState }));
		fakeNow += 5_000;
		const psExplicitLine = strip(psExplicitCall.render(120))[0];
		assert.match(psExplicitLine, /timeout 45s/, "powershell explicit call shows timeout 45s");
		assert.match(psExplicitLine, /5\.0s elapsed/, "powershell explicit call shows elapsed");
		assert.match(psExplicitLine, /40\.0s remaining/, "powershell explicit call shows remaining");
		// Clean up interval
		powershellRenderers.renderResult(
			{ content: [{ type: "text", text: "ok" }], details: undefined },
			{ expanded: false, isPartial: false },
			customTheme,
			context({ args: { command: "Start-Sleep 5", timeout: 45 }, state: psExplicitState }),
		);

		for (const omitted of [undefined, 0, -3]) {
			const psState = {};
			const psCall = powershellRenderers.renderCall({ command: "echo ps", timeout: omitted }, customTheme, context({ state: psState }));
			fakeNow += 3_000;
			const psCallLine = strip(psCall.render(120))[0];
			assert.match(psCallLine, /no timeout/, `powershell timeout=${omitted} call shows no timeout`);
			assert.doesNotMatch(psCallLine, /120s/, `powershell timeout=${omitted} must not claim 120s default`);
			assert.match(psCallLine, /3\.0s elapsed/, `powershell timeout=${omitted} shows live elapsed`);
			assert.doesNotMatch(psCallLine, /remaining/, `powershell timeout=${omitted} has no remaining countdown`);

			const psDone = powershellRenderers.renderResult(
				{ content: [{ type: "text", text: "ok" }], details: undefined },
				{ expanded: false, isPartial: false },
				customTheme,
				context({ args: { command: "echo ps", timeout: omitted }, state: psState }),
			);
			const psDoneLine = strip(psDone.render(120))[0];
			assert.match(psDoneLine, /no timeout/, `powershell timeout=${omitted} result keeps no timeout`);
		}
	} finally {
		Date.now = realNow;
	}
});
