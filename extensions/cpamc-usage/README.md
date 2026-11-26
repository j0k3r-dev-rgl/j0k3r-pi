# cpamc-usage

CLIProxyAPI (`cpamc`) usage and subscription quota modal for Pi.

Command: `/usage`
- Shows all active accounts grouped by provider (`antigravity`, `openai` / `codex` — normalized under `openai`, `deepseek`, `deeprelay`).
- Displays OpenAI rate limit reset credits (`⚡ X resets`) and expiration/renewal dates (`vencen el DD/MM/YYYY`).
- Fetches real-time quota windows via CLIProxyAPI Management API (`/v0/management/api-call`):
  - Antigravity: tries `daily-cloudcode-pa.googleapis.com`, `daily-cloudcode-pa.sandbox.googleapis.com`, then `cloudcode-pa.googleapis.com`, combining `v1internal:retrieveUserQuotaSummary` (Claude & GPT 5h/weekly windows) and `v1internal:retrieveUserQuota` (Gemini 5h quota buckets) with relative countdowns (`reset en Xh Ym`).
  - OpenAI / Codex: `wham/usage` primary (5h) and secondary (weekly) windows.
  - DeepSeek / DeepRelay: balance-style providers read from `/v0/management/openai-compatibility` (`auth-index`), then `api-call` with `Bearer $TOKEN$`.
- Balance providers show amounts, not fabricated percentages; the 0-100% bar appears only when a real limit exists.
  - DeepSeek (`/user/balance`): total, topped-up and granted balance.
  - DeepRelay (`/billing/subscription`, `/usage?bucket=day`, `/billing/spending-limit`): subscription plan and its five server-enforced meters (monthly input/output tokens, rolling 7-day input/output tokens, monthly web searches) as real quota bars with the period reset date, plus PAYG balance, period cost and per-day cost buckets. `spending-limit` returns 404 `no_spending_limit` when unset and is treated as "no limit", not an error.
- Displays interactive TUI modal with tabs for providers, account lists, and progress bars (guards against opening duplicate overlays).
- Supports headless text report via `/usage --text` (propagates fetch errors if loading fails).

## Environment variables

Read directly from the Pi process environment (this extension does not load `.env` files itself):

- `CLIPROXYAPI_BASE_URL` — optional CLIProxyAPI base URL (defaults to `http://127.0.0.1:8317`).
- `CLIPROXYAPI_MANAGEMENT_KEY` — required Bearer token for `/v0/management/*` endpoints (missing key returns HTTP 401).

## Modal controls

- **Keyboard:** `h`/`l`, `←`/`→`, `Tab`/`Shift+Tab` (switch provider tab); `j`/`k`, `↑`/`↓` (select account); `r` (refresh); `q`/`Esc`/`Ctrl+C` (close).
- **Mouse:** click provider tabs, `◀`/`▶` arrows, account rows, or `[ ⟳ Refrescar ]` / `[ ✕ Cerrar ]` / `[✕]` buttons; scroll wheel and hover supported.

## Background cache and HUD

In TUI sessions, quotas preload asynchronously at session start and refresh every
30 seconds, even when the panel is closed. `/usage` reuses that cache; its explicit
refresh still forces a fetch. Concurrent requests share one promise. A failed
refresh retains the previous snapshot. Shutdown cancels the timer and owned I/O.

Optional `pihud:quota:read:v1` event requests return structured quota accounts
(`{ lines: [], accounts: QuotaAccount[], updatedAt, error }`) only to the matching
TUI cwd/session. No messages or tool results are injected into model context; no
sibling imports or dependencies are required. The HUD may persist this human-only
snapshot in its private cache; do not share that cache.

## Files & Validation

Files: `index.ts`, `src/{api,cache,hud,modal}.ts`, `test/*.test.ts`.
Validation: `node --test test/*.test.ts` from this extension directory.
