---
name: subagents-configuration
description: "configure Pi Subagents with explicit global/project scope, markdown definitions, cascaded subagents.json defaults, opt-in continuation, model profiles, execution modes, tool allowlists, shortcuts, history, and live background steering guidance."
license: Apache-2.0
metadata:
  author: j0k3r
  version: "1.2"
---

# Subagents Configuration

## Registry Contract

Use this block as the machine-readable source for `.pi/skill-registry.json` generation. Keep it valid JSON.

```json
{
  "category": "workflow",
  "domains": ["subagents-configuration", "subagent-config", "model-profile-config", "execution-mode-config", "tool-allowlist-config", "subagent-history-config", "subagent-shortcut-config", "live-steering-config"],
  "triggers": {
    "paths": [
      ".pi/agents/**/*.md",
      ".pi/subagents/**/*.md",
      ".pi/subagents.json",
      "agents/**/*.md",
      "subagents/**/*.md",
      "subagents.json",
      "~/.pi/agent/agents/**/*.md",
      "~/.pi/agent/subagents/**/*.md",
      "~/.pi/agent/subagents.json"
    ],
    "keywords": [
      "subagents configuration",
      "configure subagents",
      "configurar subagents",
      "configuro subagents",
      "como configurar subagents",
      "cómo configurar subagents",
      "como configuro subagents",
      "cómo configuro subagents",
      "como se configura subagents",
      "cómo se configura subagents",
      "configurar subagentes",
      "configuro subagentes",
      "como configurar subagentes",
      "cómo configurar subagentes",
      "como configuro subagentes",
      "cómo configuro subagentes",
      "como se configura subagentes",
      "cómo se configura subagentes",
      "configuracion subagents",
      "configuración subagents",
      "configuracion subagentes",
      "configuración subagentes",
      "subagent config",
      "subagents.json",
      "model profiles configuration",
      "tool allowlist configuration",
      "subagent history configuration",
      "background handoff shortcut",
      "background_handoff_shortcut",
      "default_mode",
      "enable_continue",
      "subagent_mode",
      "subagent_continue mode",
      "continuation enablement",
      "subagent_send_message",
      "live background steering",
      "global subagents config",
      "project subagents config",
      "local or global subagents",
      "configuracion global o local",
      "configuración global o local",
      "interaction handoff configuration"
    ]
  },
  "workflow_phases": [],
  "related_skills": [],
  "priority": 88
}
```

Field conventions:

- `category`: short grouping such as `base`, `transversal`, `workflow`, `quality`, `security`, or `runtime`.
- `domains`: stable domain tags used for routing.
- `triggers.paths`: glob-like project paths that should activate this skill.
- `triggers.keywords`: configuration-only keywords that should activate this skill.
- `workflow_phases`: keep empty for configuration-only skills so phase routing alone does not load them.
- `related_skills`: configuration-adjacent skills only; do not add usage, implementation, or workflow skills.
- `priority`: routing priority from 0 to 100. Higher means consider earlier when multiple skills match.

## Activation Contract

Use this skill only when the user asks how to configure Pi Subagents or when editing/reviewing subagent configuration files: package installation/update settings, markdown subagent definitions, project/global `subagents.json`, model profiles, allowed tools, history settings, execution defaults, opt-in continuation, continuation modes, background handoff shortcuts, lean resources, live background steering requirements, runtime task/background behavior, and generic interaction handoff as configuration topics only.

Do not load this skill for ordinary subagent delegation/use (`subagent_run`, task status/result polling), extension implementation work, task history browsing, or editing this skill file; those are not configuration questions.

## Hard Rules

- The main agent remains the orchestrator; subagents must not delegate to other subagents.
- Never allow `subagent_*` tools in subagent tool allowlists; the extension filters them, but configs should not include them.
- Prefer narrow tool allowlists per subagent. Do not grant write/bash tools unless the subagent purpose requires them.
- For planning, implementation, and verification agents, prefer deterministic active-flow memory tools only: `memory_search`, `memory_get`, `memory_add`, and `memory_update`; avoid `memory_context` and `memory_recall` in subagent allowlists unless there is a specific reviewed need.
- For workflow phase agents, memory write tools may be allowed only for active workflow flow memory/artifacts according to `work-workflow`.
- Project subagent definitions live in `.pi/agents/*.md` and `.pi/subagents/*.md`; global user definitions live in `$PI_CODING_AGENT_DIR/agents/*.md`, `$PI_CODING_AGENT_DIR/subagents/*.md`, `~/.pi/agent/agents/*.md`, or `~/.pi/agent/subagents/*.md`.
- The npm package is the extension runtime only; do not tell users or future agents to inspect `node_modules/pi-subagents-j0k3r/agents` for subagent definitions. Use the real global/project definition directories above, or runtime listing via `subagent_list_agents` / `subagent({ action: "list" })`.
- Project definitions override global definitions with the same normalized name. Within the same scope, definitions in `subagents` override definitions in `agents` with the same normalized name, and Pi should warn at session startup so users can clean up the duplicate.
- Before proposing or editing configuration, ask which scope the user wants unless it is already explicit: global for every project, project-local for the current workspace, or definition-specific frontmatter. Do not infer configuration scope from where the npm package is installed.
- Explain the consequence before the user chooses: global config supplies defaults to all projects, project config overrides only fields present locally and inherits missing fields globally, and definition frontmatter affects only that subagent.
- Do not edit both global and project config unless the user explicitly asks for both. Do not copy inherited global values into project config unless the user wants to pin a local override.
- For answer-only configuration questions, explain the choices and recommended path without editing; asking how configuration works is not authorization to change files.
- Subagents config resolves as a cascade: project `.pi/subagents.json` overrides global `$PI_CODING_AGENT_DIR/subagents.json` or `~/.pi/agent/subagents.json`; missing project fields fall back to global config; fields missing from both fall back to built-in defaults. Communicate this precedence to users when explaining config behavior.
- `enable_continue` is built-in default `false` and follows that same cascade. Project `enable_continue` overrides global only when present; omitting it locally inherits the global value. Continuation guidance and new continuation execution are available only when the effective value is `true`.
- When effective `enable_continue` is `false`, `subagent_continue` is not registered, direct or stale continuation attempts must be described as generic unavailable behavior, historical task and continuation records remain visible, and failed/cancelled/interrupted/stopping terminal results plus terminal background notifications must not recommend continuation or mention `subagent_continue`.
- `model_profiles` are scoped to the matching subagent definition source: project-local profile entries in `.pi/subagents.json` apply to project-local definitions, while global profile entries apply to global definitions. If a project definition overrides a global definition with the same normalized name, the project definition and its project-local profile win.
- Prefer configuring subagent `model` and `effort` under `model_profiles` in the config matching the definition scope: project-local definitions use `.pi/subagents.json`; global definitions use `$PI_CODING_AGENT_DIR/subagents.json` or `~/.pi/agent/subagents.json`. Markdown definitions should usually contain identity, description, tool allowlist, and behavioral instructions only.
- Nested subagent sessions should use `session_resources: "lean"` by default so the subagent markdown body becomes the nested session system prompt, the delegated user prompt contains only orchestrator context/task, and workflow skills, prompt templates, themes, context files, and startup context injections are not auto-loaded.
- In lean mode, extensions are loaded for allowlisted tools and tool-safety hooks only; prompt/context lifecycle hooks such as `before_agent_start` and `context` must not inject hidden messages into subagent turns.
- Subagent task history is stored globally under data storage, but rows remain project-scoped by `cwd`; history stores delegated prompt and subagent system prompt separately.
- Debug logging is disabled by default with `debug: false`; when enabled in global or project `subagents.json`, logs are written to the executing project's `cwd/.pi/subagents-debug.log`.
- To install the published package globally, prefer `pi install npm:pi-subagents-j0k3r`. If the user wants future `pi update --extensions` / `pi update --all` to move to newer releases, keep the package source unpinned as `npm:pi-subagents-j0k3r` in `~/.pi/agent/settings.json`. Use `npm:pi-subagents-j0k3r@x.y.z` only when the user explicitly wants a fixed version.
- Runtime behavior to explain: `mode=task` waits and returns the full subagent response to the orchestrator; `mode=background` frees the chat, should not be polled just to wait, and sends an automatic completion/failure notification. `subagent_continue` is available only when effective `enable_continue` is true at extension load time, so changing that flag requires `/reload` or restart. When enabled, `subagent_continue` also accepts `mode`, and continuation mode resolves as explicit continuation `mode`, then the previous attempt's `effective_mode`, then the previous persisted `mode`, then `default_mode`, then built-in `task`. `/subagents` opens the session history/detail panel; `ctrl+o` expands/collapses rendered tool output and responses; `subagent_result` reads a stored result when explicitly needed.
- The old UI config key `mode: "opencode" | "claude"` is removed. Do not recommend it. History, background visibility, and task-to-background handoff are available together without an UI-mode gate.
- `subagent_send_message` is runtime behavior, not a configurable permission bypass: it only targets a running background task owned by the exact originating parent Pi session, requires supported Pi live steering, uses bounded queues, and reports queue acceptance separately from model consumption. Message text is visible only in the owning task detail timeline, not list/notification/result summary surfaces.
- After changing subagent markdown/config, package settings, or extension code, tell the user to `/reload` or restart Pi.

Recommended global package setting in `~/.pi/agent/settings.json`:

```json
{
  "packages": [
    "npm:pi-subagents-j0k3r"
  ]
}
```

Recommended `subagents.json` starter:

```json
{
  "timeout_ms": 1200000,
  "stall_timeout_ms": 240000,
  "max_concurrency": 5,
  "debug": false,
  "session_resources": "lean",
  "history_panel_shortcut": "ctrl+,",
  "detail_cancel_shortcut": "x",
  "background_handoff_shortcut": "ctrl+h",
  "default_mode": "task",
  "enable_continue": false,
  "default_tools": [
    "read",
    "memory_context",
    "memory_search",
    "memory_recall",
    "memory_get"
  ],
  "model_profiles": {}
}
```

Markdown subagent frontmatter pattern:

```md
---
name: discovery
description: investigates isolated ideas, code, documentation, and context7 before deciding next workflow
tools:
  - read
  - memory_search
---

# Discovery Subagent

Instructions...
```

Tool entries can include `*` wildcards such as `tool_*`. Wildcards expand at subagent runtime only against tools that are active in the current parent session. If a pattern matches nothing active, it expands to nothing. Blocked `subagent_*` tools remain unavailable even if a pattern would match them. The same wildcard behavior is supported by `default_tools` in `subagents.json`.

Configure model/effort routing separately in the matching local or global `subagents.json` when needed. If no matching profile/default is configured, the subagent inherits the current orchestrator model and thinking effort.

```json
{
  "model_profiles": {
    "discovery": {
      "model": "anthropic/claude-sonnet-4-5",
      "effort": "low"
    }
  }
}
```

Model/effort resolution order:

1. `model_profiles[agentName]` from the config matching the selected definition scope: `.pi/subagents.json` for project-local definitions, or `$PI_CODING_AGENT_DIR/subagents.json` / `~/.pi/agent/subagents.json` for global definitions.
2. Markdown frontmatter `model` / `effort` only for explicit per-file overrides.
3. `default_model` / `default_effort` from effective `subagents.json` config.
4. Current orchestrator model / effort.

Execution-mode resolution order:

1. Explicit `mode` in the `subagent_run` invocation.
2. Markdown frontmatter `subagent_mode` for the selected definition.
3. `default_mode` from effective `subagents.json` config.
4. Built-in `task` fallback.

Continuation-mode resolution order (when `enable_continue` is enabled):

1. Explicit `mode` in the `subagent_continue` invocation.
2. Previous attempt `effective_mode`.
3. Previous persisted `mode`.
4. `default_mode` from effective `subagents.json` config.
5. Built-in `task` fallback.

## Decision Gates

- If the user has not chosen configuration scope, ask: **global for every project, project-local for this workspace, or one subagent definition only?** Do not edit until they choose.
- If the requested local value differs from an existing global value, explain that local wins and ask whether the user wants an override or wants to change the global default instead.
- If the user asks for a default execution mode without naming one, ask whether omitted runs should wait in `task` or free the chat in `background`; explain automatic notification behavior before they choose.
- If the user asks for model profiles, ask which subagent definitions are global versus project-local, then write profiles to the matching config scope.
- If the user requests a new definition but does not specify `agents` versus `subagents`, recommend `subagents` and ask only when compatibility with another harness may require `agents`.
- If the subagent will modify files, run bash, or write memory, ask whether the planned workflow or stricter review is required.
- If the subagent needs human input, require a structured `interaction_required` request with enough prompt, payload, and expected-response data for the parent to answer.
- If a project wants many subagents or broad tools, recommend starting with read-only discovery agents and expanding deliberately.

## Execution Steps

1. Classify the request as package setup, definition creation, config defaults, per-agent profiles, shortcuts/UI, history/debug, or runtime explanation.
2. If scope is not explicit, present the three choices and wait: global (`$PI_CODING_AGENT_DIR` or `~/.pi/agent`), project-local (`.pi`), or one definition's frontmatter. Explain the cascade before asking the user to choose.
3. For package setup, inspect settings before editing; use `pi install npm:pi-subagents-j0k3r` when possible, or edit `~/.pi/agent/settings.json` only when the CLI is unavailable/broken. Prefer unpinned `npm:pi-subagents-j0k3r` unless the user asks for a fixed version.
4. After scope is approved, read the matching existing config/definition plus the fallback config needed to explain effective values. Check optional `agents` and `subagents` directories for existence before listing them.
5. Summarize existing effective values, what will be inherited, and exactly which file would change; ask for any missing product choice such as `task` versus `background` before editing.
6. For new subagents, choose lowercase kebab-case names and clear trigger-focused descriptions. Write definitions in English by default; use another language only when explicitly requested. Prefer `subagents` unless compatibility requires `agents`.
7. Set minimal tool allowlists; remove any `subagent_*` entries.
8. Configure `model_profiles` in the config matching definition scope. Configure `default_model`, `default_effort`, `default_mode`, and `enable_continue` only in the user-approved scope. Explain model/effort inheritance, execution-mode precedence, and that `enable_continue` needs `/reload` or restart before tool exposure changes.
9. Never add the removed UI key `mode: "opencode" | "claude"`. Configure history and handoff independently with `history_panel_shortcut`, `detail_cancel_shortcut`, and `background_handoff_shortcut`.
10. Configure `debug: true` only for temporary diagnostics; keep it false by default and explain that logs are written under the executing project's `.pi` directory.
11. Validate JSON syntax and Markdown frontmatter/body structure. Preserve unrelated existing keys and definitions.
12. Explain runtime behavior when relevant: task versus background, automatic notifications, disabled generic continuation unavailability with preserved history and no continuation recommendations in failed/cancelled/interrupted/stopping terminal results or terminal background notifications, then enabled-only continuation mode preservation/override, `/subagents`, configured history shortcut, `ctrl+o`, and same-parent live steering.
13. Tell the user to `/reload` or restart Pi after changes.
14. If runtime validation is requested after reload, use `subagent_list_agents` for definition/config discovery and run delegated smoke tests only when the user explicitly asks for them.

## Output Contract

Return:

- Skill applied: `subagents-configuration`.
- Scope/path configured or reviewed, including whether definitions came from `agents` or `subagents`.
- Package settings and subagents/config fields added, changed, or preserved.
- Scope decision: global, project-local, or definition-specific; include the effective cascade and why that scope was selected.
- User choices requested before editing, including default execution mode or override intent when relevant.
- Tool allowlist, system-prompt isolation, Context7 scope, memory-tool scope, debug logging, model/effort decisions, and inheritance behavior.
- Runtime behavior explained when relevant: task vs background, automatic notifications, enabled-only continuation mode preservation/override, same-parent `subagent_send_message`, `/subagents`, `ctrl+o`, and `subagent_result`.
- Related configuration skills considered or loaded.
- Validation executed, or the concrete reason it was not run.
- Required reload/restart note and open risks.

## References

- `README.md` — package installation, definitions, global/project config cascade, execution modes, tools, shortcuts, history, and runtime behavior.
- `src/config.ts` — config loading, parsing, definition precedence, and project/global cascade.
- `src/continuation-mode.ts` — effective continuation-mode precedence.
- `src/manager.ts` — task lifecycle, live steering ownership/queues, continuation attempts, and history-facing task state.
- `src/history.ts` — global history storage with project-scoped rows.
