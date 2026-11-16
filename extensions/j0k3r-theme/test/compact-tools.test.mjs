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
import { visibleWidth } from "@earendil-works/pi-tui";

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
} = await import("../src/render/compact.ts");
const { registerCompactToolRenderer } = await import("../src/render/resolver.ts");
const { DEFAULT_BASH_TIMEOUT_SECONDS, applyBashTimeout, registerNativeToolOverrides, resolveBashTimeout } = await import(
	"../src/tools/index.ts",
);
const { bashRenderers, createShellRenderers } = await import("../src/render/bashRenderer.ts");

const theme = { fg: (_color, text) => text, bg: (_color, text) => text, bold: (text) => text };
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
		assert.equal(unmargined[1], "", "leading blank line preserved");
		assert.ok(unmargined[2].startsWith("    indented_long_"), `leading spaces preserved on soft-wrap, got ${JSON.stringify(unmargined[2])}`);
		const unwrappedLead = unmargined.slice(2, 5).join("");
		assert.equal(unwrappedLead, "    indented_long_" + "k".repeat(30) + "   ", "trailing spaces preserved across soft-wrap");
		const unwrappedTab = unmargined.slice(5, 7).join("");
		assert.equal(unwrappedTab, "      echo \"a'b\" \\\\ 'x\\ny'", "tabs, quotes, backslashes, and literal \\n preserved");
		assert.equal(unmargined[7], "", "internal blank line preserved");
		assert.equal(unmargined[8], "  trailing   ", "short line leading/trailing spaces preserved verbatim");
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
			// Undo soft-wraps across physical lines emitted by each logical split
			const combined4 = lines4.slice(1).map((l) => l.slice(1)).join("");
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
	const headerIdx = 0;
	const outStart = plain2.indexOf(" X");
	const cmdReconstructed = plain2.slice(headerIdx + 1, outStart).map((l) => (l.startsWith(" ") ? l.slice(1) : l)).join("");
	assert.equal(cmdReconstructed, wideCmd);

	// Normal widths >= 3 always retain 1-col margin even on wide graphemes
	for (const w of [3, 10]) {
		for (const line of strip(comp.render(w))) {
			assert.ok(line.startsWith(" "), `width ${w} must retain 1-col margin on ${JSON.stringify(line)}`);
		}
	}
});
