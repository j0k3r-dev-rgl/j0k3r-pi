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

Purpose: understand current state, affected areas, approaches, risks, and recommendation.

Expected outputs:

- exploration artifact or memory section
- initial implementation-map
- recommendation
- open questions
- readiness for proposal

### sdd-proposal

Purpose: translate user goals and any approved PRD into SDD planning scope and capability-level approach without duplicating the PRD.

### sdd-spec

Purpose: define normative requirements and scenarios.

Expected outputs:

- changed capabilities or requirements
- SHALL-style requirements
- scenarios or examples
- edge cases
- compatibility constraints

### sdd-design

Purpose: define technical design.

Expected outputs:

- architecture
- affected modules or files
- implementation-map refinements
- data flow
- APIs or interfaces
- testing strategy
- mitigations and alternatives

### sdd-task

Purpose: define implementation tasks.

Expected outputs:

- ordered tasks
- dependencies
- acceptance checks per task
- concrete file or symbol references when applicable
- TDD or test-first expectations
- validation commands
- apply slices suitable for approval

### sdd-apply

Purpose: implement approved task slices only.

### sdd-verify

Purpose: verify implementation against formal SDD artifacts or, for mini-SDD/minimal delegated apply, against the orchestrator task packet, acceptance criteria, apply output, changed files, and validation evidence.

### sdd-archive

Purpose: close verified formal SDD work.
