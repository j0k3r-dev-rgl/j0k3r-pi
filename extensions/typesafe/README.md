# TypeSafe System One (Jev) Pi Extension

Native Pi extension providing consultative semantic evaluation primitives (`Choice`, `Noul`, `Score`) backed by local SQLite telemetry and asynchronous non-authoritative shadow workflow triage.

## Architecture & Guarantees

- **Zero Runtime Dependencies**: Built with Node 22 built-in `node:sqlite` (`DatabaseSync`), native `fetch`, `node:crypto`, and `node:test`.
- **Deterministic Governance Policy**: All TypeSafe outputs are consultative semantic data; they never override or veto hard policies (`AGENTS.md`, `skills/workflow-triage/SKILL.md`). LLM triage decisions remain 100% authoritative.
- **Privacy & Security**: All payloads, state objects, questions, and error messages are recursively sanitized to redact API keys, Bearer tokens, passwords, private keys, and `.env` credentials prior to network dispatch or SQLite telemetry persistence. Database file permissions are strictly enforced at `0o600` inside a `0o700` directory.
- **90-Day Telemetry Retention**: Evaluations and shadow triage discrepancies are retained for 90 days. Older records are automatically pruned on startup/maintenance; no row-count cap deletes newer records within the retention window.

## Public Tools

### `typesafe_evaluate`
Evaluates natural language application state against typed semantic questions using TypeSafe System One (`jev-latest`, resolving to `jev-1.13.0`).
- **Parameters**:
  - `state` (string | object | array): The content or application state to judge.
  - `questions` (map of Question definitions): Questions with `type` (`choice`, `noul`, or `score`), `instructions`, and optional `criteria`.
  - `model` (optional string): Defaults to `jev-latest`.
- **Output**:
  - Model-facing: JSON summary with question answers, confidence, probabilities, tokens, and latency.
  - Details: Structured metadata including `telemetry_id`, `model`, `latency_ms`, `input_tokens`, `output_tokens`, `answers`.

### `typesafe_telemetry`
Queries local SQLite telemetry for benchmarking and calibration.
- **Parameters**:
  - `limit` (number, 1-50, default 10): Number of records per page.
  - `offset` (number, default 0): Pagination offset.
  - `source` (string, optional): Filter by `shadow-triage`, `evaluate-tool`, or `benchmark`.
  - `discrepancies_only` (boolean, optional): Filter to records where shadow triage disagreed with actual route.
- **Output**:
  - Bounded results with explicit total, window count, records, and continuation offset.

### `typesafe_record_shadow_triage` (alias `typesafe_shadow_triage`)
Explicitly records post-decision shadow triage telemetry comparing an already-selected canonical route against TypeSafe System One prediction.
- **Parameters**:
  - `original_prompt` (string): The original user prompt or triage request.
  - `route` (string enum): The canonical route chosen by the orchestrator (`direct_orchestrator`, `planned_workflow`, or `deep_researcher`).
- **Output**:
  - Model-facing: JSON summary with telemetry ID, match status, actual vs predicted route, and non-authoritative confirmation.
  - Details: Structured metadata for TUI collapsed/expanded comparison rendering. LLM triage selection remains 100% authoritative.

## Interactive Commands

- `/typesafe`: Displays shadow triage statistics (% agreement, total shadow runs, last 5 discrepancies).

## TUI Rendering

Supports Pi's collapsed and expanded tool-row lifecycle:
- **Collapsed View**: Single compact line displaying tool name, outcome status, latency (ms), token consumption, summary conclusion, and native expansion keybinding hint retrieved via `context.keybindings.get('app.tools.expand')`.
- **Expanded View**: Structured multi-line breakdown of question answers, probabilities, confidence scores, latency, and telemetry ID without ANSI overflow.

## Configuration & Environment

- `TYPESAFE_API_KEY`: Required for API requests to `https://api.typesafe.ai/v1/systemone`.
- `PI_TYPESAFE_TELEMETRY_DB_PATH`: Optional custom SQLite file path (defaults to `${XDG_DATA_HOME:-~/.local/share}/pi/typesafe/telemetry.sqlite`).
- Activation: Governed by `.pi/extensions.json` under Configuration Lock.
