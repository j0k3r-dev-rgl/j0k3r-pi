import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * OmniRoute management API adapter.
 *
 * The inference key `OMNIROUTE_API_KEY` is NOT accepted by the management API
 * (403 "Invalid management token"). The CLI uses a machine-derived token, so we
 * derive the same value here with no extra dependencies:
 *   HMAC-SHA256(machineId, OMNIROUTE_CLI_SALT || "omniroute-cli-auth-v1")
 * sent as `x-omniroute-cli-token`. Loopback-only by construction and by guard.
 */

const MACHINE_ID_FILES = ["/var/lib/dbus/machine-id", "/etc/machine-id"];
const DEFAULT_SALT = "omniroute-cli-auth-v1";
const DEFAULT_BASE_URL = "http://127.0.0.1:20128";
const REQUEST_TIMEOUT_MS = 8000;
const MAX_CONNECTIONS = 25;

export type Quota = {
    used?: number;
    total?: number | null;
    remaining?: number;
    remainingPercentage?: number;
    unlimited?: boolean;
    resetAt?: string | null;
    windowSeconds?: number;
    displayName?: string;
    currency?: string;
};

export type UsagePool = {
    label: string;
    displayName: string | null;
    currency: string | null;
    used: number;
    available: number | null;
    total: number | null;
    unlimited: boolean;
    availablePercentage: number;
    resetAt: string | null;
    windowLabel: string | null;
    modelCount: number;
    models: string[];
};

export type AccountUsage = {
    id: string;
    provider: string;
    account: string;
    authType: string | null;
    plan: string;
    tier: string | null;
    limitReached: boolean;
    bankedCredits: number | null;
    rateLimitType: string | null;
    pools: UsagePool[];
    /** Provider explanation when no quota API is available (still a healthy connection). */
    note?: string;
    error?: string;
};

export type ProviderGroup = {
    provider: string;
    accounts: AccountUsage[];
};

type Connection = {
    id: string;
    provider: string;
    name?: string;
    email?: string;
    authType?: string;
    isActive?: boolean;
};

type Tier = { id?: string; name?: string };

type UsageResponse = {
    plan?: string;
    quotas?: Record<string, Quota | null>;
    subscriptionInfo?: { currentTier?: Tier; paidTier?: Tier };
    limitReached?: boolean;
    bankedResetCredits?: number;
    rateLimitReachedType?: string;
    /** Some providers (opencode-go) answer 200 with an explanation instead of quotas. */
    message?: string;
};

export function resolveBaseUrl(): string {
    const raw = (process.env.OMNIROUTE_BASE_URL || DEFAULT_BASE_URL).trim();
    return raw.replace(/\/+$/, "").replace(/\/v1$/, "");
}

function isLoopback(value: string): boolean {
    try {
        const host = new URL(value).hostname.replace(/^\[|\]$/g, "").toLowerCase();
        return host === "localhost" || host === "::1" || /^127(?:\.\d{1,3}){3}$/.test(host);
    } catch {
        return false;
    }
}

export function deriveManagementToken(): string {
    const explicit = process.env.OMNIROUTE_CLI_TOKEN?.trim();
    if (explicit) return explicit;

    let machineId = "";
    for (const file of MACHINE_ID_FILES) {
        try {
            machineId = readFileSync(file, "utf8").replace(/\s+/g, "").toLowerCase();
            if (machineId) break;
        } catch {
            // try next candidate
        }
    }
    if (!machineId) {
        throw new Error(
            "Cannot derive the OmniRoute management token: no machine-id file readable. Set OMNIROUTE_CLI_TOKEN explicitly.",
        );
    }
    const salt = process.env.OMNIROUTE_CLI_SALT || DEFAULT_SALT;
    return createHmac("sha256", machineId).update(salt).digest("hex");
}

async function callManagementApi<T>(
    baseUrl: string,
    path: string,
    token: string,
    signal?: AbortSignal,
): Promise<T> {
    if (!isLoopback(baseUrl)) {
        throw new Error(`Refusing non-loopback OmniRoute base URL: ${baseUrl}`);
    }
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const response = await fetch(`${baseUrl}${path}`, {
        headers: { accept: "application/json", "x-omniroute-cli-token": token },
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`OmniRoute ${path} failed with HTTP ${response.status}${body ? `: ${body.slice(0, 200)}` : ""}`);
    }
    return (await response.json()) as T;
}

function finiteOr(value: unknown, fallback: number): number {
    const numeric = typeof value === "number" ? value : Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

/** Antigravity families use clean prefixes; unknown models keep their own id. */
function familyOf(model: string): string {
    const head = model.split("-")[0]?.trim();
    return head ? head.toLowerCase() : model.toLowerCase();
}

/** Window-keyed quota rows (Codex / OpenCode Go) vs model-keyed rows (Antigravity). */
const WINDOW_KEYS = new Set([
    "session",
    "weekly",
    "daily",
    "monthly",
    "mcp_monthly",
    "hourly",
    "baseline",
    "sprint",
]);

function isWindowQuota(key: string, quota: Quota): boolean {
    return (
        WINDOW_KEYS.has(key.toLowerCase()) ||
        typeof quota.windowSeconds === "number" ||
        (typeof quota.remaining === "number" && typeof quota.remainingPercentage !== "number")
    );
}

function remainingPercent(quota: Quota): number {
    if (typeof quota.remainingPercentage === "number" && Number.isFinite(quota.remainingPercentage)) {
        return Math.max(0, Math.min(100, quota.remainingPercentage));
    }
    const total = typeof quota.total === "number" && quota.total > 0 ? quota.total : null;
    if (!total) return quota.unlimited ? 100 : 0;
    const remaining =
        typeof quota.remaining === "number" ? quota.remaining : Math.max(0, total - finiteOr(quota.used, 0));
    return Math.max(0, Math.min(100, (remaining / total) * 100));
}

function absoluteAvailable(quota: Quota): number | null {
    if (typeof quota.remaining === "number" && Number.isFinite(quota.remaining)) return Math.max(0, quota.remaining);
    if (typeof quota.total === "number" && Number.isFinite(quota.total)) {
        return Math.max(0, quota.total - finiteOr(quota.used, 0));
    }
    return null;
}

function humanWindow(seconds: number | undefined): string | null {
    if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return null;
    if (seconds % 86400 === 0) return `${seconds / 86400}d`;
    if (seconds % 3600 === 0) return `${seconds / 3600}h`;
    return `${Math.round(seconds / 60)}m`;
}

/**
 * Collapse raw quota rows into quota windows (pools).
 * - Model rows (Antigravity): models sharing a reset window are one "uso".
 * - Window rows (Codex / OpenCode Go): each key is already a window.
 */
export function buildPools(quotas: Record<string, Quota | null>): UsagePool[] {
    const pools: UsagePool[] = [];
    const modelGroups = new Map<string, { quota: Quota; models: string[] }>();

    const entries = Object.entries(quotas)
        .filter(([, quota]) => quota && typeof quota === "object")
        .map(([key, quota]) => ({ key, quota: quota as Quota }))
        .sort((a, b) => a.key.localeCompare(b.key));

    for (const { key, quota } of entries) {
        const remaining = remainingPercent(quota);

        if (isWindowQuota(key, quota)) {
            pools.push({
                label: key,
                displayName: quota.displayName ?? null,
                currency: quota.currency ?? null,
                used: finiteOr(quota.used, 0),
                available: absoluteAvailable(quota),
                total: typeof quota.total === "number" ? quota.total : null,
                unlimited: Boolean(quota.unlimited),
                availablePercentage: remaining,
                resetAt: quota.resetAt ?? null,
                windowLabel: humanWindow(quota.windowSeconds),
                modelCount: 0,
                models: [],
            });
            continue;
        }

        const groupKey = `${quota.resetAt ?? "none"}|${remaining.toFixed(4)}|${finiteOr(quota.used, 0)}|${quota.total ?? "∞"}|${quota.unlimited ? 1 : 0}`;
        const group = modelGroups.get(groupKey);
        if (group) group.models.push(key);
        else modelGroups.set(groupKey, { quota, models: [key] });
    }

    for (const [, { quota, models }] of modelGroups) {
        const remaining = remainingPercent(quota);
        const families = [...new Set(models.map(familyOf))];
        const label = families.length === 1 ? families[0] : `${families.slice(0, 2).join("+")} (${models.length} modelos)`;
        pools.push({
            label,
            displayName: null,
            currency: null,
            used: finiteOr(quota.used, 0),
            available: absoluteAvailable(quota),
            total: typeof quota.total === "number" ? quota.total : null,
            unlimited: Boolean(quota.unlimited),
            availablePercentage: remaining,
            resetAt: quota.resetAt ?? null,
            windowLabel: humanWindow(quota.windowSeconds),
            modelCount: models.length,
            models,
        });
    }

    return pools.sort((a, b) => {
        const left = a.resetAt ? Date.parse(a.resetAt) : Number.MAX_SAFE_INTEGER;
        const right = b.resetAt ? Date.parse(b.resetAt) : Number.MAX_SAFE_INTEGER;
        if (left !== right) return left - right;
        return a.label.localeCompare(b.label);
    });
}

/** Fetch every active connection and group it by provider, then by account. */
export async function fetchUsage(signal?: AbortSignal): Promise<ProviderGroup[]> {
    const baseUrl = resolveBaseUrl();
    const token = deriveManagementToken();

    const payload = await callManagementApi<{ connections?: Connection[] }>(baseUrl, "/api/providers", token, signal);
    const all = Array.isArray(payload?.connections) ? payload.connections : [];
    const targets = all.filter((connection) => connection?.isActive !== false).slice(0, MAX_CONNECTIONS);

    // One usage probe per connection, in parallel: some providers (opencode-go)
    // scrape a dashboard and are slow, so serial fetching would stack the latency.
    const settled = await Promise.allSettled(
        targets.map(async (connection) => {
            const raw = (connection.name || connection.email || "").trim();
            const account = !raw ? connection.id.slice(0, 8) : raw.length > 34 ? `${raw.slice(0, 31)}…` : raw;

            try {
                const usage = await callManagementApi<UsageResponse>(
                    baseUrl,
                    `/api/usage/${encodeURIComponent(connection.id)}`,
                    token,
                    signal,
                );
                const pools = buildPools(usage?.quotas ?? {});
                return {
                    id: connection.id,
                    provider: connection.provider,
                    account,
                    authType: connection.authType ?? null,
                    plan: usage?.plan ?? "unknown",
                    tier: usage?.subscriptionInfo?.paidTier?.name ?? usage?.subscriptionInfo?.currentTier?.name ?? null,
                    limitReached: Boolean(usage?.limitReached),
                    bankedCredits: typeof usage?.bankedResetCredits === "number" ? usage.bankedResetCredits : null,
                    rateLimitType: usage?.rateLimitReachedType ?? null,
                    pools,
                    note: pools.length === 0 ? usage?.message?.trim() : undefined,
                } satisfies AccountUsage;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return {
                    id: connection.id,
                    provider: connection.provider,
                    account,
                    authType: connection.authType ?? null,
                    plan: "unknown",
                    tier: null,
                    limitReached: false,
                    bankedCredits: null,
                    rateLimitType: null,
                    pools: [],
                    error: message.slice(0, 300),
                } satisfies AccountUsage;
            }
        }),
    );

    const accounts = settled.map((result, index) => {
        if (result.status === "fulfilled") return result.value;
        const connection = targets[index];
        const raw = (connection?.name || connection?.email || "").trim();
        return {
            id: connection?.id ?? "",
            provider: connection?.provider ?? "unknown",
            account: raw || connection?.id?.slice(0, 8) || "unknown",
            authType: connection?.authType ?? null,
            plan: "unknown",
            tier: null,
            limitReached: false,
            bankedCredits: null,
            rateLimitType: null,
            pools: [],
            error: String(result.reason ?? "unknown error").slice(0, 300),
        } satisfies AccountUsage;
    });

    const byProvider = new Map<string, AccountUsage[]>();
    for (const entry of accounts) {
        const list = byProvider.get(entry.provider);
        if (list) list.push(entry);
        else byProvider.set(entry.provider, [entry]);
    }

    return [...byProvider.entries()]
        .map(([provider, list]) => ({
            provider,
            accounts: list.sort((a, b) => a.account.localeCompare(b.account)),
        }))
        .sort((a, b) => a.provider.localeCompare(b.provider));
}

export function formatReset(resetAt: string | null): string {
    if (!resetAt) return "reset n/a";
    const date = new Date(resetAt);
    if (Number.isNaN(date.getTime())) return "reset n/a";
    return `reset ${date.toISOString().slice(11, 16)}Z`;
}

export function availabilityBar(percentage: number, width = 20): string {
    const filled = Math.round((Math.max(0, Math.min(100, percentage)) / 100) * width);
    return "█".repeat(filled) + "░".repeat(Math.max(0, width - filled));
}

/** Compact number: integers stay integers, decimals keep two places. */
export function formatAmount(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export function poolTitle(pool: UsagePool): string {
    const name = pool.displayName ?? pool.label;
    const window = !pool.displayName && pool.windowLabel ? ` (${pool.windowLabel})` : "";
    return `${name}${window}`;
}

export function poolAvailable(pool: UsagePool): string {
    if (pool.unlimited) return "∞ disponible";
    const money = pool.currency === "USD";
    const available = pool.available != null ? formatAmount(pool.available) : "?";
    const total = pool.total != null ? formatAmount(pool.total) : "∞";
    return `${money ? "$" : ""}${available}/${money ? "$" : ""}${total} disponibles`;
}

/** Plain-text fallback used outside the TUI (print/json/rpc modes). */
export function renderTextReport(groups: ProviderGroup[]): string {
    const lines: string[] = [];
    const totals = groups.reduce((sum, group) => sum + group.accounts.length, 0);
    lines.push(`${totals} suscripción(es) en ${groups.length} proveedor(es)`);

    for (const group of groups) {
        lines.push(`${group.provider} (${group.accounts.length})`);
        for (const account of group.accounts) {
            const flags: string[] = [];
            if (account.limitReached) flags.push("LIMIT REACHED");
            if (account.bankedCredits != null) flags.push(`banked ${account.bankedCredits}`);
            const header = account.note
                ? `${account.account} · sin cuota expuesta`
                : `${account.account} · plan ${account.plan}${account.tier ? ` · ${account.tier}` : ""} · ${account.pools.length} uso(s)`;
            lines.push(`  ${header}${flags.length ? ` · ${flags.join(" · ")}` : ""}`);
            if (account.note) lines.push(`    ${account.note.slice(0, 240)}`);
            if (account.error) lines.push(`    error: ${account.error}`);
            for (const pool of account.pools) {
                const models = pool.modelCount > 0 ? ` · ${pool.modelCount} modelo(s)` : "";
                lines.push(
                    `    ${poolTitle(pool)}: ${pool.availablePercentage.toFixed(1)}% libre · ${poolAvailable(pool)} · ${formatReset(pool.resetAt)}${models}`,
                );
            }
        }
    }

    if (totals === 0) lines.push("No active OmniRoute provider connections found.");
    return lines.join("\n");
}
