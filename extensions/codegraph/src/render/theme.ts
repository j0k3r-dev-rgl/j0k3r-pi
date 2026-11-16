import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

export const RESET = "\x1b[0m";
export const PINK = "\x1b[1;38;2;255;45;247m";
export const RED = "\x1b[1;38;2;255;77;109m";
export const LIME = "\x1b[1;38;2;102;255;102m";
export const AMBER = "\x1b[1;38;2;255;184;77m";
export const DIM = "\x1b[2m";

/** Short inline row separator; not a card frame. */
export const ROW_SEPARATOR = " ─ ";

export function electric(color: string, text: string): string {
	return `${color}${text}${RESET}`;
}

export function fit(text: string, width: number): string {
	return truncateToWidth(text, Math.max(0, width), "");
}

export function visible(text: string): number {
	return visibleWidth(text);
}

/**
 * One compact inline line joining non-empty parts. Returns no cells for a
 * non-positive width so narrow or zero-width viewports stay safe.
 */
export function rowLine(parts: Array<string | undefined | null>, width: number): string[] {
	if (width <= 0) return [];
	const line = parts
	  .filter((part): part is string => Boolean(part && part.trim()))
	  .map((part) => part.replace(/[\r\n]+/g, ' '))
	  .join(ROW_SEPARATOR);
	return [fit(line, width)];
}

/** Wrap expanded content losslessly; blank lines are preserved as empty rows. */
export function textLines(text: string, width: number): string[] {
	if (width <= 0) return [];
	const out: string[] = [];
	for (const raw of text.split(/\r?\n/)) {
		if (raw === "") {
			out.push("");
			continue;
		}
		const segments = wrapTextWithAnsi(raw, width);
		if (segments.length === 0) out.push("");
		else out.push(...segments.map((segment) => fit(segment, width)));
	}
	return out;
}

export interface CodeGraphRowState {
	hasResult?: boolean;
	isError?: boolean;
	isPartial?: boolean;
	expanded?: boolean;
}
