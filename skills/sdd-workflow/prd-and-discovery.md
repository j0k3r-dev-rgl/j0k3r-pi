# PRD and Discovery Companion

Load this companion when the active route needs PRD-first planning, existing-PRD handling, or a clear distinction between read-only discovery and named SDD exploration.

## Discovery vs sdd-explore

Workspace investigation follows the executor-choice and evidence-packet contract in `AGENTS.md`.

Use `discovery` when the user selected delegated standalone or pre-SDD research:

- no OpenSpec artifacts, source edits, or Engram writes;
- return the bounded evidence packet defined by its system prompt;
- the orchestrator consumes the packet without repeating research and retains routing/approval responsibility.

Use `sdd-explore` only after a named formal or mini-SDD flow is selected, its mode/store pair is asked and locked, and the active per-flow state contains enough user-approved context for the explore subagent to validate or block:

- formal explore may maintain `exploration.md`, `implementation-map.md`, or detailed Engram state according to the configured store and feeds proposal/spec/design/tasks;
- mini explore consumes prior evidence, avoids formal artifacts, updates only `mini-sdd.md` and/or active Engram state, and returns an apply-ready packet;
- both variants stop on missing decisions instead of choosing another route.

For large Pi documentation work, keep pre-SDD evidence in the selected investigation executor and pass only compact relevant findings into the chosen SDD explore variant.

## Optional PRD Flow

Use a PRD-first route when the user asks for a PRD or when complex product, UX, integration, OAuth/auth, security, or architecture work needs requirements definition before formal proposal/spec/design/tasks.

When PRD-first work will persist artifacts/state, ask mode/store for that PRD flow and lock the pair through `prd-review`. The selection ends only after review persists `lifecycle_status: prd-review-complete-returned-to-triage`; that terminal state preserves PRD artifacts but never selects a later SDD's settings. Reviewing an existing persisted PRD reuses its own locked PRD-flow selection; if no valid selection exists, ask rather than infer.

The main orchestrator drafts or revises the PRD directly with the user because it has the full conversation, approvals, and gathered context. Use `discovery` only for bounded pre-PRD research when evidence is missing. Do not create or delegate extra PRD drafting/analyzer subagents just to transform context.

### PRD Creation Expectations

1. Gather enough evidence to write a strong PRD: user goals, local files, project docs, Pi docs, installed package sources, Context7 docs, and web references when available.
2. Ask only decision-critical questions.
3. Write or update `openspec/changes/<change>/prd.md` when artifact storage is `openspec` or `hybrid`; for `engram`, store enough PRD content in the active `sdd.active-flow.<change>` observation.
4. Use the canonical PRD structure below unless the user explicitly supplies another format.
5. Run `prd-review` before downstream SDD whenever a PRD is present or PRD-first was used. Ensure the PRD flow has an active-flow pointer and readable PRD reference, then invoke only the fixed trigger; the `prd-review` subagent writes its own review status, lifecycle transition, blockers, and next recommendation.
6. Resolve CRITICAL PRD debts, contradictions, untestable requirements, or open product decisions before proceeding, unless the user explicitly accepts continuing with those risks as-is.
7. After approval or explicit continue-as-is, the `prd-review` subagent persists `prd-review-complete-returned-to-triage`, then returns to `workflow-triage`. The user then chooses mini-SDD, formal SDD, another route, or deferral; PRD approval never implies planning or implementation approval. If a new mini-SDD or formal SDD is chosen, ask its artifact store and execution mode afresh rather than inheriting the terminal PRD flow's selection.

### Canonical PRD Format

```markdown
# PRD: {Change Title}

## Status
State: draft | reviewed | approved-by-prd-review | blocked | waived-by-user
Owner: orchestrator
Last updated: YYYY-MM-DD
Approval: pending-prd-review | approved by prd-review | explicit user continue-as-is | blocked

## Problem
{user/product problem}

## Goals
- ...

## Non-Goals
- ...

## Users / Personas
- ...

## User Stories
- As a ..., I want ..., so that ...

## Functional Requirements
- FR-1: ...

## Acceptance Criteria
- AC-1: ...

## Constraints
- Product/UX/business/security/privacy constraints only. Put implementation/file/symbol detail in `implementation-map.md`, `design.md`, or `tasks.md`.

## Risks
- ...

## Success Metrics
- ...

## Open Questions
- [ ] ...

## Out of Scope
- ...
```

## Existing PRD Rule

- If `openspec/changes/<change>/prd.md` exists, the orchestrator must treat it as needing `prd-review` unless a current `prd-review.md` approves it for SDD or the user explicitly says to continue with the PRD as-is.
- After review approval or explicit continue-as-is, return to triage for a separate downstream route decision.
- PRDs approved by `prd-review`, or explicitly continued as-is by the user, are mandatory downstream context for `sdd-explore`, `sdd-proposal`, `sdd-spec`, `sdd-design`, `sdd-task`, `sdd-apply`, and `sdd-verify`.
- If `openspec/changes/<change>/metadata.yaml` exists, it is mandatory context for SDD phases and `prd-review`.
- Each phase output should include concise metadata/PRD/artifact alignment notes covering relevant requirements, assumptions, gaps, and conflicts.
- If an SDD artifact conflicts with an approved PRD requirement, the phase must report `blocked` or flag the conflict clearly instead of silently overriding it.
- Keep PRD content product/requirements-focused; use `implementation-map.md`, `design.md`, and `tasks.md` for technical planning.
