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

Extensión de Pi que proporciona al agente una única checklist activa para la rama de conversación actual.

### Resumen

Agent Todo sirve para trabajos multi-paso donde conviene mantener estado visible: investigación larga, implementación por fases, validaciones o coordinación con otros cambios. Expone una herramienta principal, `agent_todo`, y además integra un widget/atajo para mostrar el estado en la TUI.

### Herramientas y capacidades

- `agent_todo`: crea, muestra, completa, reabre o limpia la checklist activa.
- Widget de estado para ver el plan actual sin pedirlo de nuevo.
- Contrato de provider para que otras extensiones consulten el estado.

### Uso recomendado

Úsalo solo cuando una checklist aporte valor real. Para preguntas simples o cambios pequeños, responde directamente sin crear todo.

### Ver más

La sección en inglés contiene el detalle completo de acciones, ejemplos, widget, contrato de provider y validación.
