# Shared Phase Rules Companion

Load this companion when a formal or mini-SDD route needs cross-phase execution rules, subagent task-packet requirements, or return-envelope rules. Every `prd-review` and `sdd-*` executor must also read and obey the complete `skills/sdd-workflow/phase-commit-contract.md`; it is the sole authority for attempt identity, input coverage, persistence order, partial/resume, and receipt-derived returns.

## Cross-Phase Authority

- The orchestrator owns workflow selection, user interaction, configuration resolution, phase authorization, apply approval, archive approval, and the final interpretation of phase results.
- Phase subagents do not ask the user, choose another phase, create missing configuration, infer defaults, or delegate.
- `sdd-apply` implements only explicitly approved scope and must load `executor-contract.md` before code edits.
- Exact normative mechanisms are immutable during apply. Equivalent-looking substitutions, partial controls, and implementation-time reinterpretation are blocking.
- `sdd-verify` reports issues and does not fix them unless the orchestrator obtains a new apply approval for a first-class versioned remediation packet and launches a remediation apply.
- `sdd-archive` runs only after successful verification, orchestrator completion summary, and explicit archive approval.
- When metadata exists, every applicable phase reads it and reports alignment or conflicts.
- When a PRD approved by `prd-review` or explicitly continued as-is is in scope, downstream phases preserve it as product context.
- Security is cross-phase context. Every phase preserves or refines applicable authn/authz, secrets, data exposure, privacy, validation, dependency, rollback, and abuse-case implications.
- Any blocking conflict is reported before work continues.

## Authoritative Phase State and Zero-Payload Invocation

Project-wide phase contracts live in `openspec/config.yaml`. It defines only global SDD policy: the fixed invocation trigger, transient `active_flow_invocation` cursor, default `active_flow_reference`, executor-to-lifecycle mappings, expected return envelopes, global output limits, and validation order. Flow-local selection and operational phase state live only in each flow's `metadata.yaml` for `openspec`/`hybrid`, or in the active-flow Engram observation for `engram`.

Before invoking a PRD/SDD phase, the orchestrator validates global config, the transient single-flight invocation lease, user authorization, and existing per-flow state. It assigns an immutable `attempt_id` bound to the lease, phase/executor, expected flow/packet revisions, authorization revision, and optional parent checkpoint. In routine progression, it writes only that narrow revision-bound attempt/authorization gate and the phase subagent owns its state transition through `phase-commit-contract.md`. During explicitly selected remediation, the orchestrator instead owns targeted reconciliation of affected artifacts and semantic flow state before a new apply approval. The phase subagent must commit, as applicable:

- current phase and phase-executor identity;
- immutable `attempt_id`, invocation lease id, expected prior flow/packet revisions, and parent checkpoint when resuming;
- immutable packet revision;
- invocation lease validation, phase authorization consumption result, and artifact-write authorization outcome;
- compact goal/blocker/status references, with detailed acceptance checks and phase constraints stored in owner artifacts;
- required prior-artifact references and handoff pointers;
- apply/archive approval binding when applicable;
- flow skill-plan usage and any precise `skill_gap`;
- complete input/evidence coverage and uncovered ids;
- persisted artifact manifest and parser/assertion evidence;
- Phase Commit Record id/state, authoritative previous/current flow revisions, lifecycle status, and next-phase eligibility.

The subagent tool invocation carries only the fixed trigger string declared in project config, for example `execute-authoritative-phase`. It carries no structured packet, artifact summary, mode/store, references, authorization, boundaries, envelope, limits, or copied handoff. If the tool API requires a task string, that fixed trigger is the entire task.

A PRD/SDD subagent invocation starts with no trustworthy orchestrator file context. It must reject additional task payload, read `openspec/config.yaml`, resolve the active/default flow, read the complete authoritative flow state, and read each complete current artifact required by that phase exactly once. It must not rely on an orchestrator cache, compact return envelope, or conversation history as a substitute for authoritative inputs. Superseded history and unrelated artifacts remain out of scope unless a current artifact explicitly requires them.

### Flow identity separation

Authoritative phase state records the **phase executor identity** separately from the persisted lifecycle `flow_type`. They are intentionally different strings and must never be compared for equality.

| Phase executor `flow_type` | Required lifecycle `flow_type` |
|---|---|
| `prd_review` | `prd-first` |
| `formal_sdd_explore`, `formal_sdd_proposal`, `formal_sdd_spec`, `formal_sdd_design`, `formal_sdd_task`, `formal_sdd_apply`, `formal_sdd_verify`, `formal_sdd_archive` | `formal-sdd` |
| `mini_sdd_explore`, `mini_sdd_apply`, `mini_sdd_verify`, `mini_sdd_archive` | `mini-sdd` |
| `minimal_delegated_apply`, `minimal_delegated_verify`, `minimal_delegated_archive` | `minimal-delegated-apply` |

Validation is independent:

1. Validate the fixed trigger against project config and reject extra payload.
2. Resolve the active flow through `active_flow_invocation` lease metadata or the default `active_flow_reference`, then read authoritative flow state.
3. Validate project-config, invocation lease, authorized attempt id, expected prior flow/packet revisions, and flow-state revisions from their own contents and references; global config fields must not contain flow-local phase data.
4. Validate the executing subagent identity against per-flow state and project-config mappings. A phase may run when either the current phase/executor matches it, or the last completed/partial phase records a `next_phase` whose phase/executor matches it and whose eligibility is not blocked.
5. In `interactive`, validate a matching `phase_authorization` gate for that target phase/executor. The gate must be revisioned, user-approved, path/reference-only, redacted, and must not rewrite prior phase result, blockers, handoff, or artifacts. In `auto`, read-only/planning phases may proceed from non-blocked next-phase eligibility without an explicit user gate; apply/archive never may.
6. Validate lifecycle type, mode, store, lock, status, PRD policy, stable conventions, handoff references, boundaries, output contract, and limits from their proper authorities: global policy from config, flow-local state from metadata/Engram.
7. Validate any apply/archive approval binding.

An invalid invocation or phase-state record is blocked; it never permits changing locked selection values or inferring missing content. A project-contract change requires a new project-config revision. A legitimate operational flow-state change requires an authoritative write and new flow-state revision.

Rules:

- The orchestrator asks mode/store before each new formal SDD or mini-SDD and persists the flow-local selection. Phase agents read and validate it; they never choose, normalize, infer from the trigger, or alter it.
- `active_flow_invocation` must resolve exactly one authoritative target flow and one attempt id for the current zero-payload phase invocation. Multiple flows may be active in separate flow records, but dependent phases do not run in parallel and stale/expired/ambiguous leases or attempts block before phase work. Missing/unreadable state, revision mismatch, invalid executor/lifecycle mapping, unlocked state, blocked/missing `next_phase` eligibility for a routine transition, missing/mismatched `phase_authorization` in `interactive`, or a lifecycle status that disallows the phase blocks before phase work. The phase revalidates the lease immediately before the authoritative commit. In `hybrid`, only the exact persisted Engram observation id may be refreshed from verified OpenSpec; Engram never advances OpenSpec.
- In `interactive`, a separate per-flow `phase_authorization` gate must record `user-approved` before the target phase runs. In `auto`, read-only/planning phases may record `auto-authorized` next-phase eligibility; blockers and material decisions still return control to the orchestrator.
- A phase that persists output requires authoritative `artifact_writes_authorized: true`.
- Apply additionally requires persisted `apply_approved_by_user: true`, approval id, approved packet revision, `approval_scope_refs`, `approval_scope_fingerprint`, timestamp, approval record reference, and redaction flag. The approved revision and fingerprint must equal the current authoritative packet.
- Verify additionally requires the persisted apply-approval record reference and fingerprint.
- Archive additionally requires persisted archive approval, matching completion revisions, `approval_scope_refs`, `approval_scope_fingerprint`, timestamp, approval record reference, redaction flag, successful verification evidence, and orchestrator completion summary.
- For `hybrid`, approval and phase state are read from OpenSpec; Engram carries only a compact pointer/cursor.
- Any phase scope/content change creates and persists a new packet revision in the per-flow state. For routine planning phases the executing subagent writes that revision inside a metadata-last Phase Commit Record; for apply/archive approval packets the orchestrator records the explicit local approval before invocation. Conversation history and trigger text are never approval evidence.
- Missing, invalid, mismatched, unredacted, or non-durable authoritative fields produce `status: blocked` before writes, implementation, verification persistence, or archive.

## Handoff by Flow

### Formal SDD

- `implementation-map.md` is operational context, not a normative contract.
- Formal explore persists an Input Evidence Coverage Ledger with one row per authoritative discovery/prior-evidence id. Every row is consumed into `exploration.md`/`implementation-map.md`, explicitly not applicable with rationale, or blocking. Later formal phases preserve/extend the ledger for the prior inputs they consume.
- For `openspec` or `hybrid`, each fresh phase subagent reads the complete current `implementation-map.md` once before source inspection so it has the full cross-phase/code context. Within that invocation, reuse the cached read and explain any reread caused by an external write, revision mismatch, or specific inconsistency.
- For `engram`, use the active observation `sdd.active-flow.<change>` with enough approved phase detail for continuation.

### Mini-SDD

- Do not require proposal, spec, design, tasks, `exploration.md`, `implementation-map.md`, `apply-progress.md`, or `verify-report.md` solely for mini-SDD.
- Persist compact prior evidence with stable evidence ids and the explore apply-ready packet in `mini-sdd.md` or Engram state; never transport them in the invocation trigger. Mini explore records one disposition per evidence id before success.
- Persist continuity in authoritative `mini-sdd.md` for `openspec`/`hybrid`, full active Engram state for `engram`, and only a compact pointer/cursor for `hybrid`.
- Do not rediscover trustworthy evidence without a specific stale or missing-evidence reason.

## Source Inspection and Skill Context

- Local workspace source inspection follows `AGENTS.md`: the assigned workspace files/surfaces are a hard boundary. Phase agents do not inspect external repositories or unrelated workspace content; only explicitly approved discovery/documentation research may widen research scope.
- Skill Registry generation and resolution are orchestrator-only. Reuse session context; before the first flow needing skill routing, generate once only if necessary or explicitly requested, then never generate again in that session. Resolve the live registry for initial flow selection and later only for a real `skill_gap`; known skill changes do not trigger another generation.
- `flow_skill_plan` contains exact selected skill refs, revision, covered paths/intents/phases, and bounded rationale. Phase agents load only those skills and record usage; they never call registry tools or refresh the plan themselves.
- If selected skills do not cover a newly encountered material need, the phase returns `skill_gap` with the precise missing capability and stops. The orchestrator may resolve that gap once, revise the plan, and reauthorize the phase without changing approved scope silently.

## Risk-Based Slice Execution Policy

- Load `executor-contract.md` for task, apply, remediation, verify, and direct implementation success decisions.
- Bounded low-risk work may use one complete `sdd-apply` followed by independent `sdd-verify`.
- A real multi-invocation split is mandatory for High workload/review risk or work involving security, secrets, authorization, persistence, process lifecycle, concurrency, migrations, permissions, destructive behavior, or independently testable safety invariants.
- A list of work units executed inside one large apply is not a split. Each slice needs its own immutable revision, complete Slice Execution Contract, exact mechanism constraints, forbidden substitutions, acceptance evidence, and separately persisted result.
- Each risk-bearing slice has one primary safety invariant and an exact ordered operation sequence. Independently verifiable invariants cannot share an invocation; tightly coupled rows may share one only when one bounded RED case and review prove the same invariant.
- Run independent review/verify after each safety-critical slice before dependent slices consume it. One approval may cover several named slices only when every slice revision and boundary is explicit.
- Planning phases must resolve scope, requirements, design, tasks, acceptance, security applicability, exact mechanisms, forbidden substitutions, and validation evidence before apply.
- Apply stops on material blockers, ambiguous mechanisms, partial controls, or genuinely new product/security/API/persistence decisions. It never defers known compliance work to verify.
- Verify reports exact findings without fixing them. After a user remediation-planning decision, the orchestrator uses verify evidence, current artifacts, durable observations, and user comments to revision/supersede every affected SDD artifact and create the first-class remediation packet. It does not rerun proposal/spec/design/task/explore merely to reconcile remediation. A remediation apply occurs only after coherent artifacts, the new packet revision, and fresh user approval.
- Reuse compact handoffs and verified evidence, but never trade exact normative fidelity for fewer invocations.

## Apply / Verify / Archive Expectations

### `sdd-apply`

- require the persisted local revision-bound apply approval record;
- load and obey `executor-contract.md`;
- for formal SDD, require `pre_apply_traceability: aligned` covering PRD (when in scope), spec requirements, design decisions, implementation tasks, acceptance criteria, exact mechanisms, forbidden substitutions, and planned validation evidence;
- require the complete Slice Execution Contract and copy its ordered operations verbatim before code edits;
- block when sequence/order/first-use boundary is abstract, context refs are broad, a repeated finding lacks immutable root lineage/recurrence analysis, or any blocking source finding lacks one exact remediation disposition;
- build a finding-indexed preflight/completion matrix and require every mapped finding's exact named RED case to fail for the expected reason before any production edit;
- use strict TDD and negative/adversarial evidence when applicable;
- do not expand scope or substitute mechanisms;
- implement applicable security tasks completely;
- derive changed files and pending/verified task counts from current evidence;
- report changed files, RED/GREEN evidence, validations, deviations, residual risks, and final compliance rows;
- record work as `implemented-pending-independent-verify`; apply never closes normative tasks/findings;
- return `success` only when every assigned implementation row is PASS and no known control is partial, approximate, deferred, or left for verify to decide; success remains pending independent verification;
- stop when a new product, design, security, privacy, persistence, or API decision appears.

### `sdd-verify`

- retrieve and validate the local apply approval record, applied packet revision, configured store, executor contract, and remediation packet when applicable;
- derive compliance independently; never trust apply alignment labels, task checkboxes, summaries, or success claims;
- enumerate every applicable active requirement/scenario, design mechanism, task/remediation finding, security/scope control, Slice Execution Contract operation, and named evidence row before judging; persist the ledger and inspect every row;
- return `INCOMPLETE`/`partial` with named uninspected rows when `coverage_complete` cannot be true; only a coverage-complete FAIL may authorize remediation planning;
- on re-verify, rerun every prior finding's exact reproducer/mechanism check first and record `resolved`, `recurring`, or `blocked-unverified` before broader validation;
- fail any unapproved mechanism substitution or control described as partial, mostly, approximate, equivalent, deferred, or unresolved;
- run relevant tests or validation; source inspection alone is not a full PASS when executable validation exists;
- require a complete Verification Finding Record for every CRITICAL/WARNING issue and classify new issues separately from recurrences;
- verify is the sole owner of normative task/finding closure: close only independently passed slice items and leave/reopen failed or prematurely closed items;
- report residual risks and recommend completion-summary/archive approval only after PASS or accepted PASS WITH WARNINGS;
- never return `done` when archive is still pending.

### Verification Finding and Coverage Contract

A **Verification Coverage Ledger** is mandatory before the verdict. Each row records the exact active ref/control/evidence id, applicability with rationale, inspection method, implementation evidence, executable/manual evidence, result (`PASS`, `FAIL`, or `N/A`), and linked finding ids. The report also records `coverage_complete`, `uninspected_rows`, and `coverage_scope`. PASS, PASS WITH WARNINGS, and remediation-ready FAIL require `coverage_complete: true`; otherwise verdict is `INCOMPLETE`, phase status is `partial`/`blocked`, and remediation apply is forbidden.

Every CRITICAL/WARNING issue is a **Verification Finding Record** with:

- stable `finding_id`, immutable `root_finding_id`, `recurrence_lineage`, source verify revision, attempt, and `classification`: `initial`, `recurrence`, `regression`, `newly-exposed`, `pre-existing`, or `out-of-scope`;
- severity, blocking state, and controlled `root_cause_category`: `implementation-defect`, `verify-schema-gap`, `incomplete-verification`, `remediation-gap`, `apply-preflight-gap`, `evidence-gap`, `state-ownership-gap`, or `genuinely-newly-exposed`;
- exact path, line range, and symbol/heading; when a stable line does not exist, an explicit unavailable reason rather than an invented location;
- exact violated requirement/design/task/remediation/mechanism revisions; actual versus expected behavior and root cause rather than symptom only;
- exact reproducer/check command, preconditions/fixture, named RED case, expected failure, observed result/output reference, plus required positive and adversarial evidence;
- existing required mechanism/ordered constraints and forbidden substitutions copied from canonical authority, or `decision-required` when authority is insufficient—verify does not invent a solution;
- bounded affected files/symbols, verify-owned closure criteria, and remediation eligibility.

A remediation-ready FAIL is invalid if any blocking finding record is incomplete. Remediation gives each blocking `root_finding_id` exactly one disposition entry targeting one slice, one ordered slice set with disjoint responsibilities, an explicit accepted-risk/out-of-scope decision, or an unresolved-decision blocker. Re-verify persists one prior-finding disposition (`resolved`, `recurring`, or `blocked-unverified`) for every source root before recording separately classified new findings. Renaming/splitting children never resets lineage.

### `sdd-archive`

- require successful verification evidence, completion summary, and persisted local revision-bound archive approval;
- for `hybrid`, treat OpenSpec as authority, idempotently move the whole change from `openspec/changes/<change>/` to `openspec/archive/YYYY-MM-DD-<change>/`, rewrite authoritative archived references, verify that active and archived folders are not mixed, then rebuild the Engram closure pointer from verified OpenSpec state;
- formal SDD syncs only capability-spec targets explicitly mapped by the canonical change spec; missing or ambiguous required mapping blocks archive rather than being interpreted by the archive agent;
- mini-SDD archives only its configured consolidated lifecycle record/state and any explicitly linked tracker;
- update compact Engram closure state when configured;
- report what was archived and any residual follow-up.

## Subagent Orchestration Checklist

Before launching a phase subagent, verify from project config plus authoritative per-flow state:

- `active_flow_invocation` lease/default reference, immutable attempt id, expected prior flow/packet revisions, and exact current phase/executor mapping;
- packet revision, phase authorization, and artifact-write authorization state;
- local approval-record references and approved packet/completion revisions when applicable;
- exact OpenSpec source `openspec/changes/<change>/`, archive target `openspec/archive/YYYY-MM-DD-<change>/`, absence of the invalid `openspec/changes/archive/` nesting, and Engram pointer when `hybrid`;
- compact phase goal/reference, blockers, and required prior artifacts;
- relevant metadata/PRD status;
- formal implementation-map or mini-SDD lifecycle handoff, as applicable;
- `flow_skill_plan` revision/freshness/coverage, plus any phase_authorization skill-plan override;
- allowed/forbidden scope;
- validation expectations;
- mandatory executor-contract reference for code-writing/verify phases;
- first-class remediation packet revision, complete source Verification Finding Records, immutable root lineage, and one exact finding disposition/mapping when applicable;
- complete Slice Execution Contract: primary invariant, verbatim ordered operations, finding-indexed named RED/GREEN evidence, bounded context refs, completion authority, attempt number, and recurrence analysis when applicable;
- risk-based slice revision, dependency, and prior independent review evidence;
- expected return envelope and output limit.

Then invoke only the configured fixed trigger. Do not run dependent phases in parallel. Do not mutate normal phase metadata just to prepare the handoff; the phase subagent writes its own transition.

After return, first validate the persisted Phase Commit Record required by `phase-commit-contract.md`: attempt/lease/commit ids, previous/current revisions, `commit_state`, input coverage, persisted parser/assertion result, artifact manifest, exact Engram identity/status, phase status, and next eligibility must match the envelope. The orchestrator must reject `success` without that receipt and must not release the lease as successful or advance the flow. After receipt validation, read only the manifest's changed headings/ids plus exact referenced prior sections. The orchestrator verifies unchanged Slice Execution Contract text, named RED/GREEN evidence, pending-verification state, and recurrence fields from those deltas. Application source/tests remain evidence refs for `sdd-verify`, which owns changed-code inspection and final closure.

### State Repair Policy

Mechanical repair is allowed only for syntax/format damage that preserves already-authoritative meaning: YAML parse repair with unambiguous values, key ordering, normalized null/empty optional fields, stale Engram pointer refresh from coherent OpenSpec, or broken local cross-reference that can be deterministically regenerated from existing artifact ids/revisions. The repairer must record `repair_type: mechanical`, changed paths, evidence, and validation.

Semantic repair is blocked until the user selects remediation. Once selected, the orchestrator may directly reconcile phase status, blockers, next phase, scope, and requirement/design/task/map/remediation content when the intended correction is unambiguous from verify findings and user context. If a finding materially recurs, reconciliation must include the executor-contract `recurrence_analysis`, corrected ordered operations, and strengthened RED evidence before another approval can be requested. Approval records/fingerprints, verification verdict, and archive closure remain immutable historical evidence; ambiguous product, architecture, API, persistence, privacy, or security choices return to the user.

## Expected Return Envelope

Every phase returns the same base fields:

- `status`: `success`, `partial`, or `blocked`; `success` requires a validated `commit_state: committed` Phase Commit Record, and `partial` requires the persisted resumable checkpoint from `phase-commit-contract.md`; for apply, `success` is additionally forbidden unless the executor-contract final implementation matrix is fully PASS and the result remains `implemented-pending-independent-verify`;
- `phase`: `prd-review`, `explore`, `proposal`, `spec`, `design`, `task`, `apply`, `verify`, or `archive`;
- `attempt_id`, `invocation_lease_id`, `phase_commit_id`, and `commit_state`;
- `previous_flow_revision` and `current_flow_revision`;
- `input_coverage_complete` and `uncovered_input_ids`;
- `persisted_validation`: actual parser/assertion used, result, and checked persisted refs;
- `flow_type`;
- `packet_revision`;
- `executive_summary`;
- `alignment`: object containing `metadata`, `prd`, `spec`, and `security`, each `aligned`, `blocked`, or `not-applicable`;
- `conflicts_detected`;
- `required_decision` or `None`;
- `skills_loaded`: names, paths, and `flow-skill-plan`, `authorization-override`, or `none`, plus a separate `skill_gap` when coverage is insufficient;
- `context_efficiency`: complete authoritative startup artifacts read once, cache hits within the invocation, justified rereads, commands avoided/reused, and remaining gaps;
- `artifacts_updated` plus `artifact_deltas` copied from the committed artifact manifest (path, prior/current revision, changed headings/ids, new/existing);
- `engram_observation_ids` copied from the exact committed identity/status;
- `validations`;
- `risks`;
- `next_recommended`;
- `phase_output`: phase-specific structured result.

Do not rename base fields per phase. Put readiness verdicts, matrices, task plans, implementation results, verification verdicts, or archive reports inside `phase_output`. Construct every base field from the validated committed record; self-reported or in-memory substitutions are invalid.

For `discovery`, use the evidence-packet contract in `subagents/discovery.md` and `AGENTS.md`, not this phase envelope.
