# Pi Subagents Extension (`pi-subagents-j0k3r`)

Extensión de Pi para delegar tareas a subagentes definidos en Markdown, con sesiones anidadas independientes, historial y ejecución en primer o segundo plano. Expone **una sola herramienta: `subagent_run`**. El panel `/subagents`, el widget y los controles manuales permanecen disponibles.

## Una herramienta, tres operaciones

El campo `task` contiene las instrucciones en las tres operaciones. `action` es opcional y, si se omite, equivale a `run`; las llamadas existentes con `agent` y `task` siguen funcionando.

| `action` | Parámetros específicos | Comportamiento |
|---|---|---|
| `run` | `agent` obligatorio; `name`, `display_name`, `context`, `mode` opcionales | Inicia exactamente una tarea nueva. |
| `continue` | `task_id` obligatorio; `mode` opcional | Reanuda una tarea terminada en su misma sesión anidada. Requiere `enable_continue: true`. |
| `message` | `task_id` obligatorio | Encola instrucciones para una tarea en background activa, propiedad de esta sesión padre. No depende de `enable_continue`. |

No se infiere la operación del estado de la tarea. Un mensaje tardío se rechaza; **nunca se convierte automáticamente en una continuación**. `task_id` no se acepta en `run`; `agent`, `name`, `display_name` y `context` no se aceptan en `continue` ni `message`. `message` no acepta `mode`. Las instrucciones vacías y las combinaciones contradictorias devuelven errores explícitos.

### Iniciar una tarea

```json
{
  "agent": "analyst",
  "task": "Revisa el código y documenta los hallazgos",
  "display_name": "Revisión de seguridad"
}
```

El modo nuevo se resuelve como `input.mode ?? definition.subagent_mode ?? config.default_mode`, con fallback built-in `task`. El orquestador debe omitir `mode` salvo que el usuario pida explícitamente `task` o `background`.

- **`task`:** espera y devuelve la respuesta completa; muestra progreso en vivo. Se puede enviar a background con el atajo configurado (por defecto `ctrl+h`) o cancelar con doble Escape.
- **`background`:** devuelve inmediatamente `task_id` y libera el chat. El acuse incluye intento, modelo/esfuerzo conocidos y sesión ejecutora cuando ya existe; los valores pendientes se muestran como `unresolved`, no como una selección confirmada. Al finalizar, fallar o cancelarse, la sesión principal recibe una notificación automática con el resultado completo. No hay que dormir ni sondear para esperar.

Las definiciones se cargan al invocar la herramienta. Un agente desconocido produce un error que enumera los agentes actualmente disponibles, incluidas sus descripciones; no existe una herramienta separada para listarlos.

### Continuar una tarea terminada

```json
{
  "action": "continue",
  "task_id": "subtask_analyst_...",
  "task": "Continúa con la corrección aprobada"
}
```

- Conserva el ID, la sesión `.jsonl`, el contexto anterior y el nombre visible; incrementa `attempt`.
- Admite tareas `completed`, `failed`, `cancelled` e `interrupted`. Si está en `stopping`, espera la limpieza del intento anterior. Rechaza tareas `queued` o `running` y sesiones inexistentes.
- El modo se resuelve como `mode` explícito, `effective_mode` anterior, `mode` anterior, `default_mode` y finalmente `task`.
- `enable_continue` se lee de la configuración efectiva en cada llamada. Si está deshabilitado, devuelve un error explicativo sin ejecutar otro intento. La herramienta y su esquema permanecen registrados; los errores y notificaciones no recomiendan continuar cuando está deshabilitado.
- Si falla el primer intento y la continuación está habilitada y es segura, el mensaje indica al orquestador reintentar una sola vez con `action: "continue"` y el mismo `task_id`, sin preguntar. Si falla el segundo intento o uno posterior, debe detenerse e informar al usuario; otro reintento requiere aprobación explícita. No debe iniciar otra tarea para reiniciar este límite. Es una instrucción al orquestador, no un bucle automático del runner.
- Las tareas canceladas, interrumpidas o en proceso de detenerse no se reanudan automáticamente. Modelo y esfuerzo se resuelven de nuevo en cada intento según el asignador o el fallback al orquestador, con prioridad del esfuerzo definido en el Markdown; no se ofrecen elecciones manuales ni se admiten overrides en la llamada.

### Enviar instrucciones en vivo

```json
{
  "action": "message",
  "task_id": "subtask_reviewer_...",
  "task": "Incluye también el análisis de auth.ts"
}
```

Solo la **sesión padre originaria exacta** puede enviar mensajes a su tarea en background mientras está `running`. Requiere steering soportado por Pi `>=0.82.1`. Puede aceptar mensajes antes de que el puente esté listo; el puente los procesa al inicializarse.

- `queued` confirma aceptación en la cola, **no consumo por el modelo**.
- `pending_message_count` indica mensajes pendientes; los no consumidos al terminar pasan a `undelivered_message_count`, sin reproducirse en otro intento.
- Límites: 16 mensajes pendientes, 16 KiB UTF-8 por mensaje y 64 KiB pendientes en total.
- Las negativas incluyen motivo estructurado, como `not_owner`, `not_running`, `unsupported_runtime` o `queue_count_limit`, y se marcan como error de herramienta.
- El texto de los mensajes permanece en el detalle de la tarea propietaria; los resúmenes y notificaciones no lo reproducen.

### Reportes informativos sin detener el trabajo

Para pedir progreso a un subagente en background, el padre usa el canal existente, sin otra tool pública:

```json
{
  "action": "message",
  "task_id": "subtask_analyst_...",
  "task": "Send a concise progress report with report_orchestrator, then continue the assigned work without waiting for a reply."
}
```

El acuse `queued` sigue indicando solo aceptación, no que el hijo ya haya leído la petición. Al consumirla, el hijo puede llamar a la tool interna `report_orchestrator({ report: "..." })`: recibe un acuse de envío y continúa en el mismo intento, sin esperar respuesta del padre. La notificación `subagent-report` llega al contexto del orquestador y a la TUI con identidad/intento, vista compacta y expansión nativa; no es un resultado final, aceptación, permiso ni una pregunta pendiente. No requiere contestar ni autoriza avanzar fases. El padre puede informar al usuario y esperar la notificación final sin sondear ni reenviar peticiones periódicamente.

El runner inyecta la tool solo cuando hay transporte al padre para una tarea iniciada en background y una identidad padre disponible; no hace falta añadirla al Markdown. No está disponible en ejecuciones iniciadas en modo `task` (incluido un traspaso posterior a background). No se cambia de modo para habilitarla. El callback queda vinculado al intento y sesión padre: al terminar/cancelarse, cambiar de sesión o reanudarse otro intento, el callback anterior ya no puede entregar reportes. No depende de `enable_continue`. Cada reporte admite hasta 16 KiB UTF-8; se rechazan vacíos/excesos sin truncar, y el transporte aplica la sanitización existente. No incluyas secretos, transcripciones ni datos privados ajenos. El acuse confirma el envío al runtime padre, no que el modelo padre lo haya leído. Un fallo de envío se informa al hijo sin crear una espera de respuesta ni terminar automáticamente su trabajo.

`report_orchestrator` es para información solicitada, no para ocultar bloqueos: si falta una decisión necesaria, se mantiene el canal `ask_orchestrator` y sus límites. Ambas tools existen solo en la sesión hija; el orquestador conserva únicamente `subagent_run` como tool pública de esta extensión.

### Preguntas del hijo al orquestador

En tareas en background, cuando existe el manejador de preguntas del padre, el manager inyecta dinámicamente `ask_orchestrator` como herramienta local del hijo: no necesita aparecer en `tools:` del Markdown. El hijo espera la respuesta en la misma sesión; el padre contesta con `subagent_run action: message`, que devuelve `answered` en vez de encolar steering. La propiedad de la sesión padre sigue siendo obligatoria y cancelar la tarea rechaza la espera pendiente.

En modo `task` no se ofrece esta herramienta: el padre está esperando el resultado. Si falta una decisión material, el hijo devuelve `BLOCKED`; no debe suponerse que añadir el nombre a la allowlist habilita el canal ni cambiar de modo sin respetar la elección del usuario. Una aclaración factual no autoriza ampliar alcance o modificar configuración.

## Historial, resultados y render

La herramienta devuelve el resultado completo al orquestador, independientemente de la expansión visual. Las notificaciones finales de background incluyen también intento, modelo/esfuerzo conocidos y la identidad de sesión anidada cuando está disponible, para poder atribuir implementación y verificación sin recuperar el transcript. El historial SQLite conserva resultados y eventos por workspace (`cwd`); la sesión anidada conserva su conversación. El preview de actividad está acotado, no el resultado final.

El render de herramientas (`subagent_run`, tools inyectadas `ask_orchestrator`/`report_orchestrator` y replay anidado) sigue el contrato compacto sin tarjetas (`compactToolRenderingVersion: 1`, `compactLeftMargin: 1`, `renderShell: "self"`): ajuste automático de línea consciente de ANSI al exceder el ancho disponible (sin recorte con puntos suspensivos `…`) en cabeceras colapsadas, cuerpos expandidos, filas del panel `/subagents` y widget de background (manteniendo una sola fila fija únicamente en barras HUD), exactamente 1 columna vacía de margen izquierdo en cada línea generada (con la excepción de ancho 2 para grafemas anchos), texto plano expandido con el color atenuado del tema (`theme.fg("muted", ...)` / fallback `#7aa7b8`, preservando colores ANSI en código, diffs, títulos, avisos y errores), bloque literal de comando de `bash` en replay anidado/fallback (preservando sangría, espacios, tabs, líneas en blanco, CR/CRLF y saltos de línea reales en naranja/ámbar con ajuste suave sin recortar ni colapsar espacios) y visualización veraz del timeout de `bash` (`timeout Xs` con tiempo transcurrido/restante en ejecución si está definido, o `no timeout` en el fallback de `subagents` cuando se omite). Sin marco de tarjeta encerrante (sin bordes superior/inferior/verticales, filas vacías arriba/abajo, relleno derecho ni relleno de fondo) y sin pistas visibles de expansión; los separadores inline cortos `─` alrededor de una cabecera compacta sí están permitidos y son deseables. La expansión nativa muestra completa la respuesta o error disponible. La expansión de filas en la transcripción principal pertenece al atajo/clic nativo de Pi (`app.tools.expand`), sin abrir el panel `/subagents` al hacer clic sobre la fila. Los mensajes en vivo muestran su acuse, la notificación de finalización en background (`subagent-completion`) sigue la presentación compacta con el mismo margen izquierdo de 1 carácter, ajuste automático sin recorte, texto plano expandido atenuado, sin marco ni pistas y sin campos de cabecera duplicados, y el panel `/subagents` abre rápido con índice compuesto SQLite, carga por ventanas, hidratación perezosa de la tarea seleccionada, render incremental del viewport y refresco guiado por eventos sin sondeo ciego cuando está inactivo.

## Compact Tool Rendering & Panel Contracts (v1)

Pinned owner contract for `compact-tool-rendering` (`MINI-001`) as amended by `tui-rendering-and-subagents-lazy-load` (`MINI-001`: decisions D1, D2, D3, and D4 Option A), using installed Pi `1.5.2` `ToolRenderContext` and `ToolRenderResultOptions` directly without sibling extension imports.

### Tool & Nested Replay Conformance
- **Marker & Slots**: `subagent_run`, child-injected `ask_orchestrator`/`report_orchestrator`, and compliant external/nested definitions declare `compactToolRenderingVersion: 1` (presentation metadata only) with `renderShell: "self"` and exception-safe `renderCall` + `renderResult` slots, plus `compactLeftMargin: 1` on `subagent_run`, `ask_orchestrator`, and `report_orchestrator` (and their rendered components) so the 1-character left margin is emitted once without doubling in host or nested replay.
- **Automatic Line Wrapping Without Ellipsis Clipping, One-Column Left Margin & Lossless Expansion (D2 — Supersedes Prior Single-Line Clipped-Header Rule)**: Replaces the prior single-line clipped-header rule. Every tool state (`run`, `continue`, `message`, `background`, partial, error, cancelled), `inlineComponent`, `subagent-completion`, nested replay `compactToolRow`/`compactToolResultRow`, `subagents-history-panel` sidebar/detail/flow rows, and `background-widget` rows wraps automatically ANSI-aware across multiple lines on terminal-width overflow without ellipsis (`…`) clipping or dropping trailing characters, while keeping fixed single-row layouts solely in HUD bars (`pihud`, `j0k3r-theme` header/footer/editor bars, `agent-todo` HUD widget, `orchestrator-supervisor` HUD widget, `cpamc-usage` HUD). Tool rows and `subagent-completion` retain one leading blank column (`" "`) on every generated line in collapsed and expanded views except at total width 2 on a line where omitting it is necessary to fit an intact two-column grapheme (memories 816/817; superseding earlier no-perimeter-padding wording solely for this single leading column; no enclosing card frame `╭╮╰╯│` or `┌┐└┘`, no blank vertical row above/below, no right padding, no background SGR fills, and no expansion hints in tool rows or panel chrome). Short inline `─` separators around compact headers are allowed and desirable. Margined content lays out within `Math.max(0, width - 1)` via ANSI-aware wrapping (`width <= 0` emits `[]`; `width === 1` renders `" "` for non-empty blocks without overflow or ANSI leakage). Wrapped rows in `subagents-history-panel` and `background-widget` must preserve accurate visual-row hit-testing, click-target mapping, keyboard selection, and scroll bounds rather than assuming 1 row per item. Native `app.tools.expand` and fullscreen click expand `subagent_run` natively without redirecting clicks to open `/subagents`. Expanded views preserve all available returned/retained text in order, safe metadata, continuation/artifact references, and native image handling.
- **Muted Foreground for Plain-Text Expanded Bodies (D1)**: Plain-text expanded bodies in `subagent_run`, `ask_orchestrator`, `report_orchestrator`, `subagent-completion` (replacing plain white `customMessageText` on plain response/error/fallback lines), and `thread-view` fallback rows render with the active theme muted token `theme.fg("muted", ...)` (via `themeFg(theme, "muted", ..., MUTED)` with `#7aa7b8` fallback when theme is absent or mocked), while preserving existing ANSI foreground colors on syntax-highlighted code, diffs, headings, status badges, warnings, and error labels.
- **Local Replay Fallback, Verbatim Bash & Truthful Bash Timeout Display (D4 Option A & Memory 816)**: Nested replay (`thread-view.ts`, `panel-overlay.ts`) applies this policy locally without requiring `j0k3r-theme`: marked (`compactToolRenderingVersion: 1`) renderers keep specialized details; unmarked, throwing, absent-runtime/component, orphan `tool_result`, and legacy bash-snapshot entries use safe compact unboxed fallbacks with automatic wrapping without ellipsis clipping. Nested replay applies the 1-column left margin once only when the resolved definition/component lacks `compactLeftMargin: 1` (and on all fallback rows), never double-indenting. Nested replay `bash` rows (both marked `bash` and the `compactToolRow` unavailable-component fallback, including legacy `SubagentBashItem` adapted as `bash`) render the complete command verbatim as authored — preserving original leading/trailing spaces, mixed indentation, tabs (native visual display width only), consecutive blank lines, internal/trailing newlines, standalone CR and CRLF characters (splitting only on `\n`, never stripping `\r`), quotes, backslashes, and literal `\n` in existing orange/amber foreground, soft-wrapping long lines at `width - 1` without trimming, whitespace collapsing, synthetic continuation indentation, clipping, preview slicing, or ellipsis — while keeping concise inline identity/status and lossless output expansion.
  - **Truthful Per-Surface Timeout Status (D4 Option A)**: Display-only with zero snapshot or execution mutation. In `thread-view.ts` `compactToolRow` (and legacy `SubagentBashItem` adapter when timeout is present), always display bash timeout status: show `timeout Xs` (plus elapsed and remaining time when running and timing metadata is present) when `arguments.timeout` is a positive number, or truthfully show `no timeout` when `arguments.timeout` is omitted or non-positive. Consistent with the paired `extensions/j0k3r-theme/README.md` contract, `powershell` (`PS>`) likewise displays `no timeout` when omitted, whereas `j0k3r-theme` main `bash` (`$`) truthfully displays `timeout 120s (default)` with elapsed/remaining while running (matching `applyBashTimeout` / `DEFAULT_BASH_TIMEOUT_SECONDS = 120` in `extensions/j0k3r-theme/src/tools/index.ts`). Existing outer panel frame, thinking toggle, cancel, and navigation controls remain intact; detail-pane tool rows are unboxed.

### Approved Custom-Message Notification Contract
- **Scope**: Explicitly replaces the earlier non-tool completion-message exclusion for `subagent-completion` only (`git-sync-awareness` is covered under the same amendment in its owner/theme host contract; `subagent-report` and outer panel chrome remain outside tool-row restyling).
- **`subagent-completion` Presentation**:
  - **One-Column Left Margin**: Every generated line (collapsed and expanded) starts with one leading blank column (`" "`), except where needed at total width 2 to fit an intact wide grapheme, laying out content normally in `Math.max(0, width - 1)` (`width <= 0` emits zero cells; `width === 1` emits `" "` without overflow or ANSI leakage), with no blank vertical rows above/below and no right padding.
  - **Collapsed**: Automatic ANSI-aware wrapped header (no ellipsis clipping) with friendly task identity (`display_name` / `agent`), status, and useful `model`/`effort`/`attempt` summary, with each generated header field appearing once rather than a title row plus a duplicate metadata row. Preserves existing foreground/status palette.
  - **Expanded**: Unboxed and background-free, wrapping all available final response or error text and applicable already-sanitized error metadata without preview slicing, rendering plain response/error/fallback lines with `theme.fg("muted", ...)` (`#7aa7b8` fallback) rather than plain white `customMessageText` while preserving existing ANSI colors on headings, diffs, syntax-highlighted blocks, status badges, and error labels, and showing useful metadata without repeating generated header fields. Empty, missing, or legacy details use a safe content fallback without inventing results or revealing private details.
  - **No Frames, Backgrounds, or Hints**: Emit no enclosing borders (`┌┐└┘╭╮╰╯│`), blank vertical perimeter rows, right padding, background SGR fills, or generated expansion/collapse hints (`to expand`, `to collapse`, `ctrl+o`, `app.tools.expand`) in either state; short inline `─` separators are allowed. Returned components must avoid Pi `CustomMessageComponent`'s default boxed fallback. Literal response text containing box characters or hint-like words remains data.
  - **Width & Safety**: Positive widths wrap and fit via ANSI-aware helpers without ellipsis clipping including CJK/combining/emoji (`width <= 0` emits zero cells, `width === 1` emits `" "`). Preserves `completionMessage`, `sendSubagentCompletionMessage`, steering/turn delivery, `task_id`/attempt/executor attribution, continuation guidance, and error-metadata redaction unchanged.

### Active-First Ordering & Selection Identity
- **Group Ordering**: UI-facing task lists (`manager.ts`, panel, background widget) group active tasks (`queued`, `running`) ahead of terminal tasks (`completed`, `failed`, `cancelled`, `interrupted`), preserving existing `createdAt` DESC then binary `id` DESC ordering within each group (no invented `running`-vs-`queued` priority).
- **Task-ID Continuity**: Panel selection, scroll/follow-tail, expansion state, keyboard/mouse navigation, and cancellation bind strictly to stable `task_id` across live status changes, reordering, and windowed metadata expansion, never to stale list indexes.

### Subagents History Performance, Lazy Loading, Viewport Rendering & Event-Driven Refresh (D3)
- **Additive SQLite Composite Index**: `ensureHistoryDb` (`src/history.ts`) idempotently creates `idx_subagent_tasks_cwd_session_created` on `subagent_tasks(cwd, session_id, created_at DESC, id DESC)` via `CREATE INDEX IF NOT EXISTS`, preserving full compatibility with existing SQLite databases without destructive migrations so `EXPLAIN QUERY PLAN` uses the index for session metadata listing without full table scan or temporary B-tree sort.
- **Windowed On-Demand Metadata Loading**: Opening `SubagentsHistoryPanel` with many persisted tasks (e.g., 200+ tasks across sessions) loads only an initial lightweight metadata window plus active tasks and expands windows transparently as the user navigates or scrolls down, preserving active-first ordering and stable `task_id` continuity.
- **Lazy Selected-Task Hydration & Bounded LRU Cache**: Non-selected tasks are never eagerly hydrated via `getTask`; selecting/displaying a task hydrates its full record and thread snapshot on demand, caches it in a bounded LRU map, and invalidates cleanly on task updates, attempt changes, or panel close. Sidebar list metadata and elapsed-duration ticks never hydrate or reconstruct unrelated threads.
- **Incremental Viewport-Only Thread Rendering & Content-Fresh Caching**: Opening or scrolling a task with a large thread snapshot (e.g., 150–200 items) constructs and renders only the items needed for the active viewport window (including follow-tail bottom window and incremental expansion on scroll up/down or page jump) rather than eagerly building all items up front. Rendered item lines are cached and reused across unchanged frames while cache keys cover all visible body inputs (content, tool arguments/results/errors, metadata, attempt, theme, width, image settings, expansion/thinking state, live active tools, resolved renderer)—not item count or timestamps alone—so same-length and equal-timestamp mutations invalidate immediately while preserving click targets and `task_id` resolution.
- **Event-Driven Refresh (Zero Idle Polling)**: `panel-overlay.ts` replaces unconditional 1-second `setInterval` polling with `manager.onTaskUpdate` subscription plus conditional live ticking only while active (`queued`, `running`, `stopping`) tasks exist. When all visible/session tasks are terminal and no task update or user input arrives, `panel-overlay` triggers zero periodic `tui.requestRender()` calls; when an active task exists or `manager.onTaskUpdate` fires, the panel refreshes promptly and releases all listeners and timers on close or reload.
- **Test & Baseline Scope**: Existing tests asserting single-line clipped headers or ellipsis truncation on tool rows, `subagent-completion`, `subagents-history-panel`, or `background-widget` (or plain-white expanded bodies) are updated under `UNIT-SUBAGENTS` (`MINI-003`, `MINI-004`) while retaining payload/delivery, continuation, safe-error, redaction, width-fit, margin, width-2 wide-grapheme, and verbatim bash CR/CRLF regressions. Pre-apply baseline under Node `v24.22.3`: `npm run typecheck` passes (`tsc --noEmit`) and `node --experimental-strip-types test/compact-panel-benchmark.mjs` completes all 7 scenarios and 5 freshness checks (`active1Marked` coldOpen median `2.103ms` / 30 assistant + 30 tool constructions; warmFrame median `0.329ms`; zero non-selected hydration reads); `MINI-003` and `MINI-008` extend the benchmark with many-subagents / large-snapshot viewport and idle-refresh measurements.

El modelo no tiene tools separadas de consulta, resultados ni cancelación. El usuario conserva el historial y la cancelación en `/subagents`; los entregables persistidos pueden leerse con `read`. Tras compactar contexto, no se garantiza recuperación programática de resultados históricos arbitrarios sin un artefacto o una continuación habilitada; continuar ejecuta un nuevo intento y no equivale a leer un resultado almacenado.

## Definiciones de subagentes

Se cargan desde `agents/*.md` y `subagents/*.md` bajo el directorio global de Pi (`$PI_CODING_AGENT_DIR` o `~/.pi/agent`), y desde `.pi/agents/*.md` y `.pi/subagents/*.md` del proyecto. Las definiciones del proyecto tienen prioridad; dentro de un mismo ámbito, `subagents` tiene prioridad sobre `agents`.

```markdown
---
name: analyst
description: Revisa código y documenta hallazgos
tools:
  - read
  - bash
subagent_mode: background
---

# Analyst
Lee únicamente el alcance asignado y documenta la evidencia.
```

`tools` es una allowlist y acepta comodines sobre herramientas activas del padre. Las herramientas `subagent_*` están bloqueadas en las sesiones anidadas: los subagentes no pueden delegar entre sí. Las modificaciones Markdown se leen en la siguiente ejecución.

## Configuración

La configuración de `.pi/subagents.json` del proyecto sobrescribe los campos presentes en `$PI_CODING_AGENT_DIR/subagents.json` o `~/.pi/agent/subagents.json`. Los campos ausentes heredan el valor global y luego el default built-in. La extensión actual lee la configuración local sin una comprobación adicional de confianza; úsala solo en proyectos confiables.

| Campo | Default built-in | Propósito |
|---|---|---|
| `default_mode` | `"task"` | Modo cuando no lo especifican llamada o definición. |
| `enable_continue` | `false` | Habilita únicamente `action: "continue"`; no bloquea `message`. |
| `timeout_ms` | `1200000` | Tiempo máximo por tarea. |
| `stall_timeout_ms` | `240000` | Límite de inactividad. |
| `max_concurrency` | `5` | Ejecuciones simultáneas máximas. |
| `session_resources` | `"lean"` | Aislamiento del prompt de la sesión anidada. |
| `debug` | `false` | Logs en `.pi/subagents-debug.log` del workspace ejecutor. |
| `history_panel_shortcut` | `"ctrl+,"` | Abrir historial. |
| `detail_cancel_shortcut` | `"x"` | Cancelar la tarea seleccionada. |
| `background_handoff_shortcut` | `"ctrl+h"` | Enviar primer plano a background. |

El modo lean carga herramientas permitidas y hooks de seguridad, sin inyectar contexto o skills globales. No se necesitan credenciales adicionales para esta herramienta: se utilizan los proveedores del runtime padre. No publiques secretos en definiciones, instrucciones ni logs.

## Integraciones y ciclo de vida

La extensión funciona independientemente de otras extensiones. Cuando existe un asignador (como `orchestrator-supervisor`), el manager emite `subagents:task:allocate` tanto para tareas nuevas como para continuaciones; cada intento vuelve a solicitar asignación. Ante un fallo elegible de proveedor/modelo (excluyendo cancelación o timeout total), el manager emite `subagents:task:failover`: si el asignador devuelve otro modelo del pool, actualiza modelo/esfuerzo y continúa la ejecución automáticamente sobre `nested_session_path` (o reintenta la tarea si aún no existía sesión). Sin asignador o si no hay más modelos disponibles, usa el modelo/esfuerzo del orquestador en el arranque o falla normalmente en el failover. Al terminar emite `subagents:task:terminal`.

El supervisor puede seguir observando `subagent_run`, los eventos y SQLite sin depender de las tools eliminadas. El historial, widget y controles manuales usan directamente el manager. Al cerrar la sesión se drenan tareas y recursos; las tareas huérfanas se reconcilian como interrumpidas sin volver a emitir resultados de background.

Si la extensión opcional `pihud` está presente, el widget de subagentes se oculta mientras el HUD de esa sesión está visible y se reinstala al cerrarlo; el HUD es entonces la única lista de ejecuciones activas. Sin `pihud`, o si su puente falla, el widget funciona normalmente.

Después de actualizar el código, ejecuta **`/reload` o reinicia Pi** para retirar las tools viejas de la sesión y registrar el nuevo contrato. Cambiar `enable_continue` se aplica a la siguiente llamada; cambiar atajos requiere recargar.

## Validación del paquete

Desde el directorio de esta extensión, usando sus dependencias propias:

```bash
npm run check
```

Las pruebas cubren el contrato único, continuación, steering, límites/propiedad, cancelación, persistencia, notificaciones y render/replay. La comprobación visual final en la TUI requiere recargar la extensión.
