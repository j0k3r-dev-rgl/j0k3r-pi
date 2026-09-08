import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionContext, ReadonlyFooterDataProvider } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

type ThemeLike = {
	bold(text: string): string;
	fg(color: "accent" | "dim" | "muted" | "success" | "warning" | "text", text: string): string;
};

const RESET = "\x1b[0m";
const CYAN = "\x1b[1;38;2;0;229;255m";
const PINK = "\x1b[1;38;2;255;45;247m";
const VIOLET = "\x1b[1;38;2;153;92;255m";
const LIME = "\x1b[1;38;2;102;255;102m";
const AMBER = "\x1b[1;38;2;255;184;77m";

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
		input += message.usage.input;
		output += message.usage.output;
	}

	return { input, output };
}

function getEngramStatus(footerData: ReadonlyFooterDataProvider): string {
	const candidates: string[] = [];

	for (const [key, value] of footerData.getExtensionStatuses()) {
		const haystack = `${key} ${value}`.toLowerCase();
		if (haystack.includes("engram") || haystack.includes("memory") || haystack.includes("loaded")) {
			candidates.push(value);
		}
	}

	return candidates.length > 0 ? candidates.join(" · ") : "engram";
}

function joinSegments(segments: string[]): string {
	return segments.filter(Boolean).join(electric(VIOLET, " ┃ "));
}

export class J0k3rThemeFooter implements Component {
	constructor(
		private readonly tui: TUI,
		private readonly theme: ThemeLike,
		private readonly footerData: ReadonlyFooterDataProvider,
		private readonly ctx: ExtensionContext,
		private readonly getThinkingLevel: () => string,
	) {}

	render(width: number): string[] {
		if (width <= 0) return [];

		const { input, output } = getTokenTotals(this.ctx);
		const context = this.ctx.getContextUsage();
		const model = this.ctx.model ? `${this.ctx.model.provider}/${this.ctx.model.id}` : "no-model";
		const effort = this.getThinkingLevel();
		const percent = context?.percent === null || context?.percent === undefined ? "?%" : `${context.percent.toFixed(1)}%`;
		const usedContext = formatContextTokens(context?.tokens);
		const agentContext = formatContextTokens(context?.contextWindow ?? this.ctx.model?.contextWindow);

		const left = joinSegments([
			electric(CYAN, this.theme.bold(model)),
			electric(PINK, `effort ${effort}`),
			`${electric(AMBER, "tok")} ${this.theme.fg("success", `in ${formatNumber(input)}`)} ${this.theme.fg("warning", `out ${formatNumber(output)}`)}`,
			`${electric(LIME, percent)} ${this.theme.fg("muted", `${usedContext}/${agentContext}`)}`,
		]);
		const right = electric(CYAN, getEngramStatus(this.footerData));
		const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(right));

		return [truncateToWidth(`${left}${" ".repeat(gap)}${right}`, width, "")];
	}

	invalidate(): void {}
}
