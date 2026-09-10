import {
    Container,
    type Component,
    type Focusable,
    type TuiMouseEvent,
    type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import {
    formatContext,
    formatCost,
    modelBadges,
    type AccountNode,
    type Catalog,
    type Model,
    type ProviderNode,
} from "./api.ts";

/**
 * Floating model picker with a PROVIDER → ACCOUNT → MODEL hierarchy.
 *
 * Choose the provider first; if it exposes several accounts, pick one; then pick
 * the model inside it. Single-account providers skip the account level so the
 * common case stays flat.
 */

export type ModalTheme = {
    fg: (color: string, text: string) => string;
    bg?: (color: string, text: string) => string;
    bold?: (text: string) => string;
    italic?: (text: string) => string;
};

export type PickerDeps = {
    theme: ModalTheme;
    tui: { requestRender: () => void };
    done: () => void;
    load: (force: boolean) => Promise<Catalog>;
    /** Assigns the model to Pi. Returns an error message on failure. */
    select: (model: Model<any>) => Promise<string | undefined>;
    currentModel?: Model<any>;
    initialQuery?: string;
    /** Total rows the overlay can display. Drives the scroll viewport. */
    maxHeight?: number;
};

const ANSI_PATTERN = /\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?(\x07|\x1b\\)|\x1b[()][AB012]|\x1b./g;

const PADDING = 2;
const VERTICAL_PADDING = 1;

const KEY = {
    up: "\x1b[A",
    down: "\x1b[B",
    left: "\x1b[D",
    right: "\x1b[C",
    pageUp: "\x1b[5~",
    pageDown: "\x1b[6~",
    enter: "\r",
    tab: "\t",
    shiftTab: "\x1b[Z",
    escape: "\x1b",
    ctrlC: "\x03",
    backspace: "\x7f",
    space: " ",
} as const;

type RowKind = "provider" | "account" | "model";

type Row = {
    kind: RowKind;
    provider: ProviderNode;
    account?: AccountNode;
    model?: Model<any>;
    depth: number;
};

type ClickRegion = {
    id: string;
    kind: "toggle" | "select" | "refresh" | "close" | "row";
    x1: number;
    x2: number;
    y: number;
    index?: number;
};

/** Region geometry is computed during render, so callers omit `x1`/`x2`. */
type RegionSeed = Omit<ClickRegion, "x1" | "x2">;

/**
 * `TuiMouseDispatchResult` is not re-exported from the package index but is the
 * return type `Container.handleMouse` declares. Redeclared structurally so the
 * override type-checks without reaching into internals.
 */
type ContainerMouseResult = TuiMouseEventResult & {
    handled: true;
    target: { component: Component; originX: number; originY: number; width: number; height: number };
};

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
            const match = text.slice(i).match(new RegExp(`^(${ANSI_PATTERN.source})`));
            if (match) {
                out += match[0];
                i += match[0].length;
                continue;
            }
        }
        if (vis >= maxVis) break;
        out += text[i];
        vis += 1;
        i += 1;
    }
    return out + "\x1b[0m" + ellipsis;
}

function padLine(line: string, innerWidth: number): string {
    const vis = visibleWidth(line);
    if (vis > innerWidth) {
        const fitted = truncateToWidth(line, innerWidth);
        return fitted + " ".repeat(Math.max(0, innerWidth - visibleWidth(fitted)));
    }
    return line + " ".repeat(Math.max(0, innerWidth - vis));
}

function innerWidth(width: number): number {
    return Math.max(4, width - 2 - PADDING * 2);
}

function fg(theme: ModalTheme, color: string, text: string): string {
    return theme.fg ? theme.fg(color, text) : text;
}

function bold(theme: ModalTheme, text: string): string {
    return theme.bold ? theme.bold(text) : `\x1b[1m${text}\x1b[22m`;
}

export class ModelPickerModal extends Container implements Focusable {
    focused = false;

    private deps: PickerDeps;
    private catalog: Catalog | null = null;
    private error: string | null = null;
    private loading = true;

    private query = "";
    private rows: Row[] = [];
    private cursor = 0;
    private scroll = 0;
    /**
     * Rows that fit in the body. Recomputed from real available height on every
     * render so scrolling matches what is actually on screen.
     */
    private viewportRows = 10;

    /**
     * Explicit overrides. Everything starts collapsed; `collapseAll` is the
     * baseline (true = all collapsed) and these hold the nodes the user has
     * expanded, so toggling the baseline does not lose their choices.
     */
    private collapsed = new Set<string>();
    private collapseAll = true;

    private status: { text: string; kind: "ok" | "error" } | null = null;
    private clickRegions: ClickRegion[] = [];
    private hoveredId: string | null = null;

    constructor(deps: PickerDeps) {
        super();
        this.deps = deps;
        this.query = deps.initialQuery ?? "";
        void this.runLoad(false);
    }

    // ---------------------------------------------------------------- loading

    private async runLoad(force: boolean): Promise<void> {
        this.loading = true;
        this.error = null;
        this.deps.tui.requestRender();
        try {
            this.catalog = await this.deps.load(force);
            if (this.catalog.error) this.error = this.catalog.error;
            this.rebuildRows();
        } catch (cause) {
            this.error = cause instanceof Error ? cause.message : String(cause);
        } finally {
            this.loading = false;
            this.deps.tui.requestRender();
        }
    }

    // ------------------------------------------------------------------ rows

    /** Collapsed unless the user explicitly expanded it (or all are expanded). */
    private isCollapsed(id: string): boolean {
        return this.collapseAll ? !this.collapsed.has(id) : this.collapsed.has(id);
    }

    /** True when the row at `index` has hidden content above/below the view. */
    private scrollState(): { above: boolean; below: boolean; start: number; end: number } {
        const end = Math.min(this.rows.length, this.scroll + this.viewportRows);
        return {
            above: this.scroll > 0,
            below: end < this.rows.length,
            start: this.rows.length === 0 ? 0 : this.scroll + 1,
            end,
        };
    }

    private modelMatches(model: Model<any>, provider: ProviderNode): boolean {
        if (!this.query) return true;
        const needle = this.query.toLowerCase();
        return (
            model.id.toLowerCase().includes(needle) ||
            (model.name ?? "").toLowerCase().includes(needle) ||
            provider.id.toLowerCase().includes(needle) ||
            provider.displayName.toLowerCase().includes(needle)
        );
    }

    private rebuildRows(): void {
        const previous = this.rows[this.cursor];
        this.rows = [];

        for (const provider of this.catalog?.providers ?? []) {
            const models = provider.models.filter((model) => this.modelMatches(model, provider));
            if (models.length === 0) continue;

            this.rows.push({ kind: "provider", provider, depth: 0 });
            if (this.isCollapsed(provider.id)) continue;

            // Filtering flattens to models: less nesting, faster scanning.
            if (this.query) {
                for (const model of models) {
                    this.rows.push({ kind: "model", provider, model, depth: 1 });
                }
                continue;
            }

            if (!provider.multiAccount) {
                // Single account: skip straight to models.
                for (const model of models) {
                    this.rows.push({ kind: "model", provider, model, depth: 1 });
                }
                continue;
            }

            for (const account of provider.accounts) {
                const accountModels = account.models.filter((model) => this.modelMatches(model, provider));
                if (accountModels.length === 0) continue;
                this.rows.push({ kind: "account", provider, account, depth: 1 });
                if (this.isCollapsed(account.id)) continue;
                for (const model of accountModels) {
                    this.rows.push({ kind: "model", provider, account, model, depth: 2 });
                }
            }
        }

        if (previous) {
            const index = this.rows.findIndex((row) => sameRow(row, previous));
            this.cursor = index >= 0 ? index : 0;
        } else {
            this.cursor = this.firstSelectableIndex();
        }
        this.clampScroll();
    }

    private firstSelectableIndex(): number {
        const index = this.rows.findIndex((row) => row.kind === "model");
        return index >= 0 ? index : 0;
    }

    /**
     * Keeps the cursor inside the visible window.
     *
     * Both directions matter: scrolling down must push `scroll` forward, not
     * only clamp it against the maximum. Without the lower bound the cursor
     * walks off-screen while the viewport stays pinned at the top.
     */
    private clampScroll(): void {
        const viewport = Math.max(1, this.viewportRows);
        const max = Math.max(0, this.rows.length - viewport);

        if (this.cursor < this.scroll) {
            this.scroll = this.cursor;
        } else if (this.cursor >= this.scroll + viewport) {
            this.scroll = this.cursor - viewport + 1;
        }

        if (this.scroll > max) this.scroll = max;
        if (this.scroll < 0) this.scroll = 0;
    }

    private move(delta: number): void {
        if (this.rows.length === 0) return;
        this.cursor = Math.min(this.rows.length - 1, Math.max(0, this.cursor + delta));
        this.clampScroll();
        this.deps.tui.requestRender();
    }

    // -------------------------------------------------------------- actions

    private toggleCollapse(id: string): void {
        const collapsed = this.isCollapsed(id);
        if (this.collapseAll) {
            if (collapsed) this.collapsed.add(id);
            else this.collapsed.delete(id);
        } else if (collapsed) {
            this.collapsed.delete(id);
        } else {
            this.collapsed.add(id);
        }
    }

    private toggleAtCursor(): void {
        const row = this.rows[this.cursor];
        if (!row) return;

        if (row.kind === "provider") {
            this.toggleCollapse(row.provider.id);
            this.rebuildRows();
            this.deps.tui.requestRender();
            return;
        }

        if (row.kind === "account" && row.account) {
            this.toggleCollapse(row.account.id);
            this.rebuildRows();
            this.deps.tui.requestRender();
            return;
        }

        void this.selectRow();
    }

    private async selectRow(): Promise<void> {
        const row = this.rows[this.cursor];
        if (!row?.model) return;
        const message = await this.deps.select(row.model);
        if (message) {
            this.status = { text: message, kind: "error" };
            this.deps.tui.requestRender();
            return;
        }
        this.close();
    }

    private toggleCollapseAll(): void {
        this.collapseAll = !this.collapseAll;
        this.collapsed.clear();
        this.rebuildRows();
        this.deps.tui.requestRender();
    }

    private close(): void {
        this.deps.done();
    }

    dispose(): void {
        this.clear();
    }

    // ----------------------------------------------------------------- input

    handleInput(data: string): void {
        switch (data) {
            case KEY.up:
            case "k":
            case "K":
                this.move(-1);
                return;
            case KEY.down:
            case "j":
            case "J":
                this.move(1);
                return;
            case KEY.pageUp:
                this.move(-Math.max(1, this.viewportRows - 1));
                return;
            case KEY.pageDown:
                this.move(Math.max(1, this.viewportRows - 1));
                return;
            case KEY.enter:
                this.toggleAtCursor();
                return;
            case KEY.tab:
            case KEY.right:
            case "l":
            case "L":
                this.expandAtCursor();
                return;
            case KEY.shiftTab:
            case KEY.left:
            case "h":
            case "H":
                this.collapseAtCursor();
                return;
            case KEY.space:
            case "e":
            case "E":
                this.toggleCollapseAll();
                return;
            case "r":
            case "R":
                void this.runLoad(true);
                return;
            case "c":
            case "C":
                this.query = "";
                this.rebuildRows();
                this.deps.tui.requestRender();
                return;
            case KEY.backspace:
                this.query = this.query.slice(0, -1);
                this.rebuildRows();
                this.deps.tui.requestRender();
                return;
            case KEY.escape:
            case "q":
            case "Q":
            case KEY.ctrlC:
                this.close();
                return;
            default:
                break;
        }

        // Printable characters extend the filter.
        if (data.length === 1 && data.charCodeAt(0) >= 32) {
            this.query += data;
            this.rebuildRows();
            this.deps.tui.requestRender();
        }
    }

    private expandAtCursor(): void {
        const row = this.rows[this.cursor];
        if (!row) return;
        if (row.kind === "provider" && this.isCollapsed(row.provider.id)) this.toggleAtCursor();
        else if (row.kind === "account" && row.account && this.isCollapsed(row.account.id)) this.toggleAtCursor();
    }

    private collapseAtCursor(): void {
        const row = this.rows[this.cursor];
        if (!row) return;

        if (row.kind === "model") {
            // Walk up to the nearest collapsible ancestor and collapse it.
            const parentId = row.account?.id ?? row.provider.id;
            if (!this.isCollapsed(parentId)) {
                this.toggleCollapse(parentId);
                this.rebuildRows();
                this.deps.tui.requestRender();
            }
            return;
        }

        if (row.kind === "account" && row.account && !this.isCollapsed(row.account.id)) {
            this.toggleAtCursor();
            return;
        }
        if (row.kind === "provider" && !this.isCollapsed(row.provider.id)) {
            this.toggleAtCursor();
        }
    }

    // ----------------------------------------------------------------- mouse

    /**
     * Replaces `Container.handleMouse`. `Container` forwards events to children
     * and returns the richer dispatch result; this modal renders its own rows
     * and has no children, so it behaves as a leaf implementing the plain
     * `TuiMouseEventResult` contract the TUI expects.
     */
    override handleMouse(event: TuiMouseEvent): ContainerMouseResult | undefined {
        const result = this.handleMouseEvent(event);
        if (!result?.handled) return undefined;
        return {
            ...result,
            handled: true,
            target: { component: this, originX: 0, originY: 0, width: 0, height: 0 },
        };
    }

    private handleMouseEvent(event: TuiMouseEvent): TuiMouseEventResult | undefined {
        if (event.type === "wheel" && event.wheelDelta) {
            this.move(event.wheelDelta > 0 ? 1 : -1);
            return { handled: true, render: true };
        }

        if (event.type === "move") {
            const hit = this.clickRegions.find((region) => event.y === region.y && event.x >= region.x1 && event.x <= region.x2);
            const id = hit ? hit.id : null;
            if (id !== this.hoveredId) {
                this.hoveredId = id;
                return { handled: true, render: true };
            }
            return { handled: true };
        }

        if (event.button === "left" && event.type === "click") {
            return { handled: true };
        }

        if (event.button === "left" && event.type === "press") {
            const hit = this.clickRegions.find((region) => event.y === region.y && event.x >= region.x1 && event.x <= region.x2);
            if (!hit) return { handled: true };

            switch (hit.kind) {
                case "row":
                    if (hit.index !== undefined) {
                        this.cursor = hit.index;
                        this.clampScroll();
                        this.deps.tui.requestRender();
                    }
                    return { handled: true, render: true };
                case "toggle":
                    if (hit.index !== undefined) {
                        this.cursor = hit.index;
                        this.toggleAtCursor();
                    }
                    return { handled: true, render: true };
                case "select":
                    if (hit.index !== undefined) {
                        this.cursor = hit.index;
                        void this.selectRow();
                    }
                    return { handled: true, render: true };
                case "refresh":
                    void this.runLoad(true);
                    return { handled: true, render: true };
                case "close":
                    this.close();
                    return { handled: true, render: true };
            }
        }

        return { handled: true };
    }

    // ---------------------------------------------------------------- render

    override invalidate(): void {
        this.clickRegions = [];
        super.invalidate();
    }

    override render(width: number): string[] {
        this.clickRegions = [];
        const available = Math.max(20, width);
        const iw = innerWidth(available);

        const title = bold(this.deps.theme, fg(this.deps.theme, "accent", "Selector de modelo"));
        const lines: string[] = [];

        if (this.loading && !this.catalog) {
            lines.push(fg(this.deps.theme, "muted", "Cargando catálogo de modelos…"));
            lines.push("");
            this.pushButtons(lines, 1 + VERTICAL_PADDING + lines.length, iw);
            return this.frame(title, lines, available, iw);
        }

        if (this.error && !this.catalog) {
            lines.push(bold(this.deps.theme, fg(this.deps.theme, "error", "No se pudo cargar el catálogo")));
            lines.push(fg(this.deps.theme, "muted", this.error));
            lines.push("");
            this.pushButtons(lines, 1 + VERTICAL_PADDING + lines.length, iw, true);
            return this.frame(title, lines, available, iw);
        }

        // Header: current model + counts.
        const current = this.deps.currentModel;
        lines.push(
            current
                ? `${fg(this.deps.theme, "dim", "actual:")} ${fg(this.deps.theme, "text", `${current.provider}/${current.id}`)}`
                : fg(this.deps.theme, "dim", "actual: ninguno"),
        );
        const providerCount = this.catalog?.providers.length ?? 0;
        const accountCount = this.catalog?.providers.reduce((sum, p) => sum + p.accounts.length, 0) ?? 0;
        lines.push(
            fg(
                this.deps.theme,
                "dim",
                `${providerCount} proveedor${providerCount === 1 ? "" : "es"} · ${accountCount} cuenta${accountCount === 1 ? "" : "s"} · ${this.catalog?.total ?? 0} modelos${this.catalog?.scoped ? " · sesión limitada" : ""}`,
            ),
        );
        lines.push("");

        // Filter row.
        const queryLabel = fg(this.deps.theme, "accent", "/");
        const queryText = this.query
            ? fg(this.deps.theme, "text", this.query)
            : fg(this.deps.theme, "dim", "filtrar (escribe para buscar)");
        lines.push(`${queryLabel} ${queryText}${fg(this.deps.theme, "accent", this.focused ? "▌" : "")}`);
        lines.push("");

        // Body. The viewport is derived from real available height.
        const bodyStart = lines.length;
        const chromeRows = 1 + VERTICAL_PADDING * 2 + 4 + 2 + 1 + 1;
        const availableRows = this.deps.maxHeight ?? 20;
        this.viewportRows = Math.max(3, Math.min(12, availableRows - chromeRows));

        if (this.rows.length === 0) {
            lines.push(
                fg(
                    this.deps.theme,
                    "muted",
                    this.query ? `Sin modelos que coincidan con "${this.query}".` : "Sin modelos disponibles.",
                ),
            );
        } else {
            this.clampScroll();
            const visible = this.rows.slice(this.scroll, this.scroll + this.viewportRows);
            for (const [offset, row] of visible.entries()) {
                const index = this.scroll + offset;
                const y = 1 + VERTICAL_PADDING + bodyStart + offset;
                lines.push(this.renderRow(row, index, y, iw));
            }
        }

        // Scroll indicator: arrows make hidden content obvious.
        const scroll = this.scrollState();
        if (this.rows.length > 0) {
            const up = scroll.above ? fg(this.deps.theme, "accent", "▲") : fg(this.deps.theme, "borderMuted", "·");
            const down = scroll.below ? fg(this.deps.theme, "accent", "▼") : fg(this.deps.theme, "borderMuted", "·");
            const range = fg(this.deps.theme, "dim", `${scroll.start}-${scroll.end} de ${this.rows.length}`);
            lines.push(`${up} ${down} ${range}`);
        }

        // Status line.
        lines.push("");
        if (this.status) {
            const color = this.status.kind === "error" ? "error" : "success";
            lines.push(fg(this.deps.theme, color, this.status.text));
        } else if (this.loading) {
            lines.push(fg(this.deps.theme, "muted", "Refrescando…"));
        } else {
            lines.push(fg(this.deps.theme, "dim", "enter elige/expande · espacio colapsa todo · r refresca · Esc cierra"));
        }

        lines.push("");
        this.pushButtons(lines, 1 + VERTICAL_PADDING + lines.length, iw);

        return this.frame(title, lines, available, iw);
    }

    private renderRow(row: Row, index: number, y: number, iw: number): string {
        if (row.kind === "provider") return this.renderProviderRow(row, index, y, iw);
        if (row.kind === "account") return this.renderAccountRow(row, index, y, iw);
        return this.renderModelRow(row, index, y, iw);
    }

    private renderProviderRow(row: Row, index: number, y: number, iw: number): string {
        const theme = this.deps.theme;
        const provider = row.provider;
        const selected = index === this.cursor;
        const hovered = this.hoveredId === `row-${index}`;
        const collapsed = this.isCollapsed(provider.id);
        const arrow = collapsed ? "▶" : "▼";
        const marker = selected ? fg(theme, "accent", "▸ ") : "  ";

        const auth = provider.auth.configured ? fg(theme, "success", "✓") : fg(theme, "error", "✗");
        const label = selected
            ? bold(theme, fg(theme, "accent", provider.displayName.toUpperCase()))
            : fg(theme, hovered ? "text" : "muted", provider.displayName.toUpperCase());

        const meta = provider.multiAccount
            ? fg(theme, "dim", `${provider.accounts.length} cuentas · ${provider.models.length} modelos`)
            : fg(theme, "dim", `${provider.models.length} modelos`);
        const authLabel = provider.auth.label ? fg(theme, "dim", ` · ${provider.auth.label}`) : "";

        const text = `${marker}${fg(theme, "accent", arrow)} ${auth} ${label} ${meta}${authLabel}`;
        this.pushRegion({ id: `row-${index}`, kind: "toggle", y, index }, text, "", iw);
        return text;
    }

    private renderAccountRow(row: Row, index: number, y: number, iw: number): string {
        const theme = this.deps.theme;
        const account = row.account!;
        const selected = index === this.cursor;
        const hovered = this.hoveredId === `row-${index}`;
        const collapsed = this.isCollapsed(account.id);
        const arrow = collapsed ? "▶" : "▼";
        const marker = selected ? fg(theme, "accent", "▸ ") : "  ";

        const label = selected
            ? bold(theme, fg(theme, "syntaxFunction", account.label))
            : fg(theme, hovered ? "text" : "muted", account.label);
        const meta = fg(theme, "dim", `${account.models.length} modelo${account.models.length === 1 ? "" : "s"}`);

        const text = `  ${marker}${fg(theme, "accent", arrow)} ${label} ${meta}`;
        this.pushRegion({ id: `row-${index}`, kind: "toggle", y, index }, text, "  ", iw);
        return text;
    }

    private renderModelRow(row: Row, index: number, y: number, iw: number): string {
        const theme = this.deps.theme;
        const model = row.model!;
        const selected = index === this.cursor;
        const hovered = this.hoveredId === `row-${index}`;
        const marker = selected ? fg(theme, "accent", "▸ ") : "  ";

        const isCurrent =
            this.deps.currentModel !== undefined &&
            this.deps.currentModel.provider === model.provider &&
            this.deps.currentModel.id === model.id;
        const dot = isCurrent ? fg(theme, "success", "●") : fg(theme, "dim", "○");

        const label = selected
            ? bold(theme, fg(theme, "text", model.id))
            : fg(theme, hovered ? "text" : "muted", model.id);
        const ctx = fg(theme, "syntaxType", formatContext(model.contextWindow));
        const cost = fg(theme, "syntaxKeyword", formatCost(model));
        const badges = modelBadges(model);
        const badgeText = badges.length > 0 ? fg(theme, "dim", ` · ${badges.join(" · ")}`) : "";

        const indent = row.depth >= 2 ? "    " : "  ";
        const text = `${indent}${marker}${dot} ${label} ${fg(theme, "dim", "·")} ${ctx} ${fg(theme, "dim", "·")} ${cost}${badgeText}`;
        this.pushRegion({ id: `row-${index}`, kind: "select", y, index }, text, indent, iw);
        return text;
    }

    private pushRegion(region: RegionSeed, text: string, indent: string, iw: number): void {
        const x1 = 1 + PADDING + visibleWidth(indent);
        const x2 = Math.min(x1 + visibleWidth(text), 1 + PADDING + iw);
        this.clickRegions.push({ ...region, x1, x2: Math.max(x1, x2 - 1) });
    }

    private pushButtons(lines: string[], y: number, iw: number, withRetry = false): void {
        const theme = this.deps.theme;
        let x = 1 + PADDING;
        const parts: string[] = [];

        const refreshLabel = "⟳ Refrescar";
        const refresh = this.hoveredId === "refresh" ? bold(theme, fg(theme, "accent", `[ ${refreshLabel} ]`)) : fg(theme, "accent", `[ ${refreshLabel} ]`);
        parts.push(refresh);
        this.clickRegions.push({ id: "refresh", kind: "refresh", x1: x, x2: x + visibleWidth(refresh) - 1, y });
        x += visibleWidth(refresh) + 2;

        if (withRetry) {
            const retryLabel = "⟳ Reintentar";
            const retry = this.hoveredId === "retry" ? bold(theme, fg(theme, "accent", `[ ${retryLabel} ]`)) : fg(theme, "accent", `[ ${retryLabel} ]`);
            parts.push(retry);
            this.clickRegions.push({ id: "retry", kind: "refresh", x1: x, x2: x + visibleWidth(retry) - 1, y });
            x += visibleWidth(retry) + 2;
        }

        const closeLabel = "✕ Cerrar";
        const close = this.hoveredId === "close" ? bold(theme, fg(theme, "error", `[ ${closeLabel} ]`)) : fg(theme, "error", `[ ${closeLabel} ]`);
        parts.push(close);
        this.clickRegions.push({ id: "close", kind: "close", x1: x, x2: x + visibleWidth(close) - 1, y });

        lines.push(`${parts.join("  ")} ${fg(theme, "dim", "(r refrescar · Esc cerrar)")}`);
    }

    private frame(title: string, lines: string[], width: number, iw: number): string[] {
        const theme = this.deps.theme;
        const border = (text: string) => fg(theme, "border", text);
        const pad = " ".repeat(PADDING);
        const scroll = this.scrollState();

        // A marker on the top/bottom border makes hidden rows obvious even when
        // the numeric range scrolls out of view.
        const topFill = width - 4;
        const bottomFill = width - 4;
        const top = scroll.above
            ? border("╭") + fg(theme, "accent", "─".repeat(topFill)) + border("╮")
            : border("╭") + border("─".repeat(topFill)) + border("╮");
        const bottom = scroll.below
            ? border("╰") + fg(theme, "accent", "─".repeat(bottomFill)) + border("╯")
            : border("╰") + border("─".repeat(bottomFill)) + border("╯");

        const out = [
            top,
            border("│") + pad + padLine(title, iw) + pad + border("│"),
            border("├") + border("─".repeat(width - 4)) + border("┤"),
        ];

        for (let i = 0; i < VERTICAL_PADDING; i += 1) {
            out.push(border("│") + pad + " ".repeat(iw) + pad + border("│"));
        }
        for (const line of lines) {
            out.push(border("│") + pad + padLine(line, iw) + pad + border("│"));
        }
        for (let i = 0; i < VERTICAL_PADDING; i += 1) {
            out.push(border("│") + pad + " ".repeat(iw) + pad + border("│"));
        }
        out.push(bottom);
        return out;
    }
}

function sameRow(a: Row, b: Row): boolean {
    if (a.kind !== b.kind) return false;
    if (a.provider.id !== b.provider.id) return false;
    if (a.kind === "provider") return true;
    if (a.kind === "account") return a.account?.id === b.account?.id;
    return a.model?.id === b.model?.id;
}
