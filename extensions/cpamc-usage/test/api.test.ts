import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fetchUsage, renderTextReport } from "../src/api.ts";

describe("cpamc-usage Antigravity Gemini & Claude/GPT quotas", () => {
    it("combines retrieveUserQuotaSummary (Claude/GPT) and retrieveUserQuota (Gemini) for Antigravity accounts", async () => {
        const originalFetch = globalThis.fetch;
        const calls: string[] = [];
        globalThis.fetch = (async (input, init) => {
            const url = String(input);
            calls.push(url);
            if (url.endsWith("/v0/management/auth-files")) {
                return Response.json({
                    files: [
                        {
                            id: "ag-1",
                            name: "ag-1.json",
                            auth_index: "idx-ag-1",
                            provider: "antigravity",
                            email: "user@example.org",
                            project_id: "proj-1",
                            disabled: false,
                        },
                    ],
                });
            }
            if (url.endsWith("/v0/management/api-call")) {
                const payload = JSON.parse(String(init?.body ?? "{}"));
                if (payload.url.endsWith("retrieveUserQuotaSummary")) {
                    return Response.json({
                        status_code: 200,
                        body: JSON.stringify({
                            groups: [
                                {
                                    displayName: "Claude and GPT models",
                                    buckets: [
                                        { window: "5h", remainingFraction: 1.0, resetTime: "2026-11-13T17:00:00Z" },
                                        { window: "weekly", remainingFraction: 0.68, resetTime: "2026-11-20T12:00:00Z" },
                                    ],
                                },
                            ],
                        }),
                    });
                }
                if (payload.url.endsWith("retrieveUserQuota")) {
                    return Response.json({
                        status_code: 200,
                        body: JSON.stringify({
                            buckets: [
                                { modelId: "gemini-2.5-pro", remainingFraction: 0.82, resetTime: "2026-11-13T17:04:00Z" },
                                { modelId: "gemini-3-flash", remainingFraction: 0.82, resetTime: "2026-11-13T17:04:00Z" },
                                { modelId: "claude-opus-4-6-thinking", remainingFraction: 1.0, resetTime: "2026-11-13T17:00:00Z" },
                                { modelId: "chat_20706", remainingFraction: 1.0 },
                            ],
                        }),
                    });
                }
            }
            return new Response("Not found", { status: 404 });
        }) as typeof fetch;

        try {
            const groups = await fetchUsage();
            assert.equal(groups.length, 1);
            assert.equal(groups[0].provider, "antigravity");
            const pools = groups[0].accounts[0].pools;
            assert.equal(pools.length, 3);
            assert.equal(pools[0].displayName, "Gemini Models · 5 hs");
            assert.equal(Math.round(pools[0].availablePercentage), 82);
            assert.equal(pools[0].modelCount, 2);
            assert.deepEqual(pools[0].models, ["gemini-2.5-pro", "gemini-3-flash"]);
            assert.equal(pools[1].displayName, "Claude and GPT models · 5 hs");
            assert.equal(pools[2].displayName, "Claude and GPT models · Semanal");
            // openai-compatibility is now the source for monetary providers (DeepSeek/DeepRelay);
            // it must not alter the Antigravity pools asserted above.
            assert.ok(!calls.some((u) => u.includes("opencode.ai")), "must not query OpenCode Go");

            const report = renderTextReport(groups);
            assert.match(report, /Gemini Models · 5 hs: 82\.0% libre/);
            assert.match(report, /Claude and GPT models · Semanal: 68\.0% libre/);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});

describe("cpamc-usage monetary providers (DeepSeek, DeepRelay)", () => {
    it("reports DeepSeek balance and DeepRelay balance/usage/spending-limit as amounts, not percentages", async () => {
        const originalFetch = globalThis.fetch;
        globalThis.fetch = (async (input, init) => {
            const url = String(input);
            if (url.endsWith("/v0/management/auth-files")) {
                return Response.json({ files: [] });
            }
            if (url.endsWith("/v0/management/openai-compatibility")) {
                return Response.json({
                    "openai-compatibility": [
                        {
                            name: "deepseek",
                            disabled: false,
                            prefix: "main-dsk",
                            "base-url": "https://api.deepseek.com/",
                            "api-key-entries": [{ "api-key": "sk-test", "auth-index": "idx-ds" }],
                        },
                        {
                            name: "deeprelay",
                            disabled: false,
                            prefix: "deeprelay",
                            "base-url": "https://api.deeprelay.ai/v1",
                            "api-key-entries": [{ "api-key": "sk-test", "auth-index": "idx-dr" }],
                        },
                        {
                            name: "openrouter",
                            disabled: false,
                            "base-url": "https://openrouter.ai/api/v1",
                            "api-key-entries": [{ "api-key": "sk-test", "auth-index": "idx-or" }],
                        },
                    ],
                });
            }
            if (url.endsWith("/v0/management/api-call")) {
                const payload = JSON.parse(String(init?.body ?? "{}"));
                assert.equal(payload.header.Authorization, "Bearer $TOKEN$");
                if (payload.url === "https://api.deepseek.com/user/balance") {
                    return Response.json({
                        status_code: 200,
                        body: JSON.stringify({
                            is_available: true,
                            balance_infos: [
                                {
                                    currency: "USD",
                                    total_balance: "15.49",
                                    granted_balance: "0.00",
                                    topped_up_balance: "15.49",
                                },
                            ],
                        }),
                    });
                }
                if (payload.url === "https://api.deeprelay.ai/v1/billing/subscription") {
                    return Response.json({
                        status_code: 200,
                        body: JSON.stringify({
                            subscribed: true,
                            status: "active",
                            cancel_at_period_end: false,
                            current_period_start: "2026-11-15T19:01:17Z",
                            current_period_end: "2026-12-15T19:01:17Z",
                            plan: {
                                key: "plus",
                                name: "Plus",
                                price: { amount_cents: 499, currency: "usd", interval: "month", interval_count: 1 },
                            },
                            quota: {
                                input_tokens_monthly: 2500000000,
                                output_tokens_monthly: 250000000,
                                weekly_input_tokens: 625000000,
                                weekly_output_tokens: 62500000,
                                searches_monthly: 500,
                            },
                            usage: {
                                period_start: "2026-11-15T19:01:17Z",
                                period_end: "2026-12-15T19:01:17Z",
                                weighted_input_tokens: 2762649,
                                weighted_output_tokens: 37335,
                                weekly_weighted_input_tokens: 2762649,
                                weekly_weighted_output_tokens: 37335,
                                cost_micro_cents: 2005873,
                                searches: 25,
                            },
                            balance_payment: {
                                balance_cents: 1234,
                                spendable_cents: 1234,
                                free_credit_cents: 0,
                                pending_deposit_cents: 0,
                            },
                        }),
                    });
                }
                if (payload.url.startsWith("https://api.deeprelay.ai/v1/usage")) {
                    return Response.json({
                        status_code: 200,
                        body: JSON.stringify({
                            data: [
                                { bucket_start: "2026-11-13T00:00:00Z", cost_cents: 7176 },
                                { bucket_start: "2026-11-14T00:00:00Z", cost_cents: 3588 },
                            ],
                            next_cursor: null,
                        }),
                    });
                }
                if (payload.url === "https://api.deeprelay.ai/v1/billing/spending-limit") {
                    return Response.json({
                        status_code: 404,
                        body: JSON.stringify({ code: "no_spending_limit" }),
                    });
                }
            }
            return new Response("Not found", { status: 404 });
        }) as typeof fetch;

        try {
            const groups = await fetchUsage();
            assert.deepEqual(groups.map((g) => g.provider), ["deeprelay", "deepseek"]);

            const deepseek = groups.find((g) => g.provider === "deepseek")!;
            const dsPool = deepseek.accounts[0].pools[0];
            assert.equal(dsPool.label, "Saldo USD");
            assert.equal(dsPool.amountText, "US$ 15.49");
            assert.match(dsPool.noteText ?? "", /cargado US\$ 15\.49/);
            assert.notEqual(dsPool.showBar, true);

            const deeprelay = groups.find((g) => g.provider === "deeprelay")!;
            const drPools = deeprelay.accounts[0].pools;

            const plan = drPools.find((p) => p.label === "Plan")!;
            assert.equal(plan.amountText, "Plus");
            assert.equal(plan.label, "Plan");
            assert.match(plan.noteText ?? "", /US\$ 4\.99\/mes/);
            assert.notEqual(plan.showBar, true, "plan row is informational");

            const monthlyInput = drPools.find((p) => p.label === "Input mensual")!;
            assert.equal(monthlyInput.amountText, "2.76M / 2.50B");
            assert.equal(monthlyInput.showBar, true);
            assert.equal(monthlyInput.total, 2500000000);
            assert.ok(monthlyInput.availablePercentage > 99, "barely used this period");
            assert.equal(monthlyInput.resetAt, "2026-12-15T19:01:17Z");

            const weeklyOutput = drPools.find((p) => p.label === "Output semanal")!;
            assert.equal(weeklyOutput.total, 62500000);
            assert.equal(weeklyOutput.resetAt, null, "rolling window has no reset date");
            assert.match(weeklyOutput.noteText ?? "", /7d/);

            const searches = drPools.find((p) => p.label === "Búsquedas")!;
            assert.equal(searches.used, 25);
            assert.equal(searches.total, 500);

            const payg = drPools.find((p) => p.label === "Saldo PAYG")!;
            assert.equal(payg.amountText, "US$ 12.34");
            assert.notEqual(payg.showBar, true);

            const periodCost = drPools.find((p) => p.label === "Costo del período")!;
            assert.equal(periodCost.amountText, "US$ 200.59");

            const usage = drPools.find((p) => p.label === "Consumo PAYG")!;
            assert.equal(usage.amountText, "US$ 107.64");
            assert.match(usage.noteText ?? "", /2 días/);

            const report = renderTextReport(groups);
            assert.match(report, /US\$ 15\.49/);
            assert.match(report, /US\$ 12\.34/);
            assert.match(report, /Input mensual: 2\.76M \/ 2\.50B/);
            assert.doesNotMatch(report, /deepseek[\s\S]*?% libre/);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it("keeps a monetary provider visible with an error note when its endpoint fails", async () => {
        const originalFetch = globalThis.fetch;
        globalThis.fetch = (async (input) => {
            const url = String(input);
            if (url.endsWith("/v0/management/auth-files")) return Response.json({ files: [] });
            if (url.endsWith("/v0/management/openai-compatibility")) {
                return Response.json({
                    "openai-compatibility": [
                        {
                            name: "deepseek",
                            disabled: false,
                            "base-url": "https://api.deepseek.com/",
                            "api-key-entries": [{ "api-key": "sk-test", "auth-index": "idx-ds" }],
                        },
                    ],
                });
            }
            if (url.endsWith("/v0/management/api-call")) {
                return Response.json({ status_code: 500, body: "upstream boom" });
            }
            return new Response("Not found", { status: 404 });
        }) as typeof fetch;

        try {
            const groups = await fetchUsage();
            const ds = groups.find((g) => g.provider === "deepseek")!;
            assert.ok(ds, "provider must stay listed");
            assert.equal(ds.accounts[0].pools.length, 0);
            assert.match(ds.accounts[0].note ?? "", /no disponible|error/i);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});
