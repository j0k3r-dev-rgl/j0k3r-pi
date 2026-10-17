import { describe, it, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
    renderTextReport,
    fetchUsage,
    type AccountUsage,
    type ProviderGroup,
    type BillingSummary,
} from "../src/api.ts";

describe("MWAPI USD credits", () => {
    const config = {
        "openai-compatibility": [{
            name: "mwapi",
            "base-url": "https://api.mwapi.dev/v1",
            "api-key-entries": [{ "auth-index": "mwapi-test-index", "api-key": "private-test-value" }],
        }],
    };
    const creditResponse = {
        code: 0,
        data: {
            is_active: true,
            status: "active",
            pay_as_you_go: { quota_limit: 500, quota_used: 0.38867, quota_remaining: 499.61133, unit: "USD" },
        },
    };

    async function query(creditBody: unknown = creditResponse, status = 200, providerConfig: unknown = config) {
        const originalFetch = globalThis.fetch;
        const calls: Array<{ url: string; body?: string }> = [];
        globalThis.fetch = (async (url, init) => {
            const target = String(url);
            calls.push({ url: target, body: init?.body as string | undefined });
            if (target.endsWith("/auth-files")) return Response.json({ files: [] });
            if (target.endsWith("/openai-compatibility")) return Response.json(providerConfig);
            if (target.endsWith("/api-call")) return Response.json({ status_code: status, body: JSON.stringify(creditBody) });
            return new Response("Not found", { status: 404 });
        }) as typeof fetch;
        try {
            return { groups: await fetchUsage(), calls };
        } finally {
            globalThis.fetch = originalFetch;
        }
    }

    it("reuses CPAMC token substitution and the reseller endpoint for monetary credits", async () => {
        const { groups, calls } = await query();
        const account = groups.find((group) => group.provider === "mwapi")?.accounts[0];
        assert.ok(account, "MWAPI credits must appear even though API-key providers are absent from auth-files");
        assert.equal(account.pools[0].available, 499.61133);
        assert.equal(account.pools[0].used, 0.38867);
        assert.equal(account.pools[0].total, 500);
        assert.equal(account.pools[0].currency, "USD");
        assert.equal(account.pools[0].windowLabel, null);
        const request = JSON.parse(calls.find((call) => call.url.endsWith("/api-call"))!.body!);
        assert.equal(request.auth_index, "mwapi-test-index");
        assert.equal(request.url, "https://api.mwapi.dev/api/v1/usage-check/lookup");
        assert.equal(request.method, "POST");
        assert.deepEqual(JSON.parse(request.data), { key: "$TOKEN$" });
        assert.ok(!JSON.stringify(calls).includes("private-test-value"));
        const report = renderTextReport(groups);
        assert.match(report, /499\.61 USD disponibles de 500\.00 USD/);
        assert.match(report, /0\.39 USD consumidos/);
        assert.doesNotMatch(report, /% libre|reset n\/a|private-test-value/);
    });

    it("uses fresh credit amounts on each query and preserves a real zero balance", async () => {
        const depleted = structuredClone(creditResponse);
        depleted.data.pay_as_you_go.quota_remaining = 0;
        depleted.data.pay_as_you_go.quota_used = 500;
        const { groups } = await query(depleted);
        const account = groups.find((group) => group.provider === "mwapi")!.accounts[0];
        assert.equal(account.pools[0].available, 0);
        assert.equal(account.limitReached, true);
        assert.match(renderTextReport(groups), /0\.00 USD disponibles de 500\.00 USD/);
    });

    it("reports upstream failures without inventing a balance or echoing secrets", async () => {
        const { groups } = await query({ error: "private-test-value" }, 401);
        const account = groups.find((group) => group.provider === "mwapi")?.accounts[0];
        assert.ok(account);
        assert.equal(account.pools.length, 0);
        assert.match(account.error!, /créditos/i);
        assert.doesNotMatch(JSON.stringify(account), /private-test-value|500/);
    });

    it("rejects missing, invalid or wrong-currency credit data", async () => {
        for (const body of [
            {},
            { code: 1, message: "private-test-value" },
            { code: 0, data: { pay_as_you_go: { quota_limit: 500, quota_used: 0, quota_remaining: "500", unit: "USD" } } },
            { code: 0, data: { pay_as_you_go: { quota_limit: 500, quota_used: 0, quota_remaining: -1, unit: "USD" } } },
            { code: 0, data: { pay_as_you_go: { quota_limit: 500, quota_used: 0, quota_remaining: 500, unit: "tokens" } } },
        ]) {
            const { groups } = await query(body);
            const account = groups.find((group) => group.provider === "mwapi")?.accounts[0];
            assert.ok(account);
            assert.equal(account.pools.length, 0);
            assert.ok(account.error);
        }
    });

    it("ignores disabled providers, other origins and missing configuration", async () => {
        for (const providerConfig of [
            { "openai-compatibility": [] },
            { "openai-compatibility": [{ ...config["openai-compatibility"][0], disabled: true }] },
            { "openai-compatibility": [{ ...config["openai-compatibility"][0], "base-url": "https://api.mwapi.dev.attacker.invalid/v1" }] },
        ]) {
            const { groups, calls } = await query(creditResponse, 200, providerConfig);
            assert.ok(!groups.some((group) => group.provider === "mwapi"));
            assert.ok(!calls.some((call) => call.url.endsWith("/api-call")));
        }
    });

    it("does not query without an auth index or fabricate available credit", async () => {
        const noIndex = { "openai-compatibility": [{ ...config["openai-compatibility"][0], "api-key-entries": [{}] }] };
        const { groups, calls } = await query(creditResponse, 200, noIndex);
        const account = groups.find((group) => group.provider === "mwapi")?.accounts[0];
        assert.ok(account?.error);
        assert.equal(account.pools.length, 0);
        assert.ok(!calls.some((call) => call.url.endsWith("/api-call")));
    });

    it("propagates caller cancellation during the credits request", async () => {
        const originalFetch = globalThis.fetch;
        const controller = new AbortController();
        globalThis.fetch = (async (url) => {
            const target = String(url);
            if (target.endsWith("/auth-files")) return Response.json({ files: [] });
            if (target.endsWith("/openai-compatibility")) return Response.json(config);
            if (target.endsWith("/api-call")) {
                controller.abort();
                throw new DOMException("Cancelled", "AbortError");
            }
            return new Response("Not found", { status: 404 });
        }) as typeof fetch;
        try {
            await assert.rejects(fetchUsage(controller.signal), { name: "AbortError" });
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});

describe("MINI-002: API Billing Integration & Text Report", () => {
    it("renderTextReport formats pending_initial_export billing state with zeroed baseline", () => {
        const groups: ProviderGroup[] = [
            {
                provider: "vertex",
                accounts: [
                    {
                        id: "vertex-account",
                        provider: "vertex",
                        account: "cliproxy-vertex@sias-478809.iam.gserviceaccount.com",
                        authType: "service_account",
                        plan: "standard",
                        tier: null,
                        limitReached: false,
                        bankedCredits: null,
                        rateLimitType: null,
                        pools: [],
                        billing: {
                            status: "pending_initial_export",
                            dataset: "billing_export",
                            totalProject: { grossCost: 0, creditsApplied: 0, netCost: 0, currency: "USD" },
                            vertexAi: { grossCost: 0, creditsApplied: 0, netCost: 0, currency: "USD" },
                        },
                    },
                ],
            },
        ];

        const report = renderTextReport(groups);
        assert.match(
            report,
            /\[GCP Billing Export: Dataset 'billing_export' conectado · En espera de generación inicial de tablas por Google Cloud\]/,
        );
        assert.match(
            report,
            /Consumo MTD: Costo Bruto \$0\.00 · Créditos Aplicados \$0\.00 · Neto a Pagar \$0\.00/,
        );
    });

    it("renderTextReport formats ready billing state with full Total and Vertex breakdown", () => {
        const groups: ProviderGroup[] = [
            {
                provider: "vertex",
                accounts: [
                    {
                        id: "vertex-account",
                        provider: "vertex",
                        account: "cliproxy-vertex@sias-478809.iam.gserviceaccount.com",
                        authType: "service_account",
                        plan: "standard",
                        tier: null,
                        limitReached: false,
                        bankedCredits: null,
                        rateLimitType: null,
                        pools: [],
                        billing: {
                            status: "ready",
                            dataset: "billing_export",
                            table: "gcp_billing_export_v1_XXXXXX",
                            totalProject: { grossCost: 45.5, creditsApplied: 15.5, netCost: 30.0, currency: "USD" },
                            vertexAi: { grossCost: 15.5, creditsApplied: 5.5, netCost: 10.0, currency: "USD" },
                        },
                    },
                ],
            },
        ];

        const report = renderTextReport(groups);
        assert.match(
            report,
            /\[GCP Billing MTD\] Total Proyecto: Costo Bruto \$45\.50 · Créditos Aplicados \$15\.50 · Neto a Pagar \$30\.00 \(USD\)/,
        );
        assert.match(
            report,
            /\[GCP Billing MTD\] Vertex AI \/ Agent: Costo Bruto \$15\.50 · Créditos Aplicados \$5\.50 · Neto a Pagar \$10\.00 \(USD\)/,
        );
    });

    it("renderTextReport formats error billing state gracefully", () => {
        const groups: ProviderGroup[] = [
            {
                provider: "vertex",
                accounts: [
                    {
                        id: "vertex-account",
                        provider: "vertex",
                        account: "cliproxy-vertex@sias-478809.iam.gserviceaccount.com",
                        authType: "service_account",
                        plan: "standard",
                        tier: null,
                        limitReached: false,
                        bankedCredits: null,
                        rateLimitType: null,
                        pools: [],
                        billing: {
                            status: "error",
                            dataset: "billing_export",
                            totalProject: { grossCost: 0, creditsApplied: 0, netCost: 0, currency: "USD" },
                            vertexAi: { grossCost: 0, creditsApplied: 0, netCost: 0, currency: "USD" },
                            error: "Dataset not found",
                        },
                    },
                ],
            },
        ];

        const report = renderTextReport(groups);
        assert.match(report, /\[GCP Billing Export Error: Dataset not found\]/);
    });

    it("fetchUsage attaches billing object to vertex provider accounts and ignores non-vertex", async () => {
        const originalFetch = globalThis.fetch;
        try {
            globalThis.fetch = (async (url: string | URL | Request) => {
                const urlStr = String(url);
                if (urlStr.includes("/v0/management/auth-files")) {
                    return {
                        ok: true,
                        status: 200,
                        json: async () => ({
                            files: [
                                {
                                    id: "vertex-test",
                                    name: "non-existent-vertex.json",
                                    provider: "vertex",
                                    account: "cliproxy-vertex@sias-478809.iam.gserviceaccount.com",
                                    disabled: false,
                                },
                                {
                                    id: "openai-test",
                                    name: "openai.json",
                                    provider: "openai",
                                    account: "user@example.com",
                                    disabled: false,
                                },
                            ],
                        }),
                    } as Response;
                }
                return {
                    ok: false,
                    status: 404,
                    text: async () => "Not found",
                } as Response;
            }) as typeof fetch;

            const groups = await fetchUsage();
            const vertexGroup = groups.find((g) => g.provider === "vertex");
            assert.ok(vertexGroup, "Vertex group should exist");
            assert.equal(vertexGroup.accounts.length, 1);
            assert.ok(vertexGroup.accounts[0].billing, "Vertex account should have billing object");
            assert.equal(vertexGroup.accounts[0].billing?.status, "error");

            const openaiGroup = groups.find((g) => g.provider === "openai");
            assert.ok(openaiGroup, "OpenAI group should exist");
            assert.equal(openaiGroup.accounts[0].billing, undefined, "Non-vertex account should not have billing");
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});
