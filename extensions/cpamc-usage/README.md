# cpamc-usage

CLIProxyAPI (`cpamc`) usage and subscription quota modal for Pi.

Command: `/usage`
- Shows all active accounts grouped by provider (`antigravity`, `openai` / `codex`).
- Displays OpenAI rate limit reset credits (`⚡ X resets`) and expiration/renewal dates (`vencen el DD/MM/YYYY`).
- Fetches real-time quota windows via CLIProxyAPI Management API (`/v0/management/api-call`):
  - Antigravity: combines `v1internal:retrieveUserQuotaSummary` (Claude & GPT 5h/weekly windows) and `v1internal:retrieveUserQuota` (Gemini 5h quota buckets) with relative countdowns (`reset en Xh Ym`).
  - OpenAI / Codex: `wham/usage` primary (5h) and secondary (weekly) windows.
- Displays interactive TUI modal with tabs for providers, account lists, and progress bars.
- Supports headless text report via `/usage --text`.

Validation: `node --test test/*.test.ts` from this extension directory.
