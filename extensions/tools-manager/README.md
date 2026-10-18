# Tools & Extensions Manager (`tools-manager`)

## Overview

`tools-manager` is a global interactive Pi extension providing a centered TUI modal (`/extension`, `/tools-manager`, or `Alt+E`) to manage project-local opt-in extensions stored in `<project-cwd>/.pi/extensions.json`.

## Supported Opt-In Extensions

The manager supports toggling 10 workspace extensions:
1. `browser-screenshot`: Browser CDP, tabs & screenshots
2. `youtube-research`: YouTube search & transcripts
3. `api-tools`: REST, GraphQL & Swagger tools
4. `workspace-services`: Service runner & process manager
5. `utils`: System screenshot & audio tools
6. `context7`: Context7 documentation & tools
7. `websearch`: Web search tools
8. `pdf-review`: PDF inspection & text review
9. `codegraph`: CodeGraph semantic exploration & index management
10. `typesafe`: TypeSafe System One (Jev) semantic AI evaluation

## Persistence & Foreign Key Preservation

Configuration is loaded from and persisted to `<project-cwd>/.pi/extensions.json` as a JSON object (`Record<string, boolean>`). When saving changes, any unrelated or foreign keys already present in `.pi/extensions.json` are strictly preserved.

## Safe Deferred Reload Guard

When configuration is saved, `tools-manager` checks whether an immediate session reload is safe:
1. It queries `supervisor:reload-guard:v1` on Pi's shared `EventBus` (`pi.events`). If an active supervisor reports in-flight mutating effects or active subagents, reload is deferred.
2. It queries the subagent history store (`subagents-history.sqlite`) for any tasks in `'queued' | 'running' | 'stopping'` status for the current directory.
3. If active background workers or unsettled supervisor effects exist, `.pi/extensions.json` remains saved on disk and reload is deferred with a clear TUI notification until active workers finish, preventing unexpected task cancellation via `session_shutdown(reason: "reload")`.
