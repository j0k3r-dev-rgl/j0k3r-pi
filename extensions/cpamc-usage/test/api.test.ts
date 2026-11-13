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
            assert.ok(!calls.some((u) => u.includes("openai-compatibility")), "must not query MWAPI config");
            assert.ok(!calls.some((u) => u.includes("opencode.ai")), "must not query OpenCode Go");

            const report = renderTextReport(groups);
            assert.match(report, /Gemini Models · 5 hs: 82\.0% libre/);
            assert.match(report, /Claude and GPT models · Semanal: 68\.0% libre/);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});
