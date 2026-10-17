import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatAccountLine, UsageModal, type ModalTheme } from "../src/modal.ts";
import type { AccountUsage, ProviderGroup } from "../src/api.ts";

const dummyTheme: ModalTheme = {
    fg: (_color, text) => text,
    bg: (_color, text) => text,
    bold: (text) => text,
};

describe("MINI-003: TUI Modal Billing Visualization", () => {
    const baseAccount: AccountUsage = {
        id: "vertex-acc",
        provider: "vertex",
        account: "cliproxy-vertex@sias-478809.iam.gserviceaccount.com",
        authType: "service_account",
        plan: "standard",
        tier: null,
        limitReached: false,
        bankedCredits: null,
        rateLimitType: null,
        pools: [],
    };

    it("renders MWAPI as USD credits, not hourly quotas or percentages", async () => {
        const account: AccountUsage = {
            ...baseAccount,
            id: "mwapi",
            provider: "mwapi",
            account: "MWAPI",
            plan: "Créditos USD",
            pools: [{
                label: "Créditos", displayName: "Créditos MWAPI", currency: "USD",
                used: 0.38867, available: 499.61133, total: 500, unlimited: false,
                availablePercentage: 99.922266, resetAt: null, windowLabel: null, modelCount: 0, models: [],
            }],
        };
        assert.match(formatAccountLine(account, false, false, dummyTheme), /crédito\(s\)/);
        const modal = new UsageModal({
            theme: dummyTheme, tui: { requestRender: () => {} }, done: () => {},
            load: async () => [{ provider: "mwapi", accounts: [account] }],
        });
        try {
            await new Promise((resolve) => setTimeout(resolve, 10));
            const rendered = modal.render(120).join("\n");
            assert.match(rendered, /499\.61 USD disponibles de 500\.00 USD/);
            assert.match(rendered, /0\.39 USD consumidos/);
            assert.doesNotMatch(rendered, /% libre|reset n\/a|5h|5 hs/);
        } finally {
            modal.dispose();
        }
    });

    it("formatAccountLine renders pending export badge when billing is pending_initial_export", () => {
        const acc: AccountUsage = {
            ...baseAccount,
            billing: {
                status: "pending_initial_export",
                dataset: "billing_export",
                totalProject: { grossCost: 0, creditsApplied: 0, netCost: 0, currency: "USD" },
                vertexAi: { grossCost: 0, creditsApplied: 0, netCost: 0, currency: "USD" },
            },
        };

        const line = formatAccountLine(acc, false, false, dummyTheme);
        assert.match(line, /\[⏳ Export pendiente\]/);
    });

    it("formatAccountLine renders net and credits badge when billing is ready", () => {
        const acc: AccountUsage = {
            ...baseAccount,
            billing: {
                status: "ready",
                dataset: "billing_export",
                table: "gcp_billing_export_v1_XXXXXX",
                totalProject: { grossCost: 45.5, creditsApplied: 15.5, netCost: 30.0, currency: "USD" },
                vertexAi: { grossCost: 15.5, creditsApplied: 5.5, netCost: 10.0, currency: "USD" },
            },
        };

        const line = formatAccountLine(acc, false, false, dummyTheme);
        assert.match(line, /\[💵 Neto: \$30\.00 · 🎁 Créditos: \$15\.50\]/);
    });

    it("UsageModal renders pending_initial_export card with connection and zeroed baseline", async () => {
        const group: ProviderGroup = {
            provider: "vertex",
            accounts: [
                {
                    ...baseAccount,
                    billing: {
                        status: "pending_initial_export",
                        dataset: "billing_export",
                        totalProject: { grossCost: 0, creditsApplied: 0, netCost: 0, currency: "USD" },
                        vertexAi: { grossCost: 0, creditsApplied: 0, netCost: 0, currency: "USD" },
                    },
                },
            ],
        };

        const modal = new UsageModal({
            theme: dummyTheme,
            tui: { requestRender: () => {} },
            done: () => {},
            load: async () => [group],
        });

        // Allow microtasks for runLoad to complete
        await new Promise((resolve) => setTimeout(resolve, 10));

        const rendered = modal.render(120).join("\n");
        assert.match(rendered, /ℹ BigQuery Billing Export \('billing_export'\) conectado/);
        assert.match(rendered, /Esperando creación inicial de tablas por Google Cloud/);
        assert.match(rendered, /Costo Bruto: \$0\.00 USD  ·  Créditos Aplicados: \$0\.00 USD  ·  Neto a Pagar: \$0\.00 USD/);
    });

    it("UsageModal renders ready billing card with Total and Vertex rows and no fixed progress bar", async () => {
        const group: ProviderGroup = {
            provider: "vertex",
            accounts: [
                {
                    ...baseAccount,
                    billing: {
                        status: "ready",
                        dataset: "billing_export",
                        table: "gcp_billing_export_v1_XXXXXX",
                        totalProject: { grossCost: 45.5, creditsApplied: 15.5, netCost: 30.0, currency: "USD" },
                        vertexAi: { grossCost: 15.5, creditsApplied: 5.5, netCost: 10.0, currency: "USD" },
                    },
                },
            ],
        };

        const modal = new UsageModal({
            theme: dummyTheme,
            tui: { requestRender: () => {} },
            done: () => {},
            load: async () => [group],
        });

        await new Promise((resolve) => setTimeout(resolve, 10));

        const rendered = modal.render(120).join("\n");
        assert.match(rendered, /◆ Resumen de Facturación MTD \(BigQuery Export\)/);
        assert.match(rendered, /Total Proyecto:\s+Costo Bruto \$45\.50  ·  Créditos \$15\.50  ·  Neto a Pagar \$30\.00 \[USD\]/);
        assert.match(rendered, /Vertex AI\/Agent:\s+Costo Bruto \$15\.50  ·  Créditos \$5\.50  ·  Neto a Pagar \$10\.00 \[USD\]/);
    });

    it("UsageModal renders error state when billing has error", async () => {
        const group: ProviderGroup = {
            provider: "vertex",
            accounts: [
                {
                    ...baseAccount,
                    billing: {
                        status: "error",
                        dataset: "billing_export",
                        totalProject: { grossCost: 0, creditsApplied: 0, netCost: 0, currency: "USD" },
                        vertexAi: { grossCost: 0, creditsApplied: 0, netCost: 0, currency: "USD" },
                        error: "Permission denied on BigQuery dataset",
                    },
                },
            ],
        };

        const modal = new UsageModal({
            theme: dummyTheme,
            tui: { requestRender: () => {} },
            done: () => {},
            load: async () => [group],
        });

        await new Promise((resolve) => setTimeout(resolve, 10));

        const rendered = modal.render(120).join("\n");
        assert.match(rendered, /⚠ BigQuery Billing: Permission denied on BigQuery dataset/);
    });
});
