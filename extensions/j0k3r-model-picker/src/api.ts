import type { Model } from "@earendil-works/pi-ai";

/**
 * Catalog adapter: reads the Pi model registry and organizes it the way the
 * picker renders it.
 *
 * Hierarchy: PROVIDER → ACCOUNT → MODEL
 *
 * The "account" level is derived from the model id:
 * - ids containing `/` (e.g. `deepseek/deepseek-v4-pro`, common in aggregators
 *   such as CLIProxyAPI) group by the segment BEFORE the slash;
 * - plain ids group by family, so `gpt-5.6-luna` and `gpt-5.6-sol` sit together.
 *
 * A provider with a single group skips the account level entirely, keeping the
 * common case flat.
 *
 * No Pi registration lives here; this is pure domain orchestration.
 */

export type { Model };

export type AuthInfo = {
    configured: boolean;
    label?: string;
};

/** A logical group inside a provider (vendor/account namespace). */
export type AccountNode = {
    id: string;
    label: string;
    models: Model<any>[];
};

export type ProviderNode = {
    id: string;
    displayName: string;
    auth: AuthInfo;
    accounts: AccountNode[];
    /** All models across groups, newest first. */
    models: Model<any>[];
    /** True when the account level should be rendered. */
    multiAccount: boolean;
};

export type Catalog = {
    providers: ProviderNode[];
    total: number;
    scoped: boolean;
    error?: string;
};

/** Context subset the loader needs. Keeps this module free of Pi types. */
export type CatalogSource = {
    getAvailable(): Model<any>[];
    getProviderAuthStatus(provider: string): AuthInfo;
    getProviderDisplayName(provider: string): string;
    refresh?(): Promise<void>;
};

/**
 * Vendors recognised in plain (slash-less) model ids.
 *
 * Aggregators such as opencode-go expose flat catalogs where every id is its
 * own model (`glm-5.3`, `kimi-k2.6`, `qwen3.8-max`). Grouping by full family
 * would create one group per model, so we collapse on the vendor prefix
 * instead — the only grouping that actually shortens the list.
 */
const VENDOR_PREFIXES = [
    "deepseek",
    "glm",
    "grok",
    "gpt",
    "kimi",
    "longcat",
    "minimax",
    "mimo",
    "muse",
    "omen",
    "qwen",
    "claude",
    "gemini",
    "llama",
    "hy",
] as const;

/**
 * Group key for a model id.
 *
 * - `vendor/model` → `vendor` (CLIProxyAPI and similar aggregators).
 * - plain ids → the recognised vendor prefix, so `glm-5.1`, `glm-5.2` and
 *   `glm-5.3` share a `glm` group while `gpt-5.6-luna`/`gpt-5.6-sol` share
 *   `gpt`. Unrecognised ids land in `otros` rather than getting their own group.
 */
export function groupKeyOf(id: string): string {
    const trimmed = id.trim().toLowerCase();
    if (!trimmed) return "otros";

    const slash = trimmed.indexOf("/");
    if (slash > 0) return trimmed.slice(0, slash);

    // Match a vendor only at a word boundary: the id is the vendor, or starts
    // with `vendor-`, or is `vendor` followed directly by a digit
    // (`qwen3.8-max`, `hy4-preview`). Anchoring on the full prefix avoids
    // `gpt-5.6-luna` being captured by a later, longer vendor name.
    for (const prefix of VENDOR_PREFIXES) {
        if (trimmed === prefix) return prefix;
        if (trimmed.startsWith(`${prefix}-`)) return prefix;
        if (trimmed.startsWith(prefix) && /^\d/.test(trimmed.slice(prefix.length))) return prefix;
    }

    return "otros";
}

/** Sorts newest first: dated versions descend, aliases (`-latest`) float up. */
function compareIds(a: string, b: string): number {
    const aAlias = !/-\d{8}$/.test(a);
    const bAlias = !/-\d{8}$/.test(b);
    if (aAlias !== bAlias) return aAlias ? -1 : 1;
    return b.localeCompare(a);
}

export function buildCatalog(models: Model<any>[], source: CatalogSource, scoped: boolean): Catalog {
    const byProvider = new Map<string, Model<any>[]>();
    for (const model of models) {
        const bucket = byProvider.get(model.provider);
        if (bucket) bucket.push(model);
        else byProvider.set(model.provider, [model]);
    }

    const providers: ProviderNode[] = [];
    for (const [id, list] of byProvider) {
        list.sort((a, b) => compareIds(a.id, b.id));

        const byAccount = new Map<string, Model<any>[]>();
        for (const model of list) {
            const key = groupKeyOf(model.id);
            const bucket = byAccount.get(key);
            if (bucket) bucket.push(model);
            else byAccount.set(key, [model]);
        }

        const accounts: AccountNode[] = [...byAccount.entries()]
            .map(([key, groupModels]) => ({
                id: `${id}::${key}`,
                label: byAccount.size === 1 ? source.getProviderDisplayName(id) : key,
                models: [...groupModels].sort((a, b) => compareIds(a.id, b.id)),
            }))
            .sort((a, b) => a.label.localeCompare(b.label));

        providers.push({
            id,
            displayName: source.getProviderDisplayName(id),
            auth: source.getProviderAuthStatus(id),
            accounts,
            models: list,
            multiAccount: accounts.length > 1,
        });
    }

    // Authenticated providers first, then alphabetical.
    providers.sort((a, b) => {
        if (a.auth.configured !== b.auth.configured) return a.auth.configured ? -1 : 1;
        return a.displayName.localeCompare(b.displayName);
    });

    return { providers, total: models.length, scoped };
}

type LoadOptions = {
    source: CatalogSource;
    /** Pre-scoped models from `ctx.scopedModels`; empty means "no scoping". */
    scopedModels: readonly { model: Model<any> }[];
    force?: boolean;
};

let cache: Catalog | null = null;

export function invalidateCatalog(): void {
    cache = null;
}

export async function loadCatalog(options: LoadOptions, signal?: AbortSignal): Promise<Catalog> {
    if (!options.force && cache) return cache;
    if (signal?.aborted) throw new Error("aborted");

    if (options.force) cache = null;

    let error: string | undefined;
    if (options.source.refresh) {
        try {
            await options.source.refresh();
        } catch (cause) {
            error = cause instanceof Error ? cause.message : String(cause);
        }
    }

    const scoped = options.scopedModels.length > 0;
    const models = scoped ? options.scopedModels.map((entry) => entry.model) : options.source.getAvailable();
    const catalog = buildCatalog(models, options.source, scoped);
    if (error) catalog.error = error;
    cache = catalog;
    return catalog;
}

/**
 * Exact reference resolution, mirroring Pi's `/model <ref>` behavior:
 * `provider/id`, a bare `id`, or `provider/id` case-insensitively.
 */
export function findExactModel(ref: string, models: Model<any>[]): { model: Model<any> } | { ambiguous: true } | undefined {
    const trimmed = ref.trim();
    if (!trimmed) return undefined;
    const normalized = trimmed.toLowerCase();

    const canonical = models.filter((model) => `${model.provider}/${model.id}`.toLowerCase() === normalized);
    if (canonical.length === 1) return { model: canonical[0] };
    if (canonical.length > 1) return { ambiguous: true };

    const slash = trimmed.indexOf("/");
    if (slash !== -1) {
        const provider = trimmed.slice(0, slash).trim();
        const id = trimmed.slice(slash + 1).trim();
        if (provider && id) {
            const matches = models.filter(
                (model) => model.provider.toLowerCase() === provider.toLowerCase() && model.id.toLowerCase() === id.toLowerCase(),
            );
            if (matches.length === 1) return { model: matches[0] };
            if (matches.length > 1) return { ambiguous: true };
        }
    }

    const byId = models.filter((model) => model.id.toLowerCase() === normalized);
    if (byId.length === 1) return { model: byId[0] };
    if (byId.length > 1) return { ambiguous: true };
    return undefined;
}

/** Human-readable context window, e.g. `200k` or `1M`. */
export function formatContext(tokens: number | undefined): string {
    if (!tokens || tokens <= 0) return "?";
    if (tokens >= 1_000_000) {
        const millions = tokens / 1_000_000;
        return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M`;
    }
    return `${Math.round(tokens / 1000)}k`;
}

/** Compact per-million-token cost, e.g. `$3/$15`. Empty when free. */
export function formatCost(model: Model<any>): string {
    const input = model.cost?.input ?? 0;
    const output = model.cost?.output ?? 0;
    if (input === 0 && output === 0) return "gratis";
    return `$${trimNumber(input)}/$${trimNumber(output)}`;
}

function trimNumber(value: number): string {
    if (value === 0) return "0";
    if (value < 0.01) return value.toFixed(4).replace(/0+$/, "");
    if (value < 1) return value.toFixed(2).replace(/0$/, "");
    return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0$/, "");
}

/** Capability badges shown next to a model. */
export function modelBadges(model: Model<any>): string[] {
    const badges: string[] = [];
    if (model.reasoning) badges.push("razonamiento");
    if (model.input?.includes("image")) badges.push("visión");
    return badges;
}
