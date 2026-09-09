import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { J0k3rThemeEditor } from "./src/J0k3rThemeEditor.js";
import { J0k3rThemeFooter, type RepoGitInfo } from "./src/J0k3rThemeFooter.js";
import { J0k3rThemeHeader, type J0k3rThemeHeaderData } from "./src/J0k3rThemeHeader.js";

const extensionDir = dirname(fileURLToPath(import.meta.url));
const globalAgentDir = dirname(dirname(extensionDir));

function getSkillNameFromMarkdown(filePath: string, fallback: string): string {
	try {
		const content = readFileSync(filePath, "utf8");
		const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
		const name = match?.[1]?.match(/^name:\s*["']?([^"'\n]+)["']?\s*$/m)?.[1]?.trim();
		return name || fallback;
	} catch {
		return fallback;
	}
}

function discoverSkillsInDir(root: string, includeRootMarkdown: boolean): string[] {
	if (!existsSync(root)) return [];
	const names: string[] = [];
	const walk = (dir: string, isRoot: boolean) => {
		for (const entry of readdirSync(dir)) {
			const fullPath = join(dir, entry);
			const stat = statSync(fullPath);
			if (stat.isDirectory()) {
				const skillFile = join(fullPath, "SKILL.md");
				if (existsSync(skillFile)) {
					names.push(getSkillNameFromMarkdown(skillFile, entry));
					continue;
				}
				walk(fullPath, false);
				continue;
			}
			if (includeRootMarkdown && isRoot && stat.isFile() && entry.endsWith(".md") && entry !== "SKILL.md") {
				names.push(getSkillNameFromMarkdown(fullPath, entry.replace(/\.md$/, "")));
			}
		}
	};
	walk(root, true);
	return names;
}

function gitRoot(cwd: string): string | undefined {
	let current = resolve(cwd);
	while (true) {
		if (existsSync(join(current, ".git"))) return current;
		const parent = dirname(current);
		if (parent === current) return undefined;
		current = parent;
	}
}

function projectAncestors(cwd: string): string[] {
	const fallbackRoot = resolve(cwd).split(/[\\/]/).slice(0, 2).join("/") || "/";
	const root = gitRoot(cwd) ?? fallbackRoot;
	const dirs: string[] = [];
	let current = resolve(cwd);
	while (true) {
		dirs.push(current);
		if (current === root) break;
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	return dirs;
}

function listDetectedSkills(cwd: string): string[] {
	const home = process.env.HOME;
	const names = [
		...discoverSkillsInDir(join(globalAgentDir, "skills"), true),
		...(home ? discoverSkillsInDir(join(home, ".agents", "skills"), false) : []),
		...discoverSkillsInDir(join(cwd, ".pi", "skills"), true),
		...projectAncestors(cwd).flatMap((dir) => discoverSkillsInDir(join(dir, ".agents", "skills"), false)),
	];
	return [...new Set(names)].sort();
}

function listGlobalExtensions(): string[] {
	const extensionsDir = join(globalAgentDir, "extensions");
	if (!existsSync(extensionsDir)) return [];

	return readdirSync(extensionsDir).filter((entry) => {
		const fullPath = join(extensionsDir, entry);
		const stat = statSync(fullPath);
		if (stat.isDirectory()) return existsSync(join(fullPath, "index.ts")) || existsSync(join(fullPath, "index.js"));
		return stat.isFile() && [".ts", ".js"].includes(extname(entry));
	}).map((entry) => entry.replace(/\.(?:ts|js)$/, "")).sort();
}

function parseRepoName(remoteUrl: string): string | undefined {
	const trimmed = remoteUrl.trim();
	if (!trimmed) return undefined;
	// Match git@host:owner/repo.git or https://host/owner/repo.git or https://host/owner/repo
	const match = trimmed.match(/[:/]([^/:]+?)(?:\.git)?$/);
	return match?.[1] || undefined;
}

export default function j0k3rThemeExtension(pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;

		const headerData: J0k3rThemeHeaderData = {
			projectName: basename(ctx.cwd),
			skillNames: listDetectedSkills(ctx.cwd),
			extensionNames: listGlobalExtensions(),
		};
		const footerGitInfo: RepoGitInfo = {
			dir: ctx.cwd,
		};
		let activeHeader: J0k3rThemeHeader | undefined;
		let activeFooter: J0k3rThemeFooter | undefined;
		let requestUIRender: (() => void) | undefined;

		void Promise.all([
			pi.exec("git", ["branch", "--show-current"], { cwd: ctx.cwd, timeout: 1000 }).catch(() => null),
			pi.exec("git", ["remote", "get-url", "origin"], { cwd: ctx.cwd, timeout: 1000 })
				.then((res) => (res && res.code === 0 ? res : pi.exec("git", ["remote"], { cwd: ctx.cwd, timeout: 1000 })
					.then((rList) => {
						const firstRemote = rList && rList.code === 0 ? rList.stdout.trim().split("\n")[0]?.trim() : "";
						return firstRemote ? pi.exec("git", ["remote", "get-url", firstRemote], { cwd: ctx.cwd, timeout: 1000 }) : null;
					})
				))
				.catch(() => null),
		]).then(([branchRes, remoteRes]) => {
			let changed = false;
			const branch = branchRes && branchRes.code === 0 ? branchRes.stdout.trim() : "";
			if (branch.length > 0) {
				headerData.branch = branch;
				footerGitInfo.branch = branch;
				changed = true;
			}
			const remoteUrl = remoteRes && remoteRes.code === 0 ? remoteRes.stdout.trim() : "";
			const repoName = parseRepoName(remoteUrl);
			if (repoName) {
				footerGitInfo.repoName = repoName;
				changed = true;
			}
			if (changed) {
				activeHeader?.setData(headerData);
				activeFooter?.setGitInfo(footerGitInfo);
				requestUIRender?.();
			}
		}).catch(() => undefined);

		ctx.ui.setHeader((tui, theme) => {
			activeHeader = new J0k3rThemeHeader(theme, headerData, ctx.ui.getToolsExpanded());
			requestUIRender = () => tui.requestRender();
			return activeHeader;
		});
		ctx.ui.setEditorComponent((tui, theme, keybindings) => new J0k3rThemeEditor(tui, theme, keybindings));
		ctx.ui.setFooter((tui, theme, footerData) => {
			activeFooter = new J0k3rThemeFooter(tui, theme, footerData, ctx, () => pi.getThinkingLevel(), footerGitInfo);
			requestUIRender = () => tui.requestRender();
			return activeFooter;
		});
	});

	pi.on("before_agent_start", (event) => ({
		systemPrompt: `${event.systemPrompt}\n\nYou are j0k3r-pi. The user's preferred pseudonym is j0k3r; greet and address them as j0k3r when it is natural.`,
	}));
}
