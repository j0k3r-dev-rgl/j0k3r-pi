# CodeGraph for Pi

Global Pi extension exposing CodeGraph through four model-callable tools.

## Tools

- `codegraph_status` — read-only `codegraph status --json` for the selected project.
- `codegraph_explore` — read-only architecture, symbol, dependency, and call-flow exploration against an existing index. Identifier-like queries without an exact indexed match are marked as low-confidence fuzzy context.
- `codegraph_sync` — safe, unattended incremental refresh of an existing index; coalesces concurrent calls and briefly caches successful results.
- `codegraph_manage` — confirmation-gated lifecycle operations:
  - `init`: create `.codegraph/` and build the initial index;
  - `sync`: incrementally update an existing index;
  - `reindex`: rebuild the full index from scratch;
  - `unlock`: remove a stale indexing lock;
  - `uninit`: destructively delete `.codegraph/`.

## Authorization and safety

`codegraph_manage` requires an interactive Pi TUI confirmation for every operation. It displays the exact project, command, and impact before execution. In subagent, print, JSON, or RPC sessions it returns `BLOCKED` and does not execute; the subagent must ask the orchestrator to obtain user authorization. Agents must not bypass this gate with `bash`.

The extension never uses a shell: arguments are passed directly through `pi.exec`. `codegraph_status` and `codegraph_explore` are read-only; `codegraph_sync` only refreshes an existing index and never initializes one. No credentials are read.

## Output

Explore output is limited to Pi's standard 50KB/2000-line budget. Oversized full output is saved under a temporary `pi-codegraph-*` directory and the retrieval path is returned. Status, sync, and management results include structured `details`; successful management operations always finish by reading and returning status. Collapsed tool cards use Pi's configured `app.tools.expand` keybinding hint.

## Lifecycle

No daemon, watcher, socket, timer, or persistent child process is started. Each call launches the installed `codegraph` CLI and honors Pi cancellation.

## Activation

The extension is globally discovered from `~/.pi/agent/extensions/codegraph/index.ts` and is enabled when the trusted project's `.pi/extensions.json` contains `"codegraph": true`. Run `/reload`, then verify the tools with `/tools`.

## Development

The extension owns its package dependencies and test/typecheck environment; it does not resolve packages from sibling extensions.

```bash
cd extensions/codegraph
npm install
npm test
npm run typecheck
```
