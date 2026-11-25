// Foreground palette of the arch-electric theme. Rendering never paints backgrounds: Pi owns the
// shell, so tool rows stay transparent.
export const RESET = "\x1b[0m";
export const CYAN = "\x1b[1;38;2;0;229;255m";
export const PINK = "\x1b[1;38;2;255;45;247m";
export const VIOLET = "\x1b[1;38;2;153;92;255m";
export const LIME = "\x1b[1;38;2;102;255;102m"; // Neon green
export const AMBER = "\x1b[1;38;2;255;184;77m";
export const ORANGE = "\x1b[1;38;2;255;140;0m"; // Neon orange
export const RED = "\x1b[1;38;2;255;77;109m"; // Neon red
export const MUTED = "\x1b[38;2;122;167;184m"; // Arch-electric muted (#7aa7b8)
export const DIM = "\x1b[2m";

export function electric(color: string, text: string): string {
	return `${color}${text}${RESET}`;
}

/**
 * Styles plain-text expanded bodies with the active theme's `muted` token, falling back to the
 * arch-electric muted `#7aa7b8` ANSI foreground when `theme` is absent or returns unstyled text.
 */
export function mutedText(theme: any, text: string): string {
	if (text === "") return "";
	if (typeof theme?.fg === "function") {
		try {
			const styled = theme.fg("muted", text);
			if (typeof styled === "string" && styled !== text) return styled;
		} catch {
			// Fall back to arch-electric muted foreground.
		}
	}
	return electric(MUTED, text);
}

export function formatDuration(ms: number): string {
	if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
	const totalSecs = Math.round(ms / 1000);
	const mins = Math.floor(totalSecs / 60);
	const secs = totalSecs % 60;
	return `${mins}m ${secs}s`;
}
