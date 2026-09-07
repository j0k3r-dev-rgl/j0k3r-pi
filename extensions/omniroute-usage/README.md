# omniroute-usage

Pi command `/usage`: shows which AI subscriptions are connected in your local
OmniRoute instance and how much quota is left on each one.

## Contract

- **Command**: `/usage` (add `--text` to force the plain-text fallback instead of the panel).
- **User-only**: the data is rendered through `ctx.ui` (floating overlay in TUI mode,
  notification otherwise). It is **never** injected into the session, so the model never
  sees account emails, plans, or quotas.
- **Key bindings** (panel, nvim-style): `h` / `l` previous/next provider · `j` / `k`
  next/previous account · `r` refresh · `Esc` / `q` / `Ctrl+C` close.
  `Tab`/`Shift+Tab` and the arrow keys still work as aliases.
- **Cache**: data is fetched when the panel opens and reused while it stays open.
  Navigating providers and accounts does not refetch; `r` forces a refetch and shows the
  loading state again.
- **Loading state**: spinner while the management API responds (`⠋ ⠙ ⠹ ⠸`).

## Layout

```
┌─ OmniRoute usage · 4 suscripción(es) ─────────────────────┐
│ [antigravity (1)]  codex (2)  opencode-go (1)             │  <- Tab / Shift+Tab
│                                                           │
│ ▸ cuenta@proveedor · plan Pro · Google AI Pro · 2 uso(s)  │  <- ↑ / ↓
│ · cuenta2@proveedor · plan plus · LIMIT REACHED           │
│                                                           │
│ ───────────────────────────────────────────────────────── │
│   gemini                                                  │
│     ████████████████████ 99.2% libre · 992/1000 …         │
│                                                           │
│ Tab proveedor · ↑↓ cuenta · r refrescar · Esc cerrar      │
└───────────────────────────────────────────────────────────┘
```

- Bordered panel drawn by the extension (1 column border + 1 column padding per side);
  every line is padded or truncated to the panel width.
- **All** accounts of the selected provider are listed, however many there are; the
  active one is highlighted with `▸` and its quota windows render below the separator.
- Availability bar: `█` = free, `░` = used, plus absolute remaining and reset time.

## Data source

Local OmniRoute management API over loopback only:

- `GET /api/providers` — active connections.
- `GET /api/usage/{connectionId}` — plan, tiers and quota windows.

The inference key `OMNIROUTE_API_KEY` is rejected by these routes
(`403 Invalid management token`), so this extension derives the same machine token the
CLI uses:

```
x-omniroute-cli-token = HMAC-SHA256(machineId, OMNIROUTE_CLI_SALT || "omniroute-cli-auth-v1")
```

`machineId` is read from `/var/lib/dbus/machine-id` or `/etc/machine-id`. Set
`OMNIROUTE_CLI_TOKEN` explicitly if your host has neither file. Non-loopback
`OMNIROUTE_BASE_URL` values are refused.

### Supported quota shapes

| Provider | Shape | Notes |
|---|---|---|
| `antigravity` | model-keyed quotas | rows sharing `resetAt` collapse into one window |
| `codex` | window-keyed (`session`, `weekly`) | absolute `remaining`, `windowSeconds`, `limitReached`, `bankedResetCredits` |
| `opencode-go` | USD windows or message-only | needs dashboard scraping configured (workspace ID + `auth` cookie); otherwise shows the provider's message as "sin cuota expuesta" |

## Structure

```
index.ts      command registration + cache
src/api.ts    token derivation, HTTP adapter, quota grouping, text fallback
src/modal.ts  floating panel component (render/handleInput/invalidate)
```

No runtime dependencies: only `node:crypto` and `node:fs`. The theme is injected by
`ctx.ui.custom()`, the border is drawn here, and key handling uses raw escape sequences,
so `@earendil-works/pi-tui` is not imported at runtime (it is not resolvable from a global
extension directory anyway).

The component implements the `Focusable` contract by exposing a `focused` property; without
it the overlay does not receive keyboard input (and therefore never closes, stacking panels).
`onHandle` focuses the overlay right after it is created, and a module-level `open` guard
prevents a second panel from stacking on top.

## Limits

- Max 25 connections; reset timestamps are upstream rolling windows and move between calls.
- Cookie-based providers (opencode-go) stop reporting when the session cookie expires.
