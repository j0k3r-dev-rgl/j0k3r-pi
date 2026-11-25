import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

// Source modules use NodeNext `.js` specifiers; resolve them to the local `.ts` files.
const loaderCode = `
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  if (context.parentURL && (specifier.startsWith("./") || specifier.startsWith("../"))) {
    const resolvedPath = fileURLToPath(new URL(specifier, context.parentURL));
    if (!existsSync(resolvedPath) && resolvedPath.endsWith(".js")) {
      const tsPath = resolvedPath.slice(0, -3) + ".ts";
      if (existsSync(tsPath)) return { shortCircuit: true, url: pathToFileURL(tsPath).href };
    }
  }
  return nextResolve(specifier, context);
}
`;
register("data:text/javascript," + encodeURIComponent(loaderCode));

const { visibleWidth } = await import("@earendil-works/pi-tui");
const {
	GitDiffPanel,
	buildDiffVisualRows,
	buildTreeVisualRows,
	rowAtVisualLine,
	wrapPanelLine,
} = await import("../src/panel.ts");
import type { PanelTheme } from "../src/panel.ts";
import type { TreeRow } from "../src/tree.ts";


const COLORS: Record<string, string> = {
	accent: "0;229;255",
	warning: "255;184;77",
	success: "102;255;102",
	error: "255;77;109",
	muted: "122;167;184",
	dim: "2",
	text: "230;230;230",
};

const theme = {
	fg: (color: string, text: string) => `\x1b[${color === "dim" ? "2" : `38;2;${COLORS[color] ?? "230;230;230"}`}m${text}\x1b[0m`,
	bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
} as unknown as PanelTheme;

const plain = (text: string) => text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");

test("MINI-005: wrapPanelLine wraps ANSI-styled lines to the pane width without ellipsis clipping", () => {
	const text = `\x1b[38;2;0;229;255m${"added content ".repeat(12)}\x1b[0m`;
	const width = 20;
	const lines = wrapPanelLine(text, width);

	assert.ok(lines.length > 1, "long line must wrap");
	for (const line of lines) {
		assert.ok(visibleWidth(line) <= width, `line exceeds ${width}: ${JSON.stringify(plain(line))}`);
		assert.ok(!plain(line).includes("…"), "wrapping must not clip with an ellipsis");
		assert.ok(line.includes("0;229;255"), "ANSI foreground must survive the break");
	}
	const joined = lines.map(plain).join("").replace(/\s/g, "");
	assert.equal(joined, plain(text).replace(/\s/g, ""), "no visible characters are dropped");

	assert.deepEqual(wrapPanelLine("", 20), [""], "blank lines stay blank");
	assert.deepEqual(wrapPanelLine("hello", 0), []);
	assert.deepEqual(wrapPanelLine("hello", -1), []);
});

test("MINI-005: diff rows wrap while preserving per-kind ANSI colors", () => {
	const diff = [
		"diff --git a/src/app.ts b/src/app.ts",
		"--- a/src/app.ts",
		"+++ b/src/app.ts",
		"@@ -1,3 +1,3 @@",
		`+${"added text ".repeat(10)}`,
		`-${"removed text ".repeat(10)}`,
		` ${"context text ".repeat(10)}`,
	].join("\n");

	const rows = buildDiffVisualRows(diff, 18, theme);
	assert.ok(rows.length > 7, "diff lines wrap into multiple visual rows");
	for (const row of rows) {
		assert.ok(visibleWidth(row) <= 18, `diff row exceeds width: ${JSON.stringify(plain(row))}`);
		assert.ok(!plain(row).includes("…"));
	}

	const findRow = (needle: string) => rows.find((row) => plain(row).includes(needle)) ?? "";
	assert.ok(findRow("+++ b/src/app.ts").includes(COLORS.accent!), "diff header keeps accent color");
	assert.ok(findRow("@@ -1,3").includes(COLORS.warning!), "hunk header keeps warning color");
	assert.ok(findRow("added text").includes(COLORS.success!), "additions keep success color");
	assert.ok(findRow("removed text").includes(COLORS.error!), "deletions keep error color");
	assert.ok(findRow("context text").includes(COLORS.muted!), "context keeps muted color");
});

test("MINI-005: wrapped tree rows keep one owner per logical row and stay inside the pane", () => {
	const rows: TreeRow[] = [
		{ kind: "dir", name: "src/components/very-long-directory-name", path: "src/components/very-long-directory-name", depth: 0, expanded: true },
		{
			kind: "file",
			name: "extremely-long-file-name-that-needs-wrapping.ts",
			path: "src/extremely-long-file-name-that-needs-wrapping.ts",
			depth: 1,
			file: { path: "src/extremely-long-file-name-that-needs-wrapping.ts", status: "M", staged: false, unstaged: true, untracked: false, additions: 120, deletions: 7 },
		},
	];
	const width = 22;
	const { lines, owners } = buildTreeVisualRows(rows, width, theme, 1);

	assert.ok(lines.length > rows.length, "long rows wrap onto extra visual lines");
	for (const line of lines) {
		assert.ok(visibleWidth(line) <= width, `tree row exceeds width: ${JSON.stringify(plain(line))}`);
		assert.ok(!plain(line).includes("…"));
	}

	assert.equal(owners[0], 0);
	assert.deepEqual([...new Set(owners)], [0, 1], "both logical rows own at least one visual line");
	const fileOwners = owners.filter((owner) => owner === 1);
	assert.ok(fileOwners.length > 1, "the long file row spans multiple visual lines");
	assert.ok(plain(lines[owners.indexOf(1)]!).includes("▶ "), "selection marker renders on the first visual line of the selected row");

	assert.equal(rowAtVisualLine(owners, 0), 0);
	assert.equal(rowAtVisualLine(owners, owners.length - 1), 1);
	assert.equal(rowAtVisualLine(owners, -1), undefined);
	assert.equal(rowAtVisualLine(owners, owners.length), undefined);
});

test("MINI-005: rendered panel wraps every pane within its width and maps wrapped tree clicks", async () => {
	const cwd = "/home/j0k3r/.pi/agent";
	const panel = new GitDiffPanel(cwd, { requestRender: () => {}, terminal: { rows: 40 } } as any, theme as any, () => {});
	await panel.refresh();

	for (const width of [70, 120]) {
		const lines = panel.render(width);
		assert.ok(lines.length > 0);
		for (const line of lines) {
			assert.ok(visibleWidth(line) <= width, `panel line exceeds ${width}: ${JSON.stringify(plain(line))}`);
		}

		const bodyStart = lines.findIndex((line, index) => index > 0 && plain(line).startsWith("├")) + 1;
		assert.ok(bodyStart > 0 && bodyStart < lines.length, "panel body renders between separators");
		const bodyEnd = lines.findIndex((line, index) => index > bodyStart && /^├/.test(plain(line)) && line.includes("┴"));
		const treeWidth = 26;
		for (let y = bodyStart; y < (bodyEnd === -1 ? lines.length : bodyEnd); y++) {
			const result = panel.handleMouse({ type: "press", button: "left", x: Math.min(3, treeWidth - 2), y, width, height: lines.length } as any);
			assert.equal(result?.handled, true, `tree click at y=${y} must be handled`);
		}
		const wheel = panel.handleMouse({ type: "wheel", button: "none", wheelDelta: 1, x: 3, y: bodyStart, width, height: lines.length } as any);
		assert.equal(wheel?.handled, true);

		for (const line of panel.render(width)) {
			assert.ok(visibleWidth(line) <= width, `post-click line exceeds ${width}`);
		}
	}
});
