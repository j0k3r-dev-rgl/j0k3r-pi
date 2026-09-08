import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GitChangedFile {
	path: string;
	status: string;
	staged: boolean;
	unstaged: boolean;
	untracked: boolean;
	additions?: number;
	deletions?: number;
}

export interface GitSnapshot {
	cwd: string;
	branch: string;
	files: GitChangedFile[];
	totalAdditions: number;
	totalDeletions: number;
}

async function git(cwd: string, args: string[]): Promise<string> {
	const { stdout } = await execFileAsync("git", args, {
		cwd,
		timeout: 5000,
		maxBuffer: 1024 * 1024 * 8,
	});
	return stdout;
}

function parseStatus(output: string): GitChangedFile[] {
	return output.split("\n").filter(Boolean).map((line) => {
		const x = line[0] ?? " ";
		const y = line[1] ?? " ";
		const rawPath = line.slice(3);
		const path = rawPath.includes(" -> ") ? rawPath.split(" -> ").at(-1)! : rawPath;
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
		const filePath = pathParts.join("\t");
		if (!filePath) continue;
		const additions = added === "-" ? 0 : Number(added) || 0;
		const deletions = deleted === "-" ? 0 : Number(deleted) || 0;
		const current = stats.get(filePath) ?? { additions: 0, deletions: 0 };
		stats.set(filePath, { additions: current.additions + additions, deletions: current.deletions + deletions });
	}
	return stats;
}

export async function readGitSnapshot(cwd: string): Promise<GitSnapshot> {
	const [branchOutput, statusOutput, unstagedStat, stagedStat] = await Promise.all([
		git(cwd, ["branch", "--show-current"]).catch(() => ""),
		git(cwd, ["status", "--porcelain=v1", "--untracked-files=all"]).catch(() => ""),
		git(cwd, ["diff", "--numstat"]).catch(() => ""),
		git(cwd, ["diff", "--cached", "--numstat"]).catch(() => ""),
	]);
	const stats = parseNumstat(`${unstagedStat}\n${stagedStat}`);
	const files = parseStatus(statusOutput).map((file) => ({ ...file, ...stats.get(file.path) })).sort((a, b) => a.path.localeCompare(b.path));
	return {
		cwd,
		branch: branchOutput.trim() || "detached",
		files,
		totalAdditions: files.reduce((sum, file) => sum + (file.additions ?? 0), 0),
		totalDeletions: files.reduce((sum, file) => sum + (file.deletions ?? 0), 0),
	};
}

function syntheticUntrackedDiff(cwd: string, filePath: string): Promise<string> {
	return readFile(join(cwd, filePath), "utf8").then((content) => {
		const lines = content.split("\n");
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
	}).catch(() => `Untracked file: ${filePath}\nBinary or unreadable file.`);
}

export async function readFileDiff(cwd: string, file: GitChangedFile | undefined): Promise<string> {
	if (!file) return "No changed file selected.";
	if (file.untracked) return syntheticUntrackedDiff(cwd, file.path);
	const parts: string[] = [];
	if (file.staged) {
		const staged = await git(cwd, ["--no-pager", "diff", "--cached", "--", file.path]).catch(() => "");
		if (staged.trim()) parts.push(staged);
	}
	if (file.unstaged || parts.length === 0) {
		const unstaged = await git(cwd, ["--no-pager", "diff", "--", file.path]).catch(() => "");
		if (unstaged.trim()) parts.push(unstaged);
	}
	return parts.join("\n") || `No textual diff for ${file.path}`;
}
