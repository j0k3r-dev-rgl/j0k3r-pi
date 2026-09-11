import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	DefaultPackageManager,
	SettingsManager,
	getAgentDir,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { ARCH_WORKING_INDICATOR, J0k3rThemeEditor } from "./src/J0k3rThemeEditor.js";
import { J0k3rThemeFooter, type RepoGitInfo } from "./src/J0k3rThemeFooter.js";
import { J0k3rThemeHeader, type J0k3rThemeHeaderData } from "./src/J0k3rThemeHeader.js";

const extensionDir = dirname(fileURLToPath(import.meta.url));
const globalAgentDir = dirname(dirname(extensionDir));

function parseJsonFile(filePath: string): any {
	try {
		if (!existsSync(filePath)) return null;
		return JSON.parse(readFileSync(filePath, "utf8"));
	} catch {
		return null;
	}
}

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
		try {
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
		} catch {
			// ignore unreadable directory
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

function detectLocalExtensionsInDir(dir: string): string[] {
	if (!existsSync(dir)) return [];
	const names: string[] = [];
	try {
		for (const entry of readdirSync(dir)) {
			const fullPath = join(dir, entry);
			const stat = statSync(fullPath);
			if (stat.isDirectory()) {
				if (
					existsSync(join(fullPath, "index.ts")) ||
					existsSync(join(fullPath, "index.js")) ||
					existsSync(join(fullPath, "package.json"))
				) {
					names.push(entry);
				}
			} else if (stat.isFile() && [".ts", ".js"].includes(extname(entry))) {
				names.push(entry.replace(/\.(?:ts|js)$/, ""));
			}
		}
	} catch {
		// ignore
	}
	return names;
}

function getExtensionDisplayName(resource: { path: string; metadata?: any }): string {
	if (resource.metadata?.origin === "package") {
		if (typeof resource.metadata.source === "string") {
			const src = resource.metadata.source;
			const clean = src.replace(/^(?:npm|git):/, "").split("@")[0];
			if (clean) return clean;
		}
		if (resource.metadata.baseDir) {
			const pkg = parseJsonFile(join(resource.metadata.baseDir, "package.json"));
			if (pkg?.name) return pkg.name;
			return basename(resource.metadata.baseDir);
		}
	}

	const fileName = basename(resource.path);
	if (fileName === "index.ts" || fileName === "index.js") {
		return basename(dirname(resource.path));
	}
	return fileName.replace(/\.(?:ts|js)$/, "");
}

function getSkillDisplayName(skillPath: string): string {
	const fileName = basename(skillPath);
	if (fileName === "SKILL.md") {
		return getSkillNameFromMarkdown(skillPath, basename(dirname(skillPath)));
	}
	if (fileName.endsWith(".md")) {
		return getSkillNameFromMarkdown(skillPath, fileName.replace(/\.md$/, ""));
	}
	return basename(dirname(skillPath));
}

function detectResourcesSync(cwd: string): { extensionNames: string[]; skillNames: string[] } {
	const extensionNames = new Set<string>();
	const skillNames = new Set<string>();

	// 1. Local extensions
	for (const ext of detectLocalExtensionsInDir(join(globalAgentDir, "extensions"))) {
		extensionNames.add(ext);
	}
	for (const ext of detectLocalExtensionsInDir(join(cwd, ".pi", "extensions"))) {
		extensionNames.add(ext);
	}

	// 2. Local skills
	const home = process.env.HOME;
	for (const sk of discoverSkillsInDir(join(globalAgentDir, "skills"), true)) skillNames.add(sk);
	if (home) {
		for (const sk of discoverSkillsInDir(join(home, ".agents", "skills"), false)) skillNames.add(sk);
	}
	for (const sk of discoverSkillsInDir(join(cwd, ".pi", "skills"), true)) skillNames.add(sk);
	for (const dir of projectAncestors(cwd)) {
		for (const sk of discoverSkillsInDir(join(dir, ".agents", "skills"), false)) skillNames.add(sk);
	}

	// 3. Settings packages & extensions
	const settingsFiles = [join(globalAgentDir, "settings.json"), join(cwd, ".pi", "settings.json")];
	for (const sf of settingsFiles) {
		const settings = parseJsonFile(sf);
		if (!settings) continue;

		if (Array.isArray(settings.extensions)) {
			for (const extPath of settings.extensions) {
				if (typeof extPath === "string") {
					extensionNames.add(basename(extPath).replace(/\.(?:ts|js)$/, ""));
				}
			}
		}

		if (Array.isArray(settings.packages)) {
			for (const pkgItem of settings.packages) {
				const source = typeof pkgItem === "string" ? pkgItem : pkgItem.source;
				if (!source || typeof source !== "string") continue;

				const cleanName = source.replace(/^(?:npm|git):/, "").split("@")[0];
				let pkgDir: string | null = null;

				const npmUser = join(globalAgentDir, "npm", "node_modules", cleanName);
				const npmProj = join(cwd, ".pi", "npm", "node_modules", cleanName);
				if (existsSync(npmUser)) pkgDir = npmUser;
				else if (existsSync(npmProj)) pkgDir = npmProj;

				if (!pkgDir) {
					const gitUser = join(globalAgentDir, "git", cleanName);
					const gitProj = join(cwd, ".pi", "git", cleanName);
					if (existsSync(gitUser)) pkgDir = gitUser;
					else if (existsSync(gitProj)) pkgDir = gitProj;
				}

				if (pkgDir) {
					const pkgJson = parseJsonFile(join(pkgDir, "package.json"));
					const displayName = pkgJson?.name || cleanName;

					const hasExtension =
						(pkgJson?.pi?.extensions && pkgJson.pi.extensions.length > 0) ||
						existsSync(join(pkgDir, "extensions")) ||
						existsSync(join(pkgDir, "index.ts")) ||
						existsSync(join(pkgDir, "index.js"));

					if (hasExtension) {
						extensionNames.add(displayName);
					}

					if (pkgJson?.pi?.skills && Array.isArray(pkgJson.pi.skills)) {
						for (const relSkill of pkgJson.pi.skills) {
							const skillRoot = join(pkgDir, relSkill);
							for (const s of discoverSkillsInDir(skillRoot, true)) skillNames.add(s);
						}
					} else if (existsSync(join(pkgDir, "skills"))) {
						for (const s of discoverSkillsInDir(join(pkgDir, "skills"), true)) skillNames.add(s);
					}
				}
			}
		}
	}

	return {
		extensionNames: [...extensionNames].sort(),
		skillNames: [...skillNames].sort(),
	};
}

async function resolveViaPackageManager(cwd: string): Promise<{ extensionNames: string[]; skillNames: string[] } | null> {
	try {
		const agentDir = typeof getAgentDir === "function" ? getAgentDir() : globalAgentDir;
		const settingsManager = SettingsManager.create(cwd, agentDir);
		const pm = new DefaultPackageManager({ cwd, agentDir, settingsManager });
		const resolved = await pm.resolve();

		const extensionNames = [
			...new Set(
				resolved.extensions
					.filter((ext) => ext.enabled)
					.map(getExtensionDisplayName),
			),
		].sort();

		const skillNames = [
			...new Set(
				resolved.skills
					.filter((skill) => skill.enabled)
					.map((skill) => getSkillDisplayName(skill.path)),
			),
		].sort();

		return { extensionNames, skillNames };
	} catch {
		return null;
	}
}

function parseRepoName(remoteUrl: string): string | undefined {
	const trimmed = remoteUrl.trim();
	if (!trimmed) return undefined;
	// Match git@host:owner/repo.git or https://host/owner/repo.git or https://host/owner/repo
	const match = trimmed.match(/[:/]([^/:]+?)(?:\.git)?$/);
	return match?.[1] || undefined;
}

function detectGitInfoSync(cwd: string): { repoName?: string; branch?: string } {
	try {
		const root = gitRoot(cwd);
		if (!root) return {};
		const gitPath = join(root, ".git");
		let gitDir = gitPath;
		if (existsSync(gitPath) && statSync(gitPath).isFile()) {
			const content = readFileSync(gitPath, "utf8").trim();
			const match = content.match(/^gitdir:\s*(.+)$/);
			if (match?.[1]) gitDir = resolve(root, match[1]);
		}

		let repoName: string | undefined;
		const gitConfigFile = join(gitDir, "config");
		if (existsSync(gitConfigFile)) {
			const configContent = readFileSync(gitConfigFile, "utf8");
			const match = configContent.match(/^\s*url\s*=\s*(.+)$/m);
			if (match?.[1]) {
				repoName = parseRepoName(match[1]);
			}
		}
		if (!repoName) repoName = basename(root);

		let branch: string | undefined;
		const headFile = join(gitDir, "HEAD");
		if (existsSync(headFile)) {
			const headContent = readFileSync(headFile, "utf8").trim();
			const match = headContent.match(/^ref:\s*refs\/heads\/(.+)$/);
			if (match?.[1]) branch = match[1];
			else if (/^[0-9a-f]{7,}$/i.test(headContent)) branch = `detached@${headContent.slice(0, 7)}`;
		}

		return { repoName, branch };
	} catch {
		return {};
	}
}

export default function j0k3rThemeExtension(pi: ExtensionAPI): void {
	let activeHeader: J0k3rThemeHeader | undefined;
	let activeFooter: J0k3rThemeFooter | undefined;
	let requestUIRender: (() => void) | undefined;
	let bannerAnimTimer: ReturnType<typeof setInterval> | undefined;

	const stopBannerAnimation = () => {
		if (bannerAnimTimer) {
			clearInterval(bannerAnimTimer);
			bannerAnimTimer = undefined;
		}
	};

	const startBannerAnimation = () => {
		stopBannerAnimation();
		if (activeHeader?.isBannerVisible()) {
			bannerAnimTimer = setInterval(() => {
				if (!activeHeader?.isBannerVisible()) {
					stopBannerAnimation();
					return;
				}
				activeHeader.nextFrame();
				requestUIRender?.();
			}, 95);
		}
	};

	const hideBanner = () => {
		stopBannerAnimation();
		if (activeHeader?.isBannerVisible()) {
			activeHeader.setBannerVisible(false);
			requestUIRender?.();
		}
	};

	pi.on("input", () => {
		hideBanner();
	});

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;

		const hasUserMessages =
			ctx.sessionManager?.getEntries?.()?.some?.(
				(entry: any) => entry.type === "message" && entry.message?.role === "user",
			) ?? false;

		const initial = detectResourcesSync(ctx.cwd);
		const initialGit = detectGitInfoSync(ctx.cwd);
		const headerData: J0k3rThemeHeaderData = {
			projectName: basename(ctx.cwd),
			repoName: initialGit.repoName,
			branch: initialGit.branch,
			skillNames: initial.skillNames,
			extensionNames: initial.extensionNames,
		};
		const footerGitInfo: RepoGitInfo = {
			dir: ctx.cwd,
			repoName: initialGit.repoName,
			branch: initialGit.branch,
		};

		void Promise.all([
			resolveViaPackageManager(ctx.cwd).catch(() => null),
			pi.exec("git", ["branch", "--show-current"], { cwd: ctx.cwd, timeout: 1000 }).catch(() => null),
			pi.exec("git", ["remote", "get-url", "origin"], { cwd: ctx.cwd, timeout: 1000 })
				.then((res) =>
					res && res.code === 0
						? res
						: pi.exec("git", ["remote"], { cwd: ctx.cwd, timeout: 1000 }).then((rList) => {
								const firstRemote = rList && rList.code === 0 ? rList.stdout.trim().split("\n")[0]?.trim() : "";
								return firstRemote ? pi.exec("git", ["remote", "get-url", firstRemote], { cwd: ctx.cwd, timeout: 1000 }) : null;
							}),
				)
				.catch(() => null),
		])
			.then(([pmRes, branchRes, remoteRes]) => {
				let changed = false;

				if (pmRes) {
					headerData.extensionNames = pmRes.extensionNames;
					headerData.skillNames = pmRes.skillNames;
					changed = true;
				}

				const branch = branchRes && branchRes.code === 0 ? branchRes.stdout.trim() : "";
				if (branch.length > 0 && branch !== headerData.branch) {
					headerData.branch = branch;
					footerGitInfo.branch = branch;
					changed = true;
				}

				const remoteUrl = remoteRes && remoteRes.code === 0 ? remoteRes.stdout.trim() : "";
				const repoName = parseRepoName(remoteUrl) || headerData.repoName;
				if (repoName && repoName !== headerData.repoName) {
					headerData.repoName = repoName;
					footerGitInfo.repoName = repoName;
					changed = true;
				}

				if (changed) {
					activeHeader?.setData(headerData);
					activeFooter?.setGitInfo(footerGitInfo);
					requestUIRender?.();
				}
			})
			.catch(() => undefined);

		ctx.ui.setHeader((tui, theme) => {
			stopBannerAnimation();
			activeHeader = new J0k3rThemeHeader(theme, headerData, ctx.ui.getToolsExpanded(), !hasUserMessages);
			requestUIRender = () => tui.requestRender();
			if (!hasUserMessages) {
				startBannerAnimation();
			}
			return activeHeader;
		});
		if (typeof (ctx.ui as any)?.setWorkingIndicator === "function") {
			(ctx.ui as any).setWorkingIndicator(ARCH_WORKING_INDICATOR);
		}
		ctx.ui.setEditorComponent((tui, theme, keybindings) => new J0k3rThemeEditor(tui, theme, keybindings));
		ctx.ui.setFooter((tui, theme, footerData) => {
			activeFooter = new J0k3rThemeFooter(tui, theme, footerData, ctx, () => pi.getThinkingLevel(), footerGitInfo);
			requestUIRender = () => tui.requestRender();
			return activeFooter;
		});
	});

	pi.on("before_agent_start", (event) => {
		hideBanner();
		return {
			systemPrompt: `${event.systemPrompt}\n\nYou are j0k3r-pi. The user's preferred pseudonym is j0k3r; greet and address them as j0k3r when it is natural.`,
		};
	});

	pi.on("session_shutdown", () => {
		stopBannerAnimation();
	});
}
