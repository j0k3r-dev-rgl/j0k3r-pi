# Phase Contracts Companion

Load this companion when planning a formal SDD sequence or when you need high-level responsibilities for each SDD phase.

For authoritative phase-state requirements, return envelopes, and cross-phase apply/verify/archive rules, also load `skills/sdd-workflow/shared-phase-rules.md`. Every phase must load `skills/sdd-workflow/phase-commit-contract.md`. For every code-writing, remediation, slice, or implementation-success decision, load `skills/sdd-workflow/executor-contract.md`.

Local workspace source-code inspection in any phase follows `AGENTS.md` and authoritative phase state from shared rules. Phase agents receive only the fixed invocation trigger; they read config, active flow, authorization, handoff, mode/store/lock/conventions, and artifact references from authoritative sources.

## Deterministic Flow Routes

- **PRD-first:** `prd-draft → prd-review → workflow-triage`
- **Mini-SDD:** `prior-evidence → explore → apply-approval → apply → verify → completion-summary → archive-approval → archive`; failed verify returns to a user decision, then the orchestrator may reconcile affected mini artifacts and create a revised remediation packet before new apply approval.
- **Formal SDD:** `explore → proposal → spec → design → task → apply-approval → risk-based apply slice(s) with independent safety review as required → final verify → completion-summary → archive-approval → archive`

A phase advances only after its required output and complete input/evidence coverage are persisted in a validated `commit_state: committed` Phase Commit Record according to the configured store. The return must be derived from that receipt. Blocked/partial output persists a coherent non-eligible state/checkpoint and returns to the orchestrator; it never skips forward or chooses another route. Failed verification returns to a user remediation-planning decision; when selected, the orchestrator reconciles all affected SDD artifacts and creates the first-class remediation packet before requesting new apply approval.

## Default SDD Planning Sequence

For a new named feature where planning is approved but implementation is not:

1. Ask mode/store for the new flow, persist its locked flow-local selection, and require OpenSpec change metadata only for `openspec`/`hybrid`.
2. Optional orchestrator-authored PRD and `prd-review` when requested, warranted, or when PRD approval/readiness is unresolved.
3. `sdd-explore`
4. `sdd-proposal`
5. `sdd-spec`
6. `sdd-design`
7. `sdd-task`

Stop before implementation unless the user explicitly approves apply.

## Phase Responsibilities

Each phase consumes every row in the authoritative prior-input manifest and must not redo a completed phase's work. It records one consumed/not-applicable/blocked disposition per row, adds only decisions/evidence owned by its purpose, persists the exact owner-artifact set plus authoritative state, and returns one deterministic next recommendation from the committed receipt.

### Required completion matrix

Every phase definition must declare and commit: semantic outputs, exact owner artifacts including authoritative metadata/state, required input/evidence rows, phase-specific validation, exact next phase/terminal state, and all receipt fields from `phase-commit-contract.md`. Missing matrix coverage forbids success.

### prd-review

Purpose: review an existing or newly drafted PRD before downstream SDD planning or implementation.

Expected outputs:

- `prd-review.md` or Engram equivalent
- readiness verdict (`ready_for_sdd: yes/no/with warnings`)
- PRD review approval (`approved-by-prd-review`, `blocked`, `needs-revision`, or `ready-with-warnings`); `ready-with-warnings` still requires explicit user instruction to continue as-is
- terminal `prd-review-complete-returned-to-triage` lifecycle status before downstream route selection
- acceptance criteria and testability matrix
- critical debts, warnings, contradictions, and open questions
- recommended next step

### sdd-explore

Purpose: understand current state, affected areas, approaches, risks, security surface, and recommendation.

Expected outputs:

- exploration artifact or memory section
- initial implementation-map with explored files, symbols, validation commands, and context gaps
- security/trust-boundary observations: authn/authz, secrets, data exposure, privacy, input validation, dependencies, or `not-applicable`
- usage of the orchestrator-provided `flow_skill_plan` and any precise `skill_gap`
- recommendation
- open questions
- readiness for proposal

### sdd-proposal

Purpose: translate user goals and any approved PRD into SDD planning scope and capability-level approach without duplicating the PRD.

Expected outputs:

- concise intent, scope, capabilities, approach, risks, rollback plan, and success criteria
- metadata and PRD alignment notes, including conflicts or missing decisions
- security/privacy impact summary covering trust boundaries, sensitive data, permissions, secrets, external calls, input validation, dependencies, or explicit `not-applicable`
- implementation-map updates for scope-confirmed affected areas, rejected paths, constraints, and handoff notes
- context efficiency notes covering reused exploration/map context, files read, and remaining gaps
- readiness for spec/design or required decisions before continuing

### sdd-spec

Purpose: define bounded normative requirements, representative scenarios, security requirements, and references to detailed traceability without turning the canonical spec into a giant review artifact.

Expected outputs:

- changed capabilities or requirements
- SHALL-style requirements grouped by capability
- representative scenarios or examples sufficient to define externally observable behavior
- edge cases and abuse/failure scenarios when behavior has security, privacy, data, input, dependency, or permission impact
- security/privacy/auth/data requirements or explicit `not-applicable`
- compact testability summary with references to detailed traceability when needed
- compatibility constraints
- compact archive mapping summary with references to detailed mapping when needed
- stable requirement/scenario ids and bidirectional supersession metadata for material replacements

Detailed per-requirement test matrices, exhaustive schema tables, and archive target expansions belong in separate bounded artifacts such as `testability.md`, `traceability.md`, or `archive-map.md` when they would make `spec.md` difficult to review.

### sdd-design

Purpose: define technical design.

Expected outputs:

- architecture
- affected modules or files
- implementation-map refinements
- data flow with trust boundaries when relevant
- APIs or interfaces
- security controls and failure handling derived from the spec
- testing strategy
- mitigations and alternatives
- stable design decision ids/revisions with preserved rationale and bidirectional supersession links

### sdd-task

Purpose: define initial implementation tasks. Failed-verification artifact remediation is a targeted orchestrator responsibility and does not rerun this phase.

Expected outputs:

- ordered tasks
- dependencies
- acceptance checks per task
- concrete file or symbol references when applicable
- explicit security tasks or `security not applicable` rationale
- TDD or test-first expectations
- validation commands
- lightweight pre-apply traceability matrix linking PRD (when in scope), spec, design, tasks, acceptance criteria, and validation evidence
- complete apply-ready packet with exact immutable mechanisms, forbidden substitutions, and risk-based slices suitable for immutable revision and explicit approval
- a complete Slice Execution Contract per slice: one primary safety invariant when risk-bearing, exact ordered operations/checks/first-use boundary, finding-indexed named RED/GREEN evidence, bounded canonical context refs, immutable root-finding lineage plus attempt/recurrence data when applicable, and `completion_authority: sdd-verify`
- mandatory separate invocation slices when workload risk is High or security, secrets, persistence, process lifecycle, concurrency, migrations, permissions, or destructive behavior is involved
- confirmation that tasks reference active spec/design revisions and no unresolved supersession links

### sdd-apply

Purpose: retrieve the persisted local approval record and implement only the approved bounded packet or current risk-based slice under `executor-contract.md`. Apply copies ordered operations verbatim, requires a complete one-to-one source-finding mapping and finding-indexed RED failure before production edits, then records finding-indexed GREEN/adversarial evidence as `implemented-pending-independent-verify`. Exact mechanisms may not be substituted. Apply never closes normative tasks/findings; incomplete records, orphan findings, partial/deferred controls, or missing lineage block.

### sdd-verify

Purpose: verify implementation against formal SDD artifacts or, for mini-SDD/minimal delegated apply, against the authoritative approved task packet, acceptance criteria, apply output, changed files, security requirements, and validation evidence.

Expected outputs:

- Verification Coverage Ledger enumerating every applicable active row before judgment, with `coverage_complete: true` required for PASS/PASS WITH WARNINGS/remediation-ready FAIL and `INCOMPLETE` otherwise
- one complete Verification Finding Record per CRITICAL/WARNING issue, including exact location, root lineage/classification, violated refs, actual/expected/root cause, exact reproducer and observed RED evidence, canonical mechanism constraints, affected scope, and closure criteria
- prior-finding dispositions (`resolved`, `recurring`, `blocked-unverified`) before broader validation, with new issues classified separately
- independently derived requirement/scenario and exact-mechanism compliance matrix
- security compliance matrix with negative/adversarial evidence when security requirements exist
- explicit failure for unapproved substitutions or partial/mostly/deferred controls
- implementation-map compliance and context-gap notes
- skill-plan usage/freshness evidence and any fallback resolution
- command evidence from tests/build/typecheck/runtime checks, or an explicit downgrade when executable evidence is unavailable
- verdict that cannot be full PASS when testable requirements lack runtime/build/typecheck/test evidence
- persisted local apply-approval revision and active supersession-link validation
- final closure/reopening of normative implementation tasks and remediation findings, owned only by verify

### sdd-archive

Purpose: close verified work after the orchestrator presents the completion summary and persists explicit local archive approval. For `hybrid`, archive OpenSpec first and rebuild the Engram closure pointer from verified local state.

## Mini-SDD Boundary

This companion defines the formal sequence. Mini-SDD does not use proposal, spec, design, or task phases. Its phase responsibilities come from `mini-sdd.md` and shared rules:

1. `sdd-explore` validates prior evidence and returns an apply-ready packet without formal exploration/map artifacts.
2. approved `sdd-apply` implements only the approved packet.
3. `sdd-verify` validates acceptance and recommends completion summary/archive approval after PASS.
4. approved `sdd-archive` closes only the configured mini lifecycle record/state.
