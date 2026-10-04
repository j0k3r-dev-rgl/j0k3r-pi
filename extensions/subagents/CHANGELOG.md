# Changelog

## 1.5.1

### Fixed
- Preserved validated finalized subagent responses when later nested `session.prompt()` calls fail, while keeping explicit error, aborted, and streaming-only partial responses classified as failures.
- Updated `subagent_run` guidance to omit `mode` unless the user explicitly requests task or background, allowing automatic mode selection.
- Added opt-in `enable_continue` configuration with global/project cascading defaults, conditional `subagent_continue` registration after reload or restart, manager-level disabled guarding, and suppressed continuation recommendations while disabled.
- Kept historical continuation records visible even when new continuation is disabled.
- Aligned README and subagents-configuration skill guidance with the implemented continuation contract.

## 1.5.0 - 2026-07-30

### Added
- Added cascaded `default_mode` configuration for choosing `task` or `background` execution globally or per project, with project config overriding global config.
- Added per-definition `subagent_mode` support and mixed multi-agent execution, including effective-mode metadata for each delegated task.
- Added `subagent_send_message` for safely steering an owned, running background task, with bounded queues, session ownership checks, runtime compatibility checks, and pending/undelivered message counts.
- Added compact live-activity projections for subagent thinking, responses, and tool execution in task and background rendering.

### Changed
- Resolved execution mode consistently as explicit invocation `mode`, then definition `subagent_mode`, then config `default_mode`, then the built-in `task` fallback.
- Removed the separate UI config key `mode` (`opencode` / `claude`) and enabled both behavior families unconditionally.
- Made the background widget, `/subagents`, configured history shortcut, task-to-background handoff, continuation handoff, and renderer detail hint available without UI-mode gating.
- Changed background completion delivery to a model-facing follow-up that automatically starts or queues one parent-orchestrator response.

### Fixed
- Rendered queued and consumed `subagent_send_message` inputs chronologically in the owning `/subagents` detail timeline, including repeated identical messages and persisted post-completion history, without exposing message text in summary surfaces.
- Added vertical padding around collapsed and expanded subagent completion cards for clearer visual separation.
- Detected live-steering compatibility from the loaded Pi SDK `VERSION` export instead of resolving an unexported `package.json`, allowing supported global Pi installations such as 0.83.0 to use `subagent_send_message` while known older or unknown runtimes still fail closed.
- Registered the real nested SDK `session.steer(...)` bridge, accepted bounded same-parent messages before bridge readiness, forwarded them exactly once, rebound ownership per continuation attempt, and kept failed or unconsumed entries accurately counted as undelivered.
- Rendered the actual effective execution mode in `subagent_run` instead of showing `(task)` when an omitted invocation mode resolved to background.
- Added explicit `mode` support to `subagent_continue` and resolved continuation mode consistently as explicit override, previous `effective_mode`, previous persisted `mode`, config `default_mode`, then built-in `task`.
- Kept `subagent_continue` rendering, waiting/background behavior, persisted attempt state, result metadata, handoff, and automatic completion behavior aligned to the same effective continuation mode.
- Preserved visible background execution and automatic completion handling while keeping explicit task-mode runs eligible for manual background handoff.
- Prevented live steering messages from leaking across parent sessions, task attempts, completion, cancellation, shutdown, restart, or continuation boundaries.

### Documentation
- Updated the README and Subagents configuration skill for explicit global/project/definition scope selection, config cascade guidance, `default_mode`, execution-mode precedence, unconditional history/background UI, automatic completion turns, private live background steering, and explicit continuation-mode overrides.

## 1.4.4 - 2026-07-26

### Fixed
- Added `ctrl+t` thinking visibility toggling to the subagent execution panel, matching Pi's main renderer while respecting the configurable `app.thinking.toggle` keybinding.
- Kept cached subagent thread rendering synchronized when thinking blocks switch between visible and hidden.

## 1.4.3 - 2026-07-26

### Added
- Added comma-separated inline tool allowlists for subagent frontmatter, so `tools: read, write, bash` works alongside the existing multiline YAML list format.

### Fixed
- Blocked subagent definitions that mix inline and multiline tool formats or declare `tools` more than once, instead of guessing which allowlist should win.
- Added an actionable startup warning that identifies the blocked subagent and file and explains how to choose one supported format.
- Preserved scalar frontmatter values containing commas, including descriptions, rather than interpreting every comma as a list separator.
- Added Windows CRLF frontmatter support while preserving existing LF definitions.

## 1.4.2 - 2026-07-26

### Fixed
- Made cancellation, timeout, stall detection, unrecoverable errors, and Pi shutdown enter a truthful non-terminal `stopping` state until the nested runner and Pi session actually settle.
- Bound manager cancellation to Pi's supported `AgentSession.abort()` lifecycle and awaited cleanup before persisting `cancelled`, `failed`, or `interrupted`.
- Removed premature grace-period terminalization and prevented late model, text, tool, and activity events from mutating stopping or terminal tasks.
- Enforced inactivity timeouts for active tool calls so blocked tools cannot suppress stall detection indefinitely.
- Reconciled orphaned persisted `queued` and `running` tasks as `interrupted` when a new Pi session starts.

### Improved
- Exposed Pi automatic retry and `agent_settled` activity separately from plugin execution attempts, making retries distinguishable from unexpected restarts.
- Added real-process cancellation coverage proving that a built-in bash process tree is gone before the task becomes terminal.
- Stabilized in-flight cancellation tests with deterministic prompt-entry synchronization instead of timing-based sleeps.

### Compatibility
- Updated nested session creation for Pi 0.82.1 by using `modelRuntime` and `systemPromptOverride` and removing unsupported prompt signal options.

## 1.4.1 - 2026-07-15

### Fixed
- Moved resumed tasks to the top of `/subagents`, background widgets, and task listings by sorting on recent activity instead of original creation time.
- Kept recent-task ordering deterministic and consistent after SQLite history reloads, including equal-timestamp tie cases.
- Matched `subagent_continue` call, live progress, and final rendering with task-mode `subagent_run`, including agent, attempt, model, effort, and current activity.
- Restored live double-Escape cancellation and Claude-mode `ctrl+h` background handoff for continued tasks.

## 1.4.0 - 2026-07-15

### Added
- Added `subagent_continue` so completed, failed, and cancelled tasks can resume under the same task ID and exact persisted Pi conversation.
- Added per-attempt history, optional user-approved model and effort overrides, and migration-safe nested-session persistence.

### Improved
- Grouped delegated tasks, continuation prompts, thinking, tools, and responses chronologically by attempt in `/subagents`.
- Added English resume guidance to failed and cancelled agent-facing responses while keeping completed responses unchanged.
- Serialized timeout and cancellation cleanup before reopening sessions and hardened private nested-session storage.

## 1.3.2 - 2026-07-15

### Fixed
- Separated provider inactivity stalls, native tool timeouts, and total task timeouts so long-running tools are no longer misclassified as stalled providers.
- Suppressed provider stall detection while tools are active and preserved precise structured timeout and cancellation errors.
- Rendered subagent bash execution through Pi's native tool component and exposed timeout, stall, cancel, and context-consumption details in `/subagents`.
- Removed automatic model fallback so failures return the selected model's exact error to the orchestrator.

## 1.3.1 - 2026-07-13

### Fixed
- Fixed `/subagents` live rendering so `toolcall_delta` argument JSON is no longer displayed as assistant text before native tool cards.
- Preserved streamed thinking output while routing only `text_delta` events into assistant text, matching Pi's main-thread rendering behavior.

## 1.3.0 - 2026-07-12

### Changed
- Modularized extension composition, tools, renderers, UI, runner, and model-profile code into cohesive modules.
- Split each registered subagent tool into a dedicated file and separated complex rendering responsibilities.
- Reorganized monolithic tests into 24 domain-focused files with 206 passing scenarios.
- Preserved root exports, historical deep imports, runtime behavior, tool contracts, package contents, and privacy boundaries.

## 1.2.1 - 2026-07-12

### Fixed
- Stabilized `/subagents` rendering with a full-screen overlay that prevents parent-chat flicker and reserves space for the panel border.

## 1.2.0 - 2026-07-12

### Added
- Added opt-in render diagnostics with bounded JSONL logging for subagent UI and completion rendering.
- Added structured, versioned subagent execution errors covering provider failures, context limits, timeouts, stalls, cancellations, fallback attempts, persistence, tool responses, and history UI.

### Fixed
- Fixed manual task-mode background handoff so it frees the chat only when the user explicitly sends the running subagent to background.
- Fixed background completion delivery so notifications arrive while the main agent continues working without triggering an extra follow-up turn.
- Increased the default task timeout to 20 minutes and inactivity timeout to 4 minutes.
- Preserved machine-readable failure details while retaining backward-compatible human-readable error messages.

### Documentation
- Added rendering investigation and solution notes covering terminal synchronization, viewport stability, and renderer trade-offs.

## 1.1.0 - 2026-06-27

### Added
- Added support for loading markdown-defined subagents from both `agents` and `subagents` directories globally and project-locally.
- Added startup warnings when duplicate names exist in `agents` and `subagents` at the same scope, while preserving `subagents` as the winning source.
- Enabled project Skill Registry configuration and ignored generated registry cache outputs.

### Fixed
- Made `model_profiles` global-only so project-local `.pi/subagents.json` cannot override per-agent model/effort routing.

### Documentation
- Updated README and Subagents configuration skill guidance for `agents`/`subagents` source precedence and global-only model profiles.

## 1.0.1 - 2026-06-27

### Fixed
- Expanded Subagents configuration guidance so agents can explain npm installation/update setup, model/effort inheritance, and task/background runtime behavior.
- Clarified that subagent model and effort routing should live in `subagents.json` `model_profiles` by default, with unconfigured agents inheriting the orchestrator model and effort.

## 1.0.0 - 2026-06-27

### Added
- Initial Pi package for markdown-defined subagents, delegated task tools, session history, model profiles, and background handoff UX.
- GitHub Actions CI and Semantic Release publishing workflow for npm release automation.
- Package verification script to ensure published package resources are complete.

### Improved
- Background subagent completions notify automatically, stay collapsed by default, expand with `ctrl+o`, and keep the chat available while tasks run.
- Subagent result and task-mode output keep full responses available to the orchestrator while rendering compactly for users.
- Subagent task lists default to current-session collapsed summaries.
- Subagent detail views reuse Pi runtime tool renderers for tools executed inside subagent sessions.

### Changed
- Default detail cancel shortcut is `x` for reliable terminal cancellation.
- Peer dependencies use wildcard ranges for Pi package compatibility while dev dependencies remain pinned.
