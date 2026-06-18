# PRD and Discovery Companion

Load this companion when the active route needs PRD-first planning, existing-PRD handling, or a clear distinction between read-only discovery and named SDD exploration.

## Discovery vs sdd-explore

Use `discovery` when research is standalone or pre-SDD and the orchestrator needs read-only evidence:

- no OpenSpec artifacts;
- no active SDD flow memory updates;
- no source code edits;
- output is a bounded research report with facts, constraints, options, risks, and unknowns;
- the orchestrator interprets the result, chooses the next workflow, and waits for the user's decision before implementation.

Use `sdd-explore` only after the user approved a named SDD flow and the execution mode is resolved:

- it may create or update `openspec/changes/<change>/exploration.md`;
- it may update compact active SDD flow memory;
- it feeds proposal/spec/design/tasks work.

For large Pi documentation work:

- before SDD approval, use `discovery`;
- after SDD approval, use `sdd-explore`;
- avoid loading long Pi docs inline unless the answer is narrow and local.

## Optional PRD Flow

Use a PRD-first route when the user asks for a PRD or when complex product, UX, integration, OAuth/auth, security, or architecture work needs requirements definition before formal proposal/spec/design/tasks.

The main orchestrator drafts or revises the PRD directly with the user because it has the full conversation, approvals, and gathered context. Use `discovery` only for bounded pre-PRD research when evidence is missing. Do not create or delegate extra PRD drafting/analyzer subagents just to transform context.

### PRD Creation Expectations

1. Gather enough evidence to write a strong PRD: user goals, local files, project docs, Pi docs, installed package sources, Context7 docs, and web references when available.
2. Ask only decision-critical questions.
3. Write or update `openspec/changes/<change>/prd.md` when artifact storage is `openspec` or `hybrid`; otherwise store the PRD content in active SDD flow memory.
4. Use the canonical PRD structure below unless the user explicitly supplies another format.
5. Run `prd-review` before downstream SDD when PRD readiness is uncertain, unless the user explicitly waives review or already approved the PRD.
6. Resolve CRITICAL PRD debts, contradictions, untestable requirements, or open product decisions before approving the PRD or proceeding to implementation.

### Canonical PRD Format

```markdown
# PRD: {Change Title}

## Status
State: draft | reviewed | approved | blocked | waived
Owner: orchestrator
Last updated: YYYY-MM-DD
Approval: pending | approved by user | review waived by user | blocked

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

- If `openspec/changes/<change>/prd.md` exists, the orchestrator decides whether it is already approved, needs `prd-review`, or is waived for the current flow.
- Approved or explicitly in-scope PRDs are mandatory downstream context for `sdd-explore`, `sdd-proposal`, `sdd-spec`, `sdd-design`, `sdd-task`, `sdd-apply`, and `sdd-verify`.
- If `openspec/changes/<change>/metadata.yaml` exists, it is mandatory context for SDD phases and `prd-review`.
- Each phase output should include concise metadata/PRD/artifact alignment notes covering relevant requirements, assumptions, gaps, and conflicts.
- If an SDD artifact conflicts with an approved PRD requirement, the phase must report `blocked` or flag the conflict clearly instead of silently overriding it.
- Keep PRD content product/requirements-focused; use `implementation-map.md`, `design.md`, and `tasks.md` for technical planning.
