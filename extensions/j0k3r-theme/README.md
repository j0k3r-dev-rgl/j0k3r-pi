# j0k3r Theme Extension

[English](#english) | [Español](#español)

## English

Pi TUI theme extension providing custom interactive header, editor, and footer components, alongside the `arch-electric` color theme. In this agent-dir checkout it lives at `extensions/j0k3r-theme`; when copied into a project-local Pi setup the equivalent path is `.pi/extensions/j0k3r-theme`.

### What it provides

- **Interactive Header (`J0k3rThemeHeader`)**:
  - Displays project name, repository name (resolved via Git remote or directory name), and current Git branch.
  - Real-time detection and count of loaded skills and extensions.
  - Selectable startup welcome banner: defaults to the animated 3D spinning Arch Linux logo with gradient "j0k3r" typography, with an optional static "Pink Mustache" avatar banner option.
  - Automatically plays on startup and cleanly hides upon user input or when the agent starts processing.
- **Welcome Banner Selector & `/banner` Command**:
  - Optional setting key `j0k3rTheme.welcomeBanner` in `settings.json` accepting `"default"` or `"mustache"`. When absent, unreadable, or set to an unrecognized value, it falls back to `"default"` preserving existing startup behavior.
  - Bundled static ASCII/ANSI art: the `mustache` option is self-contained static art approximating the pink mustache avatar with zero runtime image loading or conversions.
  - `/banner` command: switch banners dynamically during an active session:
    - `/banner`: opens an interactive TUI selector with options `default (Arch 3D plus j0k3r)` and `mustache (Pink Mustache)`.
    - `/banner default`: immediately switches active header to the animated Arch 3D banner.
    - `/banner mustache`: immediately switches active header to the static Pink Mustache banner.
    - Handles invalid arguments gracefully with a warning notification and fallback to interactive selection.
    - Switches active header immediately in memory and notifies via `ctx.ui.notify` without requiring a Pi restart.
- **Responsive Footer (`J0k3rThemeFooter`)**:
  - Multi-tier adaptive layout that gracefully scales across wide and narrow terminal viewports.
  - Shows Git repository and branch, current model, token counts, context window usage progress bar, thinking level, and the status published by the persistent-memory extension (when loaded).
  - Publishes changed `tokenSpeed` status strings on `pi.events` channel `j0k3r-theme:token-speed` for optional HUD consumers. No file writes, imports from other extensions, or required consumer; rendering remains unchanged.
- **Custom Editor (`J0k3rThemeEditor`)**:
  - Custom styled input editor component with electric cyan borders.
  - Animated working status indicator in the top border featuring the Arch Linux logo (`󰣇`) with a pulsing neon breathing effect (scaling brightness and contrast) while smoothly cycling through electric cyberpunk gradient colors (Cyan, Arch Blue, Cyber Violet, Neon Pink, Electric Amber, Neon Green) during agent processing and thinking.
- **Theme `arch-electric` (`themes/arch-electric.json`)**:
  - Cyberpunk color palette inspired by Arch Linux: electric cyan (`#00e5ff`), Arch blue (`#1793d1`), cyberpunk violet (`#9b5cff`), neon pink (`#ff2df7`), lime green (`#66ff66`), and deep dark panel backgrounds (`#05080d`).
- **Compact Unboxed Tool Rendering (`compactToolRenderingVersion: 1`, `renderShell: "self"`)**:
  - Single-row, unboxed, transparent inline tool presentation across native built-ins (`read`, `bash`, `powershell`, `edit`, `write`, `grep`, `find`, `ls`), shipped tools (`codemode`, `tool_search`, MCP/resource tools), extension owners, and unknown/restored tools via `pi.registerToolRenderer`, with an explicit `MINI-009` exception for the `bash` command block (verbatim command as authored with real line breaks, blank lines, and original indentation/spaces/tabs in orange/amber, soft-wrapping long lines ANSI-aware without trimming or clipping) and a 1-character left margin (`compactLeftMargin: 1`) on every generated line.
  - No enclosing generated card frame (no top/bottom/vertical box borders `╭╮╰╯│`, blank vertical rows above/below, right padding, or background fills) and no expansion hints (`to expand`); short inline `─` separators around a one-line header are allowed and desirable. Pi owns native expansion (`app.tools.expand`, fullscreen click) with complete ordered model-facing output, syntax highlighting, diffs, and images.
  - Preserves foreground palette, `bash` timeout wrapper, and safe fallback for unmarked/throwing/unknown definitions; manual `!`/`!!` user shell transcripts remain excluded. Non-tool custom messages remain outside tool-row restyling except for the explicitly approved `subagent-completion` and `git-sync-awareness` notifications (`MINI-009`), which share the 1-character left margin.

---

## Español

Extensión de tema e interfaz para Pi que provee componentes interactivos personalizados de cabecera (header), editor y pie (footer), junto con el tema de colores `arch-electric`. En este repositorio reside en `extensions/j0k3r-theme`; en una instalación local de proyecto la ruta equivalente es `.pi/extensions/j0k3r-theme`.

### Qué incluye

- **Cabecera Interactiva (`J0k3rThemeHeader`)**:
  - Muestra el nombre del proyecto, el repositorio Git (resuelto vía remotos de Git o carpeta local) y la rama activa.
  - Detección y conteo en tiempo real de las skills y extensiones cargadas.
  - Banner de bienvenida seleccionable: por defecto el banner animado 3D de Arch Linux con tipografía "j0k3r", con opción estática alternativa "Pink Mustache".
  - Se ejecuta en la pantalla de bienvenida y se oculta automáticamente ante el primer input del usuario o cuando el agente inicia su turno.
- **Selector de Banner y Comando `/banner`**:
  - Clave de configuración opcional `j0k3rTheme.welcomeBanner` en `settings.json` con valores `"default"` o `"mustache"`. Si no está configurada o contiene un valor inválido, utiliza `"default"` sin alterar el comportamiento existente.
  - Arte ASCII/ANSI estático empaquetado: la opción `mustache` está completamente integrada en el código sin requerir carga o conversión de imágenes en tiempo de ejecución.
  - Comando `/banner`: permite alternar el estilo de banner en caliente durante la sesión:
    - `/banner`: abre un selector interactivo en la TUI con opciones `default (Arch 3D plus j0k3r)` y `mustache (Pink Mustache)`.
    - `/banner default`: cambia inmediatamente la cabecera activa al banner 3D de Arch.
    - `/banner mustache`: cambia inmediatamente la cabecera activa al banner Pink Mustache.
    - Notificación informativa mediante `ctx.ui.notify` tras cada cambio y manejo seguro de argumentos no reconocidos.
- **Pie Responsivo (`J0k3rThemeFooter`)**:
  - Diseño responsivo adaptativo que se ajusta a terminales estrechas y anchas sin cortes abruptos.
  - Muestra repositorio y rama Git, modelo activo, conteo de tokens, barra de progreso de uso de contexto (%), nivel de thinking y el estado publicado por la extensión de memoria persistente (cuando está cargada).
  - Publica los cambios del texto `tokenSpeed` en el canal `j0k3r-theme:token-speed` de `pi.events` para consumidores opcionales como el HUD. No escribe archivos, no importa otras extensiones ni requiere un consumidor; el renderizado no cambia.
- **Editor Personalizado (`J0k3rThemeEditor`)**:
  - Componente de editor de entrada estilizado con bordes en cian eléctrico.
  - Indicador animado de estado de trabajo (worker / spinner) en el borde superior con el logo de Arch Linux (`󰣇`) con efecto de latido/respiración neón (pulsación de brillo y contraste) mientras cicla suavemente a través de colores cyberpunk (cian eléctrico, azul Arch, violeta, rosa neón, ámbar, verde lima) cuando el agente procesa o piensa.
- **Tema `arch-electric` (`themes/arch-electric.json`)**:
  - Paleta cyberpunk con estética Arch Linux: cian eléctrico (`#00e5ff`), azul Arch (`#1793d1`), violeta cyberpunk (`#9b5cff`), rosa neón (`#ff2df7`), verde lima (`#66ff66`) y fondos oscuros profundos (`#05080d`).
- **Renderizado Compacto sin Tarjetas (`compactToolRenderingVersion: 1`, `renderShell: "self"`)**:
  - Presentación en una sola fila inline transparente y sin marco encerrante para herramientas nativas (`read`, `bash`, `powershell`, `edit`, `write`, `grep`, `find`, `ls`), integradas (`codemode`, `tool_search`, MCP/recursos), extensiones y nombres desconocidos/restaurados mediante `pi.registerToolRenderer`, con excepción explícita en `MINI-009` para el bloque de comando de `bash` (comando literal tal como lo escribe el agente, preservando saltos de línea, líneas en blanco, sangría/espacios/tabs originales en naranja/ámbar y ajuste suave consciente de ANSI sin recortar ni colapsar espacios) y un margen izquierdo de 1 carácter (`compactLeftMargin: 1`) en cada línea generada.
  - Sin marco de tarjeta generado que encierre la fila (sin bordes superior/inferior/verticales `╭╮╰╯│`, filas vacías arriba/abajo, relleno derecho ni rellenos de fondo) y sin pistas de expansión (`to expand`); los separadores inline cortos `─` alrededor de una cabecera de una línea sí están permitidos y son deseables. Pi gestiona la expansión nativa (`app.tools.expand`, clic en pantalla completa) mostrando toda la salida de modelo en orden, resaltado de sintaxis, diffs e imágenes.
  - Conserva la paleta de color, el timeout por defecto de `bash` y un fallback seguro para definiciones sin marcador, con errores o desconocidas; excluye las transcripciones manuales `!`/`!!`. Los mensajes personalizados ajenos a herramientas quedan fuera salvo las notificaciones explícitamente aprobadas `subagent-completion` y `git-sync-awareness` (`MINI-009`), que comparten el margen izquierdo de 1 carácter.

---

## Compact Tool Rendering Contract (v1)

Pinned owner contract for `compact-tool-rendering` (`MINI-001`), using installed Pi `1.5.2` `ToolRenderContext` and `ToolRenderResultOptions` directly with no shared helper package.

### Marker & Presentation Rules
- **Opt-in Marker**: Compliant tool/renderer definitions set `compactToolRenderingVersion: 1` as presentation metadata only (never alters schemas, tool names, execution, `content`, `details`, authorization, redaction, or pagination).
- **Shell & Safe Slots**: Every compliant definition and universal fallback uses `renderShell: "self"` and provides both `renderCall` and `renderResult`, catching local rendering errors so Pi never enters default `Box` or `createResultFallback`.
- **Single Inline Row (With Explicit `bash` Command Exception)**: Call and result states render at most one compact inline row (tool identity, status, key counts/target where available; no duplicate status row), except for the `bash` command block defined below.
- **Bash Command Presentation Exception (`MINI-009` Amendment & Verbatim Clarification)**: The `bash` tool's command is the sole tool surface exempt from the one-line clipped command/summary rule. In every state (pending/partial/running, completed, failed/cancelled, collapsed and expanded, including nested replay bash rows and unavailable-component fallback), render the complete command verbatim as written by the agent — preserving exact leading/trailing spaces, mixed indentation, tabs (native visual tab-width display is allowed without mutating command data), consecutive blank lines, internal/trailing newlines, standalone CR and CRLF characters, quotes, backslashes, and literal `\n` sequences — in the existing orange/amber foreground (`ORANGE`), soft-wrapping long lines ANSI-aware at available content width (`width - 1` after the single outer left margin) without trimming, whitespace collapsing, pretty-printing, synthetic continuation indentation, clipping, preview slicing, or ellipsis (`…`). A concise inline identity/status summary accompanies the command block; no enclosing card frame, background SGR fill, or generated expansion/collapse hint may be added, and output remains natively expandable and lossless. Execution, arguments, command semantics, and the 120s default timeout wrapper are untouched. All other tools (including `powershell`) keep compact single-line summaries; manual `!`/`!!` stays excluded.
- **One-Character Left Margin & Once-Only Composition (`MINI-009` Amendment)**: Every generated line of every approved tool block (built-in, shipped, standalone owner, dynamic/unknown fallback, nested replay, unavailable-component fallback) and of the two approved notifications (`subagent-completion`, `git-sync-awareness`) begins with one leading blank column (`" "`) in collapsed, expanded, body, and multiline `bash` views, except at total width 2 on a line where omitting the margin is necessary to fit an intact two-column grapheme (superseding earlier no-perimeter-padding wording solely for this single leading column). No extra blank vertical rows above/below, no right padding, no enclosing frame, and no background fill are added. Content layout uses `Math.max(0, width - 1)` via ANSI-aware helpers: `width <= 0` emits zero cells (`[]`), and `width === 1` renders a blank one-column row (`" "`) for non-empty blocks without overflow, truncation artifacts, or ANSI leakage. Standalone owner renderers apply this margin directly and expose the presentation-only flag `compactLeftMargin: 1` on the renderer definition and/or returned component (retaining `compactToolRenderingVersion: 1` unchanged); `j0k3r-theme`'s resolver and `subagents` nested replay apply the 1-character margin only when the definition/component lacks `compactLeftMargin: 1` (and for fallback rows), preventing doubled indentation (`"  "`) across host composition and nested replay.
- **No Generated Card Frame or Hints**: Emit no enclosing card frame — no top/bottom/vertical box borders (`╭╮╰╯│`), blank vertical perimeter rows, right padding, or background SGR fills — and no expansion instructions (`to expand`, `to collapse`, `app.tools.expand`, `ctrl+o`). Short inline `─` separators between a compact header and its inline details are allowed and desirable: they are row separators, not a card frame. Literal returned data containing box characters or expansion words is preserved verbatim as data.
- **Lossless Native Expansion & Width Safety**: Pi owns `expanded` state, `app.tools.expand`, and fullscreen click routing. Expanded rendering outputs all returned `content` text blocks in order plus relevant safe metadata/diffs/continuation/native image behavior without preview slicing. Positive widths fit strictly within `width` via ANSI-aware helpers (`visibleWidth`, `wrapTextWithAnsi`, `truncateToWidth`) after accounting for the 1-column left margin (`width - 1`), except that a necessary width-2 wide-grapheme line uses both columns without a margin; no intact grapheme is silently deleted on lossless surfaces at widths of at least 2; `width <= 0` emits zero cells and `width === 1` stays within one column. Home path abbreviation (`~`) is display-only on separator-bounded home prefixes and never mutates body data, commands, URLs, or arguments.
- **Universal Resolver & Fallback**: `j0k3r-theme`'s `pi.registerToolRenderer` resolver keeps `compactToolRenderingVersion: 1` compliant owner renderers intact (decorating with the 1-column left margin only if `compactLeftMargin !== 1`) and replaces unmarked, missing-slot, throwing, default, disconnected MCP/resource, and unknown tool definitions with a safe local compact fallback (including the 1-column left margin) without executing unmarked callbacks. Manual `!`/`!!` user bash (`BashExecutionComponent`) is excluded.
- **Custom-Message Notification Exceptions (`MINI-009` Amendment)**: Non-tool custom messages remain outside tool-row restyling except for the two explicitly approved notification renderers: `subagent-completion` (`extensions/subagents`) and `git-sync-awareness` (`extensions/git-sync-awareness`). Both render compact, transparent, unboxed, background-free components with the same conditional 1-character left margin (`width - 1` content width normally, the necessary width-2 wide-grapheme exception above, `width <= 0` emits zero cells, `width === 1` renders `" "` without overflow), avoid `CustomMessageComponent`'s default boxed fallback, omit generated expansion/collapse hints, avoid duplicate generated header metadata fields, preserve foreground/status palette and literal data, enforce positive-width ANSI/CJK/combining/emoji safety, and provide complete lossless native expansion (while `git-sync-awareness` also preserves its existing click affordance coherently with host `options.expanded` rebuilds).

### Inventoried Tool-Owner Coverage
- **Pi core (8)**: `read`, `bash` (with full multiline orange command exception), `powershell`, `edit`, `write`, `grep`, `find`, `ls`.
- **Pi shipped extensions**: `codemode`, `tool_search`, dynamic `mcp__*` and MCP resource tools.
- **Extension owners**: `j0k3r-theme`, `agent-todo`, `api-tools`, `codegraph`, `context7`, `pi-persistent-memory`, `workspace-services`, `websearch` (public `WEBSEARCH_TOOL_NAMES` only; internal helpers unregistered), `youtube-research`, `browser-screenshot`, `utils`, `pdf-review`, `skill-registry`, `ask-user-question`, `workflow-check`, `orchestrator-supervisor` (`supervisor_rotate`), `subagents` (`subagent_run`, `ask_orchestrator`, `report_orchestrator`, nested replay).
- **Approved custom-message notifications (`MINI-009`)**: `subagent-completion` (`extensions/subagents`), `git-sync-awareness` (`extensions/git-sync-awareness`).
- **Fallback coverage**: Any non-tool/unknown/restored definition receives the universal compact fallback.

### Baseline & Obsolete Test Scope
- Existing tests across `j0k3r-theme` and owner extensions asserting bordered cards (`╭`/`╰`) or `to expand` hints on tool rows (and on `subagent-completion` / `git-sync-awareness` custom messages under `MINI-009`) are obsolete card/hint expectations to be replaced by compact-rendering tests during implementation units and sequential `MINI-009`.
- Existing `j0k3r-theme` baseline check `node --test test/*.test.mjs` currently fails under Node `v24.19.0` strip-only TypeScript mode on pre-existing `src/J0k3rThemeFooter.ts` parameter properties (`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`); `npm run typecheck` passes. Host-aware acceptance and benchmarks (`test/compact-tools-host.test.mjs`, `test/compact-tools-benchmark.mjs`) are authored in `MINI-008` and extended in `MINI-009` to cover settled cross-unit owner registrations, real `CustomMessageComponent` notification rendering, and the multiline orange `bash` command matrix.
