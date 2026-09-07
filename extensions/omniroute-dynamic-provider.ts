import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type OmniRouteModel = {
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

type OmniRouteModelsResponse = {
    data?: OmniRouteModel[];
};

const PROVIDER_ID = "omniroute";
const DEFAULT_BASE_URL = "http://127.0.0.1:20128/v1";
const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 16_384;
const MAX_SAFE_CONTEXT_WINDOW = 272_000;
const MAX_SAFE_OUTPUT_TOKENS = 384_000;

function resolveBaseUrl(): string {
    return (process.env.OMNIROUTE_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function requireApiKey(): string {
    const apiKey = process.env.OMNIROUTE_API_KEY?.trim();
    if (!apiKey) {
        throw new Error(
            "OMNIROUTE_API_KEY is not set in the Pi process environment. Export the OmniRoute endpoint API key before starting pi.",
        );
    }
    return apiKey;
}

function boundedPositiveInteger(value: unknown, fallback: number, max: number): number {
    const numeric = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
    return Math.min(Math.floor(numeric), max);
}

function toPiModel(model: OmniRouteModel) {
    const id = typeof model.id === "string" ? model.id.trim() : "";
    if (!id) return undefined;

    const capabilities = model.capabilities ?? {};
    const contextWindow = boundedPositiveInteger(
        model.context_length ?? model.max_input_tokens,
        DEFAULT_CONTEXT_WINDOW,
        MAX_SAFE_CONTEXT_WINDOW,
    );
    const maxTokens = boundedPositiveInteger(
        model.max_output_tokens,
        DEFAULT_MAX_TOKENS,
        MAX_SAFE_OUTPUT_TOKENS,
    );
    const owner = typeof model.owned_by === "string" && model.owned_by.trim()
        ? model.owned_by.trim()
        : "OmniRoute";
    const supportsImages = Boolean(capabilities.vision || capabilities.image || capabilities.images);

    return {
        id,
        name: `${id} (${owner})`,
        reasoning: Boolean(capabilities.reasoning || capabilities.thinking),
        input: supportsImages ? ["text", "image"] : ["text"],
        contextWindow,
        maxTokens,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    };
}

async function fetchOmniRouteModels(signal?: AbortSignal) {
    const baseUrl = resolveBaseUrl();
    const apiKey = requireApiKey();
    const response = await fetch(`${baseUrl}/models?configuredOnly=true`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal,
    });

    if (!response.ok) {
        const body = await response.text().catch(() => "");
        const detail = body ? `: ${body.slice(0, 300)}` : "";
        throw new Error(`OmniRoute /v1/models failed with HTTP ${response.status}${detail}`);
    }

    const payload = (await response.json()) as OmniRouteModelsResponse;
    return (payload.data ?? [])
        .map(toPiModel)
        .filter((model): model is NonNullable<ReturnType<typeof toPiModel>> => Boolean(model));
}

export default function omnirouteDynamicProvider(pi: ExtensionAPI) {
    pi.registerProvider(PROVIDER_ID, {
        name: "OmniRoute",
        baseUrl: resolveBaseUrl(),
        apiKey: "$OMNIROUTE_API_KEY",
        api: "openai-completions",
        compat: {
            supportsDeveloperRole: false,
            supportsReasoningEffort: false,
            supportsUsageInStreaming: false,
            maxTokensField: "max_tokens",
        },
        async refreshModels({ signal }: { signal?: AbortSignal } = {}) {
            return fetchOmniRouteModels(signal);
        },
    });
}
