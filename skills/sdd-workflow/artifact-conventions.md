# Artifact Conventions Companion

Load this companion when the flow needs per-flow mode/store selection, change naming, persistence, archive behavior, or metadata handling.

## Configuration Contract

Execution mode and artifact store are flow-local user decisions, never project-global defaults.

Before every new formal SDD or mini-SDD, the orchestrator must ask the user both questions. The same gate applies when a minimal delegated apply starts a new lifecycle:

1. artifact store: `openspec`, `engram`, or `hybrid`;
2. execution mode: `interactive` or `auto`.

Ask even when another flow used known values, a PRD-first route just returned to triage, or project/tool configuration exists. A new flow must not inherit either choice from a prior flow. An existing active flow is continuation, not a new flow: recover its locked selection and do not ask again. The user's answers authorize creation of this initial selection record only; they do not authorize apply, archive, or Git operations.

A project-wide `openspec/config.yaml` is the global SDD execution contract for every phase. It defines only shared workflow policy: schema/config revision, fixed zero-payload invocation trigger, transient `active_flow_invocation` cursor, default `active_flow_reference`, supported lifecycle and phase-executor identities, global return envelopes, output limits, validation order, and revision semantics. Every PRD/SDD subagent reads it first and follows the invocation cursor. The cursor is a single-flight lease for one zero-payload phase invocation, not a statement that only one SDD flow may exist. Multiple flow metadata records may be active; switching the invocation cursor is an orchestrator action that does not change flow-local lifecycle state.

`openspec/config.yaml` never selects execution mode, artifact store, PRD policy, selected skills, acceptance checks, phase handoff, blockers, approval bindings, or another flow-local user choice. Those values remain authoritative only in each flow's metadata or Engram state. The invocation cursor may contain only flow reference, exact active Engram observation id for `engram`, immutable attempt id, lease id/expiry, expected flow/packet revisions, target phase/executor, and authorization refs—never routine phase results.

### Flow-local selection persistence

Persist the selected pair before the first SDD phase:

- `openspec`: record it in `openspec/changes/<change>/metadata.yaml`;
- `engram`: the orchestrator creates exactly one `sdd.active-flow.<change>` observation, records the selection there, and persists its exact observation id in the invocation/default flow reference;
- `hybrid`: the orchestrator creates exactly one active observation, records its exact id authoritatively in `openspec/changes/<change>/metadata.yaml`, then writes only the compact selection revision/reference into that observation.

The flow record contains metadata schema/revision, selection timestamp, change/lifecycle identity, applicable change kind(s), execution mode, artifact store, PRD policy when applicable, stable conventions, lock state, lifecycle status, compact current phase/executor/result refs, packet revision, narrow phase authorization gates, artifact-write permission, required artifact/handoff references, blockers, next phase, and approval bindings when applicable. It is the authoritative per-flow state; none of these fields are copied into the trigger or duplicated into global config.

Rules:

1. Before asking, inspect only the named change's active state. If a non-closed flow exists, treat the request as continuation or ask the user whether to continue, explicitly abandon it, or use another change slug.
2. For a genuinely new flow (no active state, or prior flow archived/explicitly abandoned), ask both questions and persist one new flow-local selection.
3. The selection is immutable until the flow is archived or explicitly abandoned. A request to change mode/store mid-flow is `blocked`; finish or abandon that flow, then start a new flow and ask again.
4. On continuation or `/reload`, read project config, resolve the target from `active_flow_invocation.flow_reference` when a live invocation is in progress or from the selected/default flow reference otherwise, verify the referenced authoritative flow state, and do not ask mode/store again.
5. Any locked selection-field mismatch or missing lock is `blocked`. For `hybrid`, rebuild a stale/missing Engram cursor from the current OpenSpec revisions already in context; consult repository state only when a material semantic conflict cannot be resolved from artifact deltas. Never reread all OpenSpec files or run Git merely because Engram is stale. Never migrate an active flow between stores or silently rewrite its mode.
6. Phase subagents load the locked selection from the active authoritative flow state. They never choose, infer from the trigger, or change mode/store themselves.
7. A PRD-first flow's selection does not choose downstream settings. On approval or explicit continue-as-is, persist `lifecycle_status: prd-review-complete-returned-to-triage`. The status `prd-review-complete-returned-to-triage` is a non-active terminal state that preserves PRD/review artifacts. Any new formal SDD or mini-SDD then passes through triage and must ask both questions again.
8. Never treat `auto` as apply or archive approval. Both gates remain mandatory.

## Artifact Store Policy

Use the configured store; do not silently substitute a default or another store.

### `openspec`

OpenSpec files are the persisted source of truth. Memory may hold only a minimal pointer or compact index when useful.

### `engram`

Engram stores compact active-flow state, decisions, approvals, and phase handoffs. Do not create OpenSpec files solely to mirror Engram state.

### `hybrid`

Hybrid is local OpenSpec + Engram only. OpenSpec holds the source-of-truth artifacts and lifecycle state. Engram holds a compact index, current-phase cursor, decisions, and handoff pointers. Do not duplicate full Markdown content into Engram.

## Local Hybrid Precedence

For `hybrid`, precedence is deterministic:

1. OpenSpec is the source of truth for PRD, proposal, spec, design, tasks, approvals, verification, archive location, and lifecycle status.
2. Engram is a compact index and recovery cursor; it is never a second normative copy.
3. On every durable phase update, use `phase-commit-contract.md`: write/validate owner artifacts, write metadata as `prepared` with next eligibility blocked, update only the exact existing Engram observation id, then finalize metadata as `committed`. Success is forbidden before finalization.
4. On reload, read the compact active-flow pointer plus current metadata revision and only the artifact sections needed for the next phase. On mismatch, inspect the conflicting sections; consult repository state only if artifact evidence cannot resolve the conflict.
5. Engram must not overwrite OpenSpec. A missing/stale cursor is repairable from coherent current OpenSpec revisions without full artifact rereads or routine Git commands; semantic conflicts remain blocked for user decision.

For `engram`, Engram remains the source of truth. For `openspec`, OpenSpec remains the sole source of truth.

`none` and legacy `memory` are not valid artifact-store values for the new SDD flow. If encountered, stop and ask the user to select `openspec`, `engram`, or `hybrid` rather than silently converting the value.

## Canonical OpenSpec Paths

OpenSpec directory roles are mutually exclusive:

- Active changes root: `openspec/changes/`
- Active change folder: `openspec/changes/<change>/`
- Archived changes root: `openspec/archive/`
- Archived change folder: `openspec/archive/YYYY-MM-DD-<change>/`
- Global workflow config: `openspec/config.yaml`
- `openspec/changes/archive/` is invalid; archived folders must never be nested among active changes.

Formal-flow paths:

- Change metadata: `openspec/changes/<change>/metadata.yaml`
- Optional PRD: `openspec/changes/<change>/prd.md`
- Optional PRD review: `openspec/changes/<change>/prd-review.md`
- Active change spec: `openspec/changes/<change>/spec.md`
- Optional detailed testability trace: `openspec/changes/<change>/testability.md`
- Optional detailed archive map: `openspec/changes/<change>/archive-map.md`
- Optional dense traceability table: `openspec/changes/<change>/traceability.md`
- Implementation map: `openspec/changes/<change>/implementation-map.md`
- Active verification report: `openspec/changes/<change>/verify-report.md`
- Versioned remediation packet after failed verification: `openspec/changes/<change>/remediation.md`
- Capability spec on archive when explicitly mapped: `openspec/specs/<capability>/spec.md`

Mini-SDD uses one consolidated lifecycle document when the store is `openspec` or `hybrid`:

- `openspec/changes/<change>/mini-sdd.md`

The mini-SDD record contains only durable phase continuity:

- compact prior-evidence summary;
- explore result and apply-ready packet;
- apply approval id, approved packet revision, `approval_record_ref`, redacted scope summary, and timestamp;
- apply result and validation evidence;
- verify result;
- versioned completion summary;
- archive approval id, approved completion revision, `approval_record_ref`, redacted archive scope, timestamp, and archive result.

Do not require separate `mini-task-packet.md`, `implementation-map.md`, `apply-progress.md`, or `verify-report.md` files solely for mini-SDD. A project may link an existing tracker or artifact when it already provides useful context, but mini-SDD must not recreate it without value.

## Formal Capability Archive Mapping

The canonical formal `spec.md` must include an archive mapping for every durable capability change:

- source change requirement/scenario ids;
- exact target `openspec/specs/<capability>/spec.md` path;
- operation: `add`, `modify`, `remove`, or `none`;
- target requirement/section identifier;
- concise merge/sync intent.

Use explicit `none` with rationale when no capability spec sync is needed. `sdd-archive` may sync only these mapped targets and active requirement revisions; superseded history remains in archived change artifacts rather than becoming current capability truth. Missing, ambiguous, or conflicting required mappings block archive and return a decision to the orchestrator.

## Formal Decision Supersession

Material formal spec requirements and design decisions use stable identifiers and preserve replacement history:

- `decision_id` or stable requirement id;
- `decision_revision`;
- `status: active | superseded`;
- `supersedes`: prior ids/revisions or `None`;
- `superseded_by`: replacement id/revision or `None`;
- supersession reason and timestamp.

A replacement adds a new record and updates only the prior record's supersession metadata. Do not erase or rewrite the prior decision, rationale, alternatives, security implications, or evidence. Both directions of the link must resolve, and downstream spec/design/task references must point to the active revision before apply. Missing, circular, or contradictory supersession links are blocking. When first touching a legacy record without stable ids, assign ids/revisions without fabricating earlier replacements or dates. This convention adds history inside existing spec/design artifacts; it does not add a workflow phase.

## Change Metadata

A named OpenSpec or hybrid flow maintains `openspec/changes/<change>/metadata.yaml` as the authoritative per-flow state for that SDD instance:

- slug, title, flow identity, flow type, and lifecycle status (`active`, `prd-review-complete-returned-to-triage`, `archived`, or `abandoned` as applicable);
- `metadata_schema_version`, immutable flow-state revision, and `flow_selection_locked: true`;
- flow-local execution mode, artifact store, stable conventions, selection timestamp, and exact `engram_observation_id` for `hybrid`;
- current phase/executor, packet revision, artifact-write authorization, and phase status;
- authorized phase attempt id, invocation lease id, expected prior flow/packet revisions, authorization revision, parent attempt/checkpoint, and consumed state;
- compact orchestrator-owned `flow_skill_plan` with registry/session marker, plan revision, coverage, exact selected skill refs, and reported skill gaps;
- narrow `phase_authorization` gates written by the orchestrator for interactive phase advancement, referencing the flow skill plan plus any overrides;
- required artifact/handoff references, including the active remediation packet revision when applicable, blockers, next phase, and short summaries;
- persisted approval bindings and approval fingerprints for apply/archive when applicable;
- PRD policy/stable conventions when applicable;
- relevant artifact paths and references to detailed owner artifacts;
- the latest complete Phase Commit Record: commit id/state, attempt/lease identity, previous/current flow revisions, artifact manifest, input/evidence coverage, persisted validation, blockers/decision, exact next eligibility, Engram cursor status, and return-envelope projection.

Metadata should not contain long acceptance-check lists, verbose allowed/forbidden action lists, full security constraints, detailed validation context, or lengthy selected-skill rationales. Store those in the owning phase artifact (`proposal.md`, `spec.md`, `design.md`, `tasks.md`, `testability.md`, `archive-map.md`, `implementation-map.md`, `mini-sdd.md`, or Engram state for `engram` flows) and keep metadata as ids, revisions, statuses, paths, blockers, authorization refs, and compact summaries.

Global workflow schema, fixed trigger, executor mapping, return-envelope shape, output limits, and validation-order policy belong only in `openspec/config.yaml`; do not duplicate them into metadata beyond revision references needed for consistency checks.

For `engram`, store the same selection fields and commit records in the single exact `sdd.active-flow.<change>` observation created by the orchestrator. For `hybrid`, persist its exact observation id in metadata and update only that id during the prepared-to-committed protocol. Phase agents never search/create a replacement observation.

Do not duplicate detailed exploration, acceptance matrices, implementation plans, raw evidence, security checklists, selected-skill reasoning, or full phase reports in metadata. Store them in formal phase artifacts or `mini-sdd.md` and reference those paths from the operational phase state. Metadata may contain only compact ids, revisions, status, paths, blockers, authorization refs, skill-plan refs, short summaries, and references needed for zero-payload execution.

Do not add placeholder paths or statuses for artifacts that do not exist.

## Change Slug Rules

Use a stable kebab-case slug derived from the feature or change name.

Examples:

- `pi-sidebar-extension`
- `sdd-workflow-skill`
- `memory-command-validation`

Before reusing a slug, inspect the selected store's state to avoid accidental overwrite. An active slug means continuation with its locked selection; do not ask or overwrite it. A `prd-review-complete-returned-to-triage`, archived, or explicitly abandoned slug is non-active for downstream selection and may start a new flow only after asking mode/store again and creating a new selection revision. For `hybrid`, inspect authoritative OpenSpec state and refresh the Engram pointer before continuing.

## Phase Handoff and Context Compression

Authoritative files/state are the transport between phases. The subagent tool prompt is only the fixed trigger declared in `openspec/config.yaml` and contains no phase packet or handoff content.

Routine phase transitions are written by the phase subagent, not hand-authored by the orchestrator. Before invocation, the orchestrator validates global config, authorization, and per-flow state, then records only the narrow attempt gate bound to immutable attempt/lease ids and expected prior revisions. The subagent follows `phase-commit-contract.md`; owner artifacts validate first and the authoritative phase transition commits last. During explicitly selected remediation, the orchestrator instead directly reconciles affected artifacts and semantic flow state, preserving revisions/supersession and invalidating stale approvals before any new apply request. Apply and archive approval records remain orchestrator/user gates.

- Persist compact phase-specific evidence and acceptance checks with stable input/evidence ids in metadata references plus the owning phase artifact or Engram state; every applicable input id receives a consumed/not-applicable/blocked disposition before commit.
- Update `mini-sdd.md` or Engram state after meaningful phase results according to the configured store.
- Keep raw discovery and verbose subagent output outside the orchestrator context unless a material decision requires it.
- Do not make a later phase rediscover evidence already preserved in a trustworthy handoff.
- After every phase, validate the persisted Phase Commit Record before trusting `artifact_deltas`. The deltas are copied from its committed artifact manifest. Read a new small artifact once when needed; for existing artifacts read only changed headings/ids and exact prior refs. Application source/tests reported by apply remain verify-owned.

## Formal Remediation Packet

After failed verification and the user's remediation-planning decision, the orchestrator must reconcile every affected normative artifact and persist formal remediation scope in `openspec/changes/<change>/remediation.md` for `openspec`/`hybrid`, or as an equivalent authoritative section in the active Engram flow for `engram`. This targeted reconciliation uses verify findings and user context and does not replay proposal/spec/design/task phases.

The remediation packet is normative for the remediation apply and must include:

- immutable `remediation_packet_revision` and source verify revision;
- exact verification finding ids;
- active requirement and design revisions that remain in force;
- exact required mechanism and forbidden substitutions for every finding;
- bounded files/symbols, RED tests, negative/abuse evidence, acceptance criteria, validation commands, and risk-based slices;
- verify-owned manual checks and explicit non-goals.

`implementation-map.md`, approval prose, metadata summaries, and conversation history cannot replace this packet. Any packet content change creates a new revision and invalidates prior apply approval. The apply approval fingerprint must reference the remediation revision, findings, active normative revisions, mechanisms, forbidden substitutions, and named slices rather than relying on a broad prose category.

## Local Approval Records

This workflow runs in a trusted local single-user environment. Approval only records that the current local user accepted an exact work packet.

Before asking for apply approval, assign the exact apply-ready packet an immutable `packet_revision`. Before asking for archive approval, assign the exact completion summary/archive scope an immutable `completion_revision`. Any content change creates a new revision.

After approval and before invoking the phase, persist a minimal local record containing:

- `approval_id` and type (`apply` or `archive`);
- `approved_packet_revision` for apply or `approved_completion_revision` for archive;
- `approval_scope_refs`: non-sensitive paths, artifact revisions, task ids, active requirement/design ids, exact mechanism ids/descriptions, forbidden-substitution ids, finding ids, and named slice revisions covered by the approval;
- `approval_scope_fingerprint`: deterministic digest over the ordered normalized non-sensitive refs/revisions, not over raw user prose or secret-bearing content; the apply executor must recompute and compare it before edits;
- concise redacted approved scope summary;
- `approval_record_ref`: OpenSpec path/section or Engram observation/topic pointer;
- `approval_recorded_at`;
- redacted summary and `approval_summary_redacted: true`.

Persistence by store:

- `openspec`: write the record into the active formal `implementation-map.md` or mini `mini-sdd.md`;
- `engram`: write it into `sdd.active-flow.<change>`;
- `hybrid`: write the OpenSpec record first, then copy only its revision, status, and pointer into Engram.

Local approvals remain valid after `/reload` or process restart when the durable record exists and the current packet/completion revision still matches exactly. Missing records, changed revisions, changed scope, failed writes, or conflicting OpenSpec/repository evidence require fresh approval. Conversation history alone is not continuation evidence, and legacy approval must not be synthesized or backdated.

Apply/archive agents retrieve `approval_record_ref`, recompute the documented fingerprint from normalized scope refs, and compare the approved revision, refs, fingerprint, type, and store before acting. Do not reconstruct authorization from redacted prose. Do not reuse approval after scope, exact mechanism, forbidden substitution, acceptance criteria, task/remediation slice, verification verdict, completion summary, or archive scope changes.

## Approval Retention and Redaction

Approval records preserve minimum audit provenance without retaining raw conversation:

- never store the raw user approval message, secrets, credentials, private data, sensitive payloads, or unnecessary file contents;
- keep scope summaries categorical and concise; replace sensitive identifiers with stable non-secret references or digests;
- set `approval_summary_redacted: true` only after checking the persisted summary;
- while a flow is active, retain the approval record and only the handoff needed for safe continuation;
- after archive or explicit abandonment, remove transient handoffs and duplicate summaries from Engram, retaining one compact closure record with approval id, approved revision, timestamp, scope category, final status, archive pointer, and accepted risks;
- archived OpenSpec approval records follow the project's documented retention policy. When no duration is configured, retain the minimal redacted provenance and do not invent an expiry;
- deletion or stronger retention requirements are user/project-policy decisions and must preserve any mandatory audit constraints.

A phase blocks if its required approval evidence cannot be validated from non-sensitive durable refs, revisions, fingerprints, and decision fields. Redacted prose is explanatory only and never the sole source of scope truth.

## Local Hybrid Archive Recovery

Hybrid archive follows one deterministic local order:

1. verify approval and verification evidence against the current completion revision;
2. sync mapped capability specs for formal SDD, or record `not-applicable` for mini-SDD;
3. move the entire OpenSpec change folder from `openspec/changes/<change>/` to `openspec/archive/YYYY-MM-DD-<change>/`, then rewrite authoritative archived path references to that target;
4. verify that no source folder remains under `openspec/changes/` and refresh the Engram closure pointer from the archived OpenSpec state.

Each step is idempotent. Before writing, inspect capability content plus the source and target paths. An already-applied identical sync, move, or Engram refresh is a no-op only after the full closure invariant is checked. If the folder moved but capability sync status is missing/failed, return `blocked-recovery-needed` and identify the incomplete invariant rather than claiming closure. If the folder moved but Engram is stale/missing, rebuild Engram from the archived OpenSpec record after verifying capability sync. If Engram claims closure while OpenSpec remains active, rebuild Engram from OpenSpec rather than advancing OpenSpec from memory.

Conflicting source and target content, unexpected capability content, missing capability-sync evidence, or an approval/completion revision mismatch is `blocked` for user decision. Do not roll back verified local files blindly. Archive is closed only after capability sync status, OpenSpec archive path, lifecycle closure, approval fingerprint, and Engram refresh when configured are all verified.

## Local Archive Retry Semantics

Archive retry behavior is idempotent for every local store:

- For `openspec`, the active source is always `openspec/changes/<change>/` and the deterministic target is always `openspec/archive/YYYY-MM-DD-<change>/`. If the active source is absent and the target already contains the expected artifacts, matching completion revision, approval fingerprint, lifecycle closure, rewritten archived references, and capability-sync marker for every mapped target, return a no-op `closed` result. If the source remains and the target is absent, continue the approved archive. If an archived folder exists under `openspec/changes/`, authoritative archived references still point at the active root, or only some effects are present, return `blocked-recovery-needed` with the missing invariant. Conflicting source/target content is `blocked`.
- For `engram`, if the active-flow/closure observation already records `closed` for the matching completion revision, approval fingerprint, and closure refs, return a no-op `closed` result. Otherwise complete the approved closure from the current active state.
- For `hybrid`, use the OpenSpec-first recovery order above, verify capability sync and archive path, then rebuild the Engram pointer before returning `closed`.

For every store, a revision mismatch, unexpected closure state, or conflicting persisted content is `blocked` for user decision. A no-op retry must still return an archive report identifying the previously completed effect; it must not repeat capability sync, move files again, duplicate closure records, or imply new approval.

## Archive Contract

Archive is never automatic, including in `auto` mode.

After successful verification:

1. Present the completion summary and explain what archive will close, move, or persist.
2. Wait for explicit user validation and archive approval.
3. Invoke `sdd-archive` only after approval.
4. Archive according to the configured store:
   - `openspec`: move `openspec/changes/<change>/` to `openspec/archive/YYYY-MM-DD-<change>/`, rewrite authoritative archived references, and sync capability specs when applicable;
   - `engram`: close the active-flow state and preserve only durable decisions or handoff summaries;
   - `hybrid`: perform the same strict OpenSpec move first, verify active/archive separation, then refresh Engram from the verified archived state.
5. Report the archived state, Engram pointer status when configured, and any residual risks.

A failed or blocked verification cannot proceed to archive. Archive approval is separate from commit, tag, branch, or push approval.
