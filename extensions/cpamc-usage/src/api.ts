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

async function fetchCodexQuota(auth: AuthFileEntry, signal?: AbortSignal): Promise<UsagePool[]> {
    const authIndex = auth.auth_index;
    if (!authIndex) return [];

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

        if (res.status_code !== 200) return [];
        const parsed = parseJsonBody(res.body);
        const rateLimit = parsed?.rate_limit;
        if (!rateLimit) return [];

        const pools: UsagePool[] = [];
        const prim = rateLimit.primary_window;
        if (prim) {
            const usedPct = Number(prim.used_percent ?? 0);
            const remainingPct = Math.max(0, 100 - usedPct);
            const resetAt = prim.reset_at ? new Date(prim.reset_at * 1000).toISOString() : null;
            pools.push({
                label: "5h Window (Primaria)",
                displayName: "Codex / Plus 5h",
                currency: null,
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
                displayName: "Codex / Plus Semanal",
                currency: null,
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

        return pools;
    } catch {
        return [];
    }
}

async function fetchAntigravityQuota(auth: AuthFileEntry, signal?: AbortSignal): Promise<UsagePool[]> {
    const authIndex = auth.auth_index;
    const projectId = auth.project_id || "aicode-consumers";
    if (!authIndex) return [];

    try {
        const res = await executeApiCall(
            authIndex,
            "POST",
            "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
            {
                Authorization: "Bearer $TOKEN$",
                "Content-Type": "application/json",
                "User-Agent": "antigravity/cli/1.0.13 (aidev_client; os_type=darwin; arch=arm64)",
            },
            JSON.stringify({ project: projectId }),
            signal,
        );

        if (res.status_code !== 200) return [];
        const parsed = parseJsonBody(res.body);
        const groups = parsed?.groups;
        if (!Array.isArray(groups)) return [];

        const pools: UsagePool[] = [];
        for (const g of groups) {
            const groupName = g.displayName || "Google Models";
            const buckets = g.buckets;
            if (!Array.isArray(buckets)) continue;

            for (const b of buckets) {
                const fraction = Number(b.remainingFraction ?? 1);
                const remainingPct = Math.max(0, Math.min(100, fraction * 100));
                const usedPct = 100 - remainingPct;
                const window = b.window || "window";
                pools.push({
                    label: `${groupName} (${window})`,
                    displayName: `${groupName} · ${b.displayName || window}`,
                    currency: null,
                    used: usedPct,
                    available: remainingPct,
                    total: 100,
                    unlimited: false,
                    availablePercentage: remainingPct,
                    resetAt: b.resetTime || null,
                    windowLabel: window,
                    modelCount: 0,
                    models: [],
                });
            }
        }

        return pools;
    } catch {
        return [];
    }
}

export async function fetchUsage(signal?: AbortSignal): Promise<ProviderGroup[]> {
    const listRes = await callManagement<ListAuthFilesResponse>("/v0/management/auth-files", signal);
    const files = listRes.files || [];

    const activeFiles = files.filter((f) => !f.disabled);

    const accounts: AccountUsage[] = await Promise.all(
        activeFiles.map(async (f) => {
            const provider = (f.provider || f.type || "unknown").toLowerCase();
            const account = f.email || f.account || f.name || f.id || "account";
            const plan = f.id_token?.plan_type || "standard";

            let pools: UsagePool[] = [];
            let errStr: string | undefined;

            try {
                if (provider === "codex" || provider === "openai") {
                    pools = await fetchCodexQuota(f, signal);
                } else if (provider === "antigravity" || provider === "google" || provider === "gemini") {
                    pools = await fetchAntigravityQuota(f, signal);
                }
            } catch (err: any) {
                errStr = err?.message || String(err);
            }

            return {
                id: f.id || f.name || account,
                provider,
                account,
                authType: f.account_type || null,
                plan,
                tier: null,
                limitReached: f.status === "quota_exhausted",
                bankedCredits: null,
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
