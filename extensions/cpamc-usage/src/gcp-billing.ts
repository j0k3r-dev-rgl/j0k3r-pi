import { createSign } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type ServiceAccountCredentials = {
    type?: string;
    project_id: string;
    private_key: string;
    client_email: string;
    token_uri?: string;
};

export type BillingMetrics = {
    grossCost: number;
    creditsApplied: number;
    netCost: number;
    currency: string;
};

export type BillingSummary = {
    status: "pending_initial_export" | "ready" | "error";
    dataset: string;
    table?: string | null;
    totalProject: BillingMetrics;
    vertexAi: BillingMetrics;
    error?: string;
    lastUpdated?: string;
};

type TokenCacheEntry = {
    token: string;
    expiresAt: number;
};

let tokenCache: TokenCacheEntry | null = null;

export function clearTokenCache(): void {
    tokenCache = null;
}

function base64url(input: string | Buffer): string {
    const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
    return buf.toString("base64url");
}

function round2(val: number): number {
    return Math.round(val * 100) / 100;
}

export function sanitizeError(err: unknown): string {
    let msg = err instanceof Error ? err.message : String(err);
    // Strip PEM private key blocks
    msg = msg.replace(/-----BEGIN[A-Z\s]+PRIVATE KEY-----[\s\S]*?-----END[A-Z\s]+PRIVATE KEY-----/gi, "[REDACTED_KEY]");
    // Strip long base64 strings or private key chunks
    msg = msg.replace(/[A-Za-z0-9+/=]{40,}/g, "[REDACTED]");
    return msg.slice(0, 200);
}

/**
 * Mint an OAuth2 access token for the given GCP service account using RS256 JWT assertion.
 * Caches tokens in-memory for 50 minutes.
 */
export async function mintServiceAccountToken(
    credentials: ServiceAccountCredentials,
    signal?: AbortSignal,
): Promise<string> {
    const now = Date.now();
    // Cache valid for 50 minutes (3000 seconds) out of standard 60 minutes
    if (tokenCache && now < tokenCache.expiresAt - 10 * 60 * 1000) {
        return tokenCache.token;
    }

    const nowSeconds = Math.floor(now / 1000);
    const tokenUri = credentials.token_uri || "https://oauth2.googleapis.com/token";

    const header = {
        alg: "RS256",
        typ: "JWT",
    };

    const claims = {
        iss: credentials.client_email,
        scope: "https://www.googleapis.com/auth/bigquery.readonly",
        aud: tokenUri,
        exp: nowSeconds + 3600,
        iat: nowSeconds,
    };

    const headerB64 = base64url(JSON.stringify(header));
    const claimsB64 = base64url(JSON.stringify(claims));
    const signingInput = `${headerB64}.${claimsB64}`;

    if (!credentials.private_key) {
        throw new Error("Service account credentials missing private_key");
    }

    const signer = createSign("RSA-SHA256");
    signer.update(signingInput);
    const signature = signer.sign(credentials.private_key);
    const signatureB64 = base64url(signature);

    const jwt = `${signingInput}.${signatureB64}`;

    const params = new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
    });

    const timeout = AbortSignal.timeout(8000);
    const combinedSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;

    const res = await fetch(tokenUri, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
        signal: combinedSignal,
    });

    if (!res.ok) {
        const bodyText = await res.text().catch(() => "");
        throw new Error(`OAuth2 token minting failed HTTP ${res.status}: ${bodyText.slice(0, 120)}`);
    }

    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) {
        throw new Error("OAuth2 response missing access_token");
    }

    const expiresIn = Number(data.expires_in ?? 3600);
    tokenCache = {
        token: data.access_token,
        expiresAt: now + expiresIn * 1000,
    };

    return data.access_token;
}

/**
 * List tables in BigQuery dataset.
 */
export async function listExportTables(
    projectId: string,
    datasetId: string,
    token: string,
    signal?: AbortSignal,
): Promise<any[]> {
    const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/datasets/${datasetId}/tables`;
    const timeout = AbortSignal.timeout(8000);
    const combinedSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;

    const res = await fetch(url, {
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
        },
        signal: combinedSignal,
    });

    if (!res.ok) {
        const bodyText = await res.text().catch(() => "");
        throw new Error(`BigQuery list tables failed HTTP ${res.status}: ${bodyText.slice(0, 120)}`);
    }

    const data = (await res.json()) as { tables?: any[] };
    return data.tables || [];
}

/**
 * Resolve the service account credentials path.
 */
export function resolveServiceAccountPath(authFileName?: string): string | null {
    if (process.env.GCP_VERTEX_KEY_PATH && existsSync(process.env.GCP_VERTEX_KEY_PATH)) {
        return process.env.GCP_VERTEX_KEY_PATH;
    }

    if (authFileName) {
        const namedPath = join(homedir(), ".cli-proxy-api", authFileName);
        if (existsSync(namedPath)) {
            return namedPath;
        }
    }

    const defaultPath = join(homedir(), ".cli-proxy-api", "vertex-vertex-global-sias-478809.json");
    if (existsSync(defaultPath)) {
        return defaultPath;
    }

    return null;
}

/**
 * Load credentials from path safely, supporting both direct Google service account
 * JSON files and CLIProxyAPI-wrapped VertexCredentialStorage format.
 */
export function loadCredentialsFromFile(filePath: string): ServiceAccountCredentials {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, any>;

    // Support CLIProxyAPI wrapped Vertex credential storage format
    if (parsed.service_account && typeof parsed.service_account === "object") {
        const sa = parsed.service_account;
        return {
            type: sa.type || parsed.type || "service_account",
            project_id: sa.project_id || parsed.project_id || "",
            private_key: sa.private_key || "",
            client_email: sa.client_email || parsed.email || "",
            token_uri: sa.token_uri || "https://oauth2.googleapis.com/token",
        };
    }

    // Direct Google Service Account key JSON format
    return {
        type: parsed.type || "service_account",
        project_id: parsed.project_id || "",
        private_key: parsed.private_key || "",
        client_email: parsed.client_email || parsed.email || "",
        token_uri: parsed.token_uri || "https://oauth2.googleapis.com/token",
    };
}

/**
 * Fetch GCP BigQuery Billing Export metrics.
 */
export async function fetchGcpBilling(
    credentials: ServiceAccountCredentials,
    datasetId = "billing_export",
    signal?: AbortSignal,
): Promise<BillingSummary> {
    const zeroMetrics = (curr = "USD"): BillingMetrics => ({
        grossCost: 0,
        creditsApplied: 0,
        netCost: 0,
        currency: curr,
    });

    try {
        const token = await mintServiceAccountToken(credentials, signal);
        const tables = await listExportTables(credentials.project_id, datasetId, token, signal);

        // Find export table (prefer resource export if available)
        const exportTables = tables.filter((t) => {
            const tableId = t.tableReference?.tableId || "";
            return /^gcp_billing_export_(resource_)?v1_/.test(tableId);
        });

        if (exportTables.length === 0) {
            return {
                status: "pending_initial_export",
                dataset: datasetId,
                table: null,
                totalProject: zeroMetrics(),
                vertexAi: zeroMetrics(),
                lastUpdated: new Date().toISOString(),
            };
        }

        // Sort so resource table takes priority if both exist
        exportTables.sort((a, b) => {
            const aId = a.tableReference?.tableId || "";
            const bId = b.tableReference?.tableId || "";
            if (aId.includes("resource") && !bId.includes("resource")) return -1;
            if (!aId.includes("resource") && bId.includes("resource")) return 1;
            return aId.localeCompare(bId);
        });

        const selectedTableId = exportTables[0].tableReference.tableId;

        // Query BigQuery for Month-to-Date gross and credit costs
        const query = `
SELECT
  CASE
    WHEN LOWER(service.description) LIKE '%vertex%' OR LOWER(service.description) LIKE '%agent%' THEN 'vertex'
    ELSE 'other'
  END AS category,
  IFNULL(SUM(cost), 0.0) AS gross_cost,
  IFNULL(SUM((SELECT IFNULL(SUM(c.amount), 0.0) FROM UNNEST(credits) c)), 0.0) AS credit_amount,
  ANY_VALUE(currency) AS currency
FROM \`${credentials.project_id}.${datasetId}.${selectedTableId}\`
WHERE usage_start_time >= TIMESTAMP_TRUNC(CURRENT_TIMESTAMP(), MONTH)
GROUP BY category
`.trim();

        const queryUrl = `https://bigquery.googleapis.com/bigquery/v2/projects/${credentials.project_id}/queries`;
        const timeout = AbortSignal.timeout(10000);
        const combinedSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;

        const queryRes = await fetch(queryUrl, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                query,
                useLegacySql: false,
                timeoutMs: 10000,
            }),
            signal: combinedSignal,
        });

        if (!queryRes.ok) {
            const errBody = await queryRes.text().catch(() => "");
            throw new Error(`BigQuery query failed HTTP ${queryRes.status}: ${errBody.slice(0, 120)}`);
        }

        const queryData = (await queryRes.json()) as {
            rows?: Array<{ f?: Array<{ v?: string }> }>;
        };

        let vertexGross = 0;
        let vertexCredits = 0;
        let otherGross = 0;
        let otherCredits = 0;
        let currency = "USD";

        if (Array.isArray(queryData.rows)) {
            for (const row of queryData.rows) {
                const cols = row.f || [];
                const cat = cols[0]?.v || "other";
                const gross = parseFloat(cols[1]?.v || "0") || 0;
                // In BigQuery, credits are usually recorded as negative adjustments (-5.00)
                const credits = Math.abs(parseFloat(cols[2]?.v || "0") || 0);
                const curr = cols[3]?.v;
                if (curr) currency = curr;

                if (cat === "vertex") {
                    vertexGross += gross;
                    vertexCredits += credits;
                } else {
                    otherGross += gross;
                    otherCredits += credits;
                }
            }
        }

        const totalGross = vertexGross + otherGross;
        const totalCredits = vertexCredits + otherCredits;
        const totalNet = Math.max(0, totalGross - totalCredits);
        const vertexNet = Math.max(0, vertexGross - vertexCredits);

        return {
            status: "ready",
            dataset: datasetId,
            table: selectedTableId,
            totalProject: {
                grossCost: round2(totalGross),
                creditsApplied: round2(totalCredits),
                netCost: round2(totalNet),
                currency,
            },
            vertexAi: {
                grossCost: round2(vertexGross),
                creditsApplied: round2(vertexCredits),
                netCost: round2(vertexNet),
                currency,
            },
            lastUpdated: new Date().toISOString(),
        };
    } catch (err) {
        return {
            status: "error",
            dataset: datasetId,
            table: null,
            totalProject: zeroMetrics(),
            vertexAi: zeroMetrics(),
            error: sanitizeError(err),
            lastUpdated: new Date().toISOString(),
        };
    }
}
