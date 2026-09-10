import type { Component, Focusable, TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";
import type { AccountUsage, ProviderGroup, UsagePool } from "./api.ts";
import { formatAmount, formatReset, poolAvailable, poolTitle } from "./api.ts";

/**
 * Floating usage modal: providers on a tab row, all of their accounts inside, and
 * the quota windows of the selected account.
 *
 * Fully themed with Pi theme colors, aligned borders, and interactive mouse support:
 * - Click on provider tabs to switch provider
 * - Click on accounts to select account
 * - Mouse wheel to scroll accounts
 * - Click on buttons to refresh or close
 */

export type ModalTheme = {
    fg: (color: string, text: string) => string;
    bg?: (color: string, text: string) => string;
    bold?: (text: string) => string;
    italic?: (text: string) => string;
    underline?: (text: string) => string;
};

export type UsageModalDeps = {
    theme: ModalTheme;
    tui: { requestRender: () => void };
    done: () => void;
    load: (force: boolean) => Promise<ProviderGroup[]>;
};

const SPINNER = ["⠋", "⠙", "⠹", "⠸"];
const ANSI_PATTERN = /\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?(\x07|\x1b\\)|\x1b[()][AB012]|\x1b./g;

/** Blank columns between the border and the content on each side. */
const PADDING = 2;
/** Blank rows between the border and the content (top and bottom). */
const VERTICAL_PADDING = 1;

const KEY = {
    tab: "\t",
    shiftTab: "\x1b[Z",
    up: "\x1b[A",
    down: "\x1b[B",
    left: "\x1b[D",
    right: "\x1b[C",
    escape: "\x1b",
    ctrlC: "\x03",
} as const;

function stripAnsi(text: string): string {
    return text.replace(ANSI_PATTERN, "");
}

function visibleWidth(text: string): number {
    return stripAnsi(text).length;
}

function truncateToWidth(text: string, width: number, ellipsis = "…"): string {
    const stripped = stripAnsi(text);
    if (stripped.length <= width) return text;
    if (width <= 0) return "";
    const maxVis = Math.max(0, width - ellipsis.length);
    let out = "";
    let vis = 0;
    let i = 0;
    while (i < text.length) {
        if (text[i] === "\x1b") {
            const match = text.slice(i).match(new RegExp("^(" + ANSI_PATTERN.source + ")"));
            if (match) {
                out += match[0];
                i += match[0].length;
                continue;
            }
        }
        if (vis >= maxVis) break;
        out += text[i];
        vis += 1;
        i++;
    }
    return out + "\x1b[0m" + ellipsis;
}

function padLine(line: string, innerWidth: number): string {
    const vis = visibleWidth(line);
    if (vis > innerWidth) {
        const fitted = truncateToWidth(line, innerWidth, "…");
        const fittedVis = visibleWidth(fitted);
        return fitted + " ".repeat(Math.max(0, innerWidth - fittedVis));
    }
    return line + " ".repeat(Math.max(0, innerWidth - vis));
}

/** Usable content width inside the border and padding. */
function innerWidth(width: number): number {
    return Math.max(4, width - 2 - PADDING * 2);
}

function fg(theme: ModalTheme, color: string, text: string): string {
    return theme.fg ? theme.fg(color, text) : text;
}

function bold(theme: ModalTheme, text: string): string {
    return theme.bold ? theme.bold(text) : `\x1b[1m${text}\x1b[22m`;
}

function renderThemedBar(percentage: number, width = 16, theme: ModalTheme): string {
    const clamped = Math.max(0, Math.min(100, percentage));
    const filled = Math.round((clamped / 100) * width);
    const empty = Math.max(0, width - filled);

    let statusColor = "success";
    if (clamped < 20) {
        statusColor = "error";
    } else if (clamped < 50) {
        statusColor = "warning";
    }

    const filledBar = filled > 0 ? fg(theme, statusColor, "█".repeat(filled)) : "";
    const emptyBar = empty > 0 ? fg(theme, "borderMuted", "░".repeat(empty)) : "";
    return `${filledBar}${emptyBar}`;
}

function formatAccountLine(account: AccountUsage, isSelected: boolean, isHovered: boolean, theme: ModalTheme): string {
    const marker = isSelected ? fg(theme, "accent", "▸ ") : fg(theme, "dim", "· ");
    const name = isSelected
        ? bold(theme, fg(theme, "text", account.account))
        : fg(theme, isHovered ? "text" : "muted", account.account);
    const plan = fg(theme, isSelected ? "syntaxKeyword" : "dim", `[${account.plan}${account.tier ? ` · ${account.tier}` : ""}]`);
    const poolsCount = fg(theme, "dim", `· ${account.pools.length} cuota(s)`);

    const flags: string[] = [];
    if (account.limitReached) {
        flags.push(bold(theme, fg(theme, "error", "⚠ LIMIT REACHED")));
    }
    if (account.bankedCredits != null) {
        flags.push(fg(theme, "warning", `banked ${account.bankedCredits}`));
    }

    const head = account.note && account.pools.length === 0
        ? `${marker}${name} ${plan} ${fg(theme, "dim", "· sin cuota expuesta")}`
        : `${marker}${name} ${plan} ${poolsCount}`;

    return flags.length ? `${head} ${flags.join(" ")}` : head;
}

function poolLines(pool: UsagePool, theme: ModalTheme): string[] {
    const pct = pool.availablePercentage;
    let statusColor = "success";
    if (pct < 20) statusColor = "error";
    else if (pct < 50) statusColor = "warning";

    const title = `${fg(theme, "accent", "◆")} ${bold(theme, fg(theme, "syntaxFunction", poolTitle(pool)))}`;
    const pctText = bold(theme, fg(theme, statusColor, `${pct.toFixed(1)}% libre`));
    const availText = pool.unlimited ? fg(theme, "success", "∞ libre") : fg(theme, "text", poolAvailable(pool));
    const resetText = fg(theme, "muted", formatReset(pool.resetAt));
    const modelsText = pool.modelCount > 0 ? fg(theme, "syntaxType", ` · ${pool.modelCount} modelo(s)`) : "";

    return [
        `  ${title}`,
        `    ${renderThemedBar(pool.availablePercentage, 16, theme)} ${pctText} · ${availText} · ${resetText}${modelsText}`,
    ];
}

type ClickRegion = {
    id: string;
    type: "close" | "refresh" | "tab" | "prev_provider" | "next_provider" | "account";
    x1: number;
    x2: number;
    y: number;
    data?: any;
};

export class UsageModal implements Component, Focusable {
    /** Focusable contract: the TUI flips this when the overlay gains/loses focus. */
    focused = false;

    private deps: UsageModalDeps;
    private groups: ProviderGroup[] = [];
    private error: string | null = null;
    private loading = true;
    private providerIndex = 0;
    private accountIndex = 0;
    private frameIndex = 0;
    private timer: ReturnType<typeof setInterval> | null = null;

    private clickRegions: ClickRegion[] = [];
    private hoveredRegionId: string | null = null;

    constructor(deps: UsageModalDeps) {
        this.deps = deps;
        void this.runLoad(false);
    }

    private stopSpinner(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    private clampIndexes(): void {
        if (this.groups.length === 0) {
            this.providerIndex = 0;
            this.accountIndex = 0;
            return;
        }
        this.providerIndex = Math.min(this.providerIndex, this.groups.length - 1);
        const accounts = this.groups[this.providerIndex]?.accounts ?? [];
        this.accountIndex = Math.min(this.accountIndex, Math.max(0, accounts.length - 1));
    }

    private async runLoad(force: boolean): Promise<void> {
        this.loading = true;
        this.error = null;
        this.deps.tui.requestRender();
        if (!this.timer) {
            this.timer = setInterval(() => {
                this.frameIndex = (this.frameIndex + 1) % SPINNER.length;
                this.deps.tui.requestRender();
            }, 120);
        }
        try {
            this.groups = await this.deps.load(force);
            this.clampIndexes();
        } catch (cause) {
            this.error = cause instanceof Error ? cause.message : String(cause);
        } finally {
            this.loading = false;
            this.stopSpinner();
            this.deps.tui.requestRender();
        }
    }

    private moveProvider(delta: number): void {
        if (this.groups.length === 0) return;
        this.providerIndex = (this.providerIndex + delta + this.groups.length) % this.groups.length;
        this.accountIndex = 0;
        this.deps.tui.requestRender();
    }

    private moveAccount(delta: number): void {
        const count = this.groups[this.providerIndex]?.accounts.length ?? 0;
        if (count === 0) return;
        this.accountIndex = (this.accountIndex + delta + count) % count;
        this.deps.tui.requestRender();
    }

    private close(): void {
        this.stopSpinner();
        this.deps.done();
    }

    dispose(): void {
        this.stopSpinner();
    }

    handleInput(data: string): void {
        switch (data) {
            // nvim-style navigation & arrows
            case "l":
            case "L":
            case KEY.right:
            case KEY.tab:
                this.moveProvider(1);
                return;
            case "h":
            case "H":
            case KEY.left:
            case KEY.shiftTab:
                this.moveProvider(-1);
                return;
            case "j":
            case "J":
            case KEY.down:
                this.moveAccount(1);
                return;
            case "k":
            case "K":
            case KEY.up:
                this.moveAccount(-1);
                return;
            case "r":
            case "R":
                void this.runLoad(true);
                return;
            case KEY.escape:
            case "q":
            case "Q":
            case KEY.ctrlC:
                this.close();
                return;
            default:
                return;
        }
    }

    handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
        // Mouse wheel: scroll accounts
        if (event.type === "wheel" && event.wheelDelta) {
            const delta = event.wheelDelta > 0 ? 1 : -1;
            this.moveAccount(delta);
            return { handled: true, render: true };
        }

        // Mouse hover: update hover state
        if (event.type === "move") {
            const hit = this.clickRegions.find(
                (r) => event.y === r.y && event.x >= r.x1 && event.x <= r.x2,
            );
            const newHoverId = hit ? hit.id : null;
            if (newHoverId !== this.hoveredRegionId) {
                this.hoveredRegionId = newHoverId;
                return { handled: true, render: true };
            }
            return { handled: true };
        }

        // Mouse click or press
        if (event.button === "left" && (event.type === "click" || event.type === "press")) {
            const hit = this.clickRegions.find(
                (r) => event.y === r.y && event.x >= r.x1 && event.x <= r.x2,
            );
            if (!hit) return { handled: true };

            // When press handles the event, prevent click duplicate
            if (event.type === "click") {
                return { handled: true };
            }

            switch (hit.type) {
                case "close":
                    this.close();
                    return { handled: true };
                case "refresh":
                    void this.runLoad(true);
                    return { handled: true, render: true };
                case "tab":
                    if (typeof hit.data === "number") {
                        this.providerIndex = hit.data;
                        this.accountIndex = 0;
                        this.deps.tui.requestRender();
                        return { handled: true, render: true };
                    }
                    break;
                case "prev_provider":
                    this.moveProvider(-1);
                    return { handled: true, render: true };
                case "next_provider":
                    this.moveProvider(1);
                    return { handled: true, render: true };
                case "account":
                    if (typeof hit.data === "number") {
                        this.accountIndex = hit.data;
                        this.deps.tui.requestRender();
                        return { handled: true, render: true };
                    }
                    break;
            }
            return { handled: true };
        }

        return undefined;
    }

    invalidate(): void {
        // No cached render output; theme changes are picked up on the next render.
    }

    render(width: number): string[] {
        const theme = this.deps.theme;
        const lines: string[] = [];
        this.clickRegions = [];

        if (this.loading && this.groups.length === 0) {
            lines.push(`${SPINNER[this.frameIndex]} Cargando suscripciones de CLIProxyAPI…`);
            lines.push("");

            const isCloseHovered = this.hoveredRegionId === "close-load";
            const closeBtn = isCloseHovered
                ? bold(theme, fg(theme, "error", "[ ✕ Cerrar ]"))
                : fg(theme, "dim", "[ ✕ Cerrar ]");

            const closeRowY = 1 + VERTICAL_PADDING + lines.length;
            this.clickRegions.push({
                id: "close-load",
                type: "close",
                x1: 1 + PADDING,
                x2: 1 + PADDING + visibleWidth(closeBtn) - 1,
                y: closeRowY,
            });

            lines.push(`${closeBtn}   ${fg(theme, "dim", "· Esc cancelar")}`);
            return this.frame(bold(theme, fg(theme, "accent", "CLIProxyAPI usage")), lines, width);
        }

        if (this.error && this.groups.length === 0) {
            lines.push(fg(theme, "error", `✖ ${this.error}`));
            lines.push("");

            const btnRowY = 1 + VERTICAL_PADDING + lines.length;
            let currentX = 1 + PADDING;

            const isRetHovered = this.hoveredRegionId === "retry-err";
            const retryBtn = isRetHovered
                ? bold(theme, fg(theme, "accent", "[ ⟳ Reintentar ]"))
                : fg(theme, "accent", "[ ⟳ Reintentar ]");
            const retVis = visibleWidth(retryBtn);
            this.clickRegions.push({
                id: "retry-err",
                type: "refresh",
                x1: currentX,
                x2: currentX + retVis - 1,
                y: btnRowY,
            });
            currentX += retVis + 2;

            const isCloseHovered = this.hoveredRegionId === "close-err";
            const closeBtn = isCloseHovered
                ? bold(theme, fg(theme, "error", "[ ✕ Cerrar ]"))
                : fg(theme, "error", "[ ✕ Cerrar ]");
            const closeVis = visibleWidth(closeBtn);
            this.clickRegions.push({
                id: "close-err",
                type: "close",
                x1: currentX,
                x2: currentX + closeVis - 1,
                y: btnRowY,
            });

            lines.push(`${retryBtn}  ${closeBtn}  ${fg(theme, "dim", "(r reintentar · Esc cerrar)")}`);
            return this.frame(bold(theme, fg(theme, "error", "CLIProxyAPI usage · Error")), lines, width);
        }

        if (this.groups.length === 0) {
            lines.push(fg(theme, "muted", "No hay cuentas activas en CLIProxyAPI."));
            lines.push("");

            const btnRowY = 1 + VERTICAL_PADDING + lines.length;
            let currentX = 1 + PADDING;

            const isRefHovered = this.hoveredRegionId === "ref-empty";
            const refBtn = isRefHovered
                ? bold(theme, fg(theme, "accent", "[ ⟳ Refrescar ]"))
                : fg(theme, "accent", "[ ⟳ Refrescar ]");
            const refVis = visibleWidth(refBtn);
            this.clickRegions.push({
                id: "ref-empty",
                type: "refresh",
                x1: currentX,
                x2: currentX + refVis - 1,
                y: btnRowY,
            });
            currentX += refVis + 2;

            const isCloseHovered = this.hoveredRegionId === "close-empty";
            const closeBtn = isCloseHovered
                ? bold(theme, fg(theme, "error", "[ ✕ Cerrar ]"))
                : fg(theme, "error", "[ ✕ Cerrar ]");
            const closeVis = visibleWidth(closeBtn);
            this.clickRegions.push({
                id: "close-empty",
                type: "close",
                x1: currentX,
                x2: currentX + closeVis - 1,
                y: btnRowY,
            });

            lines.push(`${refBtn}  ${closeBtn}  ${fg(theme, "dim", "(r refrescar · Esc cerrar)")}`);
            return this.frame(bold(theme, fg(theme, "accent", "CLIProxyAPI usage")), lines, width);
        }

        // Provider tabs row
        const tabsRowY = 1 + VERTICAL_PADDING + lines.length;
        let currentTabX = 1 + PADDING;
        const tabParts: string[] = [];

        // Left provider arrow
        const isPrevHovered = this.hoveredRegionId === "prev-provider";
        const prevArrow = isPrevHovered ? bold(theme, fg(theme, "accent", "◀")) : fg(theme, "dim", "◀");
        const prevVis = visibleWidth(prevArrow);
        this.clickRegions.push({
            id: "prev-provider",
            type: "prev_provider",
            x1: currentTabX,
            x2: currentTabX + prevVis - 1,
            y: tabsRowY,
        });
        currentTabX += prevVis + 1;
        tabParts.push(prevArrow);

        for (const [index, group] of this.groups.entries()) {
            const isSelected = index === this.providerIndex;
            const isHovered = this.hoveredRegionId === `tab-${index}`;

            let tabStr = "";
            if (isSelected) {
                tabStr = bold(theme, fg(theme, "accent", `[ ◆ ${group.provider.toUpperCase()} · ${group.accounts.length} ]`));
            } else if (isHovered) {
                tabStr = bold(theme, fg(theme, "text", `  ◇ ${group.provider.toUpperCase()} (${group.accounts.length})  `));
            } else {
                tabStr = fg(theme, "dim", `  ◇ ${group.provider.toUpperCase()} (${group.accounts.length})  `);
            }

            const tabVis = visibleWidth(tabStr);
            this.clickRegions.push({
                id: `tab-${index}`,
                type: "tab",
                x1: currentTabX,
                x2: currentTabX + tabVis - 1,
                y: tabsRowY,
                data: index,
            });
            currentTabX += tabVis + 1;
            tabParts.push(tabStr);
        }

        // Right provider arrow
        const isNextHovered = this.hoveredRegionId === "next-provider";
        const nextArrow = isNextHovered ? bold(theme, fg(theme, "accent", "▶")) : fg(theme, "dim", "▶");
        const nextVis = visibleWidth(nextArrow);
        this.clickRegions.push({
            id: "next-provider",
            type: "next_provider",
            x1: currentTabX,
            x2: currentTabX + nextVis - 1,
            y: tabsRowY,
        });
        tabParts.push(nextArrow);

        lines.push(tabParts.join(" "));
        lines.push("");

        const accounts = this.groups[this.providerIndex]?.accounts ?? [];

        // Every account of the selected provider
        for (const [index, account] of accounts.entries()) {
            const isSelected = index === this.accountIndex;
            const isHovered = this.hoveredRegionId === `account-${index}`;
            const accountRowY = 1 + VERTICAL_PADDING + lines.length;

            this.clickRegions.push({
                id: `account-${index}`,
                type: "account",
                x1: 1,
                x2: width - 2,
                y: accountRowY,
                data: index,
            });

            lines.push(formatAccountLine(account, isSelected, isHovered, theme));
        }

        // Connected divider separating accounts list from pool metrics
        lines.push("__DIVIDER__");

        const account = accounts[this.accountIndex];
        if (account) {
            if (account.note && account.pools.length === 0) {
                lines.push(fg(theme, "dim", `  ℹ ${account.note.slice(0, 160)}`));
            }
            if (account.error) {
                lines.push(bold(theme, fg(theme, "warning", `  ⚠ error: ${account.error}`)));
            }
            if (this.loading) {
                lines.push(fg(theme, "accent", `  ${SPINNER[this.frameIndex]} actualizando cuotas…`));
            }
            for (const pool of account.pools) {
                lines.push(...poolLines(pool, theme));
            }
            if (!account.note && !account.error && account.pools.length === 0 && !this.loading) {
                lines.push(fg(theme, "dim", "  sin cuotas reportadas"));
            }
        }

        lines.push("");

        // Footer buttons and interactive hints
        const footerRowY = 1 + VERTICAL_PADDING + lines.length;
        let currentFooterX = 1 + PADDING;
        const footerParts: string[] = [];

        const isRefHovered = this.hoveredRegionId === "refresh";
        const refBtn = isRefHovered
            ? bold(theme, fg(theme, "accent", "[ ⟳ Refrescar ]"))
            : fg(theme, "accent", "[ ⟳ Refrescar ]");
        const refVis = visibleWidth(refBtn);
        this.clickRegions.push({
            id: "refresh",
            type: "refresh",
            x1: currentFooterX,
            x2: currentFooterX + refVis - 1,
            y: footerRowY,
        });
        currentFooterX += refVis + 2;
        footerParts.push(refBtn);

        const isCloseFooterHovered = this.hoveredRegionId === "close-footer";
        const closeBtn = isCloseFooterHovered
            ? bold(theme, fg(theme, "error", "[ ✕ Cerrar ]"))
            : fg(theme, "error", "[ ✕ Cerrar ]");
        const closeVis = visibleWidth(closeBtn);
        this.clickRegions.push({
            id: "close-footer",
            type: "close",
            x1: currentFooterX,
            x2: currentFooterX + closeVis - 1,
            y: footerRowY,
        });
        footerParts.push(closeBtn);

        lines.push(footerParts.join("  "));
        lines.push(fg(theme, "dim", "h/l: proveedor · j/k o rueda: cuenta · r: refrescar · Esc: cerrar · mouse: click / scroll"));

        const total = this.groups.reduce((sum, group) => sum + group.accounts.length, 0);
        const modalTitle = `${bold(theme, fg(theme, "accent", "CLIProxyAPI usage"))} ${fg(theme, "muted", `· ${total} cuenta(s)`)}`;
        return this.frame(modalTitle, lines, width);
    }

    /** Bordered box with a title, horizontal and vertical padding, and connected dividers. */
    private frame(title: string, content: string[], width: number): string[] {
        const theme = this.deps.theme;
        if (width < 20) return content.map((line) => truncateToWidth(line, width, ""));

        const inner = innerWidth(width);
        const gutter = " ".repeat(PADDING);
        const border = fg(theme, "border", "│");

        // Top-right close button in the frame border
        const isCloseHovered = this.hoveredRegionId === "close-top";
        const closeBtn = isCloseHovered
            ? bold(theme, fg(theme, "error", "[✕]"))
            : fg(theme, "error", "[✕]");
        const closeVis = visibleWidth(closeBtn);

        const titlePrefix = "╭─ ";
        const titleSuffix = " ─╮";
        const prefixVis = visibleWidth(titlePrefix);
        const suffixVis = visibleWidth(titleSuffix);

        // Clickable region for the top frame close button: Row 0
        const closeX1 = width - suffixVis - closeVis;
        const closeX2 = closeX1 + closeVis - 1;
        this.clickRegions.push({
            id: "close-top",
            type: "close",
            x1: closeX1 - 1,
            x2: closeX2 + 1,
            y: 0,
        });

        // 2 spaces: one after title, one before close button
        const available = width - prefixVis - suffixVis - closeVis - 2;
        let titleText = title;
        if (visibleWidth(titleText) > available - 2) {
            titleText = truncateToWidth(titleText, Math.max(4, available - 2), "…");
        }
        const fillDashes = Math.max(1, available - visibleWidth(titleText));

        const top =
            `${fg(theme, "border", titlePrefix)}${titleText} ` +
            `${fg(theme, "borderMuted", "─".repeat(fillDashes))} ` +
            `${closeBtn}${fg(theme, "border", titleSuffix)}`;

        const bottom =
            `${fg(theme, "border", "╰")}` +
            `${fg(theme, "border", "─".repeat(width - 2))}` +
            `${fg(theme, "border", "╯")}`;

        const blank = `${border}${" ".repeat(width - 2)}${border}`;
        const padRows = Array.from({ length: VERTICAL_PADDING }, () => blank);

        const bodyLines = content.map((line) => {
            if (line === "__DIVIDER__") {
                return `${fg(theme, "border", "├")}${fg(theme, "borderMuted", "─".repeat(width - 2))}${fg(theme, "border", "┤")}`;
            }
            if (line === "") {
                return blank;
            }
            return `${border}${gutter}${padLine(line, inner)}${gutter}${border}`;
        });

        return [top, ...padRows, ...bodyLines, ...padRows, bottom];
    }
}
