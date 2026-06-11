# Pi Agent Todo Extension

Project-local Pi extension that gives the agent a single active task checklist for the current conversation branch.

## What it provides

- LLM-callable `agent_todo` tool for creating, showing, completing, reopening, and clearing the active todo.
- A compact above-chat widget that shows the active todo and progress, collapsed by default.
- `ctrl+space` shortcut to expand/collapse only the above-chat todo widget.
- Optional provider data for other extensions, such as the Sidebar extension.
- Branch-aware reconstruction from prior `agent_todo` tool results on session start/tree navigation.
- Low-noise tool rendering: mutation results show compact summaries instead of the full checklist every time.

## Tool

| Tool | Purpose |
|---|---|
| `agent_todo` | Manage the single active agent todo for the current branch. |

### Supported actions

| Action | Required fields | Description |
|---|---|---|
| `create` | `title`; optional `body`, `steps` | Create the active todo. If `steps` is omitted, the title becomes the single step. |
| `show` | none | Return the current active todo state. |
| `complete_step` | `step_id` | Mark one step complete. |
| `complete_all` | none | Mark all remaining steps complete and close the todo. Prefer this when all steps are done. |
| `complete_range` | `range` or `start_step_id` + `end_step_id` | Mark an inclusive range complete, for example `2-4`. |
| `reopen_step` | `step_id` | Reopen a completed/current todo step and reactivate the todo. |
| `clear` | none | Clear the current todo. |

### Examples

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

## Widget and shortcut

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

## Provider contract

The extension publishes a compatible provider under:

```text
agent-todo.activeTodo
```

Consumers can read the active todo without parsing tool output. The Sidebar extension uses this to render its Todo section and should fail closed if no provider/active todo exists.

## Runtime behavior

- One active todo is allowed at a time.
- Completing the final open step closes the active todo.
- `complete_all` closes the active todo in one action.
- `complete_range` accepts an inclusive numeric range (`2-4`) or start/end step ids.
- On session start or tree navigation, state is reconstructed from the current branch's prior `agent_todo` tool results.
- On shutdown, the above-chat widget and provider are cleaned up.

## Development

Install dependencies once:

```bash
cd .pi/extensions/agent-todo
npm install
```

Run validation:

```bash
cd .pi/extensions/agent-todo
npm test
npm run typecheck
```

After changing extension code during an interactive Pi session, run:

```text
/reload
```
