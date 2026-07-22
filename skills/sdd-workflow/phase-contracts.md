# Phase Contracts Companion

Load this companion when planning a formal SDD sequence or when you need high-level responsibilities for each SDD phase.

For subagent task-packet requirements, return envelopes, and cross-phase apply/verify/archive rules, also load `skills/sdd-workflow/shared-phase-rules.md`.

Local workspace source-code inspection in any phase follows `AGENTS.md` and the compact task packet from shared phase rules. Phase agents must also receive resolved configuration and authorization fields before acting.

## Deterministic Flow Routes

- **PRD-first:** `prd-draft → prd-review → workflow-triage`
- **Mini-SDD:** `prior-evidence → explore → apply-approval → apply → verify → completion-summary → archive-approval → archive`
- **Formal SDD:** `explore → proposal → spec → design → task → apply-approval → apply → verify → completion-summary → archive-approval → archive`

A phase advances only after its required output is successful and persisted according to the configured store. Blocked/partial output returns to the orchestrator; it never skips forward or chooses another route.

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

Each phase consumes the prior compact handoff and must not redo a completed phase's work. It adds only the decisions/evidence owned by its purpose and returns one deterministic next recommendation.

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

Purpose: define normative requirements, scenarios, security requirements, and testability mapping.

Expected outputs:

- changed capabilities or requirements
- SHALL-style requirements
- scenarios or examples
- edge cases and abuse/failure scenarios
- security/privacy/auth/data requirements or explicit `not-applicable`
- acceptance-criteria/testability matrix mapping each requirement or scenario to expected validation evidence
- compatibility constraints
- deterministic archive capability mapping from change requirements/scenarios to exact capability-spec targets, or explicit `none` with rationale
- stable requirement/scenario ids and bidirectional supersession metadata for material replacements

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

Purpose: define implementation tasks.

Expected outputs:

- ordered tasks
- dependencies
- acceptance checks per task
- concrete file or symbol references when applicable
- explicit security tasks or `security not applicable` rationale
- TDD or test-first expectations
- validation commands
- lightweight pre-apply traceability matrix linking PRD (when in scope), spec, design, tasks, acceptance criteria, and validation evidence
- complete apply-ready packet and slices suitable for orchestrator-assigned immutable revision and explicit approval
- confirmation that tasks reference active spec/design revisions and no unresolved supersession links

### sdd-apply

Purpose: retrieve the persisted local approval record and implement only the complete approved packet, normally in one invocation.

### sdd-verify

Purpose: verify implementation against formal SDD artifacts or, for mini-SDD/minimal delegated apply, against the orchestrator task packet, acceptance criteria, apply output, changed files, security requirements, and validation evidence.

Expected outputs:

- requirement/scenario compliance matrix
- security compliance matrix when security requirements exist
- implementation-map compliance and context-gap notes
- command evidence from tests/build/typecheck/runtime checks, or an explicit downgrade when executable evidence is unavailable
- verdict that cannot be full PASS when testable requirements lack runtime/build/typecheck/test evidence
- persisted local apply-approval revision and active supersession-link validation

### sdd-archive

Purpose: close verified work after the orchestrator presents the completion summary and persists explicit local archive approval. For `hybrid`, archive OpenSpec first and rebuild the Engram closure pointer from verified local state.

## Mini-SDD Boundary

This companion defines the formal sequence. Mini-SDD does not use proposal, spec, design, or task phases. Its phase responsibilities come from `mini-sdd.md` and shared rules:

1. `sdd-explore` validates prior evidence and returns an apply-ready packet without formal exploration/map artifacts.
2. approved `sdd-apply` implements only the approved packet.
3. `sdd-verify` validates acceptance and recommends completion summary/archive approval after PASS.
4. approved `sdd-archive` closes only the configured mini lifecycle record/state.
