import type { AccountUsage, ProviderGroup, UsagePool } from "./api.ts";
import { availabilityBar, formatReset, poolAvailable, poolTitle } from "./api.ts";

/**
 * Floating usage modal: providers on a tab row, all of their accounts inside, and
 * the quota windows of the selected account.
 *
 * Dependency-free: the theme is injected by `ctx.ui.custom()`, the border is drawn
 * here, and key handling uses raw escape sequences. It implements the `Focusable`
 * contract (`focused` is set by the TUI) so the overlay receives keyboard input.
 */

export type ModalTheme = {
    fg: (color: string, text: string) => string;
};

export type UsageModalDeps = {
    theme: ModalTheme;
    tui: { requestRender: () => void };
    done: () => void;
    load: (force: boolean) => Promise<ProviderGroup[]>;
};

const SPINNER = ["⠋", "⠙", "⠹", "⠸"];
const ANSI_PATTERN = /\[[0-9;]*m/g;

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

function visibleWidth(text: string): number {
    return text.replace(ANSI_PATTERN, "").length;
}

function fit(text: string, width: number): string {
    if (visibleWidth(text) <= width) return text;
    let out = "";
    let used = 0;
    for (const char of text.replace(ANSI_PATTERN, "")) {
        if (used >= width - 1) break;
        out += char;
        used += 1;
    }
    return `${out}…`;
}

function pad(text: string, width: number): string {
    const gap = width - visibleWidth(text);
    return gap > 0 ? text + " ".repeat(gap) : text;
}

/** Usable content width inside the border and padding. */
function innerWidth(width: number): number {
    return Math.max(4, width - 2 - PADDING * 2);
}

function accountLine(account: AccountUsage): string {
    const flags: string[] = [];
    if (account.limitReached) flags.push("LIMIT REACHED");
    if (account.bankedCredits != null) flags.push(`banked ${account.bankedCredits}`);
    const head = account.note
        ? `${account.account} · sin cuota expuesta`
        : `${account.account} · plan ${account.plan}${account.tier ? ` · ${account.tier}` : ""} · ${account.pools.length} uso(s)`;
    return flags.length ? `${head} · ${flags.join(" · ")}` : head;
}

function poolLines(pool: UsagePool, theme: ModalTheme): string[] {
    const pct = `${pool.availablePercentage.toFixed(1)}% libre`;
    const models = pool.modelCount > 0 ? ` · ${pool.modelCount} modelo(s)` : "";
    return [
        `  ${theme.fg("accent", poolTitle(pool))}`,
        `    ${availabilityBar(pool.availablePercentage)} ${pct} · ${poolAvailable(pool)} · ${formatReset(pool.resetAt)}${models}`,
    ];
}

export class UsageModal {
    /** Focusable contract: the TUI flips this when the overlay gains/loses focus. */
    focused = false;

    private groups: ProviderGroup[] = [];
    private error: string | null = null;
    private loading = true;
    private providerIndex = 0;
    private accountIndex = 0;
    private frameIndex = 0;
    private timer: ReturnType<typeof setInterval> | null = null;

    constructor(private readonly deps: UsageModalDeps) {
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
            // nvim-style navigation
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

    invalidate(): void {
        // No cached render output; theme changes are picked up on the next render.
    }

    render(width: number): string[] {
        const theme = this.deps.theme;
        const lines: string[] = [];

        if (this.loading && this.groups.length === 0) {
            lines.push(`${SPINNER[this.frameIndex]} Cargando suscripciones…`);
            lines.push("");
            lines.push(theme.fg("dim", "Esc cancelar"));
            return this.frame("OmniRoute usage", lines, width);
        }

        if (this.error && this.groups.length === 0) {
            lines.push(`✖ ${this.error}`);
            lines.push("");
            lines.push(theme.fg("dim", "r reintentar · Esc cerrar"));
            return this.frame("OmniRoute usage", lines, width);
        }

        if (this.groups.length === 0) {
            lines.push("No hay conexiones activas en OmniRoute.");
            lines.push("");
            lines.push(theme.fg("dim", "r refrescar · Esc cerrar"));
            return this.frame("OmniRoute usage", lines, width);
        }

        // Provider tabs
        lines.push(
            this.groups
                .map((group, index) => {
                    const label = `${group.provider} (${group.accounts.length})`;
                    return index === this.providerIndex ? theme.fg("accent", `[${label}]`) : theme.fg("dim", label);
                })
                .join("  "),
        );
        lines.push("");

        const accounts = this.groups[this.providerIndex]?.accounts ?? [];

        // Every account of the selected provider, however many there are
        for (const [index, account] of accounts.entries()) {
            const marker = index === this.accountIndex ? "▸" : "·";
            const text = `${marker} ${accountLine(account)}`;
            lines.push(index === this.accountIndex ? theme.fg("accent", text) : theme.fg("dim", text));
        }
        lines.push("");

        const account = accounts[this.accountIndex];
        if (account) {
            lines.push(theme.fg("dim", "─".repeat(innerWidth(width))));
            // With a single account the list above already renders this header.
            if (accounts.length > 1) lines.push(accountLine(account));
            if (account.note) lines.push(theme.fg("dim", `  ${account.note.slice(0, 160)}`));
            if (account.error) lines.push(theme.fg("warning", `  error: ${account.error}`));
            if (this.loading) lines.push(`${SPINNER[this.frameIndex]} actualizando…`);
            for (const pool of account.pools) lines.push(...poolLines(pool, theme));
            if (!account.note && !account.error && account.pools.length === 0 && !this.loading) {
                lines.push(theme.fg("dim", "  sin cuotas reportadas"));
            }
        }

        lines.push("");
        lines.push(theme.fg("dim", "h/l proveedor · j/k cuenta · r refrescar · Esc cerrar"));

        const total = this.groups.reduce((sum, group) => sum + group.accounts.length, 0);
        return this.frame(`OmniRoute usage · ${total} suscripción(es)`, lines, width);
    }

    /** Bordered box with a title, horizontal and vertical padding. */
    private frame(title: string, content: string[], width: number): string[] {
        const theme = this.deps.theme;
        if (width < 16) return content.map((line) => fit(line, width));

        const inner = innerWidth(width);
        const gutter = " ".repeat(PADDING);
        const titleText = ` ${title} `;
        const fill = Math.max(0, width - 3 - visibleWidth(titleText));
        const border = theme.fg("dim", "│");
        const top =
            `${theme.fg("accent", "┌─")}${theme.fg("accent", titleText)}` +
            `${theme.fg("dim", "─".repeat(fill))}${theme.fg("accent", "┐")}`;
        const bottom = `${theme.fg("accent", "└")}${theme.fg("dim", "─".repeat(width - 2))}${theme.fg("accent", "┘")}`;
        const blank = `${border}${pad("", width - 2)}${border}`;
        const padRows = Array.from({ length: VERTICAL_PADDING }, () => blank);

        return [
            top,
            ...padRows,
            ...content.map((line) => `${border}${gutter}${pad(fit(line, inner), inner)}${gutter}${border}`),
            ...padRows,
            bottom,
        ];
    }
}
