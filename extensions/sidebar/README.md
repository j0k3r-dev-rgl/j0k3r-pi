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
subagents.json                     +26 -26
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

Extensión de Pi que muestra una sidebar persistente estilo HUD con contexto vivo del proyecto. En este checkout de agent-dir vive en `extensions/sidebar`; cuando se copia a una configuración Pi local de proyecto, la ruta equivalente es `.pi/extensions/sidebar`.

### Uso

- La sidebar se abre automáticamente cuando inicia una sesión Pi y hay soporte de UI custom disponible; si no, falla de forma cerrada.
- Se alterna con:

```text
/sidebar
ctrl+.
```

- El título del overlay muestra `ctrl+. toggle` para que el atajo de activación/desactivación sea visible.
- El overlay no captura input y está anclado arriba a la derecha, siguiendo el estilo `pi-hud`.
- El ancho del overlay es de 42 columnas y se oculta en terminales con menos de 90 columnas.
- Cuando tiene foco, `q` o `Esc` ocultan la sidebar.

### Secciones

#### Current Chat

Muestra el título runtime/sesión actual. Si no hay título disponible, la sección usa `Current Chat` como fallback.

#### Subagents

Muestra actividad reciente de subagentes en un bloque compacto estilo `pi-hud`.

Comportamiento:

- Muestra la línea de estado:

```text
N run · M done · K err · C cnl
```

- Si uno o más subagentes están corriendo o en cola, muestra solo esos subagentes activos.
- Si no hay subagentes activos, muestra subagentes completados/fallidos/cancelados en los últimos 20 minutos.
- Las filas completadas usan marcadores terminales compactos, por ejemplo:

```text
✓ discovery · ◷ 1m0s
✗ verify · ◷ 15s
⊘ planner · ◷ 12s
```

- La sidebar no requiere que la extensión Subagents esté instalada. Los datos de subagentes son opcionales y fail-closed:
  - usa datos de provider compatible cuando están disponibles;
  - puede leer historial global compatible desde `$XDG_DATA_HOME/pi/subagents/subagents-history.sqlite` o `~/.local/share/pi/subagents/subagents-history.sqlite` cuando existe;
  - `PI_SUBAGENTS_HISTORY_DB_PATH` y `PI_SUBAGENTS_HISTORY_HOME` coinciden con los overrides de la extensión Subagents;
  - sin provider/historial compatible, renderiza `subagents unavailable` o `no recent activity` sin crashear; `subagents idle` queda reservado para un modelo compatible listo pero vacío.

#### Agent Todo

Muestra el todo activo actual del agente cuando la extensión opcional Agent Todo expone un provider compatible.

Comportamiento:

- Usa solo el contrato opcional de provider/adapter.
- Falla de forma cerrada cuando el provider está ausente, inactivo, lanza error, devuelve `null` o devuelve datos inválidos/no soportados.
- No parsea independientemente historial de sesión ni resultados de la tool `agent_todo`.
- Omite completamente la sección Todo cuando no hay un todo activo válido.

#### Git

Muestra el repositorio y branch actuales más una lista compacta de archivos modificados.

Comportamiento:

- Usa solo comandos Git read-only.
- Expande directorios untracked a archivos internos usando:

```bash
git status --porcelain=v1 -z --untracked-files=all
```

- Muestra archivos modificados ordenados por modificación más reciente en el filesystem.
- Muestra hasta 15 archivos.
- Si hay más archivos, muestra una fila resumen:

```text
+N more files
```

- Las filas mantienen el nombre de archivo a la izquierda y los conteos de líneas alineados a la derecha:

```text
render.ts                         +178 -0
subagents.json                     +26 -26
```

- Para archivos nuevos/untracked donde Git numstat todavía no tiene datos, la sidebar lee el archivo y cuenta sus líneas como additions.
- El nombre de repositorio cae al basename del worktree cuando la metadata Git no está disponible.
- Detached HEAD se renderiza como `detached@<shortsha>`.

### Cadencia de refresco

La sidebar refresca secciones de forma independiente:

- chat actual y todo: cada 1 segundo;
- subagentes: cada 1.5 segundos;
- git: cada 4 segundos.

### Validación

Ejecutar desde este directorio:

```bash
npm test
npm run typecheck
```
