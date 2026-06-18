# Phase Contracts Companion

Load this companion when planning a formal SDD sequence or when you need high-level responsibilities for each SDD phase.

For subagent task-packet requirements, return envelopes, and cross-phase apply/verify/archive rules, also load `skills/sdd-workflow/shared-phase-rules.md`.

## Default SDD Planning Sequence

For a new named feature where planning is approved but implementation is not:

1. Ensure project-global OpenSpec config and change metadata are valid and current.
2. Optional orchestrator-authored PRD and `prd-review` when requested, warranted, or when PRD approval/readiness is unresolved.
3. `sdd-explore`
4. `sdd-proposal`
5. `sdd-spec`
6. `sdd-design`
7. `sdd-task`

Stop before implementation unless the user explicitly approves apply.

## Phase Responsibilities

### prd-review

Purpose: review an existing or newly drafted PRD before downstream SDD planning or implementation.

Expected outputs:

- `prd-review.md` or memory equivalent
- readiness verdict (`ready_for_sdd: yes/no/with warnings`)
- recommended PRD status (`approved`, `blocked`, `needs-revision`, or `ready-with-warnings`)
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
- apply slices suitable for approval

### sdd-apply

Purpose: implement approved task slices only.

### sdd-verify

Purpose: verify implementation against formal SDD artifacts or, for mini-SDD/minimal delegated apply, against the orchestrator task packet, acceptance criteria, apply output, changed files, security requirements, and validation evidence.

Expected outputs:

- requirement/scenario compliance matrix
- security compliance matrix when security requirements exist
- implementation-map compliance and context-gap notes
- command evidence from tests/build/typecheck/runtime checks, or an explicit downgrade when executable evidence is unavailable
- verdict that cannot be full PASS when testable requirements lack runtime/build/typecheck/test evidence

### sdd-archive

Purpose: close verified formal SDD work.
