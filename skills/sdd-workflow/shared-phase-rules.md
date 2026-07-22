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

## Configuration and Authorization Packet

Every PRD/SDD phase invocation includes these named fields:

- `phase` and `flow_type`;
- `change`;
- `packet_revision`: immutable hash or stable revision id for the exact packet;
- `config_resolved: true`;
- `config_reference`: flow-local OpenSpec metadata path for `openspec`/`hybrid`, or active-flow observation reference for `engram`;
- `config_revision`: stable local revision/id for the exact locked flow selection;
- `resolved_config_snapshot`: complete flow/change/mode/store/PRD-policy/stable-conventions snapshot;
- `flow_selection_locked: true`;
- `execution_mode: interactive | auto`;
- `artifact_store: openspec | engram | hybrid`;
- `phase_authorization: user-approved | auto-authorized`;
- `artifact_writes_authorized: true | false`;
- `compact_handoff`: current known state and only the prior evidence needed by this phase;
- `allowed_actions` and `forbidden_actions`;
- `expected_return_envelope`;
- `output_limit`.

Rules:

- The orchestrator asks mode/store before each new formal SDD or mini-SDD, persists the flow-local selection, and supplies its locked snapshot. Phase subagents validate packet completeness but never choose or alter that selection.
- A selection mismatch between `config_reference`, `config_revision`, `resolved_config_snapshot`, top-level mode/store, and authoritative active state is `blocked` before phase work. In `hybrid`, authoritative active state means verified OpenSpec/repository state; a stale/missing/conflicting Engram cursor is rebuilt rather than treated as selection drift. No prior apply/archive approval covers changed selection data. The user must finish or explicitly abandon the current flow before starting a new flow and answering both questions again.
- In `interactive`, `phase_authorization` must be `user-approved` before invoking the phase.
- In `auto`, read-only/planning phases may use `auto-authorized`; blockers and material decisions still return control to the orchestrator.
- A phase that needs to persist output must receive `artifact_writes_authorized: true`.
- Apply additionally requires `apply_approved_by_user: true`, `approval_id`, `approved_packet_revision`, `approved_scope_summary`, `approval_recorded_at`, `approval_record_ref`, and `approval_summary_redacted: true`. `approved_packet_revision` must equal the current `packet_revision`, and the local approval record must already exist in the configured store.
- Verify additionally requires `apply_approval_record_ref` so it can verify that implementation used the persisted approved packet.
- Archive additionally requires `archive_approved_by_user: true`, `archive_approval_id`, `completion_revision`, `approved_completion_revision`, `approved_archive_scope`, `approval_recorded_at`, `approval_record_ref`, `approval_summary_redacted: true`, successful verification evidence, and the orchestrator completion summary. The approved and current completion revisions must match.
- For `hybrid`, approval and phase state are read from OpenSpec; Engram carries only the compact pointer/cursor and is rebuilt when stale.
- A packet/completion revision may be a SHA-256 of persisted content or an orchestrator-issued immutable revision id. Any content/scope change creates a new revision. Conversation history alone is not approval evidence.
- Missing, invalid, mismatched, unredacted, or non-durable required fields produce `status: blocked` before writes, implementation, verification persistence, or archive.

## Handoff by Flow

### Formal SDD

- `implementation-map.md` is operational context, not a normative contract.
- For `openspec` or `hybrid`, use `implementation-map.md` as the primary context-compression handoff: consume it before broader source inspection, update newly discovered files/symbols/validations, and explain deliberate re-reading.
- For `engram`, use the active observation `sdd.active-flow.<change>` with enough approved phase detail for continuation.

### Mini-SDD

- Do not require proposal, spec, design, tasks, `exploration.md`, `implementation-map.md`, `apply-progress.md`, or `verify-report.md` solely for mini-SDD.
- Use the compact prior evidence and explore apply-ready packet in prompts.
- Persist continuity in authoritative `mini-sdd.md` for `openspec`/`hybrid`, full active Engram state for `engram`, and only a compact pointer/cursor for `hybrid`.
- Do not rediscover trustworthy evidence without a specific stale or missing-evidence reason.

## Source Inspection and Skill Context

- Local workspace source inspection follows `AGENTS.md`: code-research tools first for symbols, references, impact, and call flow; `bash` source search only with a stated fallback reason.
- Skill Registry selection is an orchestrator responsibility before subagent launch. Pass exact selected skill paths, match reasons, and applicability notes.
- Phase agents use registry fallback only when injected skill context is missing or stale.

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

Before launching a phase subagent, prepare a focused task containing:

- all configuration/authorization packet fields;
- local approval-record references and approved packet/completion revisions when applicable;
- OpenSpec source/archive paths and Engram pointer when `hybrid`;
- phase goal and exact flow type;
- required prior artifact paths or compact summaries;
- relevant metadata/PRD status;
- formal implementation-map or mini-SDD lifecycle handoff, as applicable;
- selected skills and applicability notes;
- allowed/forbidden scope;
- validation expectations;
- expected return envelope and output limit.

Do not run dependent phases in parallel.

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
- `skills_loaded`: names, paths, and `orchestrator-injected`, `fallback-registry`, or `none`;
- `context_efficiency`: compact handoff reused, files read with reasons, justified re-reads, and remaining gaps;
- `artifacts_updated`;
- `engram_observation_ids`;
- `validations`;
- `risks`;
- `next_recommended`;
- `phase_output`: phase-specific structured result.

Do not rename base fields per phase. Put readiness verdicts, matrices, task plans, implementation results, verification verdicts, or archive reports inside `phase_output`.

For `discovery`, use the evidence-packet contract in `subagents/discovery.md` and `AGENTS.md`, not this phase envelope.
