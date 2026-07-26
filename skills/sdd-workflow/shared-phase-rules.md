# Shared Phase Rules Companion

Load this companion when a formal or mini-SDD route needs cross-phase execution rules, subagent task-packet requirements, or return-envelope rules.

## Cross-Phase Authority

- The orchestrator owns workflow selection, user interaction, configuration resolution, phase authorization, apply approval, archive approval, and the final interpretation of phase results.
- Phase subagents do not ask the user, choose another phase, create missing configuration, infer defaults, or delegate.
- `sdd-apply` implements only explicitly approved scope.
- `sdd-verify` reports issues and does not fix them unless the orchestrator obtains a new apply approval and launches a remediation apply.
- `sdd-archive` runs only after successful verification, orchestrator completion summary, and explicit archive approval.
- When metadata exists, every applicable phase reads it and reports alignment or conflicts.
- When a PRD approved by `prd-review` or explicitly continued as-is is in scope, downstream phases preserve it as product context.
- Security is cross-phase context. Every phase preserves or refines applicable authn/authz, secrets, data exposure, privacy, validation, dependency, rollback, and abuse-case implications.
- Any blocking conflict is reported before work continues.

## Authoritative Phase State and Zero-Payload Invocation

Project-wide phase contracts live in `openspec/config.yaml`. It defines only global SDD policy: the fixed invocation trigger, transient `active_flow_invocation` cursor, default `active_flow_reference`, executor-to-lifecycle mappings, expected return envelopes, global output limits, and validation order. Flow-local selection and operational phase state live only in each flow's `metadata.yaml` for `openspec`/`hybrid`, or in the active-flow Engram observation for `engram`.

Before invoking a PRD/SDD phase, the orchestrator validates global config, writes or validates a transient single-flight `active_flow_invocation` lease for the target flow, validates user authorization, and validates the existing per-flow state. In `interactive`, the orchestrator may write only a narrow revision-bound `phase_authorization` gate for the target phase/executor after explicit user approval. It does not hand-author routine phase transitions. The phase subagent owns the authoritative per-flow state transition and must write, as applicable:

- current phase and phase-executor identity;
- immutable packet revision;
- invocation lease validation, phase authorization consumption result, and artifact-write authorization outcome;
- compact goal/blocker/status references, with detailed acceptance checks and phase constraints stored in owner artifacts;
- required prior-artifact references and handoff pointers;
- apply/archive approval binding when applicable;
- flow skill-plan usage/refresh result;
- lifecycle status and next-phase eligibility.

The subagent tool invocation carries only the fixed trigger string declared in project config, for example `execute-authoritative-phase`. It carries no structured packet, artifact summary, mode/store, references, authorization, boundaries, envelope, limits, or copied handoff. If the tool API requires a task string, that fixed trigger is the entire task.

A PRD/SDD subagent must reject any invocation containing additional task payload. It reads `openspec/config.yaml`, follows `active_flow_invocation.flow_reference` when present and valid, otherwise the orchestrator-selected/default reference, reads authoritative flow state, then reads every artifact required by that phase. It never reconstructs state from conversation history or a prior return envelope.

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
3. Validate project-config, invocation lease, and flow-state revisions from their own contents and references; global config fields must not contain flow-local phase data.
4. Validate the executing subagent identity against per-flow state and project-config mappings. A phase may run when either the current phase/executor matches it, or the last completed/partial phase records a `next_phase` whose phase/executor matches it and whose eligibility is not blocked.
5. In `interactive`, validate a matching `phase_authorization` gate for that target phase/executor. The gate must be revisioned, user-approved, path/reference-only, redacted, and must not rewrite prior phase result, blockers, handoff, or artifacts. In `auto`, read-only/planning phases may proceed from non-blocked next-phase eligibility without an explicit user gate; apply/archive never may.
6. Validate lifecycle type, mode, store, lock, status, PRD policy, stable conventions, handoff references, boundaries, output contract, and limits from their proper authorities: global policy from config, flow-local state from metadata/Engram.
7. Validate any apply/archive approval binding.

An invalid invocation or phase-state record is blocked; it never permits changing locked selection values or inferring missing content. A project-contract change requires a new project-config revision. A legitimate operational flow-state change requires an authoritative write and new flow-state revision.

Rules:

- The orchestrator asks mode/store before each new formal SDD or mini-SDD and persists the flow-local selection. Phase agents read and validate it; they never choose, normalize, infer from the trigger, or alter it.
- `active_flow_invocation` must resolve exactly one authoritative target flow for the current zero-payload phase invocation. Multiple flows may be active in separate flow records, but dependent phases do not run in parallel and stale/expired/ambiguous invocation leases block before phase work. Missing/unreadable state, revision mismatch, invalid executor/lifecycle mapping, unlocked state, blocked/missing `next_phase` eligibility for a routine transition, missing/mismatched `phase_authorization` in `interactive`, or a lifecycle status that disallows the phase blocks before phase work. In `hybrid`, stale/missing Engram is rebuilt from verified OpenSpec; Engram never advances OpenSpec.
- In `interactive`, a separate per-flow `phase_authorization` gate must record `user-approved` before the target phase runs. In `auto`, read-only/planning phases may record `auto-authorized` next-phase eligibility; blockers and material decisions still return control to the orchestrator.
- A phase that persists output requires authoritative `artifact_writes_authorized: true`.
- Apply additionally requires persisted `apply_approved_by_user: true`, approval id, approved packet revision, `approval_scope_refs`, `approval_scope_fingerprint`, timestamp, approval record reference, and redaction flag. The approved revision and fingerprint must equal the current authoritative packet.
- Verify additionally requires the persisted apply-approval record reference and fingerprint.
- Archive additionally requires persisted archive approval, matching completion revisions, `approval_scope_refs`, `approval_scope_fingerprint`, timestamp, approval record reference, redaction flag, successful verification evidence, and orchestrator completion summary.
- For `hybrid`, approval and phase state are read from OpenSpec; Engram carries only a compact pointer/cursor.
- Any phase scope/content change creates and persists a new packet revision in the per-flow state. For routine planning phases the executing subagent writes that revision as part of its transition; for apply/archive approval packets the orchestrator records the explicit local approval before invocation. Conversation history and trigger text are never approval evidence.
- Missing, invalid, mismatched, unredacted, or non-durable authoritative fields produce `status: blocked` before writes, implementation, verification persistence, or archive.

## Handoff by Flow

### Formal SDD

- `implementation-map.md` is operational context, not a normative contract.
- For `openspec` or `hybrid`, use `implementation-map.md` as the primary context-compression handoff: consume it before broader source inspection, update newly discovered files/symbols/validations, and explain deliberate re-reading.
- For `engram`, use the active observation `sdd.active-flow.<change>` with enough approved phase detail for continuation.

### Mini-SDD

- Do not require proposal, spec, design, tasks, `exploration.md`, `implementation-map.md`, `apply-progress.md`, or `verify-report.md` solely for mini-SDD.
- Persist compact prior evidence and the explore apply-ready packet in `mini-sdd.md` or Engram state; never transport them in the invocation trigger.
- Persist continuity in authoritative `mini-sdd.md` for `openspec`/`hybrid`, full active Engram state for `engram`, and only a compact pointer/cursor for `hybrid`.
- Do not rediscover trustworthy evidence without a specific stale or missing-evidence reason.

## Source Inspection and Skill Context

- Local workspace source inspection follows `AGENTS.md`: code-research tools first for symbols, references, impact, and call flow; `bash` source search only with a stated fallback reason.
- Skill Registry resolution uses a flow-local `flow_skill_plan` cache to avoid repeated registry work. `sdd-explore` creates or refreshes the plan with registry hash/freshness, plan revision, covered phases, covered paths/intents, required/optional skill refs, confidence, invalidation rules, and a short rationale. Keep details bounded; do not duplicate full registry output.
- Later phase agents first validate `flow_skill_plan` against the current registry hash/freshness, phase, touched paths, intent, and user authorization. If valid and sufficient, load the referenced `SKILL.md` files directly and record `skills_loaded.source: flow_skill_plan` without re-running the resolver.
- A phase agent re-runs `skill_registry_resolve` with `stale_check=true` only when the plan is missing, stale, does not cover the phase/paths/intent, conflicts with the phase authorization, or a new material scope/security/policy decision appears. The subagent records any refreshed plan, fallback, or blocker in its phase result.
- `phase_authorization` may reference `flow_skill_plan.revision` and list explicit overrides. It is not a generic skill store and should not duplicate long skill rationale.

## One-Shot Execution Policy

- The normal target is one `sdd-apply` invocation for the complete approved packet, followed by one independent `sdd-verify`.
- Planning phases must resolve scope, requirements, design, tasks, acceptance, security applicability, and validation evidence before apply rather than deferring routine decisions to implementation.
- Only split apply when the workload forecast, review-size limit, independent deployability, or an explicit user decision requires it.
- Apply stops on a material blocker or genuinely new product/security/API/persistence decision; it does not create artificial checkpoints.
- Verify reports issues without fixing them. A remediation apply occurs only after an actual failed/blocked verification and new user approval.
- Reuse compact handoffs and verified evidence so each phase runs once unless inputs materially change.

## Apply / Verify / Archive Expectations

### `sdd-apply`

- require the persisted local revision-bound apply approval record;
- for formal SDD, require `pre_apply_traceability: aligned` covering PRD (when in scope), spec requirements, design decisions, implementation tasks, acceptance criteria, and planned validation evidence;
- use strict TDD when applicable;
- do not expand scope;
- implement applicable security tasks;
- report changed files, validations, deviations, and residual risks;
- stop when a new product, design, security, privacy, persistence, or API decision appears.

### `sdd-verify`

- retrieve and validate the local apply approval record, applied packet revision, and configured store;
- run relevant tests or validation; source inspection alone is not a full PASS when executable validation exists;
- compare against the applicable formal artifacts or mini-SDD approved packet and handoff;
- require implementation evidence plus runtime/build/typecheck/test evidence for testable requirements, or downgrade/block the verdict;
- report residual risks and recommend completion-summary/archive approval only after PASS or accepted PASS WITH WARNINGS;
- never return `done` when archive is still pending.

### `sdd-archive`

- require successful verification evidence, completion summary, and persisted local revision-bound archive approval;
- for `hybrid`, treat OpenSpec as authority, make capability sync/folder move idempotent, then rebuild the Engram closure pointer from verified OpenSpec state;
- formal SDD syncs only capability-spec targets explicitly mapped by the canonical change spec; missing or ambiguous required mapping blocks archive rather than being interpreted by the archive agent;
- mini-SDD archives only its configured consolidated lifecycle record/state and any explicitly linked tracker;
- update compact Engram closure state when configured;
- report what was archived and any residual follow-up.

## Subagent Orchestration Checklist

Before launching a phase subagent, verify from project config plus authoritative per-flow state:

- `active_flow_invocation` lease/default reference and exact current phase/executor mapping;
- packet revision, phase authorization, and artifact-write authorization state;
- local approval-record references and approved packet/completion revisions when applicable;
- OpenSpec source/archive paths and Engram pointer when `hybrid`;
- compact phase goal/reference, blockers, and required prior artifacts;
- relevant metadata/PRD status;
- formal implementation-map or mini-SDD lifecycle handoff, as applicable;
- `flow_skill_plan` revision/freshness/coverage, plus any phase_authorization skill-plan override;
- allowed/forbidden scope;
- validation expectations;
- expected return envelope and output limit.

Then invoke only the configured fixed trigger. Do not run dependent phases in parallel. Do not mutate normal phase metadata just to prepare the handoff; the phase subagent writes its own transition.

After return, the orchestrator reads project config, authoritative flow state, and every created/updated workflow-owned artifact (`openspec/**` Markdown/state or the authoritative Engram flow observation) completely. It compares those workflow artifacts against the return envelope and prior authoritative workflow artifacts, verifies metadata references and cross-artifact consistency, and blocks advancement on semantic mismatch. It must not read or review changed application source, tests, lockfiles, generated outputs, or product documentation; those remain evidence references for the independent `sdd-verify` phase, which exclusively owns changed-code inspection, scope review, and executable validation. The return envelope is an index to lifecycle-state review, never sufficient evidence by itself.

### State Repair Policy

Mechanical repair is allowed only for syntax/format damage that preserves already-authoritative meaning: YAML parse repair with unambiguous values, key ordering, normalized null/empty optional fields, stale Engram pointer refresh from coherent OpenSpec, or broken local cross-reference that can be deterministically regenerated from existing artifact ids/revisions. The repairer must record `repair_type: mechanical`, changed paths, evidence, and validation.

Semantic repair is blocked without explicit user-approved remediation: phase status, blockers, next phase, approval records/fingerprints, scope, artifact meaning, requirement/design/task content, verification verdict, archive closure, or any value where multiple interpretations exist.

## Expected Return Envelope

Every phase returns the same base fields:

- `status`: `success`, `partial`, or `blocked`;
- `phase`: `prd-review`, `explore`, `proposal`, `spec`, `design`, `task`, `apply`, `verify`, or `archive`;
- `flow_type`;
- `packet_revision`;
- `executive_summary`;
- `alignment`: object containing `metadata`, `prd`, `spec`, and `security`, each `aligned`, `blocked`, or `not-applicable`;
- `conflicts_detected`;
- `required_decision` or `None`;
- `skills_loaded`: names, paths, and `flow-skill-plan`, `authorization-override`, `fallback-registry`, `refreshed-plan`, or `none`;
- `context_efficiency`: compact handoff reused, files read with reasons, justified re-reads, and remaining gaps;
- `artifacts_updated`;
- `engram_observation_ids`;
- `validations`;
- `risks`;
- `next_recommended`;
- `phase_output`: phase-specific structured result.

Do not rename base fields per phase. Put readiness verdicts, matrices, task plans, implementation results, verification verdicts, or archive reports inside `phase_output`.

For `discovery`, use the evidence-packet contract in `subagents/discovery.md` and `AGENTS.md`, not this phase envelope.
