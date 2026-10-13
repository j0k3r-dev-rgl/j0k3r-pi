import { describe, it, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
    renderTextReport,
    fetchUsage,
    type AccountUsage,
    type ProviderGroup,
    type BillingSummary,
} from "../src/api.ts";

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
