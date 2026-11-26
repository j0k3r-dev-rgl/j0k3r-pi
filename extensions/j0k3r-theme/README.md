# j0k3r Theme Extension

[English](#english) | [Español](#español)

## English

Pi TUI theme extension providing custom interactive header, editor, and footer components, alongside the `arch-electric` color theme. In this agent-dir checkout it lives at `extensions/j0k3r-theme`; when copied into a project-local Pi setup the equivalent path is `.pi/extensions/j0k3r-theme`.

### What it provides

- **Interactive Header (`J0k3rThemeHeader`)**:
  - Displays project name, repository name (resolved via Git remote or directory name), and current Git branch.
  - Real-time detection and count of loaded skills and extensions (filtering opt-in extensions via `.pi/extensions.json`).
  - Selectable startup welcome banner supporting 4 styles: `default` (animated 3D Arch Linux emblem, `j0k3r-pi`), `mustache` (animated Pink Mustache, `mostachi-pi`), `cat` (animated Cyber Michi, `michi-pi`), and `oni` (static Neon Pink Oni, `oni-pi`).
  - Automatically plays on startup and cleanly hides upon user input or when the agent starts processing.
- **Welcome Banner Selector & `/banner` Command**:
  - Optional setting key `j0k3rTheme.welcomeBanner` in `.pi/settings.json` or `~/.pi/agent/settings.json` (flat or nested) accepting `"default"`, `"mustache"`, `"cat"`, or `"oni"`. When absent, unreadable, or unrecognized, it falls back to `"default"`.
  - Bundled ASCII/ANSI art: `default`, `mustache`, and `cat` animate across 60 frames (80 ms interval), while `oni` renders statically with no timer. Zero runtime image loading or conversions.
  - `/banner` command: switch banners dynamically during an active session:
    - `/banner`: opens an interactive TUI selector with options `default (Arch 3D Emblem)`, `mustache (Pink Mustache)`, `cat (Cyber Michi)`, and `oni (Neon Pink Oni)`.
    - `/banner <style>`: accepts canonical names and aliases (e.g. `arch`, `pink`, `michi`, `gato`, `gatito`, `mask`, `neon`, `demon`, `skull`).
    - Handles invalid arguments gracefully with a warning notification and fallback to interactive selection.
    - Updates the active header immediately, **persists the selection to `~/.pi/agent/settings.json`**, and notifies via `ctx.ui.notify` without requiring a Pi restart.
- **Responsive Footer (`J0k3rThemeFooter`) & CLIProxyAPI Quotas**:
  - Multi-tier adaptive layout that gracefully scales across wide and narrow terminal viewports, with live `.git/` watching (`fs.watch`) plus refresh on `tool_execution_end` (`bash`/`user_bash`) and `turn_end`.
  - Shows Git repository and branch, current model, token counts, context window usage progress bar, thinking level, and the status published by the persistent-memory extension (when loaded).
  - When the active model belongs to the `"cliproxyapi"` provider, polls CLIProxyAPI quotas every `30s` (`CLIPROXYAPI_BASE_URL`, `CLIPROXYAPI_MANAGEMENT_KEY`) grouped by model family (`gemini`, `claude`, `gpt`) and displays them in the top footer row when space permits.
  - Publishes changed `tokenSpeed` status strings on `pi.events` channel `j0k3r-theme:token-speed` for optional HUD consumers.
- **HUD Bridge (`src/hud.ts`)**:
  - Listens on `pihud:presence:v1` and queries `pihud:presence:read:v1`; when `pihud` is visible, hides the visual footer while keeping `j0k3r-theme:token-speed` emissions active.
  - Responds to `pihud:main:read:v1` (trusted TUI matching cwd/session) with `{ lines: [], dir, repo, branch, modelQuota }`.
- **Custom Editor, Markdown Transformer & Persona Hook**:
  - `J0k3rThemeEditor`: electric cyan borders, idle top-border badge `󰣇 j0k3r`, and animated 12-frame (`100 ms`) Arch Linux working indicator (`󰣇`) cycling cyberpunk colors during agent processing.
  - `pi.registerMarkdownTransformer`: prefixes `user` messages with ``**`󰣇 j0k3r >`** ``.
  - `before_agent_start` hook: injects `j0k3r-pi` persona/tone guidelines into `event.systemPrompt`.
- **Theme `arch-electric` (`themes/arch-electric.json`)**:
  - Cyberpunk color palette inspired by Arch Linux: electric cyan (`#00e5ff`), Arch blue (`#1793d1`), cyberpunk violet (`#9b5cff`), neon pink (`#ff2df7`), lime green (`#66ff66`), and deep dark panel backgrounds (`#05080d`).
- **Compact Unboxed Tool Rendering (`compactToolRenderingVersion: 1`, `compactLeftMargin: 1`, `renderShell: "self"`)**:
  - Unboxed, transparent inline tool presentation across native built-ins (`read`, `bash`, `powershell`, `edit`, `write`, `grep`, `find`, `ls`), shipped tools (`codemode`, `tool_search`, MCP/resource tools), extension owners, and unknown/restored tools via `pi.registerToolRenderer`, with automatic ANSI-aware line wrapping on terminal-width overflow (no ellipsis clipping) across collapsed headers, expanded bodies, and non-HUD panels/lists/modals (keeping fixed single-row layouts only in HUD bars), a 1-character left margin (`compactLeftMargin: 1`, with the width-2 wide-grapheme omission exception), and verbatim `bash` command rendering (exact authored line breaks, standalone CR/CRLF, blank lines, and original indentation/spaces/tabs in orange/amber, soft-wrapping ANSI-aware without trimming or clipping).
  - Plain-text expanded card, tool, and custom-message bodies use the active theme muted foreground token (`theme.fg("muted", ...)`, with `#7aa7b8` fallback when theme is absent), while preserving existing ANSI foreground colors on syntax-highlighted code, diffs, warnings, errors, and dim empty notices.
  - No enclosing generated card frame (no top/bottom/vertical box borders `╭╮╰╯│`, blank vertical rows above/below, right padding, or background fills) and no expansion hints (`to expand`); short inline `─` separators around compact headers are allowed and desirable. Pi owns native expansion (`app.tools.expand`, fullscreen click) with complete ordered model-facing output, syntax highlighting, diffs, and images.
  - Preserves foreground palette, `bash` 120s default timeout wrapper (`DEFAULT_BASH_TIMEOUT_SECONDS = 120`), truthful per-surface `bash` timeout display (`timeout Xs` with elapsed/remaining while running, `timeout 120s (default)` in `j0k3r-theme` `bash` when omitted, `no timeout` in `powershell` and `subagents` thread-view fallback when omitted), and safe fallback for unmarked/throwing/unknown definitions; manual `!`/`!!` user shell transcripts remain excluded. Non-tool custom messages remain outside tool-row restyling except for the explicitly approved `subagent-completion` and `git-sync-awareness` notifications, which share the 1-character left margin, automatic wrapping, and muted plain-text expanded body styling.

---

## Español

Extensión de tema e interfaz para Pi que provee componentes interactivos personalizados de cabecera (header), editor y pie (footer), junto con el tema de colores `arch-electric`. En este repositorio reside en `extensions/j0k3r-theme`; en una instalación local de proyecto la ruta equivalente es `.pi/extensions/j0k3r-theme`.

### Qué incluye

- **Cabecera Interactiva (`J0k3rThemeHeader`)**:
  - Muestra el nombre del proyecto, el repositorio Git (resuelto vía remotos de Git o carpeta local) y la rama activa.
  - Detección y conteo en tiempo real de las skills y extensiones cargadas (filtrando extensiones opt-in según `.pi/extensions.json`).
  - Banner de bienvenida seleccionable con 4 estilos: `default` (emblema 3D animado de Arch Linux, `j0k3r-pi`), `mustache` (Pink Mustache animado, `mostachi-pi`), `cat` (Cyber Michi animado, `michi-pi`) y `oni` (Neon Pink Oni estático, `oni-pi`).
  - Se ejecuta en la pantalla de bienvenida y se oculta automáticamente ante el primer input del usuario o cuando el agente inicia su turno.
- **Selector de Banner y Comando `/banner`**:
  - Clave de configuración opcional `j0k3rTheme.welcomeBanner` en `.pi/settings.json` o `~/.pi/agent/settings.json` (clave plana o anidada) con valores `"default"`, `"mustache"`, `"cat"` u `"oni"`. Si falta o es inválida, cae a `"default"`.
  - Arte ASCII/ANSI empaquetado: `default`, `mustache` y `cat` se animan en 60 frames (intervalo 80 ms), mientras `oni` es estático sin timer. Sin carga ni conversión de imágenes en ejecución.
  - Comando `/banner`: permite alternar el estilo de banner en caliente durante la sesión:
    - `/banner`: abre un selector interactivo en la TUI con `default (Arch 3D Emblem)`, `mustache (Pink Mustache)`, `cat (Cyber Michi)` y `oni (Neon Pink Oni)`.
    - `/banner <estilo>`: acepta nombres canónicos y alias (`arch`, `pink`, `michi`, `gato`, `gatito`, `mask`, `neon`, `demon`, `skull`, etc.).
    - Actualiza la cabecera al instante, **persiste la selección en `~/.pi/agent/settings.json`** y notifica mediante `ctx.ui.notify` sin reiniciar Pi.
- **Pie Responsivo (`J0k3rThemeFooter`) y Cuotas CLIProxyAPI**:
  - Diseño adaptativo para terminales estrechas y anchas, con watcher `fs.watch` sobre `.git/` y refresco en `tool_execution_end` (`bash`/`user_bash`) y `turn_end`.
  - Muestra repositorio y rama Git, modelo activo, conteo de tokens, barra de progreso de contexto (%), nivel de thinking y estado de memoria persistente (cuando está cargada).
  - Cuando el modelo activo pertenece al proveedor `"cliproxyapi"`, consulta cuotas cada `30s` (`CLIPROXYAPI_BASE_URL`, `CLIPROXYAPI_MANAGEMENT_KEY`) agrupadas por familia (`gemini`, `claude`, `gpt`) y las muestra en la fila superior del footer si caben.
  - Publica los cambios de `tokenSpeed` en `j0k3r-theme:token-speed` de `pi.events` para consumidores opcionales como el HUD.
- **Puente con HUD (`src/hud.ts`)**:
  - Escucha `pihud:presence:v1` y consulta `pihud:presence:read:v1`; cuando `pihud` está visible, oculta el footer visual sin detener las emisiones `j0k3r-theme:token-speed`.
  - Responde a `pihud:main:read:v1` (en TUI confiable con misma sesión/cwd) con `{ lines: [], dir, repo, branch, modelQuota }`.
- **Editor Personalizado, Transformador Markdown y Persona**:
  - `J0k3rThemeEditor`: bordes cian eléctrico, insignia `󰣇 j0k3r` en reposo e indicador animado de 12 frames (`100 ms`) con el logo de Arch Linux (`󰣇`) ciclando colores cyberpunk durante el procesamiento.
  - `pi.registerMarkdownTransformer`: antepone ``**`󰣇 j0k3r >`** `` a los mensajes de usuario.
  - Hook `before_agent_start`: inyecta las pautas de identidad/tono `j0k3r-pi` en `event.systemPrompt`.
- **Tema `arch-electric` (`themes/arch-electric.json`)**:
  - Paleta cyberpunk con estética Arch Linux: cian eléctrico (`#00e5ff`), azul Arch (`#1793d1`), violeta cyberpunk (`#9b5cff`), rosa neón (`#ff2df7`), verde lima (`#66ff66`) y fondos oscuros profundos (`#05080d`).
- **Renderizado Compacto sin Tarjetas (`compactToolRenderingVersion: 1`, `compactLeftMargin: 1`, `renderShell: "self"`)**:
  - Presentación inline transparente y sin marco encerrante para herramientas nativas (`read`, `bash`, `powershell`, `edit`, `write`, `grep`, `find`, `ls`), integradas (`codemode`, `tool_search`, MCP/recursos), extensiones y nombres desconocidos/restaurados mediante `pi.registerToolRenderer`, con ajuste automático de línea consciente de ANSI al exceder el ancho del terminal (sin recorte con puntos suspensivos `…`) en cabeceras colapsadas, cuerpos expandidos y paneles/listas/modales no-HUD (manteniendo una sola fila fija únicamente en barras HUD), un margen izquierdo de 1 carácter (`compactLeftMargin: 1`, con la excepción de ancho 2 para grafemas anchos) y renderizado literal del bloque de comando de `bash` (preservando saltos de línea, CR/CRLF, líneas en blanco y sangría/espacios/tabs originales en naranja/ámbar con ajuste suave sin recortar ni colapsar espacios).
  - Los cuerpos expandidos de texto plano en tarjetas, herramientas y mensajes personalizados usan el token de color atenuado del tema activo (`theme.fg("muted", ...)`, con fallback `#7aa7b8` si no hay tema), preservando intactos los colores ANSI existentes en código resaltado, diffs, avisos, errores y mensajes vacíos atenuados.
  - Sin marco de tarjeta generado que encierre la fila (sin bordes superior/inferior/verticales `╭╮╰╯│`, filas vacías arriba/abajo, relleno derecho ni rellenos de fondo) y sin pistas de expansión (`to expand`); los separadores inline cortos `─` alrededor de una cabecera compacta sí están permitidos y son deseables. Pi gestiona la expansión nativa (`app.tools.expand`, clic en pantalla completa) mostrando toda la salida de modelo en orden, resaltado de sintaxis, diffs e imágenes.
  - Conserva la paleta de color, el wrapper de timeout por defecto de 120s de `bash`, la visualización veraz de timeout por superficie (`timeout Xs` con tiempo transcurrido/restante en ejecución, `timeout 120s (default)` en `bash` de `j0k3r-theme` cuando se omite, `no timeout` en `powershell` y fallback de `subagents` cuando se omite) y un fallback seguro para definiciones sin marcador, con errores o desconocidas; excluye las transcripciones manuales `!`/`!!`. Los mensajes personalizados ajenos a herramientas quedan fuera salvo las notificaciones explícitamente aprobadas `subagent-completion` y `git-sync-awareness`, que comparten el margen izquierdo de 1 carácter, ajuste automático de línea y texto plano expandido atenuado.

---

## Compact Tool Rendering Contract (v1)

Pinned owner contract for `compact-tool-rendering` (`MINI-001`) as amended by `tui-rendering-and-subagents-lazy-load` (`MINI-001`: decisions D1, D2, D3, and D4 Option A), using installed Pi `1.5.2` `ToolRenderContext` and `ToolRenderResultOptions` directly with no shared helper package.

### Marker & Presentation Rules
- **Opt-in Marker**: Compliant tool/renderer definitions set `compactToolRenderingVersion: 1` as presentation metadata only (never alters schemas, tool names, execution, `content`, `details`, authorization, redaction, or pagination).
- **Shell & Safe Slots**: Every compliant definition and universal fallback uses `renderShell: "self"` and provides both `renderCall` and `renderResult`, catching local rendering errors so Pi never enters default `Box` or `createResultFallback`.
- **Automatic ANSI-Aware Line Wrapping Without Ellipsis Clipping (D2 — Supersedes Prior Single-Line Clipped-Header Rule)**: Replaces the prior single-line clipped-header rule (`at most one compact inline row` / `Single clipped inline row`). Across all non-HUD TUI surfaces — collapsed tool headers (`CompactToolRow`, native built-ins, shipped tools, standalone extension renderers, universal fallback, nested replay), approved custom-message notifications (`subagent-completion`, `git-sync-awareness`), non-HUD interactive panels/lists/modals (`git-diff-panel`, `subagents-history-panel`, `background-widget`, `ask-user-question` `questionnaire-view`, `j0k3r-model-picker`, `tools-manager`), and expanded bodies — overflowing lines wrap automatically ANSI-aware across multiple lines at available content width (`Math.max(0, width - 1)` when the 1-column left margin applies, or full pane width inside non-margined panels/modals) without ellipsis (`…`) clipping or silent trailing-character loss. No duplicate status row is generated.
  - **HUD Single-Row Carve-Out**: Fixed single-row layouts remain solely in HUD bars where host layout requires one row (`pihud`, `j0k3r-theme` header/footer/editor bars, `agent-todo` HUD widget, `orchestrator-supervisor` HUD widget, `cpamc-usage` HUD).
  - **Wrapped-Row Interaction Coherence**: Non-HUD panels, lists, and modals whose entries wrap across multiple visual lines (`git-diff-panel`, `subagents-history-panel`, `ask-user-question` `questionnaire-view`, `j0k3r-model-picker`, `tools-manager`) must map mouse click y-coordinates, keyboard selection, and viewport scroll offsets through rendered visual line counts rather than assuming 1 row per item.
- **Muted Foreground for Plain-Text Expanded Bodies (D1)**: Plain-text expanded card, tool, and custom-message bodies (including unhighlighted `read`, unhighlighted/result `write`, plain fallback/error `edit`, `grep`, `find`, `ls`, `bash` output, `createFallbackRenderers`, standalone extension tool bodies, `ask-user-question` answers, `subagent-completion`, `git-sync-awareness`, and `subagents` `thread-view` fallback rows) render using the active theme muted token `theme.fg("muted", ...)` — falling back to the `arch-electric` muted `#7aa7b8` ANSI foreground when `theme` is absent or mocked — so expanded body text is visibly distinct from default terminal white. Existing ANSI foreground styling on syntax-highlighted code (`highlightCode`), diffs (`renderDiff`), warnings (amber), errors, headings, links, status badges, and dim empty notices (`(no output)`) is preserved intact and must never be overwritten by muted styling.
- **Verbatim Bash Command Presentation & Truthful Per-Surface Timeout Display (D4 Option A & Memory 816)**:
  - **Verbatim Command Block**: In every state (pending/partial/running, completed, failed/cancelled, collapsed and expanded, including nested replay bash rows and unavailable-component fallback), `bash` renders the complete command verbatim as authored — preserving exact leading/trailing spaces, mixed indentation, tabs (native visual tab-width display is allowed without mutating command data), consecutive blank lines, internal/trailing newlines, standalone CR and CRLF characters (splitting only on `\n`, never stripping `\r`), quotes, backslashes, and literal `\n` sequences — in the existing orange/amber foreground (`ORANGE`), soft-wrapping long lines ANSI-aware at available content width (`width - 1` after the single outer left margin) without trimming, whitespace collapsing, pretty-printing, synthetic continuation indentation, clipping, preview slicing, or ellipsis (`…`). A concise inline identity/status summary accompanies the command block; no enclosing card frame, background SGR fill, or generated expansion/collapse hint may be added, and output remains natively expandable and lossless.
  - **Truthful Per-Surface Timeout Status (D4 Option A)**: Display-only; never modifies tool schemas, command execution semantics, `applyBashTimeout`, `DEFAULT_BASH_TIMEOUT_SECONDS = 120` in `extensions/j0k3r-theme/src/tools/index.ts`, or Pi core's unbounded default timeout.
    - When `args.timeout` is a positive number, call and result rows across `bash` (`$`), `powershell` (`PS>`), and nested `subagents` replay always display `timeout Xs` (where `X` is the timeout in seconds), and while running include live elapsed and remaining time (when timing metadata is present).
    - When `args.timeout` is omitted or non-positive, `j0k3r-theme` `bash` (`$`) truthfully displays `timeout 120s (default)` — with live elapsed and remaining time while running — matching `applyBashTimeout` (`DEFAULT_BASH_TIMEOUT_SECONDS = 120`).
    - When `args.timeout` is omitted or non-positive, `powershell` (`PS>`) and `subagents` `thread-view.ts` `compactToolRow` / legacy bash fallback truthfully display `no timeout`.
  - Manual `!`/`!!` user shell transcripts (`BashExecutionComponent`) remain excluded.
- **One-Character Left Margin & Once-Only Composition (Width-2 Wide-Grapheme Exception — Memory 817)**: Every generated line of every approved tool block (built-in, shipped, standalone owner, dynamic/unknown fallback, nested replay, unavailable-component fallback) and of the two approved notifications (`subagent-completion`, `git-sync-awareness`) begins with one leading blank column (`" "`) in collapsed, expanded, body, and multiline `bash` views, except at total width 2 on a line where omitting the margin is necessary to fit an intact two-column grapheme (e.g., `A漢B` or wide emoji; superseding earlier no-perimeter-padding wording solely for this single leading column). No extra blank vertical rows above/below, no right padding, no enclosing frame, and no background fill are added. Content layout uses `Math.max(0, width - 1)` via ANSI-aware helpers: `width <= 0` emits zero cells (`[]`), and `width === 1` renders a blank one-column row (`" "`) for non-empty blocks without overflow, truncation artifacts, or ANSI leakage. Standalone owner renderers apply this margin directly and expose the presentation-only flag `compactLeftMargin: 1` on the renderer definition and/or returned component (retaining `compactToolRenderingVersion: 1` unchanged); `j0k3r-theme`'s resolver and `subagents` nested replay apply the 1-character margin only when the definition/component lacks `compactLeftMargin: 1` (and for fallback rows), preventing doubled indentation (`"  "`) across host composition and nested replay.
- **No Generated Card Frame or Hints**: Emit no enclosing card frame — no top/bottom/vertical box borders (`╭╮╰╯│`, `┌┐└┘`), blank vertical perimeter rows, right padding, or background SGR fills — and no expansion instructions (`to expand`, `to collapse`, `app.tools.expand`, `ctrl+o`). Short inline `─` separators around compact headers and inline details are allowed and desirable: they are row separators, not a card frame. Literal returned data containing box characters or expansion words is preserved verbatim as data.
- **Lossless Native Expansion & Width Safety**: Pi owns `expanded` state, `app.tools.expand`, and fullscreen click routing. Expanded rendering outputs all returned `content` text blocks in order plus relevant safe metadata/diffs/continuation/native image behavior without preview slicing. Positive widths wrap and fit strictly within `width` via ANSI-aware helpers (`visibleWidth`, `wrapTextWithAnsi`) without ellipsis clipping after accounting for the 1-column left margin (`width - 1`), except that a necessary width-2 wide-grapheme line uses both columns without a margin; no intact grapheme is silently deleted on lossless surfaces at widths of at least 2; `width <= 0` emits zero cells and `width === 1` stays within one column. Home path abbreviation (`~`) is display-only on separator-bounded home prefixes and never mutates body data, commands, URLs, or arguments.
- **Universal Resolver & Fallback**: `j0k3r-theme`'s `pi.registerToolRenderer` resolver keeps `compactToolRenderingVersion: 1` compliant owner renderers intact (decorating with the 1-column left margin only if `compactLeftMargin !== 1`) and replaces unmarked, missing-slot, throwing, default, disconnected MCP/resource, and unknown tool definitions with a safe local compact fallback (including the 1-column left margin, automatic wrapping without ellipsis clipping, and muted plain-text expanded body styling) without executing unmarked callbacks. Manual `!`/`!!` user bash (`BashExecutionComponent`) is excluded.
- **Custom-Message Notification Exceptions**: Non-tool custom messages remain outside tool-row restyling except for the two explicitly approved notification renderers: `subagent-completion` (`extensions/subagents`) and `git-sync-awareness` (`extensions/git-sync-awareness`). Both render compact, transparent, unboxed, background-free components with the same conditional 1-character left margin (`width - 1` content width normally, the necessary width-2 wide-grapheme exception above, `width <= 0` emits zero cells, `width === 1` renders `" "` without overflow), wrap collapsed headers and expanded bodies automatically without ellipsis clipping, style plain-text expanded bodies with `theme.fg("muted", ...)` (`#7aa7b8` fallback) while preserving existing ANSI badges/status colors, avoid `CustomMessageComponent`'s default boxed fallback, omit generated expansion/collapse hints, avoid duplicate generated header metadata fields, preserve foreground/status palette and literal data, enforce positive-width ANSI/CJK/combining/emoji safety, and provide complete lossless native expansion (while `git-sync-awareness` also preserves its existing click affordance coherently with host `options.expanded` rebuilds).

### Subagents Panel Performance & Lazy-Load Contract (D3 — Owned by `extensions/subagents/README.md`)
- Full normative details live in `extensions/subagents/README.md` (`Subagents History Performance, Lazy Loading, Viewport Rendering & Event-Driven Refresh (D3)`):
  - **SQLite Composite Index**: `ensureHistoryDb` idempotently creates `idx_subagent_tasks_cwd_session_created` on `subagent_tasks(cwd, session_id, created_at DESC, id DESC)` via `CREATE INDEX IF NOT EXISTS`, preserving existing SQLite table compatibility without destructive migrations.
  - **Windowed On-Demand Metadata**: Initial open loads only a lightweight metadata window plus active tasks and expands windows on scroll/navigation, preserving active-first ordering and stable `task_id` continuity.
  - **Lazy Selected-Task Hydration & Bounded LRU**: Non-selected tasks are never eagerly hydrated via `getTask`; selected tasks hydrate on demand into a bounded LRU cache with content-fresh invalidation.
  - **Incremental Viewport-Only Thread Rendering**: Large thread snapshots construct/render only items required for the active viewport window (including follow-tail and incremental scroll expansion), caching rendered lines across unchanged frames while staying content-fresh.
  - **Event-Driven Refresh**: `panel-overlay` replaces unconditional 1-second polling with `manager.onTaskUpdate` subscription plus conditional live ticking only while active (`queued`/`running`/`stopping`) tasks exist, emitting zero idle `tui.requestRender()` ticks and releasing all listeners/timers on close.

### Inventoried Tool-Owner & Non-HUD Surface Coverage
- **Pi core (8)**: `read`, `bash` (with full multiline orange command + truthful timeout status), `powershell` (with truthful timeout status), `edit`, `write`, `grep`, `find`, `ls`.
- **Pi shipped extensions**: `codemode`, `tool_search`, dynamic `mcp__*` and MCP resource tools.
- **Extension tool owners**: `j0k3r-theme`, `agent-todo`, `api-tools`, `codegraph`, `context7`, `pi-persistent-memory`, `workspace-services`, `websearch` (public `WEBSEARCH_TOOL_NAMES` only; internal helpers unregistered), `youtube-research`, `browser-screenshot`, `utils`, `pdf-review`, `skill-registry`, `ask-user-question`, `workflow-check`, `orchestrator-supervisor` (`supervisor_rotate`), `subagents` (`subagent_run`, `ask_orchestrator`, `report_orchestrator`, nested replay).
- **Approved custom-message notifications**: `subagent-completion` (`extensions/subagents`), `git-sync-awareness` (`extensions/git-sync-awareness`).
- **Non-HUD panels, lists, and modals (D2 automatic wrapping)**: `git-diff-panel`, `ask-user-question` (`questionnaire-view`), `j0k3r-model-picker`, `tools-manager`, `subagents` (`subagents-history-panel`, `background-widget`).
- **HUD single-row carve-out (fixed 1-row preserved)**: `pihud`, `j0k3r-theme` header/footer/editor bars, `agent-todo` HUD widget, `orchestrator-supervisor` HUD widget, `cpamc-usage` HUD.
- **Fallback coverage**: Any non-tool/unknown/restored definition receives the universal compact fallback.

### Validation & Test Commands

Run from `extensions/j0k3r-theme`:

```bash
npm run typecheck
node --test test/*.test.mjs
# Optional real installed-host acceptance and benchmark (requires PI_COMPACT_TEST_HOST):
PI_COMPACT_TEST_HOST=1 node --test test/compact-tools-host.test.mjs
node test/compact-tools-benchmark.mjs
```
