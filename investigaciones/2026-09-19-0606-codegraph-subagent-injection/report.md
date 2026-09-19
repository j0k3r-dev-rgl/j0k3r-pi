# Diagnóstico y Resolución de la Inyección de Instrucciones de CodeGraph en Subagentes Lean

## Executive Summary

La extensión CodeGraph (`extensions/codegraph/`) no inyecta instrucciones en el agente principal mediante eventos de ciclo de vida (`before_agent_start`, `context` o similares), sino exclusivamente a través de los metadatos estándar de herramientas de Pi: `promptSnippet` y `promptGuidelines` dentro de `pi.registerTool()`. En el agente principal, el núcleo de Pi recopila estos metadatos automáticamente y los formatea en las secciones `Available tools:` y `Guidelines:` de la plantilla por defecto del sistema.

En los subagentes anidados que operan en modo lean (`session_resources: "lean"`), el núcleo de Pi utiliza `DefaultResourceLoader` con `systemPromptOverride`, lo que establece un `customPrompt` con las instrucciones Markdown del subagente. Por diseño canónico del motor de prompts de Pi (`dist/core/system-prompt.js`), la presencia de un `customPrompt` omite de forma íntegra la plantilla por defecto y, con ella, las secciones `Available tools:` y `Guidelines:`. Para compensar este comportamiento intencionado, el paquete de subagentes (`pi-subagents-j0k3r`) implementó recientemente una rutina de composición (`tool-guidelines.ts`), pero esta falla completamente en tiempo de ejecución debido a una discrepancia de símbolos con la API real de Pi: intenta invocar un método inexistente `source.getTools()`, cuando los métodos reales del contrato de Pi son `pi.getAllTools(): ToolInfo[]` y `pi.getActiveTools(): string[]`. Como consecuencia, la lista de directrices extraídas siempre resulta vacía, los comodines como `codegraph_*` se descartan y las directrices jamás llegan al prompt del subagente.

La solución mínima y libre de sobreingeniería (KISS/YAGNI) consiste en corregir la resolución de llamadas en `tool-guidelines.ts` y `sdk-runner.ts` para que lean de `getAllTools()` y `getActiveTools()`, propagar la referencia `pi` en la herramienta `subagent_continue`, y actualizar las pruebas unitarias para validar contra el contrato real de `ExtensionAPI`.

---

## Research Question

¿Por qué las directrices e instrucciones de la extensión CodeGraph (`/home/j0k3r/.pi/agent/extensions/codegraph/`) se inyectan en el prompt del agente principal de Pi pero quedan completamente ausentes en los subagentes anidados en modo lean, y cuál es la implementación mínima y el camino de pruebas de regresión para asegurar su inyección respetando el aislamiento de contexto?

---

## Recommendation or Answer

1. **Causa raíz confirmada**: CodeGraph no utiliza ningún hook de ciclo de vida (`before_agent_start`, `context`, etc.) [S-001, S-002]. La inyección en el agente principal ocurre automáticamente a través de la plantilla por defecto del sistema de Pi usando `promptSnippet` y `promptGuidelines` [S-003, S-007, S-008]. En subagentes lean, esta plantilla por defecto es omitida intencionadamente al usarse `systemPromptOverride` [S-008, S-010]. La capa de adaptación creada en `pi-subagents-j0k3r` (`src/runner/tool-guidelines.ts` y `src/runner/sdk-runner.ts`) para anexar dichas directrices al prompt lean falla silenciosamente porque invoca `source.getTools()`, un método inexistente en la API de Pi [S-007, S-012, S-013].
2. **Solución recomendada (Mínima y Canónica)**:
   - Modificar `extractActiveToolGuidelines` en `src/runner/tool-guidelines.ts` para consultar `source?.getAllTools?.() ?? source?.getTools?.()`, extrayendo `promptGuidelines` de los objetos `ToolInfo` [S-012, S-013].
   - Modificar `activeToolNames` en `src/runner/sdk-runner.ts` para consultar `source?.getActiveTools?.() ?? source?.getTools?.()`, permitiendo que los patrones comodín como `codegraph_*` se expandan correctamente contra las herramientas activas de la sesión padre [S-014, S-015].
   - Pasar `pi` a `createSubagentContinueTool(manager, pi)` en `src/tools/registry.ts` y propagarlo como `{ ...ctx, pi }` en `src/tools/subagent-continue.ts` para garantizar paridad en reanudaciones [S-018].
   - Actualizar la suite de pruebas unitarias (`test/runner-guidelines.test.ts` e `interaction-bridge.test.ts`) para verificar la integración con `getAllTools()` y `getActiveTools()` además de mantener compatibilidad retrospectiva [S-019, S-020].

---

## Key Findings

| Aspecto | Agente Principal (Orquestador) | Subagente Anidado (Lean Mode) | Evidencia |
| :--- | :--- | :--- | :--- |
| **Mecanismo de CodeGraph** | `promptSnippet` y `promptGuidelines` en `pi.registerTool` | Idéntico; no hay hooks específicos de subagente | `extensions/codegraph/src/tools/*.ts` [S-001 - S-006] |
| **Construcción del System Prompt** | Pi ejecuta `buildSystemPrompt` con `customPrompt: undefined`. Se renderizan `Available tools:` y `Guidelines:` | Pi ejecuta `buildSystemPrompt` con `customPrompt: instructions`. Se **omiten** `Available tools:` y `Guidelines:` | `dist/core/system-prompt.js:17-38` [S-008] |
| **Aislamiento de Extensiones** | Todas las extensiones y handlers de eventos activos | `isolateSubagentExtensions` restringe eventos a `tool_call`, `tool_result`, `user_bash` | `sdk-runner.ts:47-59` [S-014] |
| **Expansión de Comodines (`codegraph_*`)** | N/A (herramientas registradas globalmente) | Falla: `activeToolNames` invoca `getTools()` inexistente; retorna `undefined` y descarta comodines | `sdk-runner.ts:31` y `tool-patterns.ts:24` [S-014, S-015] |
| **Extracción de Guidelines** | Recopiladas por `AgentSession._refreshToolRegistry` | Falla: `extractActiveToolGuidelines` invoca `getTools()` inexistente; retorna array vacío | `tool-guidelines.ts:10` [S-013] |
| **Comportamiento en Smoke Test** | Directrices de CodeGraph visibles en el prompt | Sin directrices de CodeGraph visibles en el prompt | Observación Engram 3005 [S-021] |

---

## Evidence Review

### 1. El contrato real de CodeGraph: Sin lifecycle hooks
La inspección exhaustiva de `/home/j0k3r/.pi/agent/extensions/codegraph/` confirma que el módulo no se suscribe a ningún evento de ciclo de vida del agente:
- En `index.ts` (líneas 18–22) [S-001], la función de entrada `codegraphExtension(pi, options)` únicamente valida si la extensión está habilitada en `.pi/extensions.json` y ejecuta `registerCodeGraphTools(pi)`.
- En `src/tools/index.ts` (líneas 7–12) [S-002], registra cuatro herramientas: `codegraph_explore`, `codegraph_status`, `codegraph_manage` y `codegraph_sync`.
- Cada herramienta define metadatos declarativos:
  - `codegraph_explore` [S-003]: `promptSnippet` (l. 22), `promptGuidelines` (3 viñetas, ll. 23–27).
  - `codegraph_status` [S-004]: `promptSnippet` (l. 12), `promptGuidelines` (2 viñetas, ll. 13–16).
  - `codegraph_manage` [S-005]: `promptSnippet` (l. 16), `promptGuidelines` (4 viñetas, ll. 17–22).
  - `codegraph_sync` [S-006]: `promptSnippet` (l. 27), `promptGuidelines` (3 viñetas, ll. 28–32).
- **Conclusión fáctica**: No existe supresión de hooks en CodeGraph porque CodeGraph no implementa `pi.on("before_agent_start", ...)` ni `pi.on("context", ...)`.

### 2. Mecánica en el Agente Principal
- En el arranque del agente interactivo, `AgentSession` inicializa el registro en `_refreshToolRegistry` (`dist/core/agent-session.js:2085-2105`) [S-009].
- Extrae los snippets en `this._toolPromptSnippets` y las directrices en `this._toolPromptGuidelines`.
- Al generar el prompt en `_rebuildSystemPrompt(validToolNames)` (`agent-session.js:738-765`) [S-009], Pi pasa estas colecciones a `buildSystemPrompt(options)` (`dist/core/system-prompt.js`) [S-008].
- Al no existir `customPrompt` en el agente orquestador principal, `buildSystemPrompt` ejecuta las líneas 44–75 [S-008]:
  ```javascript
  const visibleTools = tools.filter((name) => !!toolSnippets?.[name]);
  const toolsList = visibleTools.length > 0
    ? visibleTools.map((name) => `- ${name}: ${toolSnippets[name]}`).join("\n")
    : "(none)";
  // ...
  for (const guideline of promptGuidelines ?? []) {
    addGuideline(guideline.trim());
  }
  ```
  Esto introduce automáticamente los textos de CodeGraph en las secciones `Available tools:` y `Guidelines:`.

### 3. Mecánica en el Subagente Lean y Causa del Fallo
- Cuando un subagente es ejecutado (`subagent_run` en `src/tools/subagent-run.ts:94`) [S-017], se invoca `manager.run(params, { ...ctx, pi }, ...)` inyectando la referencia `pi` de la sesión padre en el contexto.
- El gestor de subagentes (`src/manager.ts:819`) [S-016] lanza el runner de SDK (`sdkSubagentRunner` en `src/runner/sdk-runner.ts`) [S-014], el cual configura la sesión con `session_resources: "lean"`.
- En `src/runner/sdk-runner.ts:150-165` [S-014], se instancia un `DefaultResourceLoader` con:
  ```typescript
  systemPromptOverride: () => systemPrompt,
  extensionsOverride: isolateSubagentExtensions,
  noSkills: true,
  noPromptTemplates: true,
  noThemes: true,
  noContextFiles: true,
  ```
- En `dist/core/resource-loader.js:383` [S-010], `this.systemPrompt` toma el valor de `systemPrompt`.
- Al llamar a `createAgentSession` (`dist/core/sdk.js:66-260`) [S-011], `AgentSession._rebuildSystemPrompt` recupera dicho valor y lo asigna a `options.customPrompt` [S-009].
- En `dist/core/system-prompt.js:17-38` [S-008], se evalúa:
  ```javascript
  if (customPrompt) {
    let prompt = customPrompt;
    if (appendSection) prompt += appendSection;
    if (contextFiles.length > 0) { /* ... */ }
    if (skillFileReadTool && skills.length > 0) { /* ... */ }
    prompt += `\nCurrent working directory: ${promptCwd}\n`;
    return prompt;
  }
  ```
  **Comportamiento fundamental de Pi**: `buildSystemPrompt` sale inmediatamente. Toda la lógica de herramientas y directrices (`Available tools:` y `Guidelines:`) es ignorada.
- Para solucionar esto en subagentes lean, `pi-subagents-j0k3r` diseñó la función `composeLeanSystemPrompt` (`src/runner/tool-guidelines.ts`) [S-013], la cual busca las directrices y las anexa bajo el encabezado `## Active Tool Guidelines`.
- **El error de llamada (Bug)**:
  - En `src/runner/tool-guidelines.ts:10` [S-013]:
    ```typescript
    for (const source of [ctx?.pi, ctx]) {
      try {
        const tools = source?.getTools?.(); // ¡NO EXISTE EN PI!
        if (Array.isArray(tools)) { rawTools = tools; break; }
      } catch {}
    }
    ```
  - En `src/runner/sdk-runner.ts:31` [S-014]:
    ```typescript
    function activeToolNames(ctx: any): string[] | undefined {
      for (const source of [ctx?.pi, ctx]) {
        try {
          const tools = source?.getTools?.(); // ¡NO EXISTE EN PI!
          // ...
    ```
- En el contrato oficial de Pi (`ExtensionAPI`, ver `dist/core/extensions/types.d.ts` y `docs/extensions.md`) [S-007, S-012], los métodos disponibles son:
  - `pi.getActiveTools(): string[]` (nombres de herramientas activas en la sesión).
  - `pi.getAllTools(): ToolInfo[]` (donde cada objeto `ToolInfo` contiene `{ name, description, parameters, promptGuidelines, sourceInfo }`).
- Ni `ExtensionAPI` (`pi`) ni `ExtensionContext` (`ctx`) exponen jamás un método llamado `getTools`.
- Al fallar silenciosamente la llamada, `rawTools` es `undefined`, `extractActiveToolGuidelines` retorna `[]`, `activeToolNames` retorna `undefined`, los patrones como `codegraph_*` se eliminan por completo en `expandToolPatterns` [S-015], y el subagente recibe un prompt limpio únicamente con su persona Markdown.
- Los tests unitarios en `test/runner-guidelines.test.ts` [S-019] e `interaction-bridge.test.ts` [S-020] no detectaron el problema porque crearon objetos simulados con `{ getTools: () => [...] }`, mockeando una API ficticia.

---

## Trade-offs and Risks

| Enfoque | Pros | Contras / Riesgos | Veredicto |
| :--- | :--- | :--- | :--- |
| **Opción A: Corregir símbolos en `pi-subagents-j0k3r`** (`getAllTools` y `getActiveTools`) | Mínimo impacto, respeta la arquitectura existente, no altera Pi core ni extensiones, mantiene aislamiento lean estricto. | Requiere mantener fallback a `getTools` si se desea evitar romper mocks externos antiguos. | **RECOMENDADA** (Cumple KISS/YAGNI) |
| **Opción B: Alterar CodeGraph para inyectar via `before_agent_start`** | Ninguno. Viola el contrato de aislamiento lean de subagentes. | Inyectaría instrucciones no deseadas en subagentes que no tengan permitido CodeGraph; rompería la independencia de extensiones. | **RECHAZADA** |
| **Opción C: Modificar el core de Pi (`system-prompt.js`)** para incluir guidelines cuando hay `customPrompt` | Resolvería el problema a nivel harness global. | Modificaría el core distribuido de Pi (`@earendil-works/pi-coding-agent`); podría generar regresiones en otros paquetes y alterar prompts intencionalmente puros. | **RECHAZADA** |

### Riesgos de Aislamiento de Contexto
- **Fuga de contexto padre**: Al consultar `pi.getAllTools()`, se obtienen todas las herramientas registradas en el orquestador padre. Es **crítico** que el filtrado por `allowedSet` se mantenga riguroso:
  ```typescript
  const allowedSet = new Set(allowedTools);
  // Solo se extraen directrices de herramientas cuyo nombre esté explícitamente en allowedSet
  ```
  De este modo, si un subagente solo tiene permitido `read`, jamás recibirá directrices de `codegraph_explore` ni de ninguna otra herramienta ajena.
- **Inyección redundante**: Solo se inyectan `promptGuidelines` asociadas a herramientas efectivas de la subsesión. No se transfieren historial de chat, variables ni archivos de contexto (`AGENTS.md`).

---

## Alternatives Considered

1. **Inyección de instrucciones mediante directiva en el Markdown del subagente (`subagents/*.md`)**:
   - Se descartó porque exigiría duplicar manualmente las directrices de CodeGraph en cada subagente (`researcher.md`, `discovery.md`), violando el principio DRY y perdiendo sincronización ante actualizaciones de CodeGraph.
2. **Eliminación del modo `lean` (`session_resources: "full"`)**:
   - Se descartó rotundamente. El modo lean es un requisito canónico de `subagents-configuration` para evitar contaminación de contexto (skills de orquestación, plantillas de usuario y hooks de sesión padre).

---

## Unknowns and Limits

- **Disponibilidad de `promptSnippet` en subagentes**: El método `getAllTools()` de Pi proyecta la interfaz `ToolInfo`, la cual incluye `promptGuidelines` pero omite `promptSnippet` (que Pi reserva para el mapeo interno de `Available tools:`). No obstante, los subagentes reciben los esquemas JSON completos con la descripción funcional de cada herramienta (`description`), por lo que la omisión del snippet de una sola línea no afecta la capacidad del modelo para usar la herramienta; lo verdaderamente crítico son las directrices de comportamiento (`promptGuidelines`), que sí están 100% disponibles en `ToolInfo`.
- **Herramientas registradas dinámicamente**: Si una herramienta se registra después del arranque de Pi mediante eventos en caliente, `pi.getAllTools()` la reflejará de inmediato sin requerir `/reload`.

---

## Recommended Next Actions

Para el orquestador y equipo de desarrollo, la implementación y validación exacta consta de los siguientes pasos:

### 1. Modificaciones de Código Mínimas

#### A. `/home/j0k3r/projects/pi-subagents-j0k3r/src/runner/tool-guidelines.ts`
Actualizar `extractActiveToolGuidelines` para soportar la API real de Pi:
```typescript
export function extractActiveToolGuidelines(allowedTools: string[], ctx: any): string[] {
  let rawTools: any[] | undefined;
  for (const source of [ctx?.pi, ctx]) {
    try {
      const tools = source?.getAllTools?.() ?? source?.getTools?.();
      if (Array.isArray(tools)) {
        rawTools = tools;
        break;
      }
    } catch {}
  }
  // Resto de la lógica se mantiene idéntica (filtrado por allowedSet, normalización y deduplicación)
```

#### B. `/home/j0k3r/projects/pi-subagents-j0k3r/src/runner/sdk-runner.ts`
Actualizar `activeToolNames` para soportar `getActiveTools()` y `getAllTools()`:
```typescript
function activeToolNames(ctx: any): string[] | undefined {
  for (const source of [ctx?.pi, ctx]) {
    try {
      const tools = source?.getActiveTools?.() ?? source?.getTools?.();
      if (Array.isArray(tools)) {
        return tools
          .map((tool: unknown) => typeof tool === 'string' ? tool : (tool as { name?: unknown })?.name)
          .filter((name: unknown): name is string => typeof name === 'string' && name.length > 0);
      }
    } catch {}
  }
  return undefined;
}
```

#### C. `/home/j0k3r/projects/pi-subagents-j0k3r/src/tools/registry.ts` y `subagent-continue.ts`
Propagar `pi` en `subagent_continue` para paridad completa:
- En `registry.ts:14`: `if (readSubagentsConfig(cwd).enable_continue) pi.registerTool(createSubagentContinueTool(manager, pi));`
- En `subagent-continue.ts`: recibir `pi?: any` en la factoría y ejecutar `manager.continueTask(params, { ...ctx, pi }, ...)` en la línea 71.

### 2. Plan de Pruebas de Regresión

En `/home/j0k3r/projects/pi-subagents-j0k3r/test/runner-guidelines.test.ts`, añadir las pruebas que verifiquen el contrato real de Pi:
1. **Prueba con contrato real de Pi (`getAllTools`)**:
   - Pasar `ctx = { pi: { getAllTools: () => [{ name: 'codegraph_explore', promptGuidelines: ['Use codegraph_status before codegraph_explore'] }] } }`.
   - Verificar que `composeLeanSystemPrompt` genera la sección `## Active Tool Guidelines` con la viñeta correspondiente.
2. **Prueba de aislamiento estricto**:
   - Configurar `allowedTools = ['read']` mientras `getAllTools` contiene directrices de `codegraph_explore`.
   - Verificar que el prompt resultante **no** contiene mención alguna de CodeGraph.
3. **Prueba de expansión de comodines con `getActiveTools`**:
   - Simular `getActiveTools = () => ['read', 'codegraph_explore', 'codegraph_status']` y patrones `['codegraph_*']`.
   - Verificar que se extraen únicamente las directrices de las herramientas coincidentes activas.
4. **Prueba de compatibilidad retrospectiva**:
   - Verificar que los tests preexistentes basados en `getTools()` continúan ejecutándose y pasando satisfactoriamente.
