# Pi Subagents Extension

Pi extension for delegating work to markdown-defined subagents. Continuation is unavailable by default: `subagent_continue` is exposed only when effective `enable_continue` is explicitly `true`. The extension registers tools for the orchestrator, runs subagents in isolated in-memory Pi sessions, tracks task history, provides a TUI history panel, and uses automatic CPAMC model allocation with orchestrator fallback.

## What it provides

- Markdown-defined subagents loaded from global and project directories.
- `subagent_run` for task-mode or background delegation to one agent per call.
- Optional `subagent_continue` for resuming the exact persisted nested session with an optional continuation-mode override when `enable_continue: true`.
- `subagent_send_message` for live same-parent steering of owned background tasks on supported Pi runtimes.
- Status/result/list/cancel tools for delegated tasks.
- Isolated in-memory agent sessions for each subagent run.
- Subagent markdown used as system prompt, with delegated task/context as the user prompt.
- Project-scoped task history in a global SQLite data/cache location.
- TUI history panel via `/subagents` or `ctrl+,` by default.
- Task-to-background handoff via `ctrl+h` by default, configurable in `subagents.json`.
- Automatic background completion/failure notifications that start or queue a parent-orchestrator response; no polling is needed just to wait.
- TUI execution rendering can expand/collapse tool and rendered component output with `ctrl+o`, show/hide assistant thinking blocks with `ctrl+t`, and display queued/consumed steering messages in the owning task detail timeline.
- Automatic model and effort allocation via CPAMC with orchestrator model/effort fallback.
- Tool allowlist filtering that prevents subagents from delegating to other subagents.
- Generic subagent-to-parent interaction handoff so human decisions happen on the main thread.

## Install as a Pi package

This repository is an installable Pi package named `pi-subagents-j0k3r`.

Install from npm after publishing:

```bash
pi install npm:pi-subagents-j0k3r
```

Install from a Git repository or tag:

```bash
pi install git:https://github.com/<owner>/pi-subagents-j0k3r@<tag-or-commit>
```

Try a local checkout without installing it permanently:

```bash
pi -e ./path/to/pi-subagents-j0k3r
```

Install for one project instead of globally with `-l`:

```bash
pi install -l npm:pi-subagents-j0k3r
```

The package manifest exposes:

```json
{
  "pi": {
    "extensions": ["./index.ts"],
    "skills": ["./skills"]
  }
}
```

The npm metadata includes the `pi-package` keyword required for Pi package gallery discovery. After publishing the npm package, it is eligible to appear on the Pi package page.

Use `/reload` after changing extension code, skill files, config, or markdown subagent definitions during an interactive session.

Package installation scope and configuration scope are independent. A globally installed extension can still use project-local `.pi/subagents.json` and `.pi/subagents/*.md`; a project-local package installation does not require every subagent setting to be project-local.

## Subagent definitions

Subagents are markdown files with optional YAML-like frontmatter.

Load order:

1. Global user agents from `$PI_CODING_AGENT_DIR/agents/*.md`.
2. Global user subagents from `$PI_CODING_AGENT_DIR/subagents/*.md`.
3. Project agents from `.pi/agents/*.md`.
4. Project subagents from `.pi/subagents/*.md`.

Project definitions override global definitions with the same normalized name. Within the same scope, `subagents` definitions override `agents` definitions with the same normalized name and Pi shows a startup warning so the duplicate can be cleaned up.

The npm package is the extension runtime only. It does not ship or load subagent definitions from `node_modules/pi-subagents-j0k3r/agents`; use the directories above, or run `subagent_list_agents` / `subagent({ action: "list" })` to inspect the definitions Pi actually loaded.

Default global agent directory:

```txt
~/.pi/agent
```

Override with:

```bash
PI_CODING_AGENT_DIR=/path/to/pi-agent-dir
```

### Definition format

Example:

```md
---
name: discovery
description: investigates isolated ideas, code, documentation, and context7 before deciding whether to start prd/sdd
tools:
  - read
  - bash
  - context7_status
  - context7_search_library
---

# Discovery Subagent

You are an isolated research executor...
```

Supported frontmatter:

| Field | Description |
|---|---|
| `name` | Subagent name. Defaults to filename stem. Normalized to lowercase. |
| `description` | Short description shown by `subagent_list_agents`. |
| `tools` | Tool allowlist for the subagent. Accepts either a comma-separated inline list or a multiline YAML list, but never both in one definition. Entries may include `*` wildcards such as `tool_*`. Wildcards expand only against tools that are active in the current parent session; inactive or blocked tools are ignored. When omitted, the definition gets the built-in default tool list. Configured `default_tools` is used by the runner when a definition has an empty tool list. |
| `subagent_mode` | Optional default execution mode for this definition: `task` or `background`. |

### Tool allowlist formats

Choose exactly one `tools` format per subagent definition.

Comma-separated inline list:

```yaml
tools: read, write, bash
```

Multiline YAML list:

```yaml
tools:
  - read
  - write
  - bash
```

Both examples load the same allowlist: `read`, `write`, and `bash`. Comma splitting applies only to `tools`; scalar fields such as `description` can contain commas without becoming lists.

Tool entries can include `*` wildcards such as `tool_*`. Wildcards expand at runtime only against tools that are currently active in the parent session. If a pattern matches no active tool, it expands to nothing. Blocked `subagent_*` tools remain unavailable even if a pattern would match them.

Do not mix the formats or declare `tools` more than once:

```yaml
# Invalid: inline and multiline formats are mixed.
tools: read, write
  - bash
```

Ambiguous definitions are not loaded. On startup or `/reload`, Pi shows a warning with the subagent name and file path and asks you to choose either the inline or multiline format. The parser accepts frontmatter files with either LF or Windows CRLF line endings.

The markdown body becomes the subagent instructions.

## Project and global config

Choose the narrowest scope that matches the intended behavior:

| Scope | Path | Use it when |
|---|---|---|
| Global defaults | `$PI_CODING_AGENT_DIR/subagents.json`, or `~/.pi/agent/subagents.json` when the environment variable is unset | The setting should apply across projects unless locally overridden. |
| Project-local overrides | `.pi/subagents.json` | This workspace needs different execution defaults, shortcuts, or tools. |
| One definition | Frontmatter in the selected global/project Markdown definition | Only that subagent needs a different tool allowlist, instructions, or `subagent_mode`. |

Config resolves as a field-by-field cascade:

`enable_continue` follows the same cascade and defaults to `false`. Because tool exposure is decided when the extension loads, changing `enable_continue` takes effect after `/reload` or a Pi restart.


1. Project `.pi/subagents.json` values win when present.
2. Missing project fields inherit from global `$PI_CODING_AGENT_DIR/subagents.json` or `~/.pi/agent/subagents.json`.
3. Fields missing from both use built-in defaults.

Avoid copying every global value into project config: add only intentional local overrides unless you specifically want to pin inherited values. Changing where the package is installed does not change this cascade.

Model and thinking effort are allocated by CPAMC, with the current orchestrator as fallback; they are not selected through this configuration cascade or definition frontmatter. See [Model allocation and CPAMC integration](#model-allocation-and-cpamc-integration).

### Asking an agent to configure Subagents

In this agent workspace, `pi-configuration` routes Subagents questions to its internal Subagents configuration module; there is no separate global Subagents skill. Independent package installations still include the bundled `subagents-configuration` skill. If your request does not already name a scope, the agent should explain the cascade and ask whether you want:

1. a global default for every project;
2. a project-local override for the current workspace; or
3. a change to one subagent definition only.

The agent should also ask for unresolved behavior choices—such as whether omitted runs default to `task` or `background`—before editing. A question about how configuration works is not authorization to change files, and the agent should not edit both global and project config unless you explicitly request both.

Example requests:

```txt
Explain whether default_mode belongs in global or project config. Do not edit anything.
Set default_mode to background only for this project.
Explain CPAMC automatic model allocation and the orchestrator fallback. Do not edit configuration.
Give the project-local discovery definition background mode without changing other agents.
```

### Config example

The same JSON shape is valid globally or project-locally; place it only in the scope you intend:

```json
{
  "default_mode": "task",
  "enable_continue": false,
  "timeout_ms": 1200000,
  "stall_timeout_ms": 240000,
  "max_concurrency": 5,
  "debug": false,
  "session_resources": "lean",
  "history_panel_shortcut": "ctrl+,",
  "detail_cancel_shortcut": "x",
  "background_handoff_shortcut": "ctrl+h",
  "default_tools": [
    "read",
    "memory_context",
    "memory_search",
    "memory_get"
  ]
}
```

### Config fields

| Field | Default | Description |
|---|---:|---|
| `default_mode` | `task` | Fallback execution mode when neither the invocation nor the selected definition sets one. Accepts `task` or `background`. |
| `enable_continue` | `false` | Opt-in gate for new continuations and `subagent_continue` tool exposure. Project values override global values; changing it requires `/reload` or restart before tool availability changes. |
| `timeout_ms` | `1200000` | Total timeout per subagent task (20 minutes). |
| `stall_timeout_ms` | `240000` | Inactivity timeout for a subagent session (4 minutes). |
| `max_concurrency` | `5` | Max concurrent subagent tasks per cwd/config pair. |
| `debug` | `false` | Enable bounded runtime/interaction diagnostics in the executing project's `.pi/subagents-debug.log`. Use temporarily and disable after diagnosis. |
| `session_resources` | `lean` | SDK resource loading mode. `lean` uses the subagent markdown body as the nested session system prompt, skips skills, prompt templates, themes, and context files, and loads extensions in tools-only/safety-hook mode so allowlisted extension tools remain available without startup context injection. Use explicit `full` only when a subagent intentionally needs the full Pi resource set. Also accepts camelCase `sessionResources`. |
| `history_panel_shortcut` | `ctrl+,` | Shortcut used to open the subagents history/detail panel. Accepts modified Pi-style shortcuts such as `ctrl+<letter>`, `ctrl+,`, `ctrl+shift+,`, or `shift+alt+,`, and also accepts camelCase `historyPanelShortcut`. |
| `detail_cancel_shortcut` | `x` | Shortcut for the subagents history/detail panel to cancel only the currently selected queued/running subagent. `ctrl+...` values are also registered as a Pi shortcut scoped by the active panel, so they still work when the TUI captures control keys; single-letter values are handled by the panel input. Accepts `ctrl+<letter>`, `ctrl+shift+<letter>`, `ctrl+,`, or one lowercase letter, and also accepts camelCase `detailCancelShortcut`. It is ignored when the panel is not active or the selected subagent is already finished. |
| `background_handoff_shortcut` | `ctrl+h` | Shortcut used to send a running task-mode subagent to the background. Accepts `ctrl+<letter>` and also accepts camelCase `backgroundHandoffShortcut`. |
| `default_tools` | see below | Fallback tool allowlist used by the runner when an agent definition has an empty tool list. Supports the same `*` wildcard behavior as frontmatter `tools`. Omitted frontmatter `tools` uses the built-in default list. |

Default tools:

```json
["read", "memory_context", "memory_search", "memory_get"]
```

The former UI selector `mode: "opencode" | "claude"` is no longer a supported config field. Do not add it. History/background visibility and task-to-background handoff are available together and are configured independently through their shortcut fields.

Subagent delegation tools are always blocked from subagent tool allowlists, even if listed:

```txt
subagent_run
subagent_list_agents
subagent_status
subagent_result
subagent_list_tasks
subagent_cancel
any tool starting with subagent_
```

## Model allocation and CPAMC integration

Model allocation is owned automatically by the CPAMC subagent pool (`extensions/cpamc-subagent-pool`) via Pi EventBus hooks:

1. **Allocation Hook**: On task launch (or continuation attempt), `SubagentManager` emits `subagents:task:allocate` with `{ taskId, attempt, parentSessionId, agent, cwd, signal, claimModel }`.
2. **CPAMC Claim**: When CPAMC is present, it claims the allocation and assigns an optimal model (e.g. Gemini 3.8 Flash) and thinking effort (`high`), setting `model_source: 'allocated'` and `effort_source: 'allocated'`.
3. **Orchestrator Fallback**: If CPAMC is not present, unclaimed, or encounters an allocator error, the subagent launch automatically falls back to the current orchestrator model and thinking effort from context (`ctx.model` and `ctx.thinkingLevel`), setting `model_source: 'orchestrator'` and `effort_source: 'orchestrator'`.
4. **Strict Cancellation Isolation**: Cancellation (`signal.aborted`) is never converted into a fallback; aborted tasks halt immediately and release leases.
5. **Continuation Isolation**: Continuations allocate attempt-specific leases (`buildLeaseId({ taskId, attempt })`), isolating continuation attempts from previous attempt cleanups.
6. **Inert Legacy Keys**: Legacy model profiles and default model/effort keys in `subagents.json`, plus model/effort fields in definition frontmatter, no longer select the runtime model. Existing configuration files are not rewritten or deleted. `/subagent-models` and continuation model/effort overrides have been removed; configure execution modes, not model profiles.

## Debug and interaction bridge logs

Debug logging is disabled by default. Enable it in global or project `subagents.json`:

```json
{
  "debug": true
}
```

When enabled, subagents write local debug/audit breadcrumbs to the executing project's `.pi` directory:

```txt
.pi/subagents-debug.log
```

The log is intended for runtime debugging of delegated sessions and generic interaction handoff issues. Interaction bridge entries include safe metadata such as task id, agent name, request id, kind, requester, prompt presence, and payload presence. They intentionally avoid storing raw private data beyond the bounded task/history surfaces already captured for debugging.

Useful event names:

- `runner_event` — compact SDK event shape observed by the subagent runner.
- `interaction_bridge_payload_detected` — runner found a structured interaction request.
- `interaction_bridge_payload_recovered_from_channel` — runner recovered a request from the shared interaction channel.
- `interaction_bridge_request_detected` — manager received an interaction request from the runner.
- `interaction_bridge_prompt_main_thread` — manager is prompting the main user.
- `interaction_bridge_user_response` — main user response was published for the subagent to consume.

## Tools exposed to the orchestrator

| Tool | Purpose |
|---|---|
| `subagent_list_agents` | List loaded markdown-defined subagents. |
| `subagent_run` | Delegate a task to exactly one subagent. Supports `task` and `background` mode. |
| `subagent_continue` | Enabled only when `enable_continue: true`. Resumes a completed, failed, or cancelled task in the same persisted nested Pi session, with an optional continuation-mode override. |
| `subagent_status` | Get status for a delegated task. |
| `subagent_send_message` | Queue a live message for an owned running background task. |
| `subagent_result` | Read the result for a delegated task. |
| `subagent_list_tasks` | List active and persisted delegated tasks for the current cwd. |
| `subagent_cancel` | Cancel a running delegated task. |

Only the main orchestrator should call these tools. Subagents are explicitly prevented from calling `subagent_*` tools.

### `subagent_run`

Parameters:

```ts
{
  agent: string;
  task: string;
  context?: string;
  mode?: "task" | "background";
}
```

Behavior:

- Invocation mode stays optional. Effective resolution is `input.mode ?? definition.subagent_mode ?? config.default_mode`, where `default_mode` falls back to `"task"`.
- `mode: "task"` waits for completion and returns compact task summaries.
- `mode: "background"` returns task IDs immediately. Respond to the user and wait for the automatic completion/failure turn; do not sleep, poll status, or fetch results just to wait. Use status/result tools only when you explicitly need an intermediate status or stored result.
- Batch input is intentionally unsupported: call `subagent_run` once per subagent so each delegation has an isolated lifecycle, result, and failure surface.
- Double Escape during task-mode execution cancels running subagents and aborts the main turn.

Examples:

```ts
// Omitted mode: the selected definition uses its own default.
{ agent: "analyst", task: "review the plan" }

// Explicit override: run this single delegation in background mode.
{ agent: "reviewer", task: "review the plan", mode: "background" }
```

### `subagent_continue`

`subagent_continue` is disabled by default. Set effective `enable_continue: true` and then `/reload` or restart Pi before expecting the tool to appear.

When effective `enable_continue` is `false`, the tool is not registered, direct or stale continuation attempts receive a generic unavailable response, historical task and continuation records remain visible, and failed/cancelled/interrupted/stopping terminal results plus terminal background notifications do not recommend continuation or mention `subagent_continue`.

Parameters:

```ts
{
  task_id: string;
  prompt: string;
  mode?: "task" | "background";
}
```

Behavior:

- Continuations keep the same `task_id` and exact persisted nested Pi session.
- New continuations and continuation guidance are available only while the task cwd resolves `enable_continue: true`.
- Effective continuation mode resolves once as `input.mode ?? previous_task.effective_mode ?? previous_task.mode ?? config.default_mode ?? "task"`.
- `mode: "task"` waits, renders `(task)`, and remains eligible for manual `ctrl+h` handoff.
- `mode: "background"` returns immediately, renders `(background)`, and relies on the automatic completion notification.
- When `mode` is omitted, the continuation preserves the previous task attempt's effective mode. Legacy records without a valid saved mode fall back through `default_mode` and then `task`.

### `subagent_send_message`

Use `subagent_send_message` only for a running background task owned by the exact originating parent session. Successful enqueue is not delivery.

```ts
{ task_id: "subtask_reviewer_...", message: "Please include the missing constraint." }
```

Successful response:

```json
{
  "status": "queued",
  "task_id": "subtask_reviewer_...",
  "pending_message_count": 1,
  "message": "Message accepted into the steering queue; this does not prove model consumption."
}
```

Rejected ownership/runtime examples:

```json
{
  "status": "rejected",
  "reason": "not_owner",
  "message": "Only the exact originating parent Pi session may message this live background task."
}
```

```json
{
  "status": "rejected",
  "reason": "unsupported_runtime",
  "required_pi_version": ">=0.82.1",
  "detected_pi_version": "0.81.0",
  "message": "Live background messaging requires Pi runtime >=0.82.1; detected 0.81.0."
}
```

Live-message requirements, visibility, and lifecycle:

- Live steering requires Pi runtime `>=0.82.1` and an available nested SDK `session.steer(...)` bridge. Compatibility is detected from the Pi SDK version already loaded by the runner; known old or unknown runtimes fail closed.
- Ownership is exact: only the parent Pi session that launched the currently running background attempt can send to it. Continuations rebind ownership to the parent session that starts that attempt.
- A same-parent message may be accepted before the nested steering bridge is ready. It remains in a bounded pending queue and is forwarded exactly once when readiness is established.
- `status: "queued"` proves queue acceptance, not model consumption. The owning `/subagents` task detail timeline renders each message chronologically as queued and then consumed when the SDK confirms consumption, including FIFO handling of identical message text.
- Active `subagent_status` surfaces `pending_message_count`. Terminal `subagent_result` and completion notifications surface `undelivered_message_count`, including `0`.
- Pending queue entries are discarded on completion, cancellation, shutdown, restart, or continuation; they are not replayed into a new attempt.
- Message text is private to the owning task detail timeline and persisted task-detail snapshot. Lists, widgets, completion notifications, result summaries, logs, and unrelated parent sessions expose only safe counts/metadata.
- Live task-mode rendering shows the latest three safe activity labels; live background rendering shows one current activity only.

## Commands and shortcuts

| Entry point | Description |
|---|---|
| `/subagents` | Open the session-focused TUI subagent history panel. |
| `ctrl+,` | Open the TUI subagent history panel by default. Configurable via `history_panel_shortcut` in `subagents.json`. |
| `x` | Cancel the currently selected queued/running subagent from the open history/detail panel by default. Configurable via `detail_cancel_shortcut` in `subagents.json`. |
| `ctrl+h` | Send the running task-mode subagent task to the background by default. Configurable via `background_handoff_shortcut` in `subagents.json`. |
| `ctrl+o` | Expand or collapse rendered tool output and subagent responses in the active execution/detail view. |
| `ctrl+t` | Show or hide assistant thinking blocks in the open subagent execution panel, using Pi's `app.thinking.toggle` keybinding. |

## Task history

Task history is stored in a global data/cache location, while each row remains scoped by project `cwd`:

```txt
$XDG_DATA_HOME/pi/subagents/subagents-history.sqlite
```

Fallback:

```txt
~/.local/share/pi/subagents/subagents-history.sqlite
```

Environment overrides:

```bash
PI_SUBAGENTS_HISTORY_DB_PATH=/absolute/path/to/subagents-history.sqlite
PI_SUBAGENTS_HISTORY_HOME=/absolute/path/to/subagents-history-home
```

The history DB stores:

- task metadata;
- status and timestamps;
- model/effort used;
- usage stats when available;
- result/error/output preview;
- delegated user prompt and subagent system prompt separately;
- compact thread snapshots;
- task events.

When `debug: true` is configured, the extension also may write debug diagnostics to:

```txt
.pi/subagents-debug.log
```

History and debug logging are best-effort: failures to persist them should not break delegation.

## Generic interaction handling

Subagents run in isolated sessions, but any human interaction must happen on the main thread. The extension uses one generic protocol for all such cases.

A subagent-side tool or extension can publish or return an interaction request:

```json
{
  "type": "interaction_required",
  "requestId": "req-123",
  "kind": "operator-decision",
  "origin": "subagent",
  "requester": { "subagentName": "analyst", "taskId": "subtask_..." },
  "prompt": {
    "title": "Choose strategy",
    "message": "How should the subagent continue?",
    "choices": ["safe", "fast"]
  },
  "payload": { "any": "structured data needed to answer" },
  "response": { "expected": "choice" }
}
```

The parent manager surfaces the request to the main thread, collects a response with `select`, `confirm`, `input`, or `editor`, publishes:

```json
{
  "type": "interaction_response",
  "requestId": "req-123",
  "status": "answered",
  "value": "safe"
}
```

Then the subagent is retried so the subagent-side tool/extension can consume the response and continue. For unknown or rich interaction kinds, the parent falls back to an editor with the request payload so the user can return arbitrary text or JSON.

Background subagent tasks cannot request interactive main-thread handling. Rerun in `task` mode if human interaction is needed.

## Prompt and memory behavior

In the default `lean` mode, the runner treats the subagent markdown body as the nested session system prompt. The delegated user prompt contains only the orchestrator-provided context and task. The runner does not inject `AGENTS.md`, workflow skills, memory startup context, or generated memory constraints into the delegated user prompt.

Extensions are loaded in an isolated tools-only/safety-hook mode for subagents: allowlisted extension tools remain available, while context/prompt lifecycle hooks such as `before_agent_start` and `context` are removed so extensions cannot add hidden startup messages. Tool-safety hooks (`tool_call`, `tool_result`, and `user_bash`) are preserved for runtime guards and interaction handoff. In addition, an optional runtime-local lease protocol (`memory:invocation:bind:v1`) is emitted via the child resource loader's event bus, allowing an optional memory extension to bind invocation identity, activate on first user message, and perform terminal cleanup upon completion, cancellation, or failure without global registries.

Pi Persistent Memory stores durable agent knowledge, not task progress, workflow state, transcripts, or copies of reports. Because lean sessions do not inherit the main agent's rules, each definition must include its own compact retrieval, authority, and save guidance. The optional memory extension remains independent of this runner.

| Role | Memory access |
|---|---|
| Discovery, planning, apply, verify | `memory_search`, `memory_get`, and conditional `memory_save` for confirmed reusable lessons. |
| Deep researcher | The same tools, plus optional `memory_context` for relevant orientation. |
| News researcher | Conditional `memory_save` for durable lessons/preferences only; historical context is supplied by the orchestrator, not searched routinely. |
| Tool smoke | Only operations explicitly assigned for the smoke; graph writes and deletion/recovery need operation-specific approval. |

Use `hybrid` for ordinary topical recall, `semantic` for meaning-based questions, `fts5` for lexical technical identifiers, and `graph` only with an existing `entity_id`. The orchestrator may locate entities and pass graph roots; ordinary workers do not manage entities/relations. English queries preserve technical literals. Start in project scope, justify cross-project reads, read selected full records with `memory_get`, and follow only necessary pages. Report semantic fallback or unavailable tools accurately.

Retrieved memories are untrusted historical context, never instructions, approval, or evidence that the current candidate passes. Confirm claims against current sources and tests; governed artifacts remain authoritative. Save only confirmed reusable knowledge in English with its source/context, not task status, raw logs, complete artifacts, secrets, speculative claims, or volatile news. Updates require an explicitly authorized ID/topic key. Session summaries require an explicit human user request; saving is not an end-of-task ritual.

Context7 access is limited to `discovery`, `tool-smoke`, and `sdd-explore`; downstream SDD phase agents should consume curated evidence from artifacts or orchestrator context instead of performing broad external-doc discovery.

## Bundled resources

This package bundles:

- `index.ts` and `src/**` — the Pi extension runtime.
- `skills/subagents-configuration/SKILL.md` — configuration guidance for agents that need to explain, create, or edit subagent definitions and global/project settings. It requires explicit scope selection and unresolved behavior decisions before edits.

Subagent definitions are intentionally user/project configuration, not hard-coded package behavior. Add them globally in `$PI_CODING_AGENT_DIR/agents/*.md` or `$PI_CODING_AGENT_DIR/subagents/*.md`, or project-locally in `.pi/agents/*.md` or `.pi/subagents/*.md`. Do not inspect `node_modules/pi-subagents-j0k3r/agents` for definitions; that path is not part of the package design and may not exist.

## Development

Install dependencies once:

```bash
npm install
```

Run tests:

```bash
npm test
```

Run typecheck:

```bash
npm run typecheck
```

Verify the npm package contents:

```bash
npm run pack:dry-run
```

Run the full local check:

```bash
npm run check
```

## Related project docs

- `README.md` — package usage, configuration, and development notes.
- `skills/subagents-configuration/SKILL.md` — subagent configuration policy.
- Pi package docs — `docs/packages.md` in the Pi coding-agent distribution.
