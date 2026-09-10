# cpamc-usage

CLIProxyAPI (`cpamc`) usage and subscription quota modal for Pi.

Command: `/usage`
- Shows all active accounts grouped by provider (Antigravity/Google, OpenAI/Codex, etc.)
- Fetches real-time quota windows (5h, weekly) via CLIProxyAPI Management API (`/v0/management/api-call`).
- Displays interactive TUI modal with tabs for providers, account lists, and progress bars.
