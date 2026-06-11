# Pi Sidebar Extension

Project-local Pi extension that shows a persistent HUD-style sidebar overlay with live project context.

## Usage

- The sidebar auto-opens when a Pi session starts.
- Toggle it with:

```text
/sidebar
ctrl+.
```

- The overlay title shows `ctrl+. toggle` so the activation/deactivation shortcut is visible.
- The overlay is non-capturing and anchored at the top-right, following the `pi-hud` style.

## Sections

### Subagents

Shows recent subagent activity in a compact `pi-hud`-style status block.

Behavior:

- Displays the status line:

```text
N run · M done · K err · C cnl
```

- If one or more subagents are running or queued, it shows only those active subagents.
- If no subagents are active, it shows recently completed/failed/cancelled subagents from the last 20 minutes.
- Completed rows use compact terminal markers, for example:

```text
✓ discovery · ◷ 1m0s
✗ verify · ◷ 15s
⊘ planner · ◷ 12s
```

- The sidebar does not require the Subagents extension to be installed. Subagent data is optional and fail-closed:
  - compatible provider data is used when available;
  - compatible global history data may be read from `$XDG_DATA_HOME/pi/subagents/subagents-history.sqlite` or `~/.local/share/pi/subagents/subagents-history.sqlite` when available;
  - `PI_SUBAGENTS_HISTORY_DB_PATH` and `PI_SUBAGENTS_HISTORY_HOME` overrides match the Subagents extension;
  - missing provider/history support renders an unavailable/idle state without crashing.

### Agent Todo

Shows the current active agent todo when the optional Agent Todo extension exposes a compatible provider.

Behavior:

- Uses only the optional provider/adapter contract.
- Fails closed when the provider is absent, inactive, throws, returns `null`, or returns invalid/unsupported data.
- Does not parse session history or `agent_todo` tool results independently.
- Omits the Todo section entirely when no valid active todo is available.

### GitLens

Shows the current repository and branch plus a compact list of changed files.

Behavior:

- Uses read-only Git commands only.
- Expands untracked directories into internal files using:

```bash
git status --porcelain=v1 -z --untracked-files=all
```

- Shows changed files ordered by most recent filesystem modification first.
- Displays up to 15 files.
- If more files exist, it shows a summary row:

```text
+N more files
```

- File rows keep the filename on the left and line counts aligned to the right edge:

```text
render.ts                         +178 -0
permissions.json                   +26 -26
```

- For new/untracked files where Git numstat has no data yet, the sidebar reads the file and counts its lines as additions.

## Validation

Run from this directory:

```bash
npm test
npm run typecheck
```
