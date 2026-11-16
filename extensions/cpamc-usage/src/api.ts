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
    /** Monetary providers render an amount instead of a percentage. */
    amountText?: string;
    /** Extra context line for monetary providers (burn rate, granted credit, bucket count). */
    noteText?: string;
    /** Only draw a 0-100% bar when the provider exposes a real limit. */
    showBar?: boolean;
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

type OpenAiCompatEntry = {
    name?: string;
    disabled?: boolean;
    prefix?: string;
    "base-url"?: string;
    "api-key-entries"?: Array<{ "api-key"?: string; "auth-index"?: string }>;
};

type OpenAiCompatResponse = {
    "openai-compatibility"?: OpenAiCompatEntry[];
};

/** OpenAI-compatible providers billed by balance instead of quota windows. */
const MONETARY_PROVIDERS = new Set(["deepseek", "deeprelay"]);

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
        // Matches the upstream management UI: the "hub" client is the identity
        // that receives real Gemini buckets. The legacy `antigravity/cli` UA
        // gets Gemini buckets pinned to remainingFraction 1 on every host.
        "User-Agent": "antigravity/hub/2.23.0 darwin/arm64",
    };
    const payload = JSON.stringify({ project: projectId });

    // Gemini quotas only report real values on the daily host (same order the
    // upstream control panel tries). Production is the last-resort fallback.
    const hosts = [
        "daily-cloudcode-pa.googleapis.com",
        "daily-cloudcode-pa.sandbox.googleapis.com",
        "cloudcode-pa.googleapis.com",
    ];

    const call = (endpoint: string, host: string) =>
        executeApiCall(authIndex, "POST", `https://${host}/v1internal:${endpoint}`, headers, payload, signal);

    let summaryRes: ApiCallResponse | null = null;
    let quotaRes: ApiCallResponse | null = null;
    for (const host of hosts) {
        const [summary, quota] = await Promise.all([
            call("retrieveUserQuotaSummary", host).catch(() => null),
            call("retrieveUserQuota", host).catch(() => null),
        ]);
        if (summary?.status_code === 200) summaryRes = summary;
        if (quota?.status_code === 200) quotaRes = quota;
        if (summaryRes || quotaRes) break;
    }

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

function formatMoney(currency: string, value: number): string {
    const code = currency.trim().toUpperCase();
    const symbol = code === "USD" ? "US$" : code === "CNY" ? "CN¥" : code;
    return `${symbol} ${value.toFixed(2)}`;
}

/** Money is rendered as text; a bar needs a real limit to be meaningful. */
function moneyPool(label: string, displayName: string, amountText: string, noteText?: string): UsagePool {
    return {
        label,
        displayName,
        used: 0,
        available: null,
        total: null,
        unlimited: false,
        availablePercentage: 0,
        resetAt: null,
        windowLabel: null,
        modelCount: 0,
        models: [],
        amountText,
        noteText,
        showBar: false,
    };
}

async function readJson(
    authIndex: string,
    url: string,
    signal?: AbortSignal,
): Promise<{ status: number; json: any }> {
    const res = await executeApiCall(
        authIndex,
        "GET",
        url,
        { Authorization: "Bearer $TOKEN$", Accept: "application/json" },
        undefined,
        signal,
    );
    return { status: res.status_code ?? 0, json: parseJsonBody(res.body) };
}

/** 2_850_000 -> "2.85M"; keeps token meters readable in narrow panels. */
function formatTokens(value: number): string {
    if (!Number.isFinite(value)) return "0";
    if (Math.abs(value) >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
    if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
    if (Math.abs(value) >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
    return String(Math.round(value));
}

/** A real quota meter: percentage is meaningful, reset comes from the billing period. */
function quotaPool(
    label: string,
    displayName: string,
    used: number,
    total: number,
    resetAt: string | null,
    windowLabel: string,
    noteText?: string,
): UsagePool {
    const clampedUsed = Math.max(0, used);
    const remaining = Math.max(0, total - clampedUsed);
    const availablePercentage = total > 0 ? Math.max(0, Math.min(100, (remaining / total) * 100)) : 0;
    return {
        label,
        displayName,
        used: clampedUsed,
        available: remaining,
        total,
        unlimited: false,
        availablePercentage,
        resetAt,
        windowLabel,
        modelCount: 0,
        models: [],
        amountText: `${formatTokens(clampedUsed)} / ${formatTokens(total)}`,
        noteText,
        showBar: true,
    };
}

async function fetchDeepSeekPools(authIndex: string, baseUrl: string, signal?: AbortSignal): Promise<UsagePool[]> {
    const { status, json } = await readJson(authIndex, `${baseUrl}/user/balance`, signal);
    if (status !== 200 || !Array.isArray(json?.balance_infos)) return [];

    const infos: Array<Record<string, string>> = json.balance_infos;
    const primary = infos.find((i) => String(i.currency).toUpperCase() === "USD") ?? infos[0];
    if (!primary) return [];

    const currency = String(primary.currency ?? "USD");
    const total = Number(primary.total_balance ?? 0);
    const toppedUp = Number(primary.topped_up_balance ?? 0);
    const granted = Number(primary.granted_balance ?? 0);

    const notes = [`cargado ${formatMoney(currency, toppedUp)}`];
    if (granted > 0) notes.push(`regalo ${formatMoney(currency, granted)}`);
    if (json.is_available === false) notes.push("sin saldo suficiente");

    return [
        moneyPool(
            `Saldo ${currency.toUpperCase()}`,
            `DeepSeek · Saldo ${currency.toUpperCase()}`,
            formatMoney(currency, total),
            notes.join(" · "),
        ),
    ];
}

async function fetchDeepRelayPools(
    authIndex: string,
    baseUrl: string,
    signal?: AbortSignal,
): Promise<{ pools: UsagePool[]; plan: string | null }> {
    const [subscriptionRes, usageRes, limitRes] = await Promise.all([
        readJson(authIndex, `${baseUrl}/billing/subscription`, signal).catch(() => null),
        readJson(authIndex, `${baseUrl}/usage?bucket=day`, signal).catch(() => null),
        readJson(authIndex, `${baseUrl}/billing/spending-limit`, signal).catch(() => null),
    ]);

    const pools: UsagePool[] = [];
    const subscription = subscriptionRes?.status === 200 ? subscriptionRes.json : null;

    // Subscription plan: five server-enforced meters, all with a real cap.
    if (subscription?.subscribed && subscription.plan && subscription.quota) {
        const quota = subscription.quota;
        const usage = subscription.usage ?? {};
        const periodEnd = subscription.current_period_end ?? usage.period_end ?? null;
        const price = subscription.plan.price;
        const priceText = price
            ? `${formatMoney(price.currency ?? "USD", Number(price.amount_cents ?? 0) / 100)}/${price.interval === "month" ? "mes" : price.interval}`
            : "plan activo";
        const statusNote = [
            priceText,
            subscription.cancel_at_period_end ? "cancela al vencer" : null,
            subscription.status && subscription.status !== "active" ? `estado ${subscription.status}` : null,
        ]
            .filter(Boolean)
            .join(" · ");

        pools.push(
            moneyPool(
                "Plan",
                `DeepRelay · Suscripción`,
                subscription.plan.name ?? "activo",
                statusNote || undefined,
            ),
        );

        pools.push(
            quotaPool(
                "Input mensual",
                "DeepRelay · Input mensual",
                Number(usage.weighted_input_tokens ?? 0),
                Number(quota.input_tokens_monthly ?? 0),
                periodEnd,
                "Mensual",
            ),
            quotaPool(
                "Output mensual",
                "DeepRelay · Output mensual",
                Number(usage.weighted_output_tokens ?? 0),
                Number(quota.output_tokens_monthly ?? 0),
                periodEnd,
                "Mensual",
            ),
            quotaPool(
                "Input semanal",
                "DeepRelay · Input semanal",
                Number(usage.weekly_weighted_input_tokens ?? 0),
                Number(quota.weekly_input_tokens ?? 0),
                null,
                "Semanal",
                "ventana móvil 7d",
            ),
            quotaPool(
                "Output semanal",
                "DeepRelay · Output semanal",
                Number(usage.weekly_weighted_output_tokens ?? 0),
                Number(quota.weekly_output_tokens ?? 0),
                null,
                "Semanal",
                "ventana móvil 7d",
            ),
        );

        if (Number(quota.searches_monthly ?? 0) > 0) {
            pools.push(
                quotaPool(
                    "Búsquedas",
                    "DeepRelay · Búsquedas web",
                    Number(usage.searches ?? 0),
                    Number(quota.searches_monthly ?? 0),
                    periodEnd,
                    "Mensual",
                ),
            );
        }
    }

    // Pay-as-you-go balance, used when the plan allowance or the backstop runs out.
    const balancePayment = subscription?.balance_payment;
    const paygCents = Number(balancePayment?.spendable_cents ?? balancePayment?.balance_cents ?? NaN);
    if (Number.isFinite(paygCents)) {
        const notes = [];
        if (Number(balancePayment?.free_credit_cents ?? 0) > 0) {
            notes.push(`gratis ${formatMoney("USD", Number(balancePayment.free_credit_cents) / 100)}`);
        }
        if (Number(balancePayment?.pending_deposit_cents ?? 0) > 0) {
            notes.push(`pendiente ${formatMoney("USD", Number(balancePayment.pending_deposit_cents) / 100)}`);
        }
        pools.push(moneyPool("Saldo PAYG", "DeepRelay · Saldo PAYG", formatMoney("USD", paygCents / 100), notes.join(" · ") || undefined));
    }

    const costCents = Number(subscription?.usage?.cost_micro_cents ?? NaN) / 10000;
    if (Number.isFinite(costCents)) {
        pools.push(
            moneyPool(
                "Costo del período",
                "DeepRelay · Costo del período",
                formatMoney("USD", costCents),
                "consumo del plan, no del saldo",
            ),
        );
    }

    if (usageRes?.status === 200 && Array.isArray(usageRes.json?.data)) {
        const buckets: Array<{ cost_cents?: number }> = usageRes.json.data;
        const bucketCents = buckets.reduce((sum, b) => sum + Number(b.cost_cents ?? 0), 0);
        const rangeLabel = buckets.length === 0
            ? "sin consumo (30 días)"
            : buckets.length === 1
              ? "1 día"
              : `${buckets.length} días`;
        pools.push(
            moneyPool("Consumo PAYG", "DeepRelay · Consumo PAYG", formatMoney("USD", bucketCents / 100), rangeLabel),
        );
    }

    if (limitRes?.status === 200 && limitRes.json) {
        const limitCents = limitRes.json.monthly_limit_cents ?? (limitRes.json.monthly_limit_dollars != null
            ? Number(limitRes.json.monthly_limit_dollars) * 100
            : null);
        if (typeof limitCents === "number" && limitCents > 0) {
            const spentCents = Number(limitRes.json.current_month_cents ?? 0);
            const pool = quotaPool(
                "Límite mensual",
                "DeepRelay · Límite mensual PAYG",
                spentCents,
                limitCents,
                null,
                "Mensual",
                "solo PAYG",
            );
            pool.amountText = `${formatMoney("USD", (limitCents - spentCents) / 100)} de ${formatMoney("USD", limitCents / 100)}`;
            pools.push(pool);
        }
    }

    return { pools, plan: subscription?.plan?.name ?? null };
}

async function fetchMonetaryAccounts(signal?: AbortSignal): Promise<AccountUsage[]> {
    const compat = await callManagement<OpenAiCompatResponse>("/v0/management/openai-compatibility", signal)
        .catch(() => null);
    const entries = (compat?.["openai-compatibility"] ?? []).filter((entry) => {
        const name = (entry.name ?? "").toLowerCase();
        return !entry.disabled && MONETARY_PROVIDERS.has(name);
    });

    return Promise.all(
        entries.map(async (entry): Promise<AccountUsage> => {
            const name = (entry.name ?? "unknown").toLowerCase();
            const baseUrl = (entry["base-url"] ?? "").replace(/\/+$/, "");
            const authIndex = entry["api-key-entries"]?.[0]?.["auth-index"];
            const account = entry.prefix && entry.prefix !== name ? `${name} (${entry.prefix})` : name;

            const base: AccountUsage = {
                id: `${name}-${entry.prefix ?? "default"}`,
                provider: name,
                account,
                authType: "api-key",
                plan: "pay-as-you-go",
                tier: null,
                limitReached: false,
                bankedCredits: null,
                rateLimitType: null,
                pools: [],
            };

            if (!authIndex) {
                return { ...base, note: "sin auth-index en openai-compatibility" };
            }

            try {
                if (name === "deeprelay") {
                    const relay = await fetchDeepRelayPools(authIndex, baseUrl, signal);
                    if (relay.pools.length === 0) {
                        return { ...base, note: "saldo y suscripción no disponibles (respuesta vacía o error upstream)" };
                    }
                    return { ...base, plan: relay.plan ?? base.plan, pools: relay.pools };
                }
                const pools = await fetchDeepSeekPools(authIndex, baseUrl, signal);
                if (pools.length === 0) {
                    return { ...base, note: "saldo no disponible (respuesta vacía o error upstream)" };
                }
                return { ...base, pools };
            } catch (err: any) {
                return { ...base, note: `saldo no disponible: ${err?.message ?? String(err)}` };
            }
        }),
    );
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

    accounts.push(...(await fetchMonetaryAccounts(signal).catch(() => [])));

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
                if (pool.amountText) {
                    const note = pool.noteText ? ` · ${pool.noteText}` : "";
                    const bar = pool.showBar
                        ? ` [${availabilityBar(pool.availablePercentage, 15)}] ${pool.availablePercentage.toFixed(1)}%`
                        : "";
                    lines.push(`    ${poolTitle(pool)}: ${pool.amountText}${bar}${note}`);
                    continue;
                }
                lines.push(
                    `    ${poolTitle(pool)}: ${pool.availablePercentage.toFixed(1)}% libre · [${availabilityBar(pool.availablePercentage, 15)}] · ${formatReset(pool.resetAt)}`,
                );
            }
        }
    }

    if (totals === 0) lines.push("No se encontraron cuentas activas en CLIProxyAPI.");
    return lines.join("\n");
}
