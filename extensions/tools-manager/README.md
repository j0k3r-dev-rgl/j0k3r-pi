# Tools & Extensions Manager (`tools-manager`)

## Overview

`tools-manager` is a global interactive Pi extension providing a centered TUI modal (`/extension`, `/tools-manager`, or `Alt+E`) to manage project-local opt-in extensions stored in `<project-cwd>/.pi/extensions.json`. It requires interactive TUI mode (`ctx.mode === "tui"`); in non-TUI modes it warns and exits without opening the modal.

## Controls & Commands

- **Commands:** `/extension`, `/tools-manager`, and internal reload bridge `/tools-manager-reload` (invoked automatically after saving when opened via `Alt+E`).
- **Shortcut:** `Alt+E`
- **Modal controls:** `↑`/`↓` or `j`/`k` (navigate), `Space`/`Enter` (toggle), `s`/`S` (save), `q`/`Esc` (cancel/close), `Tab`/`Shift+Tab` (cycle), left-click (select/toggle/actions), with ANSI-aware wrapping on narrow viewports.

## Supported Opt-In Extensions

The manager supports toggling 9 workspace extensions:
1. `browser-screenshot`: Browser CDP, tabs & screenshots
2. `youtube-research`: YouTube search & transcripts
3. `api-tools`: REST, GraphQL & Swagger tools
4. `workspace-services`: Service runner & process manager
5. `utils`: System screenshot & audio tools
6. `context7`: Context7 documentation & tools
7. `websearch`: Web search tools
8. `pdf-review`: PDF inspection & text review
9. `codegraph`: CodeGraph semantic exploration & index management

## Persistence & Foreign Key Preservation

Configuration is loaded from and persisted to `<project-cwd>/.pi/extensions.json` as a JSON object (`Record<string, boolean>`). When saving changes, any unrelated or foreign keys already present in `.pi/extensions.json` are strictly preserved.

## Safe Deferred Reload Guard

When configuration is saved, `tools-manager` checks whether an immediate session reload is safe:
1. It queries `supervisor:reload-guard:v1` on Pi's shared `EventBus` (`pi.events`). If an active supervisor reports in-flight mutating effects or active subagents, reload is deferred.
2. It queries the subagent history store (`subagents-history.sqlite`, resolved via `PI_SUBAGENTS_HISTORY_DB_PATH`, `PI_SUBAGENTS_HISTORY_HOME`, or `XDG_DATA_HOME`) for any tasks in `'queued' | 'running' | 'stopping'` status for the current directory.
3. If active background workers or unsettled supervisor effects exist, `.pi/extensions.json` remains saved on disk and reload is deferred with a clear TUI notification until active workers finish, preventing unexpected task cancellation via `session_shutdown(reason: "reload")`.

## Validation

```bash
node --test extensions/tools-manager/test/modal.test.ts
```
