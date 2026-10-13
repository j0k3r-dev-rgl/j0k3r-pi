import { describe, it, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    mintServiceAccountToken,
    listExportTables,
    fetchGcpBilling,
    loadCredentialsFromFile,
    clearTokenCache,
    type ServiceAccountCredentials,
    type BillingSummary,
} from "../src/gcp-billing.ts";

describe("MINI-001: GCP Token Minting & BigQuery Billing Client", () => {
    // Generate a temporary in-memory RSA keypair for testing RS256 signing
    const { privateKey } = generateKeyPairSync("rsa", {
        modulusLength: 2048,
        publicKeyEncoding: { type: "spki", format: "pem" },
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });

    const mockCredentials: ServiceAccountCredentials = {
        type: "service_account",
        project_id: "test-project-123",
        private_key: privateKey,
        client_email: "test-sa@test-project-123.iam.gserviceaccount.com",
    };

    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        clearTokenCache();
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        clearTokenCache();
    });

    it("mintServiceAccountToken creates valid RS256 JWT and exchanges it for access token", async () => {
        let requestedUrl = "";
        let requestBody = "";
        let authHeader = "";

        globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
            requestedUrl = String(url);
            requestBody = String(init?.body ?? "");
            authHeader = String(init?.headers ? (init.headers as any)["Authorization"] ?? "" : "");
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    access_token: "mock-oauth2-token-xyz",
                    expires_in: 3600,
                    token_type: "Bearer",
                }),
            } as Response;
        }) as typeof fetch;

        const token = await mintServiceAccountToken(mockCredentials);
        assert.equal(token, "mock-oauth2-token-xyz");
        assert.equal(requestedUrl, "https://oauth2.googleapis.com/token");
        assert.match(requestBody, /grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer/);
        assert.match(requestBody, /assertion=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
    });

    it("mintServiceAccountToken caches token in-memory to prevent repeated minting", async () => {
        let fetchCallCount = 0;
        globalThis.fetch = (async () => {
            fetchCallCount++;
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    access_token: "cached-token-123",
                    expires_in: 3600,
                    token_type: "Bearer",
                }),
            } as Response;
        }) as typeof fetch;

        const token1 = await mintServiceAccountToken(mockCredentials);
        const token2 = await mintServiceAccountToken(mockCredentials);

        assert.equal(token1, "cached-token-123");
        assert.equal(token2, "cached-token-123");
        assert.equal(fetchCallCount, 1, "Fetch should only be called once due to caching");
    });

    it("listExportTables queries BigQuery dataset and returns matching tables", async () => {
        globalThis.fetch = (async (url: string | URL | Request) => {
            assert.match(String(url), /projects\/test-project-123\/datasets\/billing_export\/tables/);
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    tables: [
                        { tableReference: { tableId: "other_table" } },
                        { tableReference: { tableId: "gcp_billing_export_v1_012345_6789AB_CDEF01" } },
                    ],
                }),
            } as Response;
        }) as typeof fetch;

        const tables = await listExportTables("test-project-123", "billing_export", "mock-token");
        assert.equal(tables.length, 2);
        assert.equal(tables[1].tableReference.tableId, "gcp_billing_export_v1_012345_6789AB_CDEF01");
    });

    it("fetchGcpBilling returns pending_initial_export when dataset has no export tables", async () => {
        globalThis.fetch = (async (url: string | URL | Request) => {
            const urlStr = String(url);
            if (urlStr.includes("oauth2.googleapis.com")) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({ access_token: "mock-token", expires_in: 3600 }),
                } as Response;
            }
            if (urlStr.includes("/tables")) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({ tables: [] }),
                } as Response;
            }
            throw new Error(`Unexpected url: ${urlStr}`);
        }) as typeof fetch;

        const summary: BillingSummary = await fetchGcpBilling(mockCredentials);
        assert.equal(summary.status, "pending_initial_export");
        assert.equal(summary.dataset, "billing_export");
        assert.equal(summary.table, null);
        assert.equal(summary.totalProject.grossCost, 0);
        assert.equal(summary.totalProject.creditsApplied, 0);
        assert.equal(summary.totalProject.netCost, 0);
        assert.equal(summary.vertexAi.grossCost, 0);
        assert.equal(summary.vertexAi.creditsApplied, 0);
        assert.equal(summary.vertexAi.netCost, 0);
    });

    it("fetchGcpBilling returns ready with aggregated MTD costs when export table is present", async () => {
        globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
            const urlStr = String(url);
            if (urlStr.includes("oauth2.googleapis.com")) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({ access_token: "mock-token", expires_in: 3600 }),
                } as Response;
            }
            if (urlStr.includes("/tables")) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        tables: [
                            { tableReference: { tableId: "gcp_billing_export_v1_012345_6789AB_CDEF01" } },
                        ],
                    }),
                } as Response;
            }
            if (urlStr.includes("/queries")) {
                const body = JSON.parse(String(init?.body ?? "{}"));
                assert.match(body.query, /FROM `test-project-123\.billing_export\.gcp_billing_export_v1_012345_6789AB_CDEF01`/);
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        jobComplete: true,
                        rows: [
                            {
                                f: [
                                    { v: "vertex" },
                                    { v: "15.50" },
                                    { v: "-5.50" },
                                    { v: "USD" },
                                ],
                            },
                            {
                                f: [
                                    { v: "other" },
                                    { v: "30.00" },
                                    { v: "-10.00" },
                                    { v: "USD" },
                                ],
                            },
                        ],
                    }),
                } as Response;
            }
            throw new Error(`Unexpected url: ${urlStr}`);
        }) as typeof fetch;

        const summary: BillingSummary = await fetchGcpBilling(mockCredentials);
        assert.equal(summary.status, "ready");
        assert.equal(summary.table, "gcp_billing_export_v1_012345_6789AB_CDEF01");

        // Vertex AI metrics
        assert.equal(summary.vertexAi.grossCost, 15.5);
        assert.equal(summary.vertexAi.creditsApplied, 5.5);
        assert.equal(summary.vertexAi.netCost, 10.0);

        // Total Project metrics (15.5 + 30.0 = 45.5 gross, 5.5 + 10.0 = 15.5 credits, 45.5 - 15.5 = 30.0 net)
        assert.equal(summary.totalProject.grossCost, 45.5);
        assert.equal(summary.totalProject.creditsApplied, 15.5);
        assert.equal(summary.totalProject.netCost, 30.0);
    });

    it("fetchGcpBilling returns sanitized error when network or permissions fail and never leaks private key", async () => {
        globalThis.fetch = (async () => {
            throw new Error(`Connection refused to oauth2 with key ${mockCredentials.private_key}`);
        }) as typeof fetch;

        const summary: BillingSummary = await fetchGcpBilling(mockCredentials);
        assert.equal(summary.status, "error");
        assert.ok(summary.error, "Should have error message");
        assert.equal(summary.error?.includes("BEGIN RSA PRIVATE KEY"), false, "Private key must never be leaked");
        assert.equal(summary.error?.includes("MIIE"), false, "Private key bytes must never be leaked");
    });

    it("loadCredentialsFromFile parses direct Google service account JSON format", () => {
        const tempDir = join(tmpdir(), `gcp-billing-test-${Date.now()}-flat`);
        mkdirSync(tempDir, { recursive: true });
        const filePath = join(tempDir, "flat-sa.json");
        const flatData = {
            type: "service_account",
            project_id: "sias-test-flat",
            private_key: privateKey,
            client_email: "flat-sa@sias-test-flat.iam.gserviceaccount.com",
            token_uri: "https://oauth2.googleapis.com/token",
        };
        writeFileSync(filePath, JSON.stringify(flatData), "utf8");

        try {
            const loaded = loadCredentialsFromFile(filePath);
            assert.equal(loaded.project_id, "sias-test-flat");
            assert.equal(loaded.client_email, "flat-sa@sias-test-flat.iam.gserviceaccount.com");
            assert.equal(loaded.private_key, privateKey);
            assert.equal(loaded.token_uri, "https://oauth2.googleapis.com/token");
        } finally {
            rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it("loadCredentialsFromFile parses CLIProxyAPI-wrapped Vertex credential format (regression)", () => {
        const tempDir = join(tmpdir(), `gcp-billing-test-${Date.now()}-wrapped`);
        mkdirSync(tempDir, { recursive: true });
        const filePath = join(tempDir, "wrapped-vertex.json");
        const wrappedData = {
            disabled: false,
            email: "outer-email@sias-478809.iam.gserviceaccount.com",
            location: "us-central1",
            project_id: "sias-478809",
            type: "vertex",
            service_account: {
                type: "service_account",
                project_id: "sias-478809",
                private_key: privateKey,
                client_email: "cliproxy-vertex@sias-478809.iam.gserviceaccount.com",
                token_uri: "https://oauth2.googleapis.com/token",
            },
        };
        writeFileSync(filePath, JSON.stringify(wrappedData), "utf8");

        try {
            const loaded = loadCredentialsFromFile(filePath);
            assert.equal(loaded.project_id, "sias-478809");
            assert.equal(loaded.client_email, "cliproxy-vertex@sias-478809.iam.gserviceaccount.com");
            assert.equal(loaded.private_key, privateKey);
            assert.equal(loaded.token_uri, "https://oauth2.googleapis.com/token");
        } finally {
            rmSync(tempDir, { recursive: true, force: true });
        }
    });
});
