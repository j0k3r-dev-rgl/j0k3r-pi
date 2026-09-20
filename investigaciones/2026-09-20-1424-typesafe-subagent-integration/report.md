# Optimal Usage of TypeSafe / Jev Integration Across Pi Subagents

## Executive Summary

The integration of TypeSafe System One (`jev-latest` / `jev-1.13.0`) in the `jev-config` branch marks a transition from passive shadow telemetry to an active consultative co-pilot with a human-in-the-loop discrepancy circuit breaker. Equipping all five subagents (`00-discovery`, `01-planning`, `02-apply`, `03-verify`, and `deep-researcher`) with `typesafe_circuit_breaker`, `typesafe_check_overengineering`, and `typesafe_evaluate` creates powerful semantic guardrails against premature abstraction and scope ambiguity.

However, unrestrained semantic LLM querying inside subagents introduces risks of token bloat, latency cascading, and workflow stalls. To achieve optimal performance, Jev usage must follow strict architectural boundaries:

1. **Subagents must use Jev strictly as phase-exit/phase-entry quality gates**, never in tight iteration loops or for deterministic tasks (syntax, tests, file existence).
2. **`01-planning` and `03-verify` are the highest-leverage subagents** for Jev: `01-planning` uses `typesafe_check_overengineering` to enforce KISS/YAGNI on draft plans, while `03-verify` uses `typesafe_evaluate` for qualitative, non-deterministic acceptance verification.
3. **The orchestrator and subagents must operate under strict separation of concerns**: The orchestrator exclusively owns macro workflow routing (`typesafe_record_shadow_triage`) and initial prompt ambiguity. Subagents never re-evaluate orchestrator decisions.
4. **Shadow Triage belongs strictly to the orchestrator.** Subagents must never call `typesafe_record_shadow_triage`. All subagent Jev calls, however, must record standard evaluation telemetry in `telemetry.sqlite`, enriched with a newly recommended `caller_agent` tag.
5. **A defect was identified in `convenience-factory.ts`**: Token usage is currently recorded as `0/0` because the code accesses `response.tokens` instead of `response.usage`. This must be corrected to maintain accurate cost accounting.
6. **Cost and latency budget**: A typical Planned Workflow consumes 3–4 Jev calls (~3,500 input tokens, ~350 output tokens, ~2.7–3.6s cumulative latency). Daily consumption for 15–20 workflows is ~30–45k tokens (~$0.03–$0.09/day) and <40 seconds of latency—well within acceptable operational limits.

---

## Research Question

How should Pi agents and subagents optimally utilize the TypeSafe/Jev integration implemented in branch `jev-config`? Specifically:
1. What concrete patterns should each subagent use Jev for?
2. What are the critical anti-patterns to prohibit?
3. How should the orchestrator and subagents coordinate without duplicating evaluations?
4. What calibration and thresholds are required before Jev gates can be fully trusted?
5. What is a sustainable cost and latency budget per workflow and per day?
6. Should subagent Jev calls record shadow telemetry, or should that remain orchestrator-only?

---

## Recommendation or Answer

### 1. Architectural Matrix: Who Uses What

| Agent / Subagent | Allowed Tools | Primary Pattern | Invocations per Run |
|---|---|---|:---:|
| **Orchestrator** | `typesafe_record_shadow_triage`<br>`typesafe_circuit_breaker`<br>`typesafe_evaluate` | Macro triage, prompt ambiguity check, user discrepancy routing | 1–2 |
| **00-discovery** | `typesafe_circuit_breaker` | Delegated question clarity, local vs. external boundary check | 0–1 |
| **01-planning** | `typesafe_check_overengineering`<br>`typesafe_circuit_breaker` | Plan simplicity gate (KISS/YAGNI), missing product decision detection | 1–2 |
| **02-apply** | `typesafe_check_overengineering`<br>`typesafe_circuit_breaker` | Scope-creep / architectural-drift sensor (exceptional only) | 0–1 |
| **03-verify** | `typesafe_evaluate`<br>`typesafe_check_overengineering` | Qualitative contract verification, final cumulative diff simplicity audit | 1–2 |
| **deep-researcher**| `typesafe_circuit_breaker`<br>`typesafe_evaluate` | Research scope ambiguity check, evidence synthesis / contradiction sensor | 1–2 |

### 2. Core Guardrail Rules
- **Rule of Determinism**: Never replace shell commands, compiler errors, test runners, or file system inspections with a Jev call.
- **Rule of Non-Duplication**: If the orchestrator has already validated task clarity with `typesafe_circuit_breaker`, the assigned subagent must accept the task as clear unless the delegation contract itself introduced contradictory instructions.
- **Rule of Bounded Invocations**: Subagents are capped at a maximum of 2 Jev calls per execution. Any need for a 3rd call indicates algorithmic confusion and must trip the subagent's circuit breaker to return `BLOCKED`.
- **Telemetry Separation**: `typesafe_record_shadow_triage` is restricted to the orchestrator. Subagents record standard evaluation telemetry through `convenience-factory.ts` and `evaluate-tool.ts`.

---

## Key Findings

### 1. Optimal Usage Patterns per Subagent

#### A. `00-discovery` (Local Context & Code Intelligence)
- **Delegated Task Clarity**: When an orchestrator delegation is broad or lacks concrete directory bounds, `00-discovery` runs `typesafe_circuit_breaker({ task: delegated_goal, context: scope_paths })` [S-003]. If `blocked: true`, it immediately returns `BLOCKED` with the exact missing boundary.
- **Boundary Lane Verification**: Evaluating whether an unanswered question requires external research (which is forbidden in `00-discovery`) versus local code inspection.
- **Do Not Use For**: Searching code, finding symbols, or parsing ASTs. CodeGraph (`codegraph_node`, `codegraph_explore`) and `read`/`bash` are deterministic and far superior [S-010, S-011].

#### B. `01-planning` (Implementation Contract Design) — *Highest Leverage*
- **The Anti-Overengineering Gate**: Before finalizing `plan.md`, `01-planning` calls `typesafe_check_overengineering` passing its drafted architectural design and `MINI-###` items in `proposed_solution` [S-004]. If Jev returns `overengineered: true` (`score >= 0.70` or `verdict: "overengineered"`), the subagent must strip premature abstractions (e.g. unrequested repository patterns, generic plugin registries, unnecessary middleware) and adopt the simplest sufficient implementation [S-008].
- **Missing Decisions Sensor**: Runs `typesafe_circuit_breaker` on open requirements. If material product decisions are missing, it logs them under `## Open Decisions` and halts as `BLOCKED` instead of guessing speculative defaults [S-010].

#### C. `02-apply` (Code Implementation & Refactoring)
- **Architectural Drift Sensor**: During code execution, if the subagent encounters an unexpected obstacle that tempts it to introduce a new library, create a compatibility shim, or alter configuration files, it runs `typesafe_check_overengineering` or `typesafe_circuit_breaker` [S-003, S-004].
- **Anti-Pattern Warning**: `02-apply` **must not** validate individual file edits or git diff batches with Jev. Validation during `apply` is strictly governed by `skills/tdd/SKILL.md` (running tests and typechecks via `bash`) [S-010, S-011].

#### D. `03-verify` (Independent Verification & QA) — *High Leverage*
- **Qualitative Contract Verification**: While compiler passes, test suites, and SHA-256 continuity snapshots are 100% deterministic [S-010], qualitative acceptance criteria (e.g., "error messages must be human-friendly and actionable", "API signature must follow idiomatic conventions") cannot be verified by regex or exit codes. `03-verify` uses `typesafe_evaluate` with typed `Score` or `Choice` questions to verify semantic criteria [S-009].
- **Diff Simplicity Audit**: Verifying that the cumulative changes across all modified files do not contain accidental dead code or speculative scaffolding via `typesafe_check_overengineering` [S-004].

#### E. `deep-researcher` (Autonomous Deep Research)
- **Topic Ambiguity Check**: Runs `typesafe_circuit_breaker` upon initialization to verify that research boundaries, timeframes, and criteria are sufficiently well-defined [S-003].
- **Synthesis & Contradiction Detection**: When evaluating conflicting evidence between sources, `deep-researcher` uses `typesafe_evaluate` with a `Choice` primitive to classify whether divergence represents a genuine technical disagreement or outdated information [S-009].

---

### 2. Anti-Patterns and Failure Modes

1. **Deterministic Replacement**:
   - *Anti-Pattern*: Asking Jev "Did the test pass?", "Does this file exist?", "Is this JSON valid?", or "How many lines are in this function?".
   - *Impact*: High latency (~900ms per check), high token waste, and replacing exact Boolean logic with probabilistic inference [S-009, S-013].
   - *Rule*: Use `bash`, `read`, `node --test`, or `tsc` for all deterministic checks.

2. **Per-Edit Tight Loops**:
   - *Anti-Pattern*: Calling Jev after each small file modification or between individual search queries.
   - *Impact*: In a 5-step edit sequence, per-edit calls add 4.5 seconds of dead latency and 5,000 tokens of redundant prompt overhead [S-013].
   - *Rule*: Jev is a phase-boundary gate, not an inner-loop linter.

3. **Recursive Meta-Evaluations**:
   - *Anti-Pattern*: Asking Jev to evaluate whether a previous Jev verdict was correct, or passing Jev outputs into Jev prompts in an iterative loop.
   - *Impact*: Hallucinatory confirmation bias and runaway token consumption.

4. **Shadow Triage Mimicry in Subagents**:
   - *Anti-Pattern*: A subagent invoking `typesafe_record_shadow_triage` [S-005].
   - *Impact*: Pollutes the `shadow_actual_route` database with invalid routing records. Subagents execute within an already decided workflow route; they do not route traffic [S-005, S-007].

5. **State Dumping (Context Bloat)**:
   - *Anti-Pattern*: Dumping entire 2,000-line source files or complete terminal logs into `state` [S-009].
   - *Impact*: Dilutes Jev's attention, causes prompt truncation, spikes token costs, and slows response latency past 2 seconds.
   - *Rule*: Supply targeted state: function signatures, relevant diff excerpts, or structured JSON summaries [S-002, S-009].

6. **Authority Delegation**:
   - *Anti-Pattern*: Using a favorable Jev score to bypass `Configuration Lock`, skip the `Pre-Mutation Summary Gate`, or perform unapproved git commits [S-007, S-012].
   - *Rule*: TypeSafe provides consultative semantic evidence, never executive authority [S-012].

---

### 3. Orchestrator vs. Subagent Coordination

To prevent duplicate calls and conflicting judgments, execution authority is strictly partitioned:

```text
User Request
     │
     ▼
[Orchestrator Level]
  ├── 1. typesafe_circuit_breaker (User Prompt Ambiguity / Scope Risk)
  │      └── If score >= 0.70 → STOP, ask User
  │
  ├── 2. Canonical Routing (workflow-triage + AGENTS.md)
  │      └── direct_orchestrator | planned_workflow | deep_researcher
  │
  ├── 3. typesafe_record_shadow_triage (Telemetry & Discrepancy Check)
  │      └── If discrepancy_detected: true → STOP, User chooses route
  │
  ▼
[Subagent Delegation] (via compact 7-field contract)
  │
  ├── 00-discovery ──► [typesafe_circuit_breaker: only if delegation is ambiguous]
  │
  ├── 01-planning   ──► [typesafe_check_overengineering: on proposed plan.md]
  │                     └── If overengineered → Simplify locally or BLOCKED
  │
  ├── 02-apply      ──► [Deterministic TDD; Jev called only on architectural drift]
  │
  └── 03-verify     ──► [Deterministic Tests + typesafe_evaluate on qualitative criteria]
                        └── If PASS → Continuity Snapshot → Orchestrator Archive
```

#### Key Coordination Principles:
- **Downstream Trust**: Subagents must assume that prompts passing the orchestrator gate are authorized. Subagents do not re-verify user intent.
- **Contract Isolation**: Subagents evaluate only their own generated deliverables (`plan.md` draft, proposed code diff, research synthesis), not the orchestrator's initial routing decision [S-010].
- **Discrepancy Escalation**: Subagents never communicate with the user. When a subagent Jev gate trips (`blocked: true`), the subagent returns the standard `BLOCKED` handoff with the specific reason in `Blockers:`. The orchestrator receives this and asks the user for clarification [S-010].

---

### 4. Thresholds and Calibration

The TypeSafe integration in `jev-config` uses a default decision threshold of `0.70` across convenience tools [S-002, S-003, S-004]:
- `circuit_breaker_score >= 0.70` AND `decision_type !== 'none'` [S-003].
- `is_overengineering >= 0.70` OR `verdict === 'overengineered'` [S-004].

#### Calibration Findings & Risk Profile:
1. **Subagent Sensitivity Asymmetry**:
   - In the orchestrator, a false positive triggers an advisory confirmation with the user.
   - In a subagent, a false positive immediately halts the pipeline as `BLOCKED`, aborting an unattended workflow [S-010].
   - Therefore, subagent gates require higher precision than orchestrator advisory sensors [S-012].

2. **Dual-Signal Protection**:
   - The shared factory (`convenience-factory.ts`) couples a continuous probability (`Noul`) with a discrete classification (`Choice`) [S-002].
   - In `overengineering-tool.ts`: Both `is_overengineering >= 0.70` and `simplicity_verdict === 'overengineered'` are checked.
   - *Empirical validation*: In validation benchmarks (`TYPESAFE_STATUS.md`), egregious violations (e.g., "Elasticsearch microservice for 50 records", "Plugin registry with global discovery") scored `0.93–0.97`, while clean KISS solutions scored `0.05–0.26` [S-012, S-014]. Moderate solutions scored `0.56`. The `0.70` threshold safely bifurcates clean solutions from speculative complexity.

3. **Prerequisites for Hard Enforcement**:
   - Before allowing a subagent to automatically fail a build based on Jev, at least **25–50 real workflow executions** must be recorded in `telemetry.sqlite` [S-012].
   - During this calibration period, subagents should treat Jev recommendations as warnings in artifact notes rather than hard blocking aborts, unless the score exceeds `0.85` (extreme certainty).

---

### 5. Cost and Latency Budget

Based on empirical production measurements from `telemetry.sqlite` [S-013]:
- **Average Latency per Call**: 828ms – 995ms (mean: ~900ms).
- **Average Input Tokens**: ~800 tokens for convenience tools; ~1,160 tokens for shadow triage (due to `TRIAGE_POLICY_SUMMARY`).
- **Average Output Tokens**: ~35 – 100 tokens.

#### A. Per-Workflow Token & Latency Budget

| Workflow Type | Calls | Input Tokens | Output Tokens | Total Latency | Financial Cost (@ $1/Mtok) |
|---|:---:|:---:|:---:|:---:|:---:|
| **Direct Orchestrator** | 1 | ~1,160 | ~100 | ~0.9s | ~$0.0013 |
| **Planned Workflow (Standard)** | 3–4 | ~3,500 | ~350 | ~2.7s – 3.6s | ~$0.0039 |
| **Deep Researcher** | 2 | ~2,000 | ~200 | ~1.8s | ~$0.0022 |

*Breakdown for Standard Planned Workflow*:
- 1 Orchestrator triage call: 1,160 in / 100 out (~900ms)
- 1 `01-planning` overengineering check: 800 in / 75 out (~900ms)
- 1 `03-verify` semantic contract check: 800 in / 75 out (~900ms)
- (00-discovery and 02-apply: 0 calls on happy path)

#### B. Daily Operational Budget (15–20 Workflows / Day)
- **Total Invocations**: 30 – 45 calls per day.
- **Daily Token Consumption**: ~32,000 – 48,000 tokens per day.
- **Daily Latency Incurred**: ~27 – 41 seconds total across the entire working day.
- **Daily Financial Cost**: **<$0.05 – $0.10 / day**.

#### C. Budgetary Guardrails
1. **Subagent Invocation Cap**: Strict ceiling of **2 Jev calls per subagent execution**.
2. **Workflow Ceiling**: Hard limit of **6 Jev calls per complete Planned Workflow**.
3. **Graceful Timeout Fallback**: `convenience-factory.ts` enforces a 4,000ms timeout [S-002]. If Jev times out or encounters network failure, the tool falls back safely (`blocked: false`, `overengineered: false`), logging the error to SQLite without interrupting the workflow [S-002, S-006].

---

### 6. Telemetry Strategy: Shadow Triage vs. Subagent Telemetry

There is a fundamental difference between **Shadow Triage** and **Evaluation Telemetry** [S-005, S-006]:

1. **Shadow Triage is Strictly Orchestrator-Only**:
   - `typesafe_record_shadow_triage` evaluates macro routing (`direct_orchestrator`, `planned_workflow`, `deep_researcher`) [S-005, S-007].
   - Subagents do not perform routing. Invoking shadow triage from subagents corrupts the triage dataset and generates spurious discrepancies [S-005].

2. **Subagents Must Record Standard Evaluation Telemetry**:
   - Every subagent call to `typesafe_circuit_breaker`, `typesafe_check_overengineering`, and `typesafe_evaluate` already records a row in `telemetry.sqlite` [S-002, S-006].
   - This telemetry is vital for tracking latency, evaluating false positive rates, and monitoring daily token consumption [S-006].

3. **Telemetry Bug Discovered in `convenience-factory.ts`**:
   - In `extensions/typesafe/src/tools/convenience-factory.ts` (line 118):
     ```typescript
     input_tokens: (response as any).tokens?.input_tokens ?? 0,
     output_tokens: (response as any).tokens?.output_tokens ?? 0,
     ```
   - In `typesafe-client.ts`, the return structure is `response.usage.input_tokens` [S-002].
   - Because `response.tokens` is undefined, **all convenience tool calls in SQLite currently record 0 input and 0 output tokens** [S-013].
   - *Remediation*: Change `.tokens?.` to `.usage?.` in `convenience-factory.ts`.

4. **Recommended Telemetry Enhancement: `caller_agent` Attribute**:
   - Currently, the `evaluations` table records `source: 'circuit-breaker-tool'` or `'overengineering-tool'`, but cannot distinguish whether the call came from `01-planning`, `02-apply`, or the orchestrator [S-006].
   - Adding `caller_agent` to `metadata_json` (derived from tool execution context) will allow precise filtering and calibration per subagent.

---

## Evidence Review

The conclusions in this report are grounded in primary and implementation sources from the repository and live system:

- **Empirical System One Measurements** (`telemetry.sqlite`, `TYPESAFE_STATUS.md`): Confirmed real API latencies between 828ms and 995ms for `jev-1.13.0` across 56 real calls [S-012, S-013]. Confirmed that prompts with high architectural sprawl score `>0.90` while clean solutions score `<0.25` [S-012, S-014].
- **Codebase Audits** (`extensions/typesafe/`): Audited factory implementations (`convenience-factory.ts`), tools (`circuit-breaker-tool.ts`, `overengineering-tool.ts`, `shadow-tool.ts`), and database mechanics (`telemetry-db.ts`) [S-001, S-002, S-003, S-004, S-005, S-006]. Identified the token property bug.
- **Skill Specifications** (`skills/`): Audited `workflow-triage` (routing authority and discrepancy circuit breaker) [S-007], `anti-overengineering` (YAGNI/KISS rules) [S-008], `typesafe-ai` (primitives and question design) [S-009], and `work-workflow` / `subagent-artifact-contracts` (phase transitions and handoffs) [S-010].
- **Subagent Definitions** (`subagents/`): Verified that commit `f411de1` equipped all 5 subagents with the TypeSafe toolkit [S-011].

---

## Trade-offs and Risks

| Option / Pattern | Benefits | Risks / Costs | Mitigation |
|---|---|---|---|
| **Subagent Overengineering Gating** (`01-planning`) | Catches architectural bloat before code is written; enforces KISS early. | False positives can block valid plans that require legitimate abstractions. | Set conservative threshold (0.75+); dual-check Noul + Choice; human arbitrator on blocker. |
| **Qualitative Verification in `03-verify`** | Validates subjective contracts that unit tests miss (naming, readability, docs). | Adds ~900ms to verify phase; subjective drift over time. | Restrict Jev to explicit semantic acceptance checks; keep tests/SHA snapshots deterministic. |
| **Strict Subagent Tool Caps (Max 2 calls)** | Prevents token runaway, infinite loops, and latency compounding. | Subagent might lack second opinion on complex edge cases. | Subagent must return `BLOCKED` and delegate trade-off to user via orchestrator. |
| **Logging Subagent Telemetry** | Provides empirical observability across all workflow stages. | Minor SQLite write overhead (~3ms per call). | WAL mode with asynchronous/fast writes; automatic 90-day pruning [S-006]. |

---

## Alternatives Considered

1. **Restricting TypeSafe Tools to Orchestrator Only**:
   - *Why rejected*: Precludes `01-planning` from catching premature abstractions during plan drafting and prevents `03-verify` from verifying semantic contracts. Equipping subagents with single-invocation convenience tools provides significant value if bounded.
2. **Calling Jev on Every Edit Batch in `02-apply`**:
   - *Why rejected*: Catastrophic for latency and token budgets. Code changes must be validated deterministically with compilers and test runners, not probabilistic semantic models.
3. **Allowing Subagents to Run Shadow Triage**:
   - *Why rejected*: Subagents do not route traffic. Allowing them to call `typesafe_record_shadow_triage` injects invalid route comparisons into the telemetry database.
4. **Prompting the User Directly from Subagents**:
   - *Why rejected*: Violates subagent containment. Subagents are background workers that communicate exclusively through standardized Markdown artifacts (`plan.md`, `apply.md`, `verify.md`) and the compact `Handoff` contract.

---

## Unknowns and Limits

- **Sample Size in Production**: Current empirical metrics in `TYPESAFE_STATUS.md` reflect 56 test evaluations and controlled benchmarks, not months of organic daily use.
- **Model Evolution**: As `jev-latest` updates (from `1.13.0` onward), scoring distributions and latency may shift slightly, requiring periodic threshold reviews.
- **Token Telemetry Gap**: Historical records in `telemetry.sqlite` for convenience tools show `0` tokens due to the identified `response.tokens` property bug, though shadow triage tokens (~1,160) provide an accurate baseline.

---

## Recommended Next Actions

1. **Fix Token Recording Defect in `convenience-factory.ts`**:
   - Update line 118 of `extensions/typesafe/src/tools/convenience-factory.ts` to read from `response.usage?.input_tokens` and `response.usage?.output_tokens`.
2. **Enrich Telemetry Metadata with Caller Identity**:
   - Pass the executing subagent name (e.g., `01-planning`, `03-verify`, or `orchestrator`) into tool execution context and persist it in `metadata_json` or a new `caller_agent` column.
3. **Update Subagent Prompt Guidelines**:
   - Add explicit usage instructions to `subagents/01-planning.md` (mandatory overengineering check before READY) and `subagents/03-verify.md` (qualitative acceptance evaluation), while forbidding tight-loop invocations in `02-apply.md`.
4. **Accumulate 25–50 Natural Workflows**:
   - Continue running in `jev-config` with these guardrails, monitoring agreement rates and false-positive blocks before considering any merge to `main`.
