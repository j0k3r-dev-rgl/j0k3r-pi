# Orchestrator Supervisor (`orchestrator-supervisor`)

## Overview & Architecture

`orchestrator-supervisor` is a unified autonomous in-process supervisor for the Pi coding agent. It consolidates orchestrator resilience (dual-window quota failover, stream disconnect recovery, 90% context rotation, and durable Write-Ahead Logging) and subagent model allocation into a single cohesive service with a centered two-tab overlay configuration dashboard.

### Core Principles
1. **Unified Configuration Surface:** Managed exclusively through the `/supervisor` panel switch. Activation can be scoped to **Project** (`<project>/.pi/orchestrator-supervisor/`) or **Global** (`~/.pi/agent/orchestrator-supervisor/`), falling back to `Existing (unchanged)` legacy defaults when unconfigured. It is decoupled from `tools-manager`.
2. **Centered Overlay Modal Dashboard:** Running `/supervisor` opens an interactive two-tab modal framed with unicode box borders (`┌`, `─`, `┐`, `│`, `└`, `┘`) and responsive sizing positioned at the terminal center via Pi's overlay manager (`overlayOptions: { anchor: "center" }`).
3. **In-Process Subagent Model Allocation:** Replaces legacy child RPC process hooks with subscriptions to local in-process Pi events: `subagents:task:allocate` with `event.claimModel` and `subagents:task:terminal` with `event.registerCleanup`.
4. **Programmatic Persistent Memory Bridge:** Session continuation checkpoints are stored and verified using the `memory:supervisor:checkpoint:v1` request/reply event channel (`saveMemoryCheckpoint` and `getMemoryCheckpoint`), guaranteeing disk commitment and readback verification before session rotation.
5. **Reload Guard Protection:** Listens on `supervisor:reload-guard:v1` to prevent `tools-manager` or external commands from reloading Pi while mutating tools or session rotations are in flight.

---

## Capabilities

### 1. Two-Tab Centered Overlay Modal (`/supervisor`)
- **[Orchestrator] Tab:**
  - **Master Enable Switch:** Turns supervisor runtime on or off for the project.
  - **Capability Switches:** Independent switches for `Auto rotation` and `Auto model switch`.
  - **Model Count Stepper (2–10):** Adjusts the active routing pool size without discarding hidden candidates.
  - **Priority Model Slots:** Interactive slot assignment pickers with a two-stage reasoning effort selection dialog (`Default` and host-proven levels).
  - **Threshold Steppers:** `Rotation threshold` (default 90%), `Codex quota threshold` (default 95%), `Retries` (1–10, default 3), `Cooldown` (1–1440 min, default 15m), and `Poll interval` (5–3600 s, default 60s).
  - **Runtime State Display:** Live status, active model, pending/saved checkpoint IDs, and uncertain effect counters.
- **[Subagents] Tab:**
  - **Subagent Routing Switch:** Master enable/disable for subagent model allocation.
  - **Model Count Stepper (2–20):** Selects how many candidate slots are active for subagent dispatch.
  - **Model Slots & Effort Dialog:** Assigns candidate models from the Pi registry with reasoning effort overrides. Pressing `d` clears the highlighted slot without reordering adjacent slots.
- **Keyboard & Mouse Navigation:**
  - `Tab` / `Shift+Tab`: Switches between `[Orchestrator]` and `[Subagents]` tabs.
  - `↑` / `↓` (or PageUp/PageDown): Moves row highlight with bounded visible windowing.
  - `←` / `→`: Steps numeric thresholds and toggles configuration scope between `Project` and `Global`.
  - `Enter`: Toggles checkboxes, confirms confirmation prompts, or opens model pickers.
  - `q` or `Escape`: Closes the modal.
  - Mouse clicks on tabs, stepper buttons `[-]`/`[+]`, or slots trigger corresponding actions.

---

### 2. Subagent Model Allocation & Least-Loaded Pool (`src/subagent-pool.ts`, `src/subagent-assignment.ts`)
- **Event Binding:** Subscribes to `subagents:task:allocate` and `subagents:task:terminal` on `pi.events`.
- **Claim Model Contract:** Calls `event.claimModel(async (signal) => ...)`. If subagent allocation is disabled or has no candidate slots, returns `undefined` allowing subagents to fall back to the parent orchestrator model and effort.
- **Least-Loaded Selection:** Allocates models across slots using active lease counting from `subagent-pool.json` with a persistent rotation counter for fair tie-breaking.
- **Automatic Pruning:** Uses `process.kill(pid, 0)` checking `ESRCH` to safely reap leases orphaned by terminated processes without false positives.
- **Deterministic Cleanup:** Registers cleanup via `event.registerCleanup` to release leases when tasks reach terminal status (`completed`, `failed`, `cancelled`, `interrupted`) or when the task's `AbortSignal` fires.

---

### 3. Quota Management & Hierarchical Failover (`src/quota-manager.ts`)
- **Account Discovery:** Discovers available CLIProxyAPI credentials via `/v0/management/auth-files` and merges them with host-registered models.
- **OpenAI Codex Dual-Window Monitoring (Wham):** Evaluates usage across 5-hour primary (`18,000s`) and 7-day secondary (`604,800s`) windows. If either window reaches the policy threshold (`codexQuotaThresholdPercent >= 95%`), the candidate is marked ineligible.
- **Google Gemini Quota:** Tracks remaining quota fractions across resource buckets.
- **Reset-Return Engine:** Detects when an exhausted primary account's `reset_at` has expired and automatically routes back to it.
- **Error Classifier:**
  - HTTP 401 with invalid API key flags a fatal proxy fault and halts supervisor automation until human intervention.
  - OAuth revocations and model-not-found errors exclude candidates until positive restoration evidence.
  - Transient network or 5xx errors increment consecutive error counters; reaching `maxTransientFailures` (default 3) places the candidate into cooldown (default 15m) and fails over to the next candidate.

---

### 4. Context Guard & Clean Session Rotation (`src/context-guard.ts`, `src/bridge.ts`)
- **Strict 90% Boundary:** Context tokens are evaluated strictly against reported usage; tools execute without speculative batch inflation.
- **Whitelisted Tools:** `memory_*`, `mem_*`, and `supervisor_rotate` tools are never blocked by context ceilings.
- **Checkpoint Request:** When context reaches $\ge 90\%$, the supervisor injects a structured checkpoint prompt instructing the model to call `supervisor_rotate` with a concise 150–250-word continuity summary.
- **Verified Preflight:** Saves the summary via `memory:supervisor:checkpoint:v1` and verifies readback before initiating rotation.
- **Session Handover:** Issues an internal `/supervisor-rotate <token>` command, opens a fresh session with `ctx.newSession()`, and injects the continuity checkpoint into the new session.

---

### 5. Write-Ahead Logging & Durability (`src/journal.ts`, `src/lock.ts`)
- **Process Mutual Exclusion:** Manages `supervisor.lock` with process PID, boot ID, and start ticks to prevent concurrent execution on the same flow identity.
- **fsync WAL:** Pre-execution tool calls and results are persisted to `tool-journal.json` with fsync.
- **Uncertain Effect Protection:** Crashes during mutating tool calls mark mutations as `uncertain`. Mutating operations remain blocked until explicitly confirmed by the operator via `/supervisor`.

---

## Environment Variables

| Variable | Description |
|---|---|
| `PI_SUPERVISOR_DISABLED` | Set to `'1'` to disable supervisor runtime initialization. |
| `PI_SUPERVISOR_RUNTIME_DIR` | Custom directory path for supervisor state, journals, locks, and subagent pool leases (defaults to `.runtime/`). |
| `PI_NTFY_URL` | Optional ntfy push notification endpoint for session rotations, model failovers, and critical supervisor alerts. |

Backward compatibility aliases `GENTLE_SUPERVISOR_DISABLED` and `GENTLE_SUPERVISOR_RUNTIME_DIR` are respected if their `PI_*` counterparts are unset.

---

## Verification & Testing

Run unit and integration test suites with Node native test runner:

```bash
# Core modules & quota manager
node --test extensions/orchestrator-supervisor/test/candidate-id.test.ts extensions/orchestrator-supervisor/test/quota-manager.test.ts extensions/orchestrator-supervisor/test/accounts.test.ts

# Subagent pool & allocation adapter
node --test extensions/orchestrator-supervisor/test/subagent-config.test.ts extensions/orchestrator-supervisor/test/subagent-pool.test.ts extensions/orchestrator-supervisor/test/subagent-assignment.test.ts

# Dashboard modal & panel
node --test extensions/orchestrator-supervisor/test/supervisor-dashboard.test.ts extensions/orchestrator-supervisor/test/supervisor-panel.test.ts

# Full test suite
node --test extensions/orchestrator-supervisor/test/*.test.ts
```
