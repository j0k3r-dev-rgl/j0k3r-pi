import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { GitDiffPanel } from "./src/panel.js";

async function openGitDiffPanel(ctx: ExtensionContext, args?: string): Promise<void> {
	if (ctx.mode !== "tui") {
		ctx.ui.notify("git-diff-panel requires Pi TUI mode", "warning");
		return;
	}

	await ctx.ui.custom<undefined>(
		(tui, theme, _keybindings, done) => new GitDiffPanel(ctx.cwd, tui, theme, done, args?.trim()),
		{
			overlay: true,
			overlayOptions: {
				width: "96%",
				maxHeight: "95%",
				anchor: "center",
				margin: 1,
			},
		},
	);
}

export default function gitDiffPanelExtension(pi: ExtensionAPI): void {
	pi.registerCommand("git-diff", {
		description: "Open a split git changes panel with tree and diff (supports worktrees)",
		handler: async (args, ctx) => openGitDiffPanel(ctx, args),
	});

	pi.registerShortcut("alt+g", {
		description: "Open git diff panel",
		handler: async (ctx) => openGitDiffPanel(ctx),
	});
}
