# Sources

## Source Index

### S-001: Extension CodeGraph Entrypoint
- Family: IMPLEMENTATION
- URL or locator: `/home/j0k3r/.pi/agent/extensions/codegraph/index.ts`
- Date/version: 2026-09-19 (versión local de la extensión)
- Access method: `read` / `bash`
- Used for: Verificación del punto de entrada de la extensión CodeGraph, comprobación de hooks de ciclo de vida inexistentes y registro exclusivo de herramientas.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Demuestra de forma concluyente que CodeGraph no suscribe ningún evento `pi.on(...)` (`before_agent_start`, `context`, etc.). Solo comprueba activación y delega en `registerCodeGraphTools(pi)`.

### S-002: Extension CodeGraph Tools Composition
- Family: IMPLEMENTATION
- URL or locator: `/home/j0k3r/.pi/agent/extensions/codegraph/src/tools/index.ts`
- Date/version: 2026-09-19
- Access method: `read`
- Used for: Mapeo de las cuatro herramientas públicas registradas por CodeGraph (`codegraph_explore`, `codegraph_status`, `codegraph_manage`, `codegraph_sync`).
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Confirma que la interfaz expuesta al agente consiste únicamente en las 4 herramientas registradas con `pi.registerTool`.

### S-003: Extension CodeGraph Explore Tool
- Family: IMPLEMENTATION
- URL or locator: `/home/j0k3r/.pi/agent/extensions/codegraph/src/tools/explore.ts`
- Date/version: 2026-09-19
- Access method: `read`
- Used for: Evidencia de metadatos de prompt (`promptSnippet` en línea 22, `promptGuidelines` en líneas 23-27).
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Define las directrices de exploración de arquitectura e índice, probando que las instrucciones residen como metadatos de herramienta y no como inyecciones de mensaje.

### S-004: Extension CodeGraph Status Tool
- Family: IMPLEMENTATION
- URL or locator: `/home/j0k3r/.pi/agent/extensions/codegraph/src/tools/status.ts`
- Date/version: 2026-09-19
- Access method: `read`
- Used for: Evidencia de metadatos de prompt (`promptSnippet` en línea 12, `promptGuidelines` en líneas 13-16).
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Directrices para consultar disponibilidad y frescura del índice antes de explorar.

### S-005: Extension CodeGraph Manage Tool
- Family: IMPLEMENTATION
- URL or locator: `/home/j0k3r/.pi/agent/extensions/codegraph/src/tools/manage.ts`
- Date/version: 2026-09-19
- Access method: `read`
- Used for: Evidencia de metadatos de prompt (`promptSnippet` en línea 16, `promptGuidelines` en líneas 17-22).
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Directrices que prohíben mutaciones sin confirmación de usuario y exigen reportar bloqueos en subagentes no interactivos.

### S-006: Extension CodeGraph Sync Tool
- Family: IMPLEMENTATION
- URL or locator: `/home/j0k3r/.pi/agent/extensions/codegraph/src/tools/sync.ts`
- Date/version: 2026-09-19
- Access method: `read`
- Used for: Evidencia de metadatos de prompt (`promptSnippet` en línea 27, `promptGuidelines` en líneas 28-32).
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Directrices para sincronización incremental tras modificaciones de ficheros.

### S-007: Installed Pi Extensions Contract Documentation
- Family: PRIMARY
- URL or locator: `/home/j0k3r/.local/share/mise/installs/node/24.19.0/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`
- Date/version: `@earendil-works/pi-coding-agent` (Node 24.19.0 mise install)
- Access method: `read` / `bash`
- Used for: Especificación oficial de `pi.registerTool`, `promptSnippet`, `promptGuidelines`, `pi.getActiveTools()` y `pi.getAllTools()`.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Documenta que `promptSnippet` alimenta la sección `Available tools:` y `promptGuidelines` alimenta `Guidelines:`. Documenta que `pi.getActiveTools()` devuelve nombres activos y `pi.getAllTools()` devuelve la metadata de herramientas. Confirma que no existe `getTools()`.

### S-008: Installed Pi System Prompt Construction
- Family: PRIMARY
- URL or locator: `/home/j0k3r/.local/share/mise/installs/node/24.19.0/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/system-prompt.js`
- Date/version: `@earendil-works/pi-coding-agent`
- Access method: `read`
- Used for: Demostración de cómo se ensambla el system prompt principal y por qué `customPrompt` anula `Available tools` y `Guidelines` (líneas 17-38 vs 44-75).
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Evidencia primaria decisiva. Si `customPrompt` viene definido en las opciones, `buildSystemPrompt` retorna inmediatamente dicho contenido sin procesar snippets ni guidelines.

### S-009: Installed Pi Agent Session Implementation
- Family: PRIMARY
- URL or locator: `/home/j0k3r/.local/share/mise/installs/node/24.19.0/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js`
- Date/version: `@earendil-works/pi-coding-agent`
- Access method: `read`
- Used for: Análisis del flujo de reconstrucción del prompt (`_rebuildSystemPrompt`, líneas 738-765) y del registro de herramientas (`_refreshToolRegistry`, líneas 2085-2105). Métodos `getActiveToolNames` y `getAllTools` (líneas 635-650).
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Muestra la recolección de `_toolPromptSnippets` y `_toolPromptGuidelines` a partir de `definitionRegistry` y la implementación de `getAllTools()`.

### S-010: Installed Pi Resource Loader Implementation
- Family: PRIMARY
- URL or locator: `/home/j0k3r/.local/share/mise/installs/node/24.19.0/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/resource-loader.js`
- Date/version: `@earendil-works/pi-coding-agent`
- Access method: `read`
- Used for: Análisis de `DefaultResourceLoader`, `systemPromptOverride` (líneas 182, 383) y `extensionsOverride` (líneas 177, 328).
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Explica cómo opera el modo lean: `systemPromptOverride` inyecta las instrucciones como `this.systemPrompt`, que luego `AgentSession` transfiere como `customPrompt` a `buildSystemPrompt`.

### S-011: Installed Pi SDK Session Creation
- Family: PRIMARY
- URL or locator: `/home/j0k3r/.local/share/mise/installs/node/24.19.0/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/sdk.js`
- Date/version: `@earendil-works/pi-coding-agent`
- Access method: `read`
- Used for: Verificación del ciclo de vida de `createAgentSession` y paso de `options.resourceLoader` y `options.tools`.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Confirma que las herramientas pasadas a `createAgentSession({ tools })` se configuran como herramientas activas en la sesión creada.

### S-012: Installed Pi Extension API Types
- Family: PRIMARY
- URL or locator: `/home/j0k3r/.local/share/mise/installs/node/24.19.0/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts` y `loader.js`
- Date/version: `@earendil-works/pi-coding-agent`
- Access method: `read`
- Used for: Inspección de interfaces `ExtensionAPI` y `ToolInfo`.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Confirma que `ExtensionAPI` expone `getActiveTools(): string[]` y `getAllTools(): ToolInfo[]` (donde `ToolInfo` incluye `name`, `description`, `parameters`, `promptGuidelines`, `sourceInfo`). Ninguna interfaz expone `getTools()`.

### S-013: Subagents Runner Tool Guidelines Implementation
- Family: IMPLEMENTATION
- URL or locator: `/home/j0k3r/projects/pi-subagents-j0k3r/src/runner/tool-guidelines.ts`
- Date/version: 2026-09-19 05:24
- Access method: `read`
- Used for: Diagnóstico del error de llamada a `source?.getTools?.()` en `extractActiveToolGuidelines` (línea 10) y composición en `composeLeanSystemPrompt`.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Evidencia del fallo de integración: la función esperaba un método `getTools()` inexistente en la API de Pi, provocando que siempre retornara `[]`.

### S-014: Subagents SDK Runner Implementation
- Family: IMPLEMENTATION
- URL or locator: `/home/j0k3r/projects/pi-subagents-j0k3r/src/runner/sdk-runner.ts`
- Date/version: 2026-09-19 05:25
- Access method: `read`
- Used for: Diagnóstico de `activeToolNames` (línea 31, llamada a `source?.getTools?.()`), expansión de herramientas y paso de `systemPrompt` a `DefaultResourceLoader`.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Explica por qué los comodines como `codegraph_*` se descartaban (al retornar `undefined` `activeToolNames`) y cómo se ensambla la sesión lean.

### S-015: Subagents Tool Pattern Expansion
- Family: IMPLEMENTATION
- URL or locator: `/home/j0k3r/projects/pi-subagents-j0k3r/src/tool-patterns.ts`
- Date/version: 2026-08-24
- Access method: `read`
- Used for: Comportamiento de expansión de comodines (`expandToolPatterns`, línea 21).
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Demuestra que si `activeToolNames` es `undefined`, `hasToolGlob(pattern)` ejecuta `if (!active) continue;`, suprimiendo silenciosamente cualquier patrón como `codegraph_*`.

### S-016: Subagents Manager Implementation
- Family: IMPLEMENTATION
- URL or locator: `/home/j0k3r/projects/pi-subagents-j0k3r/src/manager.ts`
- Date/version: 2026-09-11
- Access method: `read`
- Used for: Verificación del flujo de invocación `manager.run` y `manager.continueTask` hacia `this.runner` (`sdkSubagentRunner`).
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Confirma que `ctx` se propaga a través de `launchAttempt` directamente al runner.

### S-017: Subagents Run Tool Implementation
- Family: IMPLEMENTATION
- URL or locator: `/home/j0k3r/projects/pi-subagents-j0k3r/src/tools/subagent-run.ts`
- Date/version: 2026-09-11
- Access method: `read`
- Used for: Verificación de la inyección de `pi` en el contexto: `manager.run(params, { ...ctx, pi }, ...)` (línea 94).
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Muestra que `ctx.pi` está presente durante la ejecución normal de `subagent_run`.

### S-018: Subagents Continue Tool and Registry Implementation
- Family: IMPLEMENTATION
- URL or locator: `/home/j0k3r/projects/pi-subagents-j0k3r/src/tools/subagent-continue.ts` y `/home/j0k3r/projects/pi-subagents-j0k3r/src/tools/registry.ts`
- Date/version: 2026-09-12 / 2026-08-20
- Access method: `read`
- Used for: Identificación del gap de propagación de `pi` en la herramienta `subagent_continue` (`createSubagentContinueTool` no recibía ni pasaba `pi`).
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Permite corregir la vía de continuación para que herede las mismas directrices que el lanzamiento inicial.

### S-019: Subagents Tool Guidelines Unit Test
- Family: IMPLEMENTATION
- URL or locator: `/home/j0k3r/projects/pi-subagents-j0k3r/test/runner-guidelines.test.ts`
- Date/version: 2026-09-19
- Access method: `read`
- Used for: Evidencia de por qué la regresión no fue detectada por las pruebas automatizadas.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Todos los tests simulaban un objeto falso `{ getTools: () => [...] }` en vez de usar la API real de Pi (`getAllTools` y `getActiveTools`).

### S-020: Subagents Interaction Bridge Unit Test
- Family: IMPLEMENTATION
- URL or locator: `/home/j0k3r/projects/pi-subagents-j0k3r/test/runner/interaction-bridge.test.ts`
- Date/version: 2026-09-19
- Access method: `read`
- Used for: Evidencia adicional de simulación de `getTools` (líneas 600-645) que forzaba a `sdkSubagentRunner` a usar dicho método ficticio.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Demuestra que la suite asumía erróneamente la existencia de `getTools()` en la interfaz `pi`.

### S-021: Observation 3005 - Confirm unchanged subagent isolation after reload
- Family: IMPLEMENTATION
- URL or locator: `mem:3005`
- Date/version: 2026-09-19 09:03:53
- Access method: `mem_get_observation`
- Used for: Contexto histórico del síntoma observado: subagente recibía únicamente su persona, esquemas de herramientas y tarea delegada, sin instrucciones de CodeGraph ni mensajes observables de lifecycle hooks.
- Usefulness: SUPPORTING
- Confidence impact: HIGH
- Notes: Confirma la observación empírica del usuario y descarta que el problema proviniese de configuraciones deshabilitadas o supresión de eventos de lifecycle.
