# Browser Screenshot Extension

Native Pi extension for controlling an already-running Chrome through the Chrome DevTools Protocol (CDP).

## Tools

- `browser_cdp_status` — check the local CDP endpoint.
- `browser_tabs_list` — list existing page targets without exposing debugger websocket URLs.
- `go_to_page` — navigate one existing page target and wait for `Page.loadEventFired`.
- `browser_page_screenshot` — save a full-page PNG and optionally attach it inline.

### `go_to_page`

`url` is required and must be an absolute `http:` or `https:` URL. Relative URLs, credentials, and schemes such as `file:`, `data:`, `javascript:`, `chrome:`, and `devtools:` are rejected. Existing targets are selected deterministically: exact `targetId` takes precedence, then the case-insensitive `urlContains` and `titleContains` filters, then the first page target. `cdpUrl` has the same default and semantics as the other browser tools.

This is a mutating navigation operation, but it does not launch Chrome, create tabs, click, type, scroll, or wait for SPA/network/visual readiness. Completion means the selected target emitted the document `Page.loadEventFired` event. It has a fixed private 30-second timeout and honors Pi cancellation; transport, event listeners, and timers are cleaned up on success, failure, timeout, and cancellation. CDP navigation errors and download responses fail natively.

A successful result contains the requested URL, completion mode, duration, selected target metadata, and the target id. Use that id for a follow-up screenshot:

```json
{"url":"https://example.com","titleContains":"Example"}
```

Then:

```json
{"targetId":"<target id returned by go_to_page>"}
```

The extension returns bounded summaries and never exposes credentials, raw CDP payloads, or `webSocketDebuggerUrl`. Local/private HTTP(S) destinations remain allowed because navigation controls an existing user browser; no new private-network policy is introduced. Default screenshots are saved under `.pi/browser-screenshots/` in the current workspace. Pi's default tool rendering remains in use.
