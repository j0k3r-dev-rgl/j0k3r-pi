import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GitWorktree {
	path: string;
	head: string;
	branch: string;
	bare?: boolean;
	locked?: boolean;
	prunable?: boolean;
	isCurrent: boolean;
}

export interface GitChangedFile {
	path: string;
	worktreePath?: string;
	worktreeBranch?: string;
	status: string;
	staged: boolean;
	unstaged: boolean;
	untracked: boolean;
	additions?: number;
	deletions?: number;
}

export interface GitWorktreeSnapshot {
	worktree: GitWorktree;
	files: GitChangedFile[];
	totalAdditions: number;
	totalDeletions: number;
}

export interface GitSnapshot {
	cwd: string;
	branch: string;
	files: GitChangedFile[];
	totalAdditions: number;
	totalDeletions: number;
	worktrees: GitWorktree[];
	worktreeSnapshots: Map<string, GitWorktreeSnapshot>;
}

async function git(cwd: string, args: string[]): Promise<string> {
	const { stdout } = await execFileAsync("git", args, {
		cwd,
		timeout: 5000,
		maxBuffer: 1024 * 1024 * 8,
	});
	return stdout;
}

function cleanGitPath(raw: string): string {
	let p = raw.trim();
	if (p.startsWith('"') && p.endsWith('"')) {
		try {
			p = JSON.parse(p);
		} catch {
			p = p.slice(1, -1);
		}
	}
	return p;
}

function parseStatus(output: string): GitChangedFile[] {
	return output.split("\n").filter(Boolean).map((line) => {
		const x = line[0] ?? " ";
		const y = line[1] ?? " ";
		let rawPath = line.slice(3);
		if (rawPath.includes(" -> ")) {
			rawPath = rawPath.split(" -> ").at(-1)!;
		}
		const path = cleanGitPath(rawPath);
		const untracked = x === "?" && y === "?";
		return {
			path,
			status: untracked ? "??" : `${x}${y}`.trim(),
			staged: !untracked && x !== " " && x !== "?",
			unstaged: !untracked && y !== " " && y !== "?",
			untracked,
		};
	});
}

function parseNumstat(output: string): Map<string, { additions: number; deletions: number }> {
	const stats = new Map<string, { additions: number; deletions: number }>();
	for (const line of output.split("\n")) {
		if (!line.trim()) continue;
		const [added, deleted, ...pathParts] = line.split("\t");
		let filePath = pathParts.join("\t");
		if (!filePath) continue;
		filePath = cleanGitPath(filePath);
		if (filePath.includes(" => ")) {
			filePath = filePath.replace(/\{.*? => (.*?)\}/g, "$1").replace(/.*? => (.*)/, "$1");
		}
		const additions = added === "-" ? 0 : Number(added) || 0;
		const deletions = deleted === "-" ? 0 : Number(deleted) || 0;
		const current = stats.get(filePath) ?? { additions: 0, deletions: 0 };
		stats.set(filePath, { additions: current.additions + additions, deletions: current.deletions + deletions });
	}
	return stats;
}

async function countUntrackedLines(cwd: string, filePath: string): Promise<number> {
	try {
		const buffer = await readFile(join(cwd, filePath));
		const checkLen = Math.min(buffer.length, 8000);
		for (let i = 0; i < checkLen; i++) {
			if (buffer[i] === 0) return 0;
		}
		const content = buffer.toString("utf8");
		if (!content) return 0;
		const trimmed = content.endsWith("\n") ? content.slice(0, -1) : content;
		return trimmed.length === 0 ? 0 : trimmed.split("\n").length;
	} catch {
		return 0;
	}
}

export async function listWorktrees(cwd: string): Promise<GitWorktree[]> {
	try {
		const stdout = await git(cwd, ["worktree", "list", "--porcelain"]);
		const blocks = stdout.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
		const currentResolved = resolve(cwd);
		const worktrees: GitWorktree[] = [];

		for (const block of blocks) {
			const lines = block.split("\n");
			let wtPath = "";
			let head = "";
			let branch = "";
			let bare = false;
			let locked = false;
			let prunable = false;

			for (const line of lines) {
				if (line.startsWith("worktree ")) {
					wtPath = line.slice(9).trim();
				} else if (line.startsWith("HEAD ")) {
					head = line.slice(5).trim();
				} else if (line.startsWith("branch ")) {
					branch = line.slice(7).trim().replace(/^refs\/heads\//, "");
				} else if (line === "detached") {
					branch = "detached";
				} else if (line === "bare") {
					bare = true;
				} else if (line.startsWith("locked")) {
					locked = true;
				} else if (line.startsWith("prunable")) {
					prunable = true;
				}
			}

			if (wtPath) {
				worktrees.push({
					path: wtPath,
					head,
					branch: branch || (bare ? "bare" : head.slice(0, 7) || "unknown"),
					bare,
					locked,
					prunable,
					isCurrent: false,
				});
			}
		}

		let bestIdx = -1;
		let bestLen = -1;
		for (let i = 0; i < worktrees.length; i++) {
			const r = resolve(worktrees[i].path);
			if (currentResolved === r || currentResolved.startsWith(`${r}/`)) {
				if (r.length > bestLen) {
					bestLen = r.length;
					bestIdx = i;
				}
			}
		}
		if (bestIdx >= 0) {
			worktrees[bestIdx].isCurrent = true;
		} else if (worktrees.length > 0) {
			worktrees[0].isCurrent = true;
		}

		return worktrees.length > 0
			? worktrees
			: [{ path: cwd, head: "", branch: "detached", isCurrent: true }];
	} catch {
		const branch = await git(cwd, ["branch", "--show-current"]).catch(() => "unknown");
		return [{ path: cwd, head: "", branch: branch.trim() || "detached", isCurrent: true }];
	}
}

async function readSingleWorktreeSnapshot(wt: GitWorktree): Promise<GitWorktreeSnapshot> {
	const [statusOutput, unstagedStat, stagedStat] = await Promise.all([
		git(wt.path, ["status", "--porcelain=v1", "--untracked-files=all"]).catch(() => ""),
		git(wt.path, ["diff", "--numstat"]).catch(() => ""),
		git(wt.path, ["diff", "--cached", "--numstat"]).catch(() => ""),
	]);
	const stats = parseNumstat(`${unstagedStat}\n${stagedStat}`);
	const parsedFiles = parseStatus(statusOutput);
	const files: GitChangedFile[] = await Promise.all(
		parsedFiles.map(async (file) => {
			const stat = stats.get(file.path);
			let additions = 0;
			let deletions = 0;
			if (stat) {
				additions = stat.additions;
				deletions = stat.deletions;
			} else if (file.untracked) {
				additions = await countUntrackedLines(wt.path, file.path);
			}
			return {
				...file,
				worktreePath: wt.path,
				worktreeBranch: wt.branch,
				additions,
				deletions,
			};
		}),
	);
	files.sort((a, b) => a.path.localeCompare(b.path));
	return {
		worktree: wt,
		files,
		totalAdditions: files.reduce((sum, file) => sum + (file.additions ?? 0), 0),
		totalDeletions: files.reduce((sum, file) => sum + (file.deletions ?? 0), 0),
	};
}

export async function readGitSnapshot(cwd: string): Promise<GitSnapshot> {
	const worktrees = await listWorktrees(cwd);
	const worktreeSnapshots = new Map<string, GitWorktreeSnapshot>();

	const snapshots = await Promise.all(worktrees.map((wt) => readSingleWorktreeSnapshot(wt)));
	for (const snap of snapshots) {
		worktreeSnapshots.set(snap.worktree.path, snap);
	}

	const currentWt = worktrees.find((w) => w.isCurrent) ?? worktrees[0] ?? {
		path: cwd,
		head: "",
		branch: "detached",
		isCurrent: true,
	};
	const currentSnap = worktreeSnapshots.get(currentWt.path);

	return {
		cwd: currentWt.path,
		branch: currentWt.branch,
		files: currentSnap?.files ?? [],
		totalAdditions: currentSnap?.totalAdditions ?? 0,
		totalDeletions: currentSnap?.totalDeletions ?? 0,
		worktrees,
		worktreeSnapshots,
	};
}

async function syntheticUntrackedDiff(cwd: string, filePath: string): Promise<string> {
	try {
		const buffer = await readFile(join(cwd, filePath));
		const checkLen = Math.min(buffer.length, 8000);
		for (let i = 0; i < checkLen; i++) {
			if (buffer[i] === 0) {
				return [
					`diff --git a/${filePath} b/${filePath}`,
					"new file mode 100644",
					`Binary file ${filePath} added.`,
				].join("\n");
			}
		}
		const content = buffer.toString("utf8");
		const trimmed = content.endsWith("\n") ? content.slice(0, -1) : content;
		const lines = trimmed.length === 0 ? [] : trimmed.split("\n");
		const truncated = lines.length > 2000;
		const shown = truncated ? lines.slice(0, 2000) : lines;
		return [
			`diff --git a/${filePath} b/${filePath}`,
			"new file mode 100644",
			"--- /dev/null",
			`+++ b/${filePath}`,
			`@@ -0,0 +1,${lines.length} @@`,
			...shown.map((line) => `+${line}`),
			...(truncated ? [`+… truncated ${lines.length - shown.length} more lines`] : []),
		].join("\n");
	} catch {
		return `Untracked file: ${filePath}\nBinary or unreadable file.`;
	}
}

export async function readFileDiff(cwd: string, file: GitChangedFile | undefined): Promise<string> {
	if (!file) return "No changed file selected.";
	const targetCwd = file.worktreePath || cwd;
	if (file.untracked) return syntheticUntrackedDiff(targetCwd, file.path);
	const parts: string[] = [];
	if (file.staged) {
		const staged = await git(targetCwd, ["--no-pager", "diff", "--cached", "--", file.path]).catch(() => "");
		if (staged.trim()) parts.push(staged);
	}
	if (file.unstaged || parts.length === 0) {
		const unstaged = await git(targetCwd, ["--no-pager", "diff", "--", file.path]).catch(() => "");
		if (unstaged.trim()) parts.push(unstaged);
	}
	return parts.join("\n") || `No textual diff for ${file.path}`;
}
