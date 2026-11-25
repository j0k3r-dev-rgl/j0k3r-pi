import type { Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import { readFileDiff, readGitSnapshot, type GitChangedFile, type GitSnapshot, type GitWorktree, type GitWorktreeSnapshot } from "./git.js";
import { buildMultiWorktreeTreeRows, buildTreeRows, nearestFileIndex, type TreeRow } from "./tree.js";

const CYAN = "accent";

/** Minimum rendering surface shared by the panel and its exported row builders. */
export type PanelTheme = Pick<Theme, "fg" | "bold">;

type FocusPane = "tree" | "diff";

type TuiLike = { requestRender(): void };

type Done = (value: undefined) => void;

/**
 * Wrap one logical line to `width` visible columns, preserving ANSI colors across the
 * break without ellipsis clipping. Blank lines stay blank.
 */
export function wrapPanelLine(text: string, width: number): string[] {
	if (width <= 0) return [];
	if (text === "") return [""];
	const wrapped = wrapTextWithAnsi(text, width);
	const lines = wrapped.length > 0 ? wrapped : [""];
	return lines.map((line) => (visibleWidth(line) <= width ? line : truncateToWidth(line, width, "")));
}

/** Map a rendered visual line back to the logical row that owns it. */
export function rowAtVisualLine(owners: number[], visualLine: number): number | undefined {
	if (visualLine < 0 || visualLine >= owners.length) return undefined;
	return owners[visualLine];
}

function fileChangeStyle(file: GitChangedFile | undefined): { label: string; color: Parameters<Theme["fg"]>[0] } {
	if (!file) return { label: "", color: "text" };
	const raw = file.untracked ? "A" : file.status || "M";
	if (raw.includes("D")) return { label: "D", color: "error" };
	if (raw.includes("R")) return { label: "R", color: "warning" };
	if (raw.includes("C")) return { label: "C", color: "warning" };
	if (raw.includes("A") || file.untracked) return { label: "A", color: "success" };
	if (raw.includes("M")) return { label: "M", color: "accent" };
	return { label: raw.trim() || "M", color: "text" };
}

/**
 * Build the file-tree visual rows: every logical row wraps to the pane width and each
 * rendered line records its owning row index for scroll and mouse mapping.
 */
export function buildTreeVisualRows(
	rows: TreeRow[],
	width: number,
	theme: PanelTheme,
	selectedIndex = -1,
): { lines: string[]; owners: number[] } {
	const lines: string[] = [];
	const owners: number[] = [];
	rows.forEach((row, index) => {
		const selected = index === selectedIndex;
		const prefix = selected ? theme.fg("accent", "▶ ") : "  ";
		const indent = "  ".repeat(row.depth);
		let text: string;

		if (row.kind === "worktree") {
			const wt = row.worktree!;
			const isCurrent = wt.isCurrent ? "*" : "";
			const expandIcon = row.expanded ? "▾" : "▸";
			const branchText = theme.fg(selected ? "accent" : "warning", `${expandIcon} ⎇ ${row.name}${isCurrent}`);
			const rel = theme.fg("dim", `(${relCwd(wt.path)})`);
			const stat = row.stats?.fileCount === 0
				? theme.fg("success", "clean")
				: theme.fg("success", `+${row.stats?.additions ?? 0}`) + theme.fg("muted", "/") + theme.fg("error", `-${row.stats?.deletions ?? 0}`) + theme.fg("dim", ` (${row.stats?.fileCount})`);
			text = `${prefix}${indent}${branchText} ${rel} ${stat}`;
		} else if (row.kind === "dir") {
			text = theme.fg(row.expanded ? "accent" : "muted", `${prefix}${indent}${row.expanded ? "▾" : "▸"} ${row.name}`);
		} else {
			const style = fileChangeStyle(row.file);
			const stat = row.file ? theme.fg("success", `+${row.file.additions ?? 0}`) + theme.fg("muted", "/") + theme.fg("error", `-${row.file.deletions ?? 0}`) : "";
			text = `${prefix}${indent}${theme.fg(style.color, style.label.padEnd(2))} ${theme.fg(style.color, row.name)} ${stat}`;
		}

		for (const line of wrapPanelLine(text, width)) {
			lines.push(line);
			owners.push(index);
		}
	});
	return { lines, owners };
}

/** Color one diff line by kind (header, hunk, addition, deletion, context). */
export function colorDiffLine(line: string, theme: PanelTheme): string {
	if (line.startsWith("+++ ") || line.startsWith("--- ") || line.startsWith("diff --git")) return theme.fg("accent", line);
	if (line.startsWith("@@")) return theme.fg("warning", line);
	if (line.startsWith("+")) return theme.fg("success", line);
	if (line.startsWith("-")) return theme.fg("error", line);
	return theme.fg("muted", line);
}

/** Build wrapped, colored diff visual rows for one pane width. */
export function buildDiffVisualRows(diff: string, width: number, theme: PanelTheme): string[] {
	const lines: string[] = [];
	for (const line of diff.split("\n")) {
		for (const wrapped of wrapPanelLine(colorDiffLine(line, theme), width)) lines.push(wrapped);
	}
	return lines;
}

function pad(text: string, width: number): string {
	if (width <= 0) return "";
	const vis = visibleWidth(text);
	if (vis === width) return text;
	if (vis < width) return text + " ".repeat(width - vis);
	const clipped = truncateToWidth(text, width, "");
	const visClipped = visibleWidth(clipped);
	return visClipped < width ? clipped + " ".repeat(width - visClipped) : clipped;
}

function relCwd(cwd: string): string {
	const home = process.env.HOME;
	return home && cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd;
}

export class GitDiffPanel {
	private snapshot: GitSnapshot | undefined;
	private worktrees: GitWorktree[] = [];
	private worktreeSnapshots: Map<string, GitWorktreeSnapshot> = new Map();
	private activeWtIndex = 0; // 0..N-1 for specific worktree, -1 for ALL
	private rows: TreeRow[] = [];
	private selected = 0;
	private treeScroll = 0;
	private diffScroll = 0;
	private focus: FocusPane = "tree";
	private activeFile: GitChangedFile | undefined;
	private diff = "Loading git changes…";
	private collapsedDirs = new Set<string>();
	private loading = false;
	private error: string | undefined;

	private readonly cwd: string;
	private readonly tui: TuiLike;
	private readonly theme: Theme;
	private readonly done: Done;
	private readonly initialWorktree: string | undefined;

	constructor(cwd: string, tui: TuiLike, theme: Theme, done: Done, initialWorktree?: string) {
		this.cwd = cwd;
		this.tui = tui;
		this.theme = theme;
		this.done = done;
		this.initialWorktree = initialWorktree;
		void this.refresh();
	}

	async refresh(): Promise<void> {
		this.loading = true;
		this.error = undefined;
		this.tui.requestRender();
		try {
			this.snapshot = await readGitSnapshot(this.cwd);
			this.worktrees = this.snapshot.worktrees;
			this.worktreeSnapshots = this.snapshot.worktreeSnapshots;

			if (this.initialWorktree && this.activeWtIndex === 0) {
				const query = this.initialWorktree.toLowerCase();
				if (query === "all") {
					this.activeWtIndex = -1;
				} else {
					const matchIdx = this.worktrees.findIndex(
						(wt) => wt.branch.toLowerCase().includes(query) || wt.path.toLowerCase().includes(query),
					);
					if (matchIdx >= 0) this.activeWtIndex = matchIdx;
				}
			} else if (this.activeWtIndex !== -1) {
				const currentIdx = this.worktrees.findIndex((w) => w.isCurrent);
				if (this.activeWtIndex < 0 || this.activeWtIndex >= this.worktrees.length) {
					this.activeWtIndex = currentIdx >= 0 ? currentIdx : 0;
				}
			}

			this.rebuildRows();
			this.selected = this.rows.length === 0 ? 0 : Math.min(this.selected, this.rows.length - 1);
			if (this.rows[this.selected]?.kind !== "file") {
				this.selected = nearestFileIndex(this.rows, this.selected, 1);
			}
			await this.loadSelectedDiff();
		} catch (error) {
			this.error = error instanceof Error ? error.message : String(error);
		} finally {
			this.loading = false;
			this.tui.requestRender();
		}
	}

	private rebuildRows(): void {
		if (this.activeWtIndex === -1 && this.worktrees.length > 1) {
			this.rows = buildMultiWorktreeTreeRows(this.worktrees, this.worktreeSnapshots, this.collapsedDirs);
		} else {
			const activeWt = this.worktrees[this.activeWtIndex] ?? this.worktrees[0];
			const files = this.worktreeSnapshots.get(activeWt?.path ?? "")?.files ?? [];
			this.rows = buildTreeRows(files, this.collapsedDirs);
		}
	}

	private cycleWorktree(direction: 1 | -1): void {
		if (this.worktrees.length <= 1) return;
		const count = this.worktrees.length + 1; // 0..N-1 plus ALL (-1)
		const currentPos = this.activeWtIndex === -1 ? count - 1 : this.activeWtIndex;
		const nextPos = (currentPos + direction + count) % count;
		this.activeWtIndex = nextPos === count - 1 ? -1 : nextPos;

		this.rebuildRows();
		this.selected = 0;
		if (this.rows[this.selected]?.kind !== "file") {
			this.selected = nearestFileIndex(this.rows, 0, 1);
		}
		void this.loadSelectedDiff().finally(() => this.tui.requestRender());
	}

	private selectedFile(): GitChangedFile | undefined {
		return this.rows[this.selected]?.file;
	}

	private async loadSelectedDiff(): Promise<void> {
		const file = this.selectedFile();
		if (!file) {
			this.activeFile = undefined;
			this.diff = "No changed file selected.";
			return;
		}
		this.activeFile = file;
		this.diffScroll = 0;
		this.diff = await readFileDiff(this.cwd, file);
	}

	private move(delta: number): void {
		if (this.rows.length === 0) return;
		this.selected = Math.max(0, Math.min(this.rows.length - 1, this.selected + delta));
		if (this.rows[this.selected]?.kind === "file") {
			void this.loadSelectedDiff().finally(() => this.tui.requestRender());
		}
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || data === "q") return this.done(undefined);
		if (data === "r") return void this.refresh();
		if (data === "w") {
			if (this.worktrees.length > 1) {
				this.cycleWorktree(1);
				this.tui.requestRender();
			}
			return;
		}
		if (data === "W") {
			if (this.worktrees.length > 1) {
				this.cycleWorktree(-1);
				this.tui.requestRender();
			}
			return;
		}
		if (matchesKey(data, "tab")) {
			this.focus = this.focus === "tree" ? "diff" : "tree";
			this.tui.requestRender();
			return;
		}
		if ((matchesKey(data, "ctrl+j") && data !== "\r") || matchesKey(data, "pageDown") || matchesKey(data, "ctrl+d")) {
			this.scrollDiff(15);
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, "ctrl+k") || matchesKey(data, "pageUp") || matchesKey(data, "ctrl+u")) {
			this.scrollDiff(-15);
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, "return") || data === " ") {
			if (this.focus === "tree") {
				const row = this.rows[this.selected];
				if (row?.kind === "worktree" || row?.kind === "dir") {
					this.setRowCollapsed(row, row.expanded ?? true);
				} else if (row?.kind === "file") {
					this.focus = "diff";
				}
				this.tui.requestRender();
				return;
			}
		}
		if (data === "j" || matchesKey(data, "down")) {
			this.focus === "tree" ? this.move(1) : this.scrollDiff(1);
			this.tui.requestRender();
			return;
		}
		if (data === "k" || matchesKey(data, "up")) {
			this.focus === "tree" ? this.move(-1) : this.scrollDiff(-1);
			this.tui.requestRender();
			return;
		}
		if (data === "l" || matchesKey(data, "right")) {
			const row = this.rows[this.selected];
			if (this.focus === "tree" && (row?.kind === "worktree" || row?.kind === "dir")) {
				this.setRowCollapsed(row, false);
			} else {
				this.focus = "diff";
			}
			this.tui.requestRender();
			return;
		}
		if (data === "h" || matchesKey(data, "left")) {
			const row = this.rows[this.selected];
			if (this.focus === "tree" && (row?.kind === "worktree" || row?.kind === "dir")) {
				this.setRowCollapsed(row, true);
			} else {
				this.focus = "tree";
			}
			this.tui.requestRender();
			return;
		}
		if (data === "g") {
			if (this.focus === "tree") this.move(-this.rows.length);
			else this.diffScroll = 0;
			this.tui.requestRender();
			return;
		}
		if (data === "G") {
			if (this.focus === "tree") this.move(this.rows.length);
			else this.diffScroll = Math.max(0, this.diffLineCount() - 1);
			this.tui.requestRender();
			return;
		}
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		const hasWtBar = this.worktrees.length > 1;

		if (event.type === "wheel") {
			const delta = event.wheelDelta ?? (event.button === "none" ? 3 : 0);
			const direction = delta === 0 ? 0 : delta > 0 ? 1 : -1;
			const amount = Math.abs(delta) || 3;

			const inner = Math.max(0, event.width - 2);
			const treeWidth = Math.max(26, Math.floor(inner * 0.35));
			const overTree = event.x <= treeWidth + 1;

			if (overTree) {
				this.focus = "tree";
				this.move(direction > 0 ? 1 : -1);
			} else {
				this.focus = "diff";
				this.scrollDiff(direction * amount);
			}

			this.tui.requestRender();
			return { handled: true };
		}

		if (event.type === "press" && event.button === "left") {
			// Click on the rendered worktree bar line
			if (hasWtBar && this.lastFrame.wtBarY !== undefined && event.y === this.lastFrame.wtBarY) {
				this.cycleWorktree(1);
				this.tui.requestRender();
				return { handled: true };
			}

			const inner = Math.max(0, event.width - 2);
			const treeWidth = Math.max(26, Math.floor(inner * 0.35));
			const overTree = event.x <= treeWidth + 1;
			this.focus = overTree ? "tree" : "diff";

			// Rows wrap, so the click y maps through rendered visual lines, not item indexes.
			const visualLine = this.treeScroll + (event.y - this.lastFrame.treeStartY);
			if (overTree && event.y >= this.lastFrame.treeStartY) {
				const rowIdx = rowAtVisualLine(this.lastFrame.treeOwners, visualLine);
				if (rowIdx !== undefined && rowIdx >= 0 && rowIdx < this.rows.length) {
					const row = this.rows[rowIdx];
					this.selected = rowIdx;
					if (row?.kind === "worktree" || row?.kind === "dir") {
						this.setRowCollapsed(row, row.expanded ?? true);
					} else if (row?.kind === "file") {
						void this.loadSelectedDiff().finally(() => this.tui.requestRender());
					}
				}
			}

			this.tui.requestRender();
			return { handled: true };
		}

		return undefined;
	}

	private setRowCollapsed(row: TreeRow, collapsed: boolean): void {
		if (row.kind === "file") return;
		if (collapsed) this.collapsedDirs.add(row.path);
		else this.collapsedDirs.delete(row.path);
		const previousPath = row.path;
		this.rebuildRows();
		this.selected = Math.max(0, this.rows.findIndex((candidate) => candidate.path === previousPath));
	}

	private scrollDiff(delta: number): void {
		this.diffScroll = Math.max(0, Math.min(Math.max(0, this.diffLineCount() - 1), this.diffScroll + delta));
	}

	/** Visual diff row count from the last render (wrapping depends on pane width). */
	private diffLineCount(): number {
		return this.lastFrame.diffLineCount || this.diffLines().length;
	}

	private diffLines(): string[] {
		return this.diff.split("\n");
	}

	private lastFrame: {
		treeStartY: number;
		wtBarY: number | undefined;
		treeOwners: number[];
		diffLineCount: number;
	} = { treeStartY: 4, wtBarY: undefined, treeOwners: [], diffLineCount: 0 };

	render(width: number): string[] {
		if (width <= 0) return [];
		const panelWidth = Math.max(70, Math.min(width, Math.floor(width * 0.96)));
		const inner = panelWidth - 2;
		const treeWidth = Math.max(26, Math.floor(inner * 0.35));
		const diffWidth = Math.max(20, inner - treeWidth - 1);
		const termRows = (this.tui as { terminal?: { rows?: number } })?.terminal?.rows ?? process.stdout.rows ?? 40;
		const targetHeight = Math.max(24, Math.floor(termRows * 0.90));
		const height = Math.min(targetHeight, Math.max(20, termRows - 2));

		const hasWtBar = this.worktrees.length > 1;
		const summaryLines = wrapPanelLine(this.summary(), inner - 2);
		const wtBarLines = hasWtBar ? this.renderWorktreeBarLines(inner - 2) : [];
		const helpText = hasWtBar
			? "j/k move · ctrl+j/k scroll · h/l focus · w/W worktree · g/G ends · r refresh · q close"
			: "j/k move · ctrl+j/k scroll · h/l focus · g/G ends · r refresh · q close";
		const helpLines = wrapPanelLine(this.theme.fg("dim", helpText), inner - 2);
		const fixedRows = 1 + summaryLines.length + wtBarLines.length + 2 + helpLines.length + 1;
		const bodyHeight = Math.max(1, height - fixedRows);

		const title = ` git changes `;
		const top = `${this.theme.fg(CYAN, "╭")}${this.theme.fg(CYAN, "─".repeat(5))}${this.theme.fg("success", title)}${this.theme.fg(CYAN, "─".repeat(Math.max(0, inner - visibleWidth(title) - 5)))}${this.theme.fg(CYAN, "╮")}`;
		const sep = `${this.theme.fg(CYAN, "├")}${this.theme.fg(CYAN, "─".repeat(treeWidth))}${this.theme.fg(CYAN, "┬")}${this.theme.fg(CYAN, "─".repeat(diffWidth))}${this.theme.fg(CYAN, "┤")}`;
		const bottomSep = `${this.theme.fg(CYAN, "├")}${this.theme.fg(CYAN, "─".repeat(treeWidth))}${this.theme.fg(CYAN, "┴")}${this.theme.fg(CYAN, "─".repeat(diffWidth))}${this.theme.fg(CYAN, "┤")}`;
		const bottom = `${this.theme.fg(CYAN, "╰")}${this.theme.fg(CYAN, "─".repeat(inner))}${this.theme.fg(CYAN, "╯")}`;

		const lines: string[] = [top, ...summaryLines.map((line) => this.fullRow(line, inner))];
		const wtBarY = hasWtBar ? lines.length : undefined;
		for (const line of wtBarLines) lines.push(this.fullRow(line, inner));
		lines.push(sep);

		const treeHeader = wrapPanelLine(this.paneHeader("tree", "files", treeWidth - 2), treeWidth - 2);
		const treeBody = this.rows.length === 0
			? { lines: wrapPanelLine(this.theme.fg("success", "clean working tree"), treeWidth - 2), owners: [] as number[] }
			: buildTreeVisualRows(this.rows, treeWidth - 2, this.theme, this.selected);
		const diffRows = buildDiffVisualRows(this.diff, diffWidth - 2, this.theme);
		const diffHeader = wrapPanelLine(this.diffHeaderText(diffWidth - 2), diffWidth - 2);

		this.lastFrame = {
			treeStartY: lines.length + treeHeader.length,
			wtBarY,
			treeOwners: treeBody.owners,
			diffLineCount: diffRows.length,
		};

		const treeRowsAvailable = Math.max(0, bodyHeight - treeHeader.length);
		this.clampTreeScroll(treeBody.owners, treeRowsAvailable);
		this.diffScroll = Math.max(0, Math.min(Math.max(0, diffRows.length - 1), this.diffScroll));

		const treeSlice = treeBody.lines.slice(this.treeScroll, this.treeScroll + treeRowsAvailable);
		const diffAvailable = Math.max(0, bodyHeight - diffHeader.length);
		const diffSlice = diffRows.slice(this.diffScroll, this.diffScroll + diffAvailable);
		const treePane = [...treeHeader, ...treeSlice];
		const diffPane = [...diffHeader, ...diffSlice];

		for (let i = 0; i < bodyHeight; i++) {
			lines.push(`${this.theme.fg(CYAN, "│")} ${pad(treePane[i] ?? "", treeWidth - 2)} ${this.theme.fg(CYAN, "│")} ${pad(diffPane[i] ?? "", diffWidth - 2)} ${this.theme.fg(CYAN, "│")}`);
		}

		lines.push(bottomSep);
		for (const line of helpLines) lines.push(this.fullRow(line, inner));
		lines.push(bottom);
		return lines;
	}

	/** Keep the selected tree row fully visible using rendered visual line counts. */
	private clampTreeScroll(owners: number[], visibleRows: number): void {
		const maxScroll = Math.max(0, owners.length - Math.max(1, visibleRows));
		this.treeScroll = Math.max(0, Math.min(this.treeScroll, maxScroll));
		const start = owners.indexOf(this.selected);
		if (start < 0) return;
		const end = owners.lastIndexOf(this.selected);
		if (start < this.treeScroll) this.treeScroll = start;
		else if (end >= this.treeScroll + visibleRows) this.treeScroll = Math.max(0, end - visibleRows + 1);
		this.treeScroll = Math.max(0, Math.min(this.treeScroll, maxScroll));
	}

	private fullRow(content: string, inner: number): string {
		return `${this.theme.fg(CYAN, "│")} ${pad(content, inner - 2)} ${this.theme.fg(CYAN, "│")}`;
	}

	/** Worktree tabs wrap across lines instead of being clipped with an ellipsis. */
	private renderWorktreeBarLines(width: number): string[] {
		const label = `${this.theme.fg("muted", "worktrees:")} `;
		const tabs: string[] = [];

		for (let i = 0; i < this.worktrees.length; i++) {
			const wt = this.worktrees[i];
			const isActive = i === this.activeWtIndex;
			const isCurrent = wt.isCurrent ? "*" : "";
			const snap = this.worktreeSnapshots.get(wt.path);
			const fileCount = snap?.files.length ?? 0;
			const statStr = fileCount === 0 ? "clean" : `+${snap?.totalAdditions ?? 0}/-${snap?.totalDeletions ?? 0}`;

			const content = `${isActive ? "●" : "○"} ${wt.branch}${isCurrent} (${statStr})`;
			if (isActive) {
				tabs.push(this.theme.bold(this.theme.fg("accent", `[${content}]`)));
			} else {
				tabs.push(this.theme.fg("muted", `[${content}]`));
			}
		}

		// ALL tab
		const isAllActive = this.activeWtIndex === -1;
		let totalFiles = 0;
		for (const snap of this.worktreeSnapshots.values()) {
			totalFiles += snap.files.length;
		}
		const allContent = `${isAllActive ? "●" : "○"} ALL (${totalFiles})`;
		if (isAllActive) {
			tabs.push(this.theme.bold(this.theme.fg("accent", `[${allContent}]`)));
		} else {
			tabs.push(this.theme.fg("muted", `[${allContent}]`));
		}

		const hint = this.theme.fg("dim", "(w: switch)");
		const tabLines = wrapPanelLine(`${label}${tabs.join(" ")}`, width);
		const last = tabLines[tabLines.length - 1] ?? "";
		const lastWidth = visibleWidth(last);
		const hintWidth = visibleWidth(hint);

		if (lastWidth + 1 + hintWidth <= width) {
			tabLines[tabLines.length - 1] = `${last}${" ".repeat(Math.max(1, width - lastWidth - hintWidth))}${hint}`;
		} else {
			tabLines.push(`${" ".repeat(Math.max(0, width - hintWidth))}${hint}`);
		}
		return tabLines;
	}

	private summary(): string {
		if (this.error) return this.theme.fg("error", `git error: ${this.error}`);
		if (!this.snapshot) return this.theme.fg("warning", "loading git status…");

		if (this.worktrees.length > 1) {
			if (this.activeWtIndex === -1) {
				let totalAdd = 0;
				let totalDel = 0;
				let totalFiles = 0;
				for (const snap of this.worktreeSnapshots.values()) {
					totalAdd += snap.totalAdditions;
					totalDel += snap.totalDeletions;
					totalFiles += snap.files.length;
				}
				return [
					this.theme.fg("accent", `worktrees [ALL] (${this.worktrees.length})`),
					this.theme.fg("success", `+${totalAdd}`),
					this.theme.fg("error", `-${totalDel}`),
					this.theme.fg("accent", `${totalFiles} changed file${totalFiles === 1 ? "" : "s"}`),
					this.theme.fg(this.focus === "tree" ? "success" : "accent", `focus ${this.focus}`),
					this.loading ? this.theme.fg("warning", "refreshing…") : "",
				].filter(Boolean).join(this.theme.fg("muted", " · "));
			}

			const activeWt = this.worktrees[this.activeWtIndex] ?? this.worktrees[0];
			const snap = this.worktreeSnapshots.get(activeWt.path);
			const files = snap?.files.length ?? 0;
			return [
				this.theme.fg("accent", `wt [${this.activeWtIndex + 1}/${this.worktrees.length}]: ${activeWt.branch}${activeWt.isCurrent ? "*" : ""}`),
				this.theme.fg("dim", relCwd(activeWt.path)),
				this.theme.fg("success", `+${snap?.totalAdditions ?? 0}`),
				this.theme.fg("error", `-${snap?.totalDeletions ?? 0}`),
				this.theme.fg("accent", `${files} changed file${files === 1 ? "" : "s"}`),
				this.theme.fg(this.focus === "tree" ? "success" : "accent", `focus ${this.focus}`),
				this.loading ? this.theme.fg("warning", "refreshing…") : "",
			].filter(Boolean).join(this.theme.fg("muted", " · "));
		}

		const files = this.snapshot.files.length;
		return [
			this.theme.fg("accent", relCwd(this.cwd)),
			this.theme.fg("muted", "branch"),
			this.theme.fg("warning", this.snapshot.branch),
			this.theme.fg("success", `+${this.snapshot.totalAdditions}`),
			this.theme.fg("error", `-${this.snapshot.totalDeletions}`),
			this.theme.fg("accent", `${files} changed file${files === 1 ? "" : "s"}`),
			this.theme.fg(this.focus === "tree" ? "success" : "accent", `focus ${this.focus}`),
			this.loading ? this.theme.fg("warning", "refreshing…") : "",
		].filter(Boolean).join(this.theme.fg("muted", " · "));
	}

	private diffHeaderText(width: number): string {
		const file = this.activeFile ?? this.selectedFile();
		return `${this.paneHeader("diff", "diff", width)} ${file ? this.theme.fg("accent", file.path) : this.theme.fg("muted", "no file selected")}`;
	}

	private paneHeader(pane: FocusPane, label: string, width: number): string {
		const active = this.focus === pane;
		const marker = active ? this.theme.fg("success", "●") : this.theme.fg("muted", "○");
		const text = active ? this.theme.fg("accent", label.toUpperCase()) : this.theme.fg("muted", label);
		const used = visibleWidth(marker) + 1 + visibleWidth(label) + 1;
		return `${marker} ${text} ${this.theme.fg("muted", "─".repeat(Math.max(0, width - used)))}`;
	}

	invalidate(): void {}
	dispose(): void {}
}
