# cpamc-usage

CLIProxyAPI (`cpamc`) usage and subscription quota modal for Pi.

Command: `/usage`
- Shows all active accounts grouped by provider (Antigravity/Google, OpenAI, Vertex AI, OpenCode, etc.).
- Displays OpenAI rate limit reset credits (`⚡ X resets`) and expiration/renewal dates (`vencen el DD/MM/YYYY`).
- Fetches real-time quota windows (5h, weekly) via CLIProxyAPI Management API (`/v0/management/api-call`) with relative countdowns (`reset en Xh Ym`).
- Google Cloud BigQuery Billing Export integration for Vertex AI accounts:
  - Zero-dependency OAuth2 token minting via RS256 JWT assertion (`node:crypto`) using Vertex service account credentials.
  - Queries month-to-date (MTD) accumulated financial metrics: Costo Bruto, Créditos Aplicados, and Neto a Pagar.
  - Detailed financial breakdown for Total Project versus Vertex AI / Agent Platform spend.
  - Graceful initial export handling: detects when BigQuery dataset (`billing_export`) is connected but tables are still pending initial generation by GCP Console, showing `[⏳ Export pendiente]` and a $0.00 baseline card.
  - Strict secret protection: private keys remain strictly in-memory and are never leaked in UI or logs.
- Displays interactive TUI modal with tabs for providers, account lists, progress bars, and billing cards.
- Supports headless text report via `/usage --text`.

## MWAPI credits

With an enabled `mwapi` OpenAI-compatible provider at `https://api.mwapi.dev/v1` in global CLIProxyAPI configuration, `/usage` shows **remaining / initial USD credits and consumed USD**, not hourly quotas or token estimates.

- Uses the same `POST /api/v1/usage-check/lookup` endpoint as [MWAPI's reseller portal](https://api.mwapi.dev/reseller).
- Discovers the credential's auth index through CLIProxyAPI Management API and uses its `$TOKEN$` substitution. No second API-key copy, environment variable, or Pi credential setting is needed; keys are not included in the display or errors.
- Refreshes when the modal opens, on its refresh action, and for `/usage --text`. No background polling or inference is performed. Management requests have an 8-second timeout and pass through caller cancellation.
- Displays the provider's reported credit amounts without estimating deductions from token usage. Failed or malformed responses show an unknown-balance error, never an invented zero or 500 USD balance.
- Requires the existing `CLIPROXYAPI_MANAGEMENT_KEY` and optional `CLIPROXYAPI_BASE_URL` (default `http://127.0.0.1:8317`). Only the named MWAPI provider with the exact HTTPS endpoint is queried.

Run `/reload` after updating the extension, then open `/usage` and select MWAPI. No additional tools or package dependencies are introduced.

Validation: `node --test test/*.test.ts` from this extension directory.
