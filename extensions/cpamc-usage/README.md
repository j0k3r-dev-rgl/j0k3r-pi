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
