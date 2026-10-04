# CPAMC Subagent Account Allocation Pool

Dynamic account allocation pool for Pi subagents delegating requests across local CLIProxyAPI (`cpamc`) Antigravity Google accounts.

## Purpose

Dynamically balances subagent workloads across local Antigravity accounts based on real-time 5-hour quota consumption:
- Automatically targets `gemini-3.8-flash-high` with thinking effort `high`.
- Varies the model prefix dynamically (`cliproxyapi/<prefix>/gemini-3.8-flash-high`).
- Prioritizes idle accounts below 95% 5-hour quota usage based on saved quota state.
- Falls back gracefully to the account with greatest remaining quota if all are busy or >=95% consumed, breaking ties by fewest active leases.
- Zero quota behavior: dispatches to greatest remaining account without guaranteeing upstream provider success (standard 429 errors bubble to subagent runner).

## Environment & Credentials

The extension connects to CLIProxyAPI Management API independently without hardcoded secrets:

- `CLIPROXYAPI_BASE_URL`: Base URL of CLIProxyAPI instance (default: `http://127.0.0.1:8317`).
- `CLIPROXYAPI_MANAGEMENT_KEY`: Secret management key for authenticating to `/v0/management/*` endpoints.

On `session_start`, account prefixes are discovered automatically from Management API `auth-files` and each account's `/v0/management/auth-files/models?name=…` response. Only IDs matching `<prefix>/gemini-*` enter the pool; Codex/GPT-only, Claude-only, disabled, unprefixed, and ambiguous shared-prefix accounts are excluded. No manual account list or local credential files are required.

Startup refreshes nonempty inventories too, preserving saved quotas and request-order tokens only for unchanged `(prefix, authIndex)` identities, plus live leases. New accounts begin with unknown quota; discovery never queries quotas or claims provider health. Empty, incomplete, or failed discovery retains saved inventory; shutdown cancels discovery and prevents late commits.

## State Management

Pool state and active leases are stored in `~/.pi/agent/cpamc-subagent-pool-state.json`.

- **Credential-free**: Persists only public account identifiers (`prefix`, `authIndex`, `email`), quota status, request-start sequence tokens, and active subagent lease records. No tokens, secrets, or keys are ever persisted.
- **Atomic Transactions**: Allocation, release, and quota updates are guarded by in-process mutex and advisory file locking (`.lock`), ensuring race-free concurrency with atomic temporary file write and rename.
- **Owner-Inclusive Attempt Leases**: Leases are keyed canonically by owner identity (`${sessionTag}/${pidTag}/${taskTag}/${attemptTag}`), distinguishing sessionId (including undefined vs literal strings), PID, taskId, and attempt. Old terminal cleanups or concurrent owners cannot overwrite or release another active reservation, while legacy `taskId:attempt` records are safely released when the exact owner matches.
- **Dead-Process Recovery**: Leases owned by dead PIDs are reclaimed automatically on each transaction using `process.kill(pid, 0)`. Active tasks are never evicted by elapsed time.

## Cached Launch & Asynchronous Quota Lifecycle

Coordinates with `pi-subagents-j0k3r` via Pi's public EventBus (`pi.events`) and extension lifecycle hooks (`pi.on`):

1. **Cached Launch Allocation (`subagents:task:allocate`)**:
   - Reads inventory and persisted quotas directly from `cpamc-subagent-pool-state.json`.
   - **Zero HTTP requests**: When inventory exists in state, zero network calls are issued (no `auth-files` and no quota queries). Candidate selection and lease reservation are atomic and immediate.
   - **Cold Empty Inventory Fallback**: If startup discovery did not populate state (`accounts.length === 0`), lazily retries Gemini prefix discovery through Management API (`discoverAccounts({ signal })`). It **never** fetches quota at launch. Discovered accounts commit with status `'unknown'` and quota `{ remainingFraction: 0, status: 'unknown', window: '5 hs' }`, participating normally in fallback selection. If discovery yields empty or fails, returns `undefined` so Subagents falls back cleanly to the configured default profile in `subagents.json`.
   - Checks cancellation signal before acquisition and immediately before state write to prevent late commits.

2. **Non-Blocking Terminal Release (`subagents:task:terminal`)**:
   - Synchronously registers cleanup via `event.registerCleanup(cleanupCallback)`.
   - **Lease Removal Precedes Request**: Inside the cleanup callback, awaits `store.removeLease(...)`, capturing the released `{ account, authIndex }` snapshot.
   - **Non-Blocking Settlement**: The cleanup callback resolves immediately once lease removal completes. Runner settlement delivers the subagent task result immediately without being delayed by quota network latency.

3. **Asynchronous Single-Account Fresh Refresh**:
   - Off the critical path, queries **only** the specific account used by the terminated task, bypassing the 30-second in-memory cache (`forceFresh: true`).
   - Updates only the refreshed account in `cpamc-subagent-pool-state.json` under store lock (`updateAccountQuota`). Preserves all other accounts and all active leases intact.
   - **Monotonic Request-Start Ordering**: Tracks monotonic request-start sequence tokens per account to reject late out-of-order responses from older requests, preventing race conditions across rapid completions and process reloads without fabricating timestamps or process-local resetting counters.
   - **Verified Quota Retention on Failure**: If a post-run refresh fails (network error, timeout, HTTP 500), the store retains the account's existing verified quota from disk, preserves its original `lastCheckedAt` timestamp, and annotates status as `'stale'` (`status: 'stale'`, account `status: 'degraded'`). Verified quotas are never overwritten with `{ remainingFraction: 0, status: 'unknown' }` or synthetic timestamps.
   - **Visible Failure Warnings**: Background refresh failures log visible warnings via `console.warn` with sanitized messages (redacting Authorization tokens and secrets). Graceful cancellations (`AbortError`) are distinguished and produce no warnings.

4. **Shutdown Ownership & Admission Gating (`session_shutdown`)**:
   - Maintains an in-memory refresh registry (`activeRefreshes = new Set()`) and `lifecycleAbortController`.
   - On instance shutdown (`reason === 'quit' || reason === 'reload'`):
     1. **Stops admission first** (`isOpen = false` / `isShuttingDown = true`). Terminal callbacks fired after pool shutdown release leases cleanly but cannot admit new quota requests or file writes.
     2. Aborts in-flight background requests via `lifecycleAbortController.abort()`.
     3. Awaits settlement of all active refreshes (`Promise.allSettled(Array.from(activeRefreshes))`).
   - Supports both extension handler execution orders (pool-first and manager-first) without leaks or late writes.
   - Ordinary session replacement (`reason === 'new' | 'resume' | 'fork'`) leaves in-flight quota refreshes intact regardless of owner so they settle naturally without controller reset, while Pi instance quit/reload stops admission first, aborts, and awaits all owned refreshes.
   - Zero background timers (`setInterval`), polling loops, or file system watchers.

## Request Bounds & Safe Fallbacks

Management requests (auth-files, per-account models, and quota) have an 8-second deadline covering fetch and body reads, combined with caller cancellation. Responses are capped at 1 MiB; oversized/malformed/error responses degrade safely. Quota requests use the inner `Bearer $TOKEN$` substitution header and accept only inner `status_code: 200` with a valid Gemini 5h bucket.

Verified quota is cached for 30 seconds for non-forced requests; post-execution refreshes use `forceFresh: true`. Unknown quota ranks conservatively as zero but does not block dispatch solely on quota or occupancy. Discovery alone does not prove provider health. Lease cancellation reaches mutex/file-lock waits and the commit boundary.

## Reloading & Activation

When Pi is reloaded (`/reload` or restart session), Pi automatically discovers this extension from `~/.pi/agent/extensions/cpamc-subagent-pool/index.js`. Installed Pi 0.99.2 tracks `pi.events.on` and `pi.on` subscriptions by runtime and removes them on invalidation after awaited shutdown. No independent pool shutdown handler deletes leases before owner-drain.

Startup discovery has been tested against the local Management API using an isolated temporary state file, without model inference or quota consumption. Live provider inference is separate and has not been tested for this change. A valid Management API key must be present in the environment of the reloaded session; public inventory/auth indexes can drift and are refreshed at session start. This extension registers no tools or UI and borrows no dependencies/compiler/types from other extensions.
