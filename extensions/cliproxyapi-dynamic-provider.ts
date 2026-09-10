import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type CLIProxyModel = {
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

type CLIProxyModelsResponse = {
    data?: CLIProxyModel[];
};

const PROVIDER_ID = "cliproxyapi";
const DEFAULT_BASE_URL = "http://127.0.0.1:8317/v1";
const DEFAULT_CONTEXT_WINDOW = 272_000;
const DEFAULT_MAX_TOKENS = 16_384;
const MAX_SAFE_OUTPUT_TOKENS = 384_000;

function resolveSafeContextWindow(modelId: string, upstreamValue: unknown): number {
    const id = modelId.toLowerCase();
    let maxSafe = 370_000;

    if (id.includes("gpt") || id.includes("codex") || id.includes("openai")) {
        maxSafe = 272_000;
    } else if (id.includes("gemini") || id.includes("claude")) {
        maxSafe = 370_000;
    }

    return boundedPositiveInteger(upstreamValue, maxSafe, maxSafe);
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

function boundedPositiveInteger(value: unknown, fallback: number, max: number): number {
    const numeric = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
    return Math.min(Math.floor(numeric), max);
}

function toPiModel(model: CLIProxyModel) {
    const id = typeof model.id === "string" ? model.id.trim() : "";
    if (!id) return undefined;

    const capabilities = model.capabilities ?? {};
    const contextWindow = resolveSafeContextWindow(
        id,
        model.context_length ?? model.max_input_tokens,
    );
    const maxTokens = boundedPositiveInteger(
        model.max_output_tokens,
        DEFAULT_MAX_TOKENS,
        MAX_SAFE_OUTPUT_TOKENS,
    );
    const owner = typeof model.owned_by === "string" && model.owned_by.trim()
        ? model.owned_by.trim()
        : "CLIProxyAPI";
    const supportsImages = Boolean(
        capabilities.vision ||
        capabilities.image ||
        capabilities.images ||
        id.includes("image") ||
        id.includes("vision"),
    );

    const isReasoning = Boolean(
        capabilities.reasoning ||
        capabilities.thinking ||
        id.includes("thinking") ||
        id.includes("high") ||
        id.includes("pro"),
    );

    return {
        id,
        name: `${id} (${owner})`,
        reasoning: isReasoning,
        input: supportsImages ? ["text", "image"] : ["text"],
        contextWindow,
        maxTokens,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    };
}

async function fetchCLIProxyModels(signal?: AbortSignal) {
    const baseUrl = resolveBaseUrl();
    const apiKey = requireApiKey();
    const response = await fetch(`${baseUrl}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal,
    });

    if (!response.ok) {
        const body = await response.text().catch(() => "");
        const detail = body ? `: ${body.slice(0, 300)}` : "";
        throw new Error(`CLIProxyAPI /v1/models failed with HTTP ${response.status}${detail}`);
    }

    const payload = (await response.json()) as CLIProxyModelsResponse;
    return (payload.data ?? [])
        .map(toPiModel)
        .filter((model): model is NonNullable<ReturnType<typeof toPiModel>> => Boolean(model));
}

export default function cliproxyapiDynamicProvider(pi: ExtensionAPI) {
    pi.registerProvider(PROVIDER_ID, {
        name: "CLIProxyAPI",
        baseUrl: resolveBaseUrl(),
        apiKey: "$CLIPROXYAPI_API_KEY",
        api: "openai-completions",
        compat: {
            supportsDeveloperRole: false,
            supportsReasoningEffort: false,
            supportsUsageInStreaming: false,
            maxTokensField: "max_tokens",
        },
        async refreshModels({ signal }: { signal?: AbortSignal } = {}) {
            return fetchCLIProxyModels(signal);
        },
    });
}
