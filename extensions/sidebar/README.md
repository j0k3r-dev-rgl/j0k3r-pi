# Pi Sidebar Extension

[English](#english) | [Español](#español)

## English

Pi extension that shows a persistent HUD-style sidebar overlay with live project context. In this agent-dir checkout it lives at `extensions/sidebar`; when copied into a project-local Pi setup the equivalent path is `.pi/extensions/sidebar`.

### Usage

- The sidebar auto-opens when a Pi session starts and custom UI support is available; otherwise it fails closed.
- Toggle it with:

```text
/sidebar
ctrl+.
```

- The overlay title shows `ctrl+. toggle` so the activation/deactivation shortcut is visible.
- The overlay is non-capturing and anchored at the top-right, following the `pi-hud` style.
- The overlay width is 42 columns and is hidden on terminals narrower than 90 columns.
- When focused, `q` or `Esc` hides the sidebar.

### Sections

#### Current Chat

Shows the current runtime/session title. If no title is available, the section falls back to `Current Chat`.

#### Subagents

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
  - missing provider/history support renders `subagents unavailable` or `no recent activity` without crashing; `subagents idle` is reserved for a ready-but-empty compatible model.

#### Agent Todo

Shows the current active agent todo when the optional Agent Todo extension exposes a compatible provider.

Behavior:

- Uses only the optional provider/adapter contract.
- Fails closed when the provider is absent, inactive, throws, returns `null`, or returns invalid/unsupported data.
- Does not parse session history or `agent_todo` tool results independently.
- Omits the Todo section entirely when no valid active todo is available.

#### Git

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
- Repository name falls back to the worktree basename when Git metadata is unavailable.
- Detached HEAD renders as `detached@<shortsha>`.

### Refresh cadence

The sidebar refreshes sections independently:

- current chat and todo: every 1 second;
- subagents: every 1.5 seconds;
- git: every 4 seconds.

### Validation

Run from this directory:

```bash
npm test
npm run typecheck
```

## Español

Extensión de Pi que agrega una sidebar persistente tipo HUD.

### Resumen

Sidebar muestra contexto vivo de la sesión en la TUI: chat actual, subagentes, checklist de Agent Todo y estado de git. Está pensada para ofrecer visibilidad sin pedir comandos adicionales.

### Capacidades

- Sección de chat actual.
- Estado de subagentes.
- Estado de Agent Todo.
- Estado git.
- Refresco periódico y validación por tests.

### Uso recomendado

Úsala como panel de observabilidad durante sesiones largas o multi-herramienta.

### Ver más

La sección en inglés documenta uso, secciones, cadencia de refresco y validación.
