# Shared Phase Rules Companion

Load this companion when a formal SDD route needs cross-phase execution rules, subagent task-packet requirements, or return-envelope rules.

## Cross-Phase Rules

- `sdd-apply` implements only approved task slices.
- `sdd-verify` reports issues and does not fix them unless the orchestrator starts a new apply task.
- `sdd-archive` runs only after verification passes and the user wants closure.
- When metadata exists, every phase must read it and report alignment or conflicts.
- When a PRD approved by `prd-review` or explicitly continued as-is by the user is in scope, downstream phases must preserve it as product context.
- `implementation-map.md` is operational context, not a normative contract.
- Use `implementation-map.md` as the primary context-compression handoff for OpenSpec/hybrid flows: read it before broad source searches, update it with newly discovered files/symbols/validation commands, and explain any deliberate re-read of already mapped files.
- Skill Registry selection is an orchestrator responsibility before subagent launch. The orchestrator must pass exact selected skill paths and applicability notes; subagents use registry fallback only when this context is missing or stale.
- Security is a cross-phase concern. Each phase must preserve or refine applicable authn/authz, secrets, data exposure, privacy, input validation, dependency, rollback, and abuse-case implications instead of deferring security to final verification.
- Any blocking conflict must be reported explicitly before continuing.

## Apply / Verify / Archive Expectations

### sdd-apply

- use strict TDD when applicable
- do not expand scope beyond approved tasks
- implement explicit security tasks and preserve security requirements from spec/design
- report changed files, validations, skill guidance applied, and any context re-read beyond the implementation map
- stop and ask if a new product, design, security, privacy, or API decision appears

### sdd-verify

- run relevant tests or validation; source inspection alone is not enough for a full PASS when executable validation is available
- compare implementation to metadata, PRD context approved by `prd-review` or explicitly continued as-is by the user, spec, design, tasks, implementation-map expectations, and security requirements when they exist
- each testable requirement/scenario and security requirement must have implementation evidence plus runtime/build/typecheck/test evidence, or the report must downgrade/block the verdict
- identify residual risks

### sdd-archive

- sync source-of-truth artifacts when applicable
- update compact memory or project state when appropriate
- summarize decisions, validations, and follow-ups

## Subagent Orchestration Checklist

Before launching a subagent, prepare a focused task with:

- phase name and goal
- change slug
- artifact store
- whether this is formal SDD apply, `mini_sdd: true`, or `minimal_apply: true`
- execution mode implications
- current known state
- required prior artifact paths or summaries
- OpenSpec config path, relevant metadata path or summary, and implementation-map path or summary when present
- relevant skills selected via `skill_registry_resolve`, including name, `SKILL.md` path, match reasons, and any related skills deliberately loaded or discarded
- implementation-map path or summary, plus instructions to update it instead of rediscovering known context
- allowed and forbidden actions
- expected return envelope
- validation expectations when relevant

Do not run dependent phases in parallel.

## Expected Return Envelope

Require:

- status: `success`, `partial`, or `blocked`
- phase: `explore`, `proposal`, `spec`, `design`, `task`, `apply`, `verify`, or `archive`
- executive_summary
- alignment summary:
  - `metadata_alignment`: `aligned` | `blocked` | `not-applicable`
  - `prd_alignment`: `aligned` | `blocked` | `not-applicable`
  - `spec_alignment`: `aligned` | `blocked` | `not-applicable`
  - `security_alignment`: `aligned` | `blocked` | `not-applicable`
- `conflicts_detected`: list of conflict entries with source artifact and impact
- `required_decision`: list of questions to unblock, or `None`
- skills loaded and whether selection was orchestrator-injected or fallback
- context efficiency notes: files read, why they were read, implementation-map reuse, and context gaps
- artifacts written or updated
- memory ids written or updated
- risks or issues
- validations when relevant
- next_recommended

Discovery may additionally return:

- research_question
- sources_inspected
- findings
- options when option comparison was requested
- workflow_relevant_observations
- open_questions_or_missing_info
