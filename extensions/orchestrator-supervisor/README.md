# Orchestrator Supervisor (`orchestrator-supervisor`)

## Overview

`orchestrator-supervisor` is an automatic, in-process, orchestrator-only Pi extension managed per-project through `extensions/tools-manager` (`/extension`, `Alt+E`, alias `/tools-manager` persisting `<project-cwd>/.pi/extensions.json`).

When enabled for a trusted project, it initializes automatically on `session_start` (`startup`, `reload`, `new`) before the first user or model message, supervising quota boundaries, error failover, and context reserve while preserving Pi's native interactive terminal TUI (`ctx.mode === "tui"`).

No manual start command (`/supervisor start`) or flow slug argument is required.

## Key Capabilities

1. **Model Hierarchy & Quota Failover**:
   - Model candidates:
     1. Primary: `cliproxyapi/main/gpt-6.1-sol` (effort: `"high"`)
     2. Secondary: `cliproxyapi/second/gpt-6.1-sol` (effort: `"high"`)
     3. Tertiary: `cliproxyapi/j0k3r/gemini-3.8-flash-high` (effort: `"high"`)
   - OpenAI Codex (Wham) Dual-Window 95% Policy Threshold:
     Both primary (`18000`s / 5h) and secondary (`604800`s / 7d) windows must strictly satisfy `used_percent < 95.0` with finite numeric validation. Ambiguous prefixes shared across multiple active `auth_index` credentials are rejected.
   - Tertiary Gemini remaining fraction tracking (`remainingFraction > 0.0`).
   - Fresh quota fetch before failover selection and upon `reset_at` expiration to return to `main` (`main` -> `second`). Stale quota expiry stops new work while allowing in-flight turns to finish.

2. **Error Classification & Standalone Progression**:
   - Filters: Assistant provider errors on active orchestrator session only. Tool execution errors (`isError: true`), bash exits, and subagent failures never increment counters; successful assistant turns reset the consecutive error counter to `0`.
   - Hard quota exhaustion (`insufficient_quota` / `quota exceeded` or HTTP 429 confirmed by fresh quota poll) cancels Pi retry sleep immediately via `ctx.abort()` (with persisted internal abort attribution) and fails over without 3 wasted retries.
   - Account OAuth revocation (401/403) and missing models (`model_not_found`) are excluded until positive restoration evidence.
   - 3 consecutive transient 5xx errors trigger 15-minute candidate cooldown and model failover.
   - When all 3 candidates are unavailable, the supervisor enters a safe `idle` state with progressive polling backoff (`60s -> 300s`) and zero prompt dispatch.
   - Fatal proxy key failure (`Invalid API key`) halts supervisor immediately with an alert in the footer.

3. **90% Hard Context Reserve & Post-Compaction Null Estimator**:
   - 10% reserve ceiling (27,200 tokens on GPT, 37,000 on Gemini).
   - At or above 90% context usage (checked on `before_agent_start`, `tool_call`, `turn_end`, and `agent_settled`), prompt queue dispatch halts and waits for turn settlement to rotate cleanly.
   - Post-compaction null tokens estimator computes deterministic fallback tokens via `Math.ceil(chars / 4)` across `ctx.getSystemPrompt()`, compaction summary, branch entries after `firstKeptEntryId`, and image blocks (`4,800` chars / `1,200` tokens per image) without LLM calls.
   - Cumulative multi-tool batch output budgeting with fail-closed intercept (`{ block: true, terminate: true }`) for unknown tools.

4. **Subagent Waiting Invariant & Reload Guard**:
   - Strictly waits for active owned background worker subagents (`'queued' | 'running' | 'stopping'`, in-flight `subagent_*` tool calls, `subagents:task:allocate` / `subagents:task:terminal` with `parentSessionId`, and completion delivery notifications) to settle before session rotation or reload. Holds conservatively if the SQLite history database is missing or unreadable after delegated launches.
   - `session_before_switch` and `supervisor:reload-guard:v1` guard reload while workers or unsettled/uncertain WAL mutations are active, keeping `.pi/extensions.json` saved on disk and deferring reload without cancelling workers.
   - Child subagent sessions (`ctx.mode !== "tui"` or distinct `sessionId`) never execute supervisor hooks.

5. **Write-Ahead Tool Journaling (WAL) & Directory Fsync**:
   - Mutating tool invocations (`write`, `edit`, `bash`, distinguishing `git commit` from `git push`) are logged and `fsync`ed to `tool-journal.json` from `ToolCallEvent` (`toolCallId`, `parentToolCallId`, `toolName`, `input`) with `status: "pending"` before `tool.execute()` begins.
   - If WAL write or `fsync` fails, `tool_call` synchronously blocks execution with `{ block: true, reason: "Supervisor WAL write failed; blocking tool execution for safety." }`.
   - Directory entry durability guaranteed by temporary file write + `fsync` + atomic rename + parent directory descriptor `fsync`.
   - Interrupted mutations during host crash are marked `uncertain` on recovery; automatic replay is strictly prohibited and subsequent tool execution is gated on explicit user confirmation (`/supervisor resume` or TUI confirmation).

6. **Persistent Memory Checkpoint Bridge**:
   - Checkpoints saved over `memory:supervisor:checkpoint:v1` on `pi.events` with immediate readback verification via `readMemoryDetail`.
   - Fresh session resolves target `Model` via `ctx.modelRegistry.find('cliproxyapi', modelSlug)` for `pi.setModel()`, sets thinking effort `"high"`, performs paginated owner readback preflight verifying Git state (`branch`, `baseCommit`, `headSha`, working tree diff) and referenced artifact SHA-256 hashes, and consumes `rotationHandoverToken` so manual `/new` sessions do not replay old checkpoints.
   - When continuation is unauthorized, unbound, or at an approval gate, injects a non-triggering bootstrap message via `pi.sendMessage({ customType: 'supervisor-continuity', content, display: true }, { triggerTurn: false })` and performs a safe stop for user input.

7. **Single-Owner Per-Flow Lock**:
   - Restrictive lockfile (`supervisor.lock`, mode 0600) under `~/.pi/supervisor/<flow-identity>/` (mode 0700).
   - Atomic `O_CREAT | O_EXCL` acquisition with Linux `/proc/<pid>/stat` verification and atomic recheck before stale unlink.
   - Retained across `reload` and in-process `newSession()` rotation handover while rejecting concurrent distinct-session activations.

## Safety Controls & Commands

- Activation / deactivation is managed exclusively via `tools-manager`.
- Internal deferred rotation command: `/supervisor-rotate` (dispatches `ctx.newSession()` with zero LLM invocation).
- Optional runtime safety controls:
  * `/supervisor status`: Show operational status, model, generation, pause state.
  * `/supervisor pause`: Manually pause supervisor (persists across restarts).
  * `/supervisor cancel`: Cancel supervisor operations.
  * `/supervisor resume`: Resume after pause/cancel or uncertain mutation check.
  * `/supervisor rotate`: Request safe session rotation at settlement.
- User pause / cancel always dominates internal aborts, restarts, or config toggles.
