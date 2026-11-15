# cpamc-usage

CLIProxyAPI (`cpamc`) usage and subscription quota modal for Pi.

Command: `/usage`
- Shows all active accounts grouped by provider (`antigravity`, `openai` / `codex`, `deepseek`, `deeprelay`).
- Displays OpenAI rate limit reset credits (`⚡ X resets`) and expiration/renewal dates (`vencen el DD/MM/YYYY`).
- Fetches real-time quota windows via CLIProxyAPI Management API (`/v0/management/api-call`):
  - Antigravity: combines `v1internal:retrieveUserQuotaSummary` (Claude & GPT 5h/weekly windows) and `v1internal:retrieveUserQuota` (Gemini 5h quota buckets) with relative countdowns (`reset en Xh Ym`).
  - OpenAI / Codex: `wham/usage` primary (5h) and secondary (weekly) windows.
  - DeepSeek / DeepRelay: balance-style providers read from `/v0/management/openai-compatibility` (`auth-index`), then `api-call` with `Bearer $TOKEN$`.
- Balance providers show amounts, not fabricated percentages; the 0-100% bar appears only when a real limit exists.
  - DeepSeek (`/user/balance`): total, topped-up and granted balance.
  - DeepRelay (`/billing/subscription`, `/usage?bucket=day`, `/billing/spending-limit`): subscription plan and its five server-enforced meters (monthly input/output tokens, rolling 7-day input/output tokens, monthly web searches) as real quota bars with the period reset date, plus PAYG balance, period cost and per-day cost buckets. `spending-limit` returns 404 `no_spending_limit` when unset and is treated as "no limit", not an error.
- Displays interactive TUI modal with tabs for providers, account lists, and progress bars.
- Supports headless text report via `/usage --text`.

Validation: `node --test test/*.test.ts` from this extension directory.
