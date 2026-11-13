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
    authFileName?: string;
    provider: string;
    account: string;
    authType: string | null;
    plan: string;
    tier: string | null;
    limitReached: boolean;
    bankedCredits: number | null;
    resetCredits?: number | null;
    resetRenewalDate?: string | null;
    rateLimitType: string | null;
    pools: UsagePool[];
    note?: string;
    error?: string;
};

export type ProviderGroup = {
    provider: string;
    accounts: AccountUsage[];
};

type AuthFileEntry = {
    id?: string;
    auth_index?: string;
    name?: string;
    type?: string;
    provider?: string;
    email?: string;
    account?: string;
    account_type?: string;
    project_id?: string;
    disabled?: boolean;
    unavailable?: boolean;
    status?: string;
    status_message?: string;
    id_token?: {
        plan_type?: string;
        chatgpt_subscription_active_until?: string;
    };
    quota?: {
        signals?: Record<string, string>;
    };
};

type ListAuthFilesResponse = {
    files?: AuthFileEntry[];
};

type ApiCallResponse = {
    status_code?: number;
    header?: Record<string, string[]>;
    body?: string;
};

const DEFAULT_BASE_URL = "http://127.0.0.1:8317";
const REQUEST_TIMEOUT_MS = 8000;

export function resolveBaseUrl(): string {
    const raw = (process.env.CLIPROXYAPI_BASE_URL || DEFAULT_BASE_URL).trim();
    return raw.replace(/\/+$/, "");
}

function resolveManagementKey(): string {
    return (process.env.CLIPROXYAPI_MANAGEMENT_KEY || "").trim();
}

async function callManagement<T>(path: string, signal?: AbortSignal): Promise<T> {
    const baseUrl = resolveBaseUrl();
    const key = resolveManagementKey();
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const response = await fetch(`${baseUrl}${path}`, {
        headers: {
            Authorization: `Bearer ${key}`,
            Accept: "application/json",
        },
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`Management API ${path} failed HTTP ${response.status}${body ? `: ${body.slice(0, 150)}` : ""}`);
    }
    return (await response.json()) as T;
}

async function executeApiCall(
    authIndex: string,
    method: string,
    url: string,
    headers: Record<string, string>,
    data?: string,
    signal?: AbortSignal,
): Promise<ApiCallResponse> {
    const baseUrl = resolveBaseUrl();
    const key = resolveManagementKey();
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const bodyPayload: Record<string, unknown> = {
        auth_index: authIndex,
        method,
        url,
        header: headers,
    };
    if (data != null) {
        bodyPayload.data = data;
    }

    const response = await fetch(`${baseUrl}/v0/management/api-call`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(bodyPayload),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });

    if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`api-call failed with HTTP ${response.status}: ${text.slice(0, 150)}`);
    }

    return (await response.json()) as ApiCallResponse;
}

function parseJsonBody(bodyStr?: string): any {
    if (!bodyStr || typeof bodyStr !== "string") return null;
    try {
        return JSON.parse(bodyStr);
    } catch {
        return null;
    }
}

type CodexQuotaResult = {
    pools: UsagePool[];
    resetCredits: number | null;
    limitReached: boolean;
};

async function fetchCodexQuota(auth: AuthFileEntry, signal?: AbortSignal): Promise<CodexQuotaResult> {
    const authIndex = auth.auth_index;
    if (!authIndex) return { pools: [], resetCredits: null, limitReached: false };

    try {
        const res = await executeApiCall(
            authIndex,
            "GET",
            "https://chatgpt.com/backend-api/wham/usage",
            {
                Authorization: "Bearer $TOKEN$",
                "Content-Type": "application/json",
                "User-Agent": "codex-tui/0.149.1 (Mac OS 26.5.2; arm64) iTerm.app/3.6.11 (codex-tui; 0.149.1)",
            },
            undefined,
            signal,
        );

        if (res.status_code !== 200) return { pools: [], resetCredits: null, limitReached: false };
        const parsed = parseJsonBody(res.body);
        const rateLimit = parsed?.rate_limit;
        if (!rateLimit) return { pools: [], resetCredits: null, limitReached: false };

        const resetCredits = typeof parsed?.rate_limit_reset_credits?.available_count === "number"
            ? parsed.rate_limit_reset_credits.available_count
            : null;
        const limitReached = Boolean(rateLimit.limit_reached);

        const pools: UsagePool[] = [];
        const prim = rateLimit.primary_window;
        if (prim) {
            const usedPct = Number(prim.used_percent ?? 0);
            const remainingPct = Math.max(0, 100 - usedPct);
            const resetAt = prim.reset_at ? new Date(prim.reset_at * 1000).toISOString() : null;
            pools.push({
                label: "5h Window (Primaria)",
                displayName: "OpenAI · 5h Window",
                used: usedPct,
                available: remainingPct,
                total: 100,
                unlimited: false,
                availablePercentage: remainingPct,
                resetAt,
                windowLabel: "5h",
                modelCount: 0,
                models: [],
            });
        }

        const sec = rateLimit.secondary_window;
        if (sec) {
            const usedPct = Number(sec.used_percent ?? 0);
            const remainingPct = Math.max(0, 100 - usedPct);
            const resetAt = sec.reset_at ? new Date(sec.reset_at * 1000).toISOString() : null;
            pools.push({
                label: "Semanal (Secundaria)",
                displayName: "OpenAI · Semanal",
                used: usedPct,
                available: remainingPct,
                total: 100,
                unlimited: false,
                availablePercentage: remainingPct,
                resetAt,
                windowLabel: "7d",
                modelCount: 0,
                models: [],
            });
        }

        return { pools, resetCredits, limitReached };
    } catch {
        return { pools: [], resetCredits: null, limitReached: false };
    }
}

function quotaWindowRank(pool: UsagePool): number {
    const raw = `${pool.windowLabel ?? ""} ${pool.label} ${pool.displayName ?? ""}`.toLowerCase();
    if (/\b5\s*(h|hs|hr|hour|hours|hora|horas)\b/.test(raw) || raw.includes("5h")) return 10;
    if (/\b(weekly|week|semana|semanal|7\s*d|7\s*day|7\s*día|7\s*dias|7\s*días)\b/.test(raw)) return 20;
    if (/\b(30\s*d|month|monthly|mes|mensual)\b/.test(raw)) return 30;
    return 100;
}

function quotaModelRank(pool: UsagePool): number {
    const raw = `${pool.label} ${pool.displayName ?? ""}`.toLowerCase();
    if (raw.includes("gemini")) return 10;
    if (raw.includes("claude") || raw.includes("gpt")) return 20;
    return 100;
}

function formatQuotaWindowLabel(window: string): string {
    const raw = window.trim().toLowerCase();
    if (/\b5\s*(h|hs|hr|hour|hours|hora|horas)\b/.test(raw) || raw.includes("5h")) return "5 hs";
    if (/\b(weekly|week|semana|semanal|7\s*d|7\s*day|7\s*día|7\s*dias|7\s*días)\b/.test(raw)) return "Semanal";
    if (/\b(30\s*d|month|monthly|mes|mensual)\b/.test(raw)) return "Mensual";
    return window;
}

type AntigravityBucket = {
    modelId?: string;
    remainingFraction?: number;
    resetTime?: string;
};

function buildAntigravityModelPools(
    buckets: AntigravityBucket[],
    baseName: string,
    matcher: (modelId: string) => boolean,
): UsagePool[] {
    const matched = buckets.filter((b) => typeof b.modelId === "string" && matcher(b.modelId));
    if (matched.length === 0) return [];

    const grouped = new Map<string, { remainingPct: number; resetAt: string | null; models: string[] }>();
    for (const b of matched) {
        const fraction = Number(b.remainingFraction ?? 1);
        const remainingPct = Math.max(0, Math.min(100, fraction * 100));
        const resetAt = b.resetTime || null;
        const key = `${remainingPct.toFixed(4)}|${resetAt ?? ""}`;
        const existing = grouped.get(key);
        if (existing) {
            existing.models.push(b.modelId!);
        } else {
            grouped.set(key, { remainingPct, resetAt, models: [b.modelId!] });
        }
    }

    const windowLabel = formatQuotaWindowLabel("5h");
    const entries = [...grouped.values()];
    return entries.map((entry) => {
        const models = [...entry.models].sort();
        const suffix = entries.length > 1
            ? ` (${models.slice(0, 2).join(", ")}${models.length > 2 ? ", …" : ""})`
            : "";
        return {
            label: `${baseName}${suffix} (${windowLabel})`,
            displayName: `${baseName}${suffix} · ${windowLabel}`,
            used: 100 - entry.remainingPct,
            available: entry.remainingPct,
            total: 100,
            unlimited: false,
            availablePercentage: entry.remainingPct,
            resetAt: entry.resetAt,
            windowLabel,
            modelCount: models.length,
            models,
        };
    });
}

async function fetchAntigravityQuota(auth: AuthFileEntry, signal?: AbortSignal): Promise<UsagePool[]> {
    const authIndex = auth.auth_index;
    const projectId = auth.project_id || "aicode-consumers";
    if (!authIndex) return [];

    const headers = {
        Authorization: "Bearer $TOKEN$",
        "Content-Type": "application/json",
        "User-Agent": "antigravity/cli/1.0.13 (aidev_client; os_type=darwin; arch=arm64)",
    };
    const payload = JSON.stringify({ project: projectId });

    const [summaryRes, quotaRes] = await Promise.all([
        executeApiCall(
            authIndex,
            "POST",
            "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
            headers,
            payload,
            signal,
        ).catch(() => null),
        executeApiCall(
            authIndex,
            "POST",
            "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota",
            headers,
            payload,
            signal,
        ).catch(() => null),
    ]);

    const pools: UsagePool[] = [];

    if (summaryRes && summaryRes.status_code === 200) {
        const parsed = parseJsonBody(summaryRes.body);
        const groups = parsed?.groups;
        if (Array.isArray(groups)) {
            for (const g of groups) {
                const groupName = g.displayName || "Google Models";
                const buckets = g.buckets;
                if (!Array.isArray(buckets)) continue;

                for (const b of buckets) {
                    const fraction = Number(b.remainingFraction ?? 1);
                    const remainingPct = Math.max(0, Math.min(100, fraction * 100));
                    const usedPct = 100 - remainingPct;
                    const window = b.window || "window";
                    const windowLabel = formatQuotaWindowLabel(window);
                    pools.push({
                        label: `${groupName} (${windowLabel})`,
                        displayName: `${groupName} · ${windowLabel}`,
                        used: usedPct,
                        available: remainingPct,
                        total: 100,
                        unlimited: false,
                        availablePercentage: remainingPct,
                        resetAt: b.resetTime || null,
                        windowLabel,
                        modelCount: 0,
                        models: [],
                    });
                }
            }
        }
    }

    if (quotaRes && quotaRes.status_code === 200) {
        const parsed = parseJsonBody(quotaRes.body);
        const buckets: AntigravityBucket[] = Array.isArray(parsed?.buckets) ? parsed.buckets : [];

        const hasGeminiPool = pools.some((p) => `${p.label} ${p.displayName ?? ""}`.toLowerCase().includes("gemini"));
        if (!hasGeminiPool) {
            pools.push(
                ...buildAntigravityModelPools(buckets, "Gemini Models", (id) => id.toLowerCase().includes("gemini")),
            );
        }

        const hasThirdPartyPool = pools.some((p) => {
            const text = `${p.label} ${p.displayName ?? ""}`.toLowerCase();
            return text.includes("claude") || text.includes("gpt");
        });
        if (!hasThirdPartyPool) {
            pools.push(
                ...buildAntigravityModelPools(buckets, "Claude and GPT models", (id) => {
                    const lower = id.toLowerCase();
                    return lower.includes("claude") || lower.includes("gpt");
                }),
            );
        }
    }

    return pools.sort((a, b) => {
        const modelRankDiff = quotaModelRank(a) - quotaModelRank(b);
        if (modelRankDiff !== 0) return modelRankDiff;
        const windowRankDiff = quotaWindowRank(a) - quotaWindowRank(b);
        if (windowRankDiff !== 0) return windowRankDiff;
        return poolTitle(a).localeCompare(poolTitle(b));
    });
}

export async function fetchUsage(signal?: AbortSignal): Promise<ProviderGroup[]> {
    const listRes = await callManagement<ListAuthFilesResponse>("/v0/management/auth-files", signal);
    const files = listRes.files || [];

    const activeFiles = files.filter((f) => !f.disabled);

    const accounts: AccountUsage[] = await Promise.all(
        activeFiles.map(async (f) => {
            let provider = (f.provider || f.type || "unknown").toLowerCase();
            if (provider === "codex") {
                provider = "openai";
            }
            const account = f.email || f.account || f.name || f.id || "account";
            const plan = f.id_token?.plan_type || "standard";

            let pools: UsagePool[] = [];
            let errStr: string | undefined;
            let resetCredits: number | null = null;
            let limitReached = f.status === "quota_exhausted";
            let resetRenewalDate: string | null = null;

            try {
                if (provider === "openai" || (f.provider || "").toLowerCase() === "codex") {
                    const res = await fetchCodexQuota(f, signal);
                    pools = res.pools;
                    resetCredits = res.resetCredits;
                    if (res.limitReached) limitReached = true;
                    if (f.id_token?.chatgpt_subscription_active_until) {
                        resetRenewalDate = f.id_token.chatgpt_subscription_active_until;
                    }
                } else if (provider === "antigravity" || provider === "google" || provider === "gemini") {
                    pools = await fetchAntigravityQuota(f, signal);
                }
            } catch (err: any) {
                errStr = err?.message || String(err);
            }

            return {
                id: f.id || f.name || account,
                authFileName: f.name,
                provider,
                account,
                authType: f.account_type || null,
                plan,
                tier: null,
                limitReached,
                bankedCredits: null,
                resetCredits,
                resetRenewalDate,
                rateLimitType: null,
                pools,
                error: errStr,
                note: pools.length === 0 ? "Sin cuota activa o respuesta pendiente" : undefined,
            };
        }),
    );

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

export function formatRenewalDate(dateStr?: string | null): string | null {
    if (!dateStr) return null;
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return null;
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = date.getFullYear();
    const diffDays = Math.ceil((date.getTime() - Date.now()) / 86400000);
    const diffStr = diffDays > 0 ? ` (en ${diffDays}d)` : diffDays === 0 ? " (hoy)" : " (vencido)";
    return `${day}/${month}/${year}${diffStr}`;
}

export function formatReset(resetAt: string | null): string {
    if (!resetAt) return "reset n/a";
    const date = new Date(resetAt);
    const time = date.getTime();
    if (Number.isNaN(time)) return "reset n/a";

    const diff = time - Date.now();
    if (diff <= 0) return "reset inminente";

    const mins = Math.max(1, Math.ceil(diff / 60000));
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    const timeStr = `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}Z`;

    if (days >= 1) {
        const remHours = Math.floor((diff % 86400000) / 3600000);
        const day = String(date.getDate()).padStart(2, "0");
        const month = String(date.getMonth() + 1).padStart(2, "0");
        return `reset en ${days}d ${remHours}h (${day}/${month})`;
    }
    if (hours >= 1) {
        const remMins = Math.floor((diff % 3600000) / 60000);
        return `reset en ${hours}h ${String(remMins).padStart(2, "0")}m (${timeStr})`;
    }
    return `reset en ${mins}m (${timeStr})`;
}

export function availabilityBar(percentage: number, width = 20): string {
    const filled = Math.round((Math.max(0, Math.min(100, percentage)) / 100) * width);
    return "█".repeat(filled) + "░".repeat(Math.max(0, width - filled));
}

export function formatAmount(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function poolTitle(pool: UsagePool): string {
    const name = pool.displayName ?? pool.label;
    return name;
}

export function poolAvailable(pool: UsagePool): string {
    if (pool.unlimited) return "∞ libre";
    return `${formatAmount(pool.availablePercentage)}% libre`;
}

export function renderTextReport(groups: ProviderGroup[]): string {
    const lines: string[] = [];
    const totals = groups.reduce((sum, group) => sum + group.accounts.length, 0);
    lines.push(`${totals} suscripción(es) en ${groups.length} proveedor(es) [CLIProxyAPI]`);

    for (const group of groups) {
        lines.push(`${group.provider.toUpperCase()} (${group.accounts.length})`);
        for (const account of group.accounts) {
            const flags: string[] = [];
            if (account.limitReached) flags.push("LIMIT REACHED");
            if (account.resetCredits != null) {
                const renewText = formatRenewalDate(account.resetRenewalDate);
                const renew = renewText ? ` (vencen: ${renewText})` : "";
                flags.push(`${account.resetCredits} reset(s)${renew}`);
            }
            if (account.bankedCredits != null) flags.push(`banked ${account.bankedCredits}`);
            const header = `${account.account} · plan ${account.plan} · ${account.pools.length} cuota(s)`;
            lines.push(`  ${header}${flags.length ? ` · ${flags.join(" · ")}` : ""}`);
            if (account.error) lines.push(`    error: ${account.error}`);
            for (const pool of account.pools) {
                lines.push(
                    `    ${poolTitle(pool)}: ${pool.availablePercentage.toFixed(1)}% libre · [${availabilityBar(pool.availablePercentage, 15)}] · ${formatReset(pool.resetAt)}`,
                );
            }
        }
    }

    if (totals === 0) lines.push("No se encontraron cuentas activas en CLIProxyAPI.");
    return lines.join("\n");
}
