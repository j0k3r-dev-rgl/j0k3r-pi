import type { Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import { readFileDiff, readGitSnapshot, type GitChangedFile, type GitSnapshot } from "./git.js";
import { buildTreeRows, nearestFileIndex, type TreeRow } from "./tree.js";

const CYAN = "accent";

type FocusPane = "tree" | "diff";

type TuiLike = { requestRender(): void };

type Done = (value: undefined) => void;

function pad(text: string, width: number): string {
	const clipped = truncateToWidth(text, Math.max(0, width), "");
	return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

function relCwd(cwd: string): string {
	const home = process.env.HOME;
	return home && cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd;
}

export class GitDiffPanel {
	private snapshot: GitSnapshot | undefined;
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

	constructor(
		private readonly cwd: string,
		private readonly tui: TuiLike,
		private readonly theme: Theme,
		private readonly done: Done,
	) {
		void this.refresh();
	}

	async refresh(): Promise<void> {
		this.loading = true;
		this.error = undefined;
		this.tui.requestRender();
		try {
			this.snapshot = await readGitSnapshot(this.cwd);
			this.rebuildRows();
			this.selected = this.rows.length === 0 ? 0 : Math.min(this.selected, this.rows.length - 1);
			if (this.rows[this.selected]?.kind !== "file") this.selected = nearestFileIndex(this.rows, this.selected, 1);
			await this.loadSelectedDiff();
		} catch (error) {
			this.error = error instanceof Error ? error.message : String(error);
		} finally {
			this.loading = false;
			this.tui.requestRender();
		}
	}

	private rebuildRows(): void {
		this.rows = buildTreeRows(this.snapshot?.files ?? [], this.collapsedDirs);
	}

	private selectedFile(): GitChangedFile | undefined {
		return this.rows[this.selected]?.file;
	}

	private async loadSelectedDiff(): Promise<void> {
		const file = this.selectedFile();
		if (!file) return;
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
				if (row?.kind === "dir") {
					this.setDirCollapsed(row, row.expanded ?? true);
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
			if (this.focus === "tree" && row?.kind === "dir") this.setDirCollapsed(row, false);
			else this.focus = "diff";
			this.tui.requestRender();
			return;
		}
		if (data === "h" || matchesKey(data, "left")) {
			const row = this.rows[this.selected];
			if (this.focus === "tree" && row?.kind === "dir") this.setDirCollapsed(row, true);
			else this.focus = "tree";
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
			else this.diffScroll = Math.max(0, this.diffLines().length - 1);
			this.tui.requestRender();
			return;
		}
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type === "wheel") {
			const delta = event.wheelDelta ?? (event.button === "none" ? 3 : 0);
			const direction = delta === 0 ? 0 : delta > 0 ? 1 : -1;
			const amount = Math.abs(delta) || 3;

			// Split boundary: check if cursor is over tree or diff based on X coordinate
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
			const inner = Math.max(0, event.width - 2);
			const treeWidth = Math.max(26, Math.floor(inner * 0.35));
			const overTree = event.x <= treeWidth + 1;
			this.focus = overTree ? "tree" : "diff";

			if (overTree && event.y >= 4) {
				const rowIdx = this.treeScroll + (event.y - 4);
				if (rowIdx >= 0 && rowIdx < this.rows.length) {
					const row = this.rows[rowIdx];
					this.selected = rowIdx;
					if (row?.kind === "dir") {
						this.setDirCollapsed(row, row.expanded ?? true);
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

	private setDirCollapsed(row: TreeRow, collapsed: boolean): void {
		if (row.kind !== "dir") return;
		if (collapsed) this.collapsedDirs.add(row.path);
		else this.collapsedDirs.delete(row.path);
		const previousPath = row.path;
		this.rebuildRows();
		this.selected = Math.max(0, this.rows.findIndex((candidate) => candidate.path === previousPath));
	}

	private scrollDiff(delta: number): void {
		this.diffScroll = Math.max(0, Math.min(Math.max(0, this.diffLines().length - 1), this.diffScroll + delta));
	}

	private diffLines(): string[] {
		return this.diff.split("\n");
	}

	render(width: number): string[] {
		if (width <= 0) return [];
		const panelWidth = Math.max(70, Math.min(width, Math.floor(width * 0.96)));
		const inner = panelWidth - 2;
		const treeWidth = Math.max(26, Math.floor(inner * 0.35));
		const diffWidth = Math.max(20, inner - treeWidth - 1);
		const termRows = (this.tui as { terminal?: { rows?: number } })?.terminal?.rows ?? process.stdout.rows ?? 40;
		const targetHeight = Math.max(24, Math.floor(termRows * 0.90));
		const height = Math.min(targetHeight, Math.max(20, termRows - 2));
		const bodyHeight = height - 5;
		const title = ` git changes `;
		const top = `${this.theme.fg(CYAN, "╭")}${this.theme.fg(CYAN, "─".repeat(5))}${this.theme.fg("success", title)}${this.theme.fg(CYAN, "─".repeat(Math.max(0, inner - visibleWidth(title) - 5)))}${this.theme.fg(CYAN, "╮")}`;
		const sep = `${this.theme.fg(CYAN, "├")}${this.theme.fg(CYAN, "─".repeat(treeWidth))}${this.theme.fg(CYAN, "┬")}${this.theme.fg(CYAN, "─".repeat(diffWidth))}${this.theme.fg(CYAN, "┤")}`;
		const bottomSep = `${this.theme.fg(CYAN, "├")}${this.theme.fg(CYAN, "─".repeat(treeWidth))}${this.theme.fg(CYAN, "┴")}${this.theme.fg(CYAN, "─".repeat(diffWidth))}${this.theme.fg(CYAN, "┤")}`;
		const bottom = `${this.theme.fg(CYAN, "╰")}${this.theme.fg(CYAN, "─".repeat(inner))}${this.theme.fg(CYAN, "╯")}`;
		const summary = this.summary();
		const lines = [top, this.fullRow(summary, inner), sep];
		const treeRows = this.renderTree(bodyHeight, treeWidth - 2);
		const diffRows = this.renderDiff(bodyHeight, diffWidth - 2);
		for (let i = 0; i < bodyHeight; i++) {
			lines.push(`${this.theme.fg(CYAN, "│")} ${pad(treeRows[i] ?? "", treeWidth - 2)} ${this.theme.fg(CYAN, "│")} ${pad(diffRows[i] ?? "", diffWidth - 2)} ${this.theme.fg(CYAN, "│")}`);
		}
		lines.push(bottomSep);
		lines.push(this.fullRow(this.theme.fg("dim", "j/k move · ctrl+j/k scroll · h/l focus · g/G ends · r refresh · q close"), inner));
		lines.push(bottom);
		return lines;
	}

	private fullRow(content: string, inner: number): string {
		return `${this.theme.fg(CYAN, "│")} ${pad(content, inner - 2)} ${this.theme.fg(CYAN, "│")}`;
	}

	private summary(): string {
		if (this.error) return this.theme.fg("error", `git error: ${this.error}`);
		if (!this.snapshot) return this.theme.fg("warning", "loading git status…");
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

	private fileChangeStyle(file: GitChangedFile | undefined): { label: string; color: Parameters<Theme["fg"]>[0] } {
		if (!file) return { label: "", color: "text" };
		const raw = file.untracked ? "A" : file.status || "M";
		if (raw.includes("D")) return { label: "D", color: "error" };
		if (raw.includes("R")) return { label: "R", color: "warning" };
		if (raw.includes("C")) return { label: "C", color: "warning" };
		if (raw.includes("A") || file.untracked) return { label: "A", color: "success" };
		if (raw.includes("M")) return { label: "M", color: "accent" };
		return { label: raw.trim() || "M", color: "text" };
	}

	private renderTree(height: number, width: number): string[] {
		const header = this.paneHeader("tree", "files");
		const listHeight = Math.max(0, height - 1);
		if (this.rows.length === 0) return [header, this.theme.fg("success", "clean working tree")];
		if (this.selected < this.treeScroll) this.treeScroll = this.selected;
		if (this.selected >= this.treeScroll + listHeight) this.treeScroll = this.selected - listHeight + 1;
		return [header, ...this.rows.slice(this.treeScroll, this.treeScroll + listHeight).map((row, offset) => {
			const index = this.treeScroll + offset;
			const selected = index === this.selected;
			const prefix = selected ? this.theme.fg("accent", "▶ ") : "  ";
			const indent = "  ".repeat(row.depth);
			if (row.kind === "dir") return this.theme.fg(row.expanded ? "accent" : "muted", `${prefix}${indent}${row.expanded ? "▾" : "▸"} ${row.name}`);
			const style = this.fileChangeStyle(row.file);
			const stat = row.file ? this.theme.fg("success", `+${row.file.additions ?? 0}`) + this.theme.fg("muted", "/") + this.theme.fg("error", `-${row.file.deletions ?? 0}`) : "";
			return `${prefix}${indent}${this.theme.fg(style.color, style.label.padEnd(2))} ${this.theme.fg(style.color, row.name)} ${stat}`;
		})];
	}

	private paneHeader(pane: FocusPane, label: string): string {
		const active = this.focus === pane;
		const marker = active ? this.theme.fg("success", "●") : this.theme.fg("muted", "○");
		const text = active ? this.theme.fg("accent", label.toUpperCase()) : this.theme.fg("muted", label);
		return `${marker} ${text} ${this.theme.fg("muted", "─".repeat(24))}`;
	}

	private renderDiff(height: number, width: number): string[] {
		const file = this.activeFile ?? this.selectedFile();
		const header = `${this.paneHeader("diff", "diff")} ${file ? this.theme.fg("accent", file.path) : this.theme.fg("muted", "no file selected")}`;
		const diff = this.diffLines().slice(this.diffScroll, this.diffScroll + Math.max(0, height - 1)).map((line) => this.colorDiffLine(line));
		return [header, ...diff].slice(0, height).map((line) => truncateToWidth(line, width, ""));
	}

	private colorDiffLine(line: string): string {
		if (line.startsWith("+++ ") || line.startsWith("--- ") || line.startsWith("diff --git")) return this.theme.fg("accent", line);
		if (line.startsWith("@@")) return this.theme.fg("warning", line);
		if (line.startsWith("+")) return this.theme.fg("success", line);
		if (line.startsWith("-")) return this.theme.fg("error", line);
		return this.theme.fg("muted", line);
	}

	invalidate(): void {}
	dispose(): void {}
}
