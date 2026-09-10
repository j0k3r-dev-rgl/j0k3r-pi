import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionContext, ReadonlyFooterDataProvider } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

type ThemeLike = {
	bold(text: string): string;
	fg(color: "accent" | "dim" | "muted" | "success" | "warning" | "text" | "error", text: string): string;
};

const RESET = "\x1b[0m";
const CYAN = "\x1b[1;38;2;0;229;255m";
const PINK = "\x1b[1;38;2;255;45;247m";
const VIOLET = "\x1b[1;38;2;153;92;255m";
const LIME = "\x1b[1;38;2;102;255;102m";
const AMBER = "\x1b[1;38;2;255;184;77m";
const RED = "\x1b[1;38;2;255;77;109m";

function electric(color: string, text: string): string {
	return `${color}${text}${RESET}`;
}

function formatNumber(value: number): string {
	if (value < 1000) return `${value}`;
	if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`;
	return `${(value / 1_000_000).toFixed(1)}m`;
}

function formatContextTokens(value: number | null | undefined): string {
	if (value === null || value === undefined) return "?";
	return formatNumber(value);
}

function getTokenTotals(ctx: ExtensionContext): { input: number; output: number } {
	let input = 0;
	let output = 0;

	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;

		const message = entry.message as AssistantMessage;
		input += message.usage?.input ?? 0;
		output += message.usage?.output ?? 0;
	}

	return { input, output };
}

function getExtensionStatus(footerData: ReadonlyFooterDataProvider): string {
	const entries = Array.from(footerData.getExtensionStatuses().entries());
	if (entries.length === 0) return "engram";

	const engramCandidates: string[] = [];
	for (const [key, value] of entries) {
		const haystack = `${key} ${value}`.toLowerCase();
		if (haystack.includes("engram") || haystack.includes("memory") || haystack.includes("loaded")) {
			engramCandidates.push(value);
		}
	}

	if (engramCandidates.length > 0) {
		return engramCandidates.join(" · ");
	}

	return entries.map(([, v]) => v).join(" · ");
}

function compactEngramStatus(status: string, maxLength: number): string {
	if (visibleWidth(status) <= maxLength) return status;

	const match = status.match(/(\d+)\s*(?:memories|memory|mem)/i);
	if (match) {
		const candidate = `${match[1]} mem`;
		if (visibleWidth(candidate) <= maxLength) return candidate;
	}

	if (status.toLowerCase().includes("engram") && maxLength >= 6) {
		return "engram";
	}

	return truncateToWidth(status, maxLength, "…");
}

function joinSegments(segments: string[], sep = electric(VIOLET, " ┃ ")): string {
	return segments.filter(Boolean).join(sep);
}

export interface RepoGitInfo {
	dir: string;
	repoName?: string;
	branch?: string;
}

function formatPath(dirPath: string): string {
	const home = process.env.HOME;
	if (home && (dirPath === home || dirPath.startsWith(`${home}/`))) {
		return `~${dirPath.slice(home.length)}`;
	}
	return dirPath;
}

function shortenPath(formattedPath: string, maxLength: number): string {
	if (maxLength <= 0) return "";
	if (formattedPath.length <= maxLength) return formattedPath;
	if (maxLength <= 4) return "…".slice(0, maxLength);

	const isHome = formattedPath.startsWith("~/");
	const isAbsolute = formattedPath.startsWith("/");
	const prefix = isHome ? "~/" : isAbsolute ? "/" : "";
	const remainder = formattedPath.slice(prefix.length);
	const segments = remainder.split("/").filter(Boolean);

	if (segments.length <= 1) {
		const part = segments[0] ?? remainder;
		const avail = maxLength - 1;
		return `…${part.slice(-avail)}`;
	}

	const lastSegment = segments[segments.length - 1];
	if (lastSegment.length + 2 > maxLength) {
		const avail = maxLength - 2;
		return `…/${lastSegment.slice(-avail)}`;
	}

	let best = `${prefix}…/${lastSegment}`;
	if (best.length > maxLength) {
		best = `…/${lastSegment}`;
	}

	for (let i = segments.length - 2; i >= 1; i--) {
		const candidateSegments = segments.slice(i).join("/");
		const candidate = `${prefix}…/${candidateSegments}`;
		if (candidate.length <= maxLength) {
			best = candidate;
		} else {
			break;
		}
	}

	return best.length <= maxLength ? best : `…/${lastSegment}`.slice(-maxLength);
}

function cleanModelName(modelStr: string): string {
	let s = modelStr.replace(/-\d{8}$/, "").replace(/-\d{4}$/, "");
	s = s.replace(/-latest$/, "");
	return s;
}

function simplifyModelForTiny(modelId: string): string {
	const cleaned = cleanModelName(modelId);
	if (cleaned.length <= 14) return cleaned;
	const claudeMatch = cleaned.match(/^claude-(\d+)[-_](\d+)/i);
	if (claudeMatch) return `claude-${claudeMatch[1]}.${claudeMatch[2]}`;
	const gptMatch = cleaned.match(/^gpt-(\d+)[._](\d+)/i);
	if (gptMatch) return `gpt-${gptMatch[1]}.${gptMatch[2]}`;
	const geminiMatch = cleaned.match(/^gemini-(\d+)[._](\d+)/i);
	if (geminiMatch) return `gemini-${geminiMatch[1]}.${geminiMatch[2]}`;
	return truncateToWidth(cleaned, 13, "…");
}

export class J0k3rThemeFooter implements Component {
	constructor(
		private readonly tui: TUI,
		private readonly theme: ThemeLike,
		private readonly footerData: ReadonlyFooterDataProvider,
		private readonly ctx: ExtensionContext,
		private readonly getThinkingLevel: () => string,
		private gitInfo?: RepoGitInfo,
	) {}

	setGitInfo(gitInfo: RepoGitInfo): void {
		this.gitInfo = gitInfo;
	}

	private renderTopLine(width: number): string {
		if (width <= 0) return "";

		const dir = formatPath(this.gitInfo?.dir ?? this.ctx.cwd);
		const rawRepo = this.gitInfo?.repoName?.trim();
		const rawBranch = this.gitInfo?.branch?.trim();
		const hasRepo = Boolean(rawRepo && rawRepo.length > 0);
		const hasBranch = Boolean(rawBranch && rawBranch.length > 0);

		if (hasRepo && hasBranch) {
			const rFull = `${this.theme.fg("muted", "repo:")} ${electric(LIME, rawRepo!)}`;
			const bFull = `${this.theme.fg("muted", "branch:")} ${electric(PINK, rawBranch!)}`;
			const dFull = `${this.theme.fg("muted", "dir:")} ${electric(CYAN, dir)}`;

			// 1. Full
			const cand1 = joinSegments([dFull, rFull, bFull]);
			if (visibleWidth(cand1) <= width) return cand1;

			// 2. Shortened dir with full repo and branch
			const overhead2 = visibleWidth(joinSegments([rFull, bFull])) + 3 + visibleWidth(`${this.theme.fg("muted", "dir:")} `);
			const availDir2 = width - overhead2;
			if (availDir2 >= 16) {
				const dShort = `${this.theme.fg("muted", "dir:")} ${electric(CYAN, shortenPath(dir, availDir2))}`;
				const cand2 = joinSegments([dShort, rFull, bFull]);
				if (visibleWidth(cand2) <= width) return cand2;
			}

			// 3. Compact labels: shortDir ┃ repo ┃ ⎇ branch
			const rClean = electric(LIME, rawRepo!);
			const bIcon = `${this.theme.fg("muted", "⎇ ")}${electric(PINK, rawBranch!)}`;
			const overhead3 = visibleWidth(joinSegments([rClean, bIcon])) + 3;
			const availDir3 = width - overhead3;
			if (availDir3 >= 16) {
				const dClean = electric(CYAN, shortenPath(dir, availDir3));
				const cand3 = joinSegments([dClean, rClean, bIcon]);
				if (visibleWidth(cand3) <= width) return cand3;
			}

			// 4. Git info only with full labels
			const cand4 = joinSegments([rFull, bFull]);
			if (visibleWidth(cand4) <= width) return cand4;

			// 5. Git info clean
			const cand5 = joinSegments([rClean, bIcon]);
			if (visibleWidth(cand5) <= width) return cand5;

			// 6. Truncated git info
			const half = Math.max(4, Math.floor((width - 5) / 2));
			const rTiny = electric(LIME, truncateToWidth(rawRepo!, half, "…"));
			const bTiny = `${this.theme.fg("muted", "⎇ ")}${electric(PINK, truncateToWidth(rawBranch!, Math.max(2, half - 2), "…"))}`;
			return truncateToWidth(joinSegments([rTiny, bTiny]), width, "…");
		}

		if (hasBranch) {
			const bFull = `${this.theme.fg("muted", "branch:")} ${electric(PINK, rawBranch!)}`;
			const dFull = `${this.theme.fg("muted", "dir:")} ${electric(CYAN, dir)}`;

			const cand1 = joinSegments([dFull, bFull]);
			if (visibleWidth(cand1) <= width) return cand1;

			const overhead2 = visibleWidth(bFull) + 3 + visibleWidth(`${this.theme.fg("muted", "dir:")} `);
			const availDir2 = width - overhead2;
			if (availDir2 >= 16) {
				const dShort = `${this.theme.fg("muted", "dir:")} ${electric(CYAN, shortenPath(dir, availDir2))}`;
				const cand2 = joinSegments([dShort, bFull]);
				if (visibleWidth(cand2) <= width) return cand2;
			}

			const bIcon = `${this.theme.fg("muted", "⎇ ")}${electric(PINK, rawBranch!)}`;
			const overhead3 = visibleWidth(bIcon) + 3;
			const availDir3 = width - overhead3;
			if (availDir3 >= 12) {
				const dClean = electric(CYAN, shortenPath(dir, availDir3));
				const cand3 = joinSegments([dClean, bIcon]);
				if (visibleWidth(cand3) <= width) return cand3;
			}

			return truncateToWidth(bIcon, width, "…");
		}

		// Just dir
		const dFull = `${this.theme.fg("muted", "dir:")} ${electric(CYAN, dir)}`;
		if (visibleWidth(dFull) <= width) return dFull;

		const labelLen = visibleWidth(`${this.theme.fg("muted", "dir:")} `);
		if (width > labelLen + 8) {
			return `${this.theme.fg("muted", "dir:")} ${electric(CYAN, shortenPath(dir, width - labelLen))}`;
		}

		return truncateToWidth(electric(CYAN, shortenPath(dir, width)), width, "…");
	}

	private renderBottomLine(width: number): string {
		if (width <= 0) return "";

		const { input, output } = getTokenTotals(this.ctx);
		const context = this.ctx.getContextUsage();
		const rawModel = this.ctx.model ? `${this.ctx.model.provider}/${this.ctx.model.id}` : "no-model";
		const effort = this.getThinkingLevel();

		const percentVal = context?.percent ?? null;
		const percentColor = percentVal === null ? LIME : percentVal >= 90 ? RED : percentVal >= 70 ? AMBER : LIME;
		const percentStr = percentVal === null ? "?%" : `${percentVal.toFixed(1)}%`;
		const usedContextStr = formatContextTokens(context?.tokens);
		const agentContextStr = formatContextTokens(context?.contextWindow ?? this.ctx.model?.contextWindow);
		const engramStatus = getExtensionStatus(this.footerData);

		const modelParts = rawModel.split("/");
		const rawModelShort = modelParts[modelParts.length - 1] || rawModel;
		const modelShort = cleanModelName(rawModelShort);
		const modelTiny = simplifyModelForTiny(rawModelShort);

		const mFull = electric(CYAN, this.theme.bold(cleanModelName(rawModel)));
		const mShort = electric(CYAN, this.theme.bold(modelShort));
		const mTiny = electric(CYAN, this.theme.bold(modelTiny));

		const hasEffort = Boolean(effort && effort !== "off");
		const eFull = hasEffort ? electric(PINK, `effort ${effort}`) : "";
		const eShort = hasEffort ? electric(PINK, `eff ${effort}`) : "";
		const eTiny = hasEffort ? electric(PINK, `eff:${effort}`) : "";

		const tFull = `${electric(AMBER, "tok")} ${this.theme.fg("success", `in ${formatNumber(input)}`)} ${this.theme.fg("warning", `out ${formatNumber(output)}`)}`;
		const tCompact = `${electric(AMBER, "tok")} ${this.theme.fg("success", `↑${formatNumber(input)}`)} ${this.theme.fg("warning", `↓${formatNumber(output)}`)}`;
		const tSlim = `${this.theme.fg("success", `↑${formatNumber(input)}`)} ${this.theme.fg("warning", `↓${formatNumber(output)}`)}`;
		const tMinimal = `${this.theme.fg("success", `↑${formatNumber(input)}`)}`;

		const cFull = `${electric(percentColor, percentStr)} ${this.theme.fg("muted", `${usedContextStr}/${agentContextStr}`)}`;
		const cCompact = `${electric(percentColor, percentStr)} ${this.theme.fg("muted", usedContextStr)}`;
		const cSlim = electric(percentColor, percentStr);

		const sFull = electric(CYAN, engramStatus);
		const sCompact = electric(CYAN, compactEngramStatus(engramStatus, 14));
		const sSlim = electric(CYAN, "engram");

		// Priority 1: Split layout (Left + Right gap >= 2)
		const splitProfiles = [
			{ left: [mFull, eFull, tFull, cFull], right: sFull },
			{ left: [mFull, eFull, tCompact, cFull], right: sFull },
			{ left: [mShort, eFull, tCompact, cFull], right: sFull },
			{ left: [mShort, eShort, tCompact, cCompact], right: sCompact },
			{ left: [mShort, eShort, tSlim, cCompact], right: sCompact },
			{ left: [mShort, eTiny, tSlim, cSlim], right: sSlim },
			{ left: [mTiny, eTiny, tSlim, cSlim], right: sSlim },
			{ left: [mTiny, "", tSlim, cSlim], right: sSlim },
		];

		for (const prof of splitProfiles) {
			const leftStr = joinSegments(prof.left);
			const rightStr = prof.right;
			const leftW = visibleWidth(leftStr);
			const rightW = visibleWidth(rightStr);
			const gap = width - leftW - rightW;

			if (gap >= 2) {
				return `${leftStr}${" ".repeat(gap)}${rightStr}`;
			}
		}

		// Priority 2: Inline layout
		const inlineProfiles = [
			[mShort, eTiny, tSlim, cSlim, sSlim],
			[mTiny, eTiny, tSlim, cSlim, sSlim],
			[mTiny, "", tSlim, cSlim, sSlim],
			[mTiny, "", tSlim, cSlim],
			[mTiny, "", tMinimal, cSlim],
			[mTiny, "", "", cSlim],
		];

		for (const prof of inlineProfiles) {
			const line = joinSegments(prof);
			if (visibleWidth(line) <= width) {
				return line;
			}
		}

		// Safety fallback
		return truncateToWidth(joinSegments([mTiny, cSlim]), width, "…");
	}

	render(width: number): string[] {
		if (width <= 0) return [];
		return [this.renderTopLine(width), this.renderBottomLine(width)];
	}

	invalidate(): void {}
}
