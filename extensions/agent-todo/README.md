# Pi Agent Todo Extension

[English](#english) | [Español](#español)

## English

Pi extension that gives the agent a single active task checklist for the current conversation branch. In this agent-dir checkout it lives at `extensions/agent-todo`; when copied into a project-local Pi setup the equivalent path is `.pi/extensions/agent-todo`.

### What it provides

- LLM-callable `agent_todo` tool for creating, showing, completing, reopening, and clearing the active todo.
- A compact above-chat widget that shows the active todo and progress, collapsed by default.
- `ctrl+space` shortcut to expand/collapse only the above-chat todo widget.
- Optional provider data for other extensions, such as the Sidebar extension.
- Branch-aware reconstruction from prior `agent_todo` tool results on session start/tree navigation.
- Low-noise tool rendering: mutation results show compact summaries instead of the full checklist every time.

### Tool

| Tool | Purpose |
|---|---|
| `agent_todo` | Manage a single active todo for substantial multi-step work. |

#### Usage policy

Use `agent_todo` only when a checklist adds coordination value, such as:

- long, tedious, multi-phase, or high-coordination tasks;
- broad investigations;
- multi-file changes;
- PRD/SDD/OpenSpec workflows;
- refactors, migrations, or tasks with several validations/checkpoints.

Do not use `agent_todo` for direct answers, tiny inspections, small approved edits, simple commit/push operations, or obvious short tasks where a conversational plan is enough.

#### Supported actions

Every call requires an `action` field.

| Action | Required fields | Description |
|---|---|---|
| `create` | `title`; optional `body`, `steps` | Create the active todo. If `steps` is omitted, the title becomes the single step. |
| `show` | none beyond `action` | Return the current active todo state. |
| `complete_step` | `step_id` | Mark one step complete. |
| `complete_all` | none beyond `action` | Mark all remaining steps complete and close the todo. Prefer this when all steps are done. |
| `complete_range` | `range` or `start_step_id` + `end_step_id` | Mark an inclusive range complete, for example `2-4`. |
| `reopen_step` | `step_id` | Reopen a completed/current todo step and reactivate the todo. |
| `clear` | none beyond `action` | Clear the current todo. |

Validation notes:

- `title` is required and must be non-empty for `create`.
- Optional `body`, when provided, must be non-empty.
- `steps`, when provided, must contain non-empty strings and is capped at 20 steps.

#### Examples

```json
{"action":"create","title":"implement feature","steps":["write failing test","implement","validate"]}
```

```json
{"action":"complete_all"}
```

```json
{"action":"complete_range","range":"2-4"}
```

```json
{"action":"complete_range","start_step_id":"2","end_step_id":"4"}
```

### Widget and shortcut

The extension renders the active todo above the chat/editor with `ctx.ui.setWidget('agent-todo', ...)`.

- Collapsed view is the default: dim compact summary, for example:

```text
Agent Todo: implement feature · 2/5 complete · 3 open
ctrl+space to expand
```

- Expanded view: title, progress, step list, and `ctrl+space to collapse` hint.

Shortcut:

```text
ctrl+space
```

The shortcut only toggles the above-chat widget. It does not collapse or modify Sidebar extension rendering because the sidebar reads provider data independently.

### Provider contract

The provider name is `agent-todo.activeTodo`. At runtime the compatible provider is exposed through `pi.agentTodo`, `ctx.agentTodo`, and `globalThis.__PI_AGENT_TODO_PROVIDER__` rather than through a generic provider registry.

Consumers can read the active todo without parsing tool output. The Sidebar extension uses this to render its Todo section and should fail closed if no provider/active todo exists.

Provider payload shape:

```ts
{
  version: 1;
  source: "agent-todo";
  active_todo: {
    id: string;
    title: string;
    body?: string;
    steps: Array<{ id: string; text: string; status: string }>;
    updated_at: string;
  } | null;
}
```

When there is no active todo, `active_todo` is `null`.

### Runtime behavior

- One active todo is allowed at a time.
- Completing the final open step closes the active todo.
- `complete_all` closes the active todo in one action.
- `complete_range` accepts an inclusive numeric range (`2-4`) or start/end step ids.
- `reopen_step` can reopen a step on the current active or completed todo, including an already-open step; after `clear`, there is no todo to reopen.
- On session start or tree navigation, state is reconstructed from the current branch's prior successful version-1 `agent_todo` tool results.
- On shutdown, the above-chat widget and provider are cleaned up.

### Development

Install dependencies once:

```bash
cd extensions/agent-todo
npm install
```

Run validation:

```bash
cd extensions/agent-todo
npm test
npm run typecheck
```

From outside this checkout, use the absolute agent-dir path, for example `cd ~/.pi/agent/extensions/agent-todo`.

After changing extension code during an interactive Pi session, run:

```text
/reload
```

## Español

Extensión de Pi que le da al agente una única checklist activa para la rama de conversación actual. En este checkout de agent-dir vive en `extensions/agent-todo`; cuando se copia a una configuración Pi local de proyecto, la ruta equivalente es `.pi/extensions/agent-todo`.

### Qué proporciona

- Tool invocable por el LLM, `agent_todo`, para crear, mostrar, completar, reabrir y limpiar el todo activo.
- Widget compacto arriba del chat que muestra el todo activo y el progreso, colapsado por defecto.
- Atajo `ctrl+space` para expandir/colapsar solo el widget de todo arriba del chat.
- Datos opcionales de provider para otras extensiones, como Sidebar.
- Reconstrucción consciente de ramas a partir de resultados previos exitosos de `agent_todo` al iniciar sesión o navegar el árbol.
- Renderizado de baja señal/ruido: los resultados de mutación muestran resúmenes compactos en vez de repetir toda la checklist cada vez.

### Tool

| Tool | Propósito |
|---|---|
| `agent_todo` | Gestiona un único todo activo para trabajos multi-paso sustanciales. |

#### Política de uso

Usa `agent_todo` solo cuando una checklist agrega valor de coordinación, por ejemplo:

- tareas largas, tediosas, multifase o con alta coordinación;
- investigaciones amplias;
- cambios multiarchivo;
- workflows PRD/SDD/OpenSpec;
- refactors, migraciones o tareas con varias validaciones/checkpoints.

No uses `agent_todo` para respuestas directas, inspecciones mínimas, ediciones pequeñas aprobadas, operaciones simples de commit/push o tareas obviamente cortas donde un plan conversacional alcanza.

#### Acciones soportadas

Cada llamada requiere un campo `action`.

| Acción | Campos requeridos | Descripción |
|---|---|---|
| `create` | `title`; opcionales `body`, `steps` | Crea el todo activo. Si `steps` se omite, el título se convierte en el único paso. |
| `show` | ninguno además de `action` | Devuelve el estado actual del todo activo. |
| `complete_step` | `step_id` | Marca un paso como completado. |
| `complete_all` | ninguno además de `action` | Marca todos los pasos restantes como completos y cierra el todo. Preferir cuando todos los pasos están hechos. |
| `complete_range` | `range` o `start_step_id` + `end_step_id` | Marca completo un rango inclusivo, por ejemplo `2-4`. |
| `reopen_step` | `step_id` | Reabre un paso completado/actual y reactiva el todo. |
| `clear` | ninguno además de `action` | Limpia el todo actual. |

Notas de validación:

- `title` es requerido y no puede estar vacío en `create`.
- `body` opcional, cuando se provee, no puede estar vacío.
- `steps`, cuando se provee, debe contener strings no vacíos y está limitado a 20 pasos.

#### Ejemplos

```json
{"action":"create","title":"implement feature","steps":["write failing test","implement","validate"]}
```

```json
{"action":"complete_all"}
```

```json
{"action":"complete_range","range":"2-4"}
```

```json
{"action":"complete_range","start_step_id":"2","end_step_id":"4"}
```

### Widget y atajo

La extensión renderiza el todo activo arriba del chat/editor con `ctx.ui.setWidget('agent-todo', ...)`.

- La vista colapsada es el default: resumen compacto tenue, por ejemplo:

```text
Agent Todo: implement feature · 2/5 complete · 3 open
ctrl+space to expand
```

- Vista expandida: título, progreso, lista de pasos y pista `ctrl+space to collapse`.

Atajo:

```text
ctrl+space
```

El atajo solo alterna el widget arriba del chat. No colapsa ni modifica el render de Sidebar porque la sidebar lee datos de provider de forma independiente.

### Contrato de provider

El nombre del provider es `agent-todo.activeTodo`. En runtime el provider compatible se expone mediante `pi.agentTodo`, `ctx.agentTodo` y `globalThis.__PI_AGENT_TODO_PROVIDER__`, no mediante un registry genérico de providers.

Los consumidores pueden leer el todo activo sin parsear salida de tools. La extensión Sidebar usa esto para renderizar su sección Todo y debe fallar de forma cerrada si no existe provider/todo activo.

Forma del payload del provider:

```ts
{
  version: 1;
  source: "agent-todo";
  active_todo: {
    id: string;
    title: string;
    body?: string;
    steps: Array<{ id: string; text: string; status: string }>;
    updated_at: string;
  } | null;
}
```

Cuando no hay todo activo, `active_todo` es `null`.

### Comportamiento runtime

- Se permite un único todo activo a la vez.
- Completar el último paso abierto cierra el todo activo.
- `complete_all` cierra el todo activo en una sola acción.
- `complete_range` acepta un rango numérico inclusivo (`2-4`) o ids de paso inicio/fin.
- `reopen_step` puede reabrir un paso en el todo activo o completado actual, incluso si el paso ya está abierto; después de `clear`, no hay todo para reabrir.
- Al iniciar sesión o navegar el árbol, el estado se reconstruye a partir de resultados previos exitosos versión 1 de `agent_todo` en la rama actual.
- Al cerrar, se limpian el widget arriba del chat y el provider.

### Desarrollo

Instalar dependencias una vez:

```bash
cd extensions/agent-todo
npm install
```

Ejecutar validación:

```bash
cd extensions/agent-todo
npm test
npm run typecheck
```

Desde fuera de este checkout, usar la ruta absoluta del agent-dir, por ejemplo `cd ~/.pi/agent/extensions/agent-todo`.

Después de cambiar código de la extensión durante una sesión interactiva de Pi, ejecutar:

```text
/reload
```
