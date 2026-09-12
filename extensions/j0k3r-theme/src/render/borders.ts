import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

export const RESET = "\x1b[0m";
export const CYAN = "\x1b[1;38;2;0;229;255m";
export const BLUE = "\x1b[1;38;2;23;147;209m";
export const PINK = "\x1b[1;38;2;255;45;247m";
export const VIOLET = "\x1b[1;38;2;153;92;255m";
export const LIME = "\x1b[1;38;2;102;255;102m"; // Neon green
export const AMBER = "\x1b[1;38;2;255;184;77m";
export const RED = "\x1b[1;38;2;255;77;109m"; // Neon red
export const DIM = "\x1b[2m";

export function electric(color: string, text: string): string {
	return `${color}${text}${RESET}`;
}

export function fit(text: string, width: number): string {
	return truncateToWidth(text, Math.max(0, width), "");
}

export function pad(text: string, width: number): string {
	const fitted = fit(text, width);
	const vis = visibleWidth(fitted);
	return fitted + " ".repeat(Math.max(0, width - vis));
}

export function boxLine(content: string, innerWidth: number, borderColor: string = CYAN): string {
	const innerContentWidth = Math.max(0, innerWidth - 2);
	return `${electric(borderColor, "│")} ${pad(content, innerContentWidth)} ${electric(borderColor, "│")}`;
}

export function cardTopBorder(
	toolName: string,
	actionOrTarget: string | undefined,
	innerWidth: number,
	borderColor: string = CYAN,
	titleColor: string = CYAN,
): string {
	const cleanAction = actionOrTarget ? actionOrTarget.replace(/[\r\n]+/g, " ").trim() : undefined;
	let label = cleanAction ? `${toolName} [${cleanAction}]` : toolName;

	const maxTitleWidth = Math.max(4, innerWidth - 4);
	if (visibleWidth(label) + 2 > maxTitleWidth && cleanAction) {
		const maxActionWidth = Math.max(3, maxTitleWidth - visibleWidth(toolName) - 5);
		const truncatedAction = fit(cleanAction, maxActionWidth);
		label = `${toolName} [${truncatedAction}]`;
	}

	let titleText = ` ${label} `;
	if (visibleWidth(titleText) > innerWidth) {
		titleText = ` ${fit(label, Math.max(1, innerWidth - 2))} `;
	}

	const rest = Math.max(0, innerWidth - visibleWidth(titleText));
	const leftDash = Math.min(2, rest);
	const rightDash = Math.max(0, rest - leftDash);
	return `${electric(borderColor, "╭")}${electric(borderColor, "─".repeat(leftDash))}${electric(titleColor, titleText)}${electric(borderColor, "─".repeat(rightDash))}${electric(borderColor, "╮")}`;
}

export function cardBottomBorder(innerWidth: number, borderColor: string = CYAN): string {
	return `${electric(borderColor, "╰")}${electric(borderColor, "─".repeat(innerWidth))}${electric(borderColor, "╯")}`;
}

export function formatDuration(ms: number): string {
	if (ms < 1000) return `${(ms / 1000).toFixed(1)}s`;
	if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
	const mins = Math.floor(ms / 60000);
	const secs = ((ms % 60000) / 1000).toFixed(0);
	return `${mins}m ${secs}s`;
}

export function frameContent(
	lines: string[],
	innerWidth: number,
	borderColor: string = CYAN,
	wrap = false,
): string[] {
	const innerContentWidth = Math.max(0, innerWidth - 2);
	const framed: string[] = [];
	for (const rawLine of lines) {
		const subLines = rawLine.split(/\r?\n/);
		for (const sub of subLines) {
			if (wrap && visibleWidth(sub) > innerContentWidth) {
				const wrapped = wrapTextWithAnsi(sub, innerContentWidth);
				for (const segment of wrapped) {
					framed.push(boxLine(segment, innerWidth, borderColor));
				}
			} else {
				framed.push(boxLine(fit(sub, innerContentWidth), innerWidth, borderColor));
			}
		}
	}
	return framed;
}
