import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type CPAModel = {
    slug?: string;
    id?: string;
    display_name?: string;
    owned_by?: string;
    context_window?: number;
    max_tokens?: number;
    input_modalities?: string[];
    default_reasoning_level?: string | null;
    supported_reasoning_levels?: Array<{ effort: string; description?: string }>;
};

type FallbackOpenAIModel = {
    id?: unknown;
    owned_by?: unknown;
    context_length?: unknown;
    max_input_tokens?: unknown;
    max_output_tokens?: unknown;
    capabilities?: {
        reasoning?: unknown;
        thinking?: unknown;
        vision?: unknown;
        image?: unknown;
        images?: unknown;
    };
};

const PROVIDER_ID = "cliproxyapi";
const DEFAULT_BASE_URL = "http://127.0.0.1:8317/v1";
const DEFAULT_MAX_TOKENS = 16_384;
const MAX_SAFE_OUTPUT_TOKENS = 65_536;

function buildStrictThinkingLevelMap(levels: string[]): Record<string, string | null> {
    if (!levels || levels.length === 0) {
        return {
            off: null,
            minimal: null,
            low: "low",
            medium: "medium",
            high: "high",
            xhigh: null,
            max: null,
        };
    }

    const set = new Set(levels.map((lvl) => lvl.toLowerCase()));

    return {
        off: null,
        minimal: set.has("minimal") ? "minimal" : null,
        low: set.has("low") ? "low" : null,
        medium: set.has("medium") ? "medium" : null,
        high: set.has("high") ? "high" : null,
        xhigh: set.has("xhigh") ? "xhigh" : null,
        max: set.has("max") ? "max" : null,
    };
}

function resolveRecommendedContextWindow(modelId: string, reportedContext?: number): number {
    const id = modelId.toLowerCase();
    let recommendedCap = 128_000;

    if (id.includes("gpt") || id.includes("codex") || id.includes("openai")) {
        recommendedCap = 272_000;
    } else if (id.includes("claude")) {
        recommendedCap = 200_000;
    } else if (id.includes("gemini")) {
        recommendedCap = 370_000;
    }

    if (typeof reportedContext === "number" && Number.isFinite(reportedContext) && reportedContext > 0) {
        return Math.min(Math.floor(reportedContext), recommendedCap);
    }
    return recommendedCap;
}

function resolveBaseUrl(): string {
    return (process.env.CLIPROXYAPI_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function requireApiKey(): string {
    const apiKey = (process.env.CLIPROXYAPI_API_KEY || "").trim();
    if (!apiKey) {
        throw new Error(
            "CLIPROXYAPI_API_KEY is not set in the Pi process environment. Export the CLIProxyAPI endpoint API key before starting pi.",
        );
    }
    return apiKey;
}



function toPiModelFromCPA(model: CPAModel) {
    const id = typeof model.slug === "string" && model.slug.trim()
        ? model.slug.trim()
        : (typeof model.id === "string" ? model.id.trim() : "");
    if (!id) return undefined;

    const lowerId = id.toLowerCase();
    const contextWindow = resolveRecommendedContextWindow(id, model.context_window);
    const maxTokens = Math.min(
        typeof model.max_tokens === "number" && Number.isFinite(model.max_tokens) && model.max_tokens > 0
            ? Math.floor(model.max_tokens)
            : DEFAULT_MAX_TOKENS,
        MAX_SAFE_OUTPUT_TOKENS,
    );

    const levels = (model.supported_reasoning_levels || [])
        .map((lvl) => (typeof lvl?.effort === "string" ? lvl.effort.trim().toLowerCase() : ""))
        .filter((effort): effort is string => Boolean(effort));

    const isReasoning = levels.length > 0 ||
        Boolean(model.default_reasoning_level) ||
        lowerId.includes("thinking") ||
        (model.display_name?.toLowerCase().includes("thinking") ?? false);

    const thinkingLevelMap = isReasoning
        ? buildStrictThinkingLevelMap(levels)
        : undefined;

    const supportsImages = (model.input_modalities?.includes("image") ?? false) ||
        lowerId.includes("vision") ||
        lowerId.includes("image") ||
        lowerId.includes("gemini") ||
        lowerId.includes("claude") ||
        lowerId.includes("gpt");

    const owner = typeof model.owned_by === "string" && model.owned_by.trim() ? model.owned_by.trim() : "CLIProxyAPI";
    const displayName = typeof model.display_name === "string" && model.display_name.trim() ? model.display_name.trim() : id;

    return {
        id,
        name: displayName !== id ? `${displayName} (${id})` : `${id} (${owner})`,
        reasoning: isReasoning,
        input: supportsImages ? (["text", "image"] as ("text" | "image")[]) : (["text"] as ("text" | "image")[]),
        contextWindow,
        maxTokens,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
        reasoningEfforts: levels,
    };
}

function toPiModelFromOpenAI(model: FallbackOpenAIModel) {
    const id = typeof model.id === "string" ? model.id.trim() : "";
    if (!id) return undefined;

    const capabilities = model.capabilities ?? {};
    const lowerId = id.toLowerCase();
    const reportedContext = typeof model.context_length === "number"
        ? model.context_length
        : (typeof model.max_input_tokens === "number" ? model.max_input_tokens : undefined);
    const contextWindow = resolveRecommendedContextWindow(id, reportedContext);
    const maxTokens = Math.min(
        typeof model.max_output_tokens === "number" && model.max_output_tokens > 0
            ? Math.floor(model.max_output_tokens)
            : DEFAULT_MAX_TOKENS,
        MAX_SAFE_OUTPUT_TOKENS,
    );
    const owner = typeof model.owned_by === "string" && model.owned_by.trim() ? model.owned_by.trim() : "CLIProxyAPI";
    const supportsImages = Boolean(
        capabilities.vision ||
        capabilities.image ||
        capabilities.images ||
        lowerId.includes("image") ||
        lowerId.includes("vision") ||
        lowerId.includes("gemini") ||
        lowerId.includes("claude") ||
        lowerId.includes("gpt"),
    );

    const isReasoning = Boolean(
        capabilities.reasoning ||
        capabilities.thinking ||
        lowerId.includes("thinking") ||
        lowerId.includes("high") ||
        lowerId.includes("pro") ||
        lowerId.includes("sol") ||
        lowerId.includes("luna") ||
        lowerId.includes("terra") ||
        lowerId.includes("o1") ||
        lowerId.includes("o3") ||
        lowerId.includes("gpt-5"),
    );

    const openAiEfforts = isReasoning ? ["low", "medium", "high"] : [];
    const thinkingLevelMap = isReasoning ? buildStrictThinkingLevelMap(openAiEfforts) : undefined;

    return {
        id,
        name: `${id} (${owner})`,
        reasoning: isReasoning,
        input: supportsImages ? (["text", "image"] as ("text" | "image")[]) : (["text"] as ("text" | "image")[]),
        contextWindow,
        maxTokens,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
        reasoningEfforts: openAiEfforts,
    };
}

async function fetchCLIProxyModels(signal?: AbortSignal) {
    const baseUrl = resolveBaseUrl();
    const apiKey = requireApiKey();

    // 1. Consultar endpoint enriquecido de CLIProxyAPI (cpamc) que incluye effort, context_window, tokens y modalidades
    try {
        const response = await fetch(`${baseUrl}/models?client_version=1`, {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal,
        });

        if (response.ok) {
            const payload = (await response.json()) as { models?: CPAModel[] };
            if (Array.isArray(payload.models) && payload.models.length > 0) {
                return payload.models
                    .map(toPiModelFromCPA)
                    .filter((model): model is NonNullable<ReturnType<typeof toPiModelFromCPA>> => Boolean(model));
            }
        }
    } catch {
        // Fallback al endpoint estándar si client_version=1 falla
    }

    // 2. Fallback estándar a /v1/models
    const response = await fetch(`${baseUrl}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal,
    });

    if (!response.ok) {
        const body = await response.text().catch(() => "");
        const detail = body ? `: ${body.slice(0, 300)}` : "";
        throw new Error(`CLIProxyAPI /v1/models failed with HTTP ${response.status}${detail}`);
    }

    const payload = (await response.json()) as { data?: FallbackOpenAIModel[] };
    return (payload.data ?? [])
        .map(toPiModelFromOpenAI)
        .filter((model): model is NonNullable<ReturnType<typeof toPiModelFromOpenAI>> => Boolean(model));
}

export default function cliproxyapiDynamicProvider(pi: ExtensionAPI) {
    pi.registerProvider(PROVIDER_ID, {
        name: "CLIProxyAPI",
        baseUrl: resolveBaseUrl(),
        apiKey: "$CLIPROXYAPI_API_KEY",
        api: "openai-completions",
        compat: {
            supportsDeveloperRole: false,
            supportsReasoningEffort: true,
            supportsUsageInStreaming: true,
            maxTokensField: "max_tokens",
        },
        async refreshModels({ signal }: { signal?: AbortSignal } = {}) {
            return fetchCLIProxyModels(signal);
        },
    });
}
