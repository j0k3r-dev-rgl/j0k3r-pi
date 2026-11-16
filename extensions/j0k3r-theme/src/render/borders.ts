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
export const DIM = "\x1b[2m";

export function electric(color: string, text: string): string {
	return `${color}${text}${RESET}`;
}

export function formatDuration(ms: number): string {
	if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
	const mins = Math.floor(ms / 60000);
	const secs = ((ms % 60000) / 1000).toFixed(0);
	return `${mins}m ${secs}s`;
}
