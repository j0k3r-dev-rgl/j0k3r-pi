# cpamc-usage

CLIProxyAPI (`cpamc`) usage and subscription quota modal for Pi.

Command: `/usage`
- Shows all active accounts grouped by provider (Antigravity/Google, OpenAI, OpenCode, etc.).
- Displays OpenAI rate limit reset credits (`⚡ X resets`) and expiration/renewal dates (`vencen el DD/MM/YYYY`).
- Fetches real-time quota windows (5h, weekly) via CLIProxyAPI Management API (`/v0/management/api-call`) with relative countdowns (`reset en Xh Ym`).
- Displays interactive TUI modal with tabs for providers, account lists, and progress bars.
