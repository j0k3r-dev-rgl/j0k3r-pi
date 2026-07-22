# Artifact Conventions Companion

Load this companion when the flow needs per-flow mode/store selection, change naming, persistence, archive behavior, or metadata handling.

## Configuration Contract

Execution mode and artifact store are flow-local user decisions, never project-global defaults.

Before every new formal SDD or mini-SDD, the orchestrator must ask the user both questions. The same gate applies when a minimal delegated apply starts a new lifecycle:

1. artifact store: `openspec`, `engram`, or `hybrid`;
2. execution mode: `interactive` or `auto`.

Ask even when another flow used known values, a PRD-first route just returned to triage, or project/tool configuration exists. A new flow must not inherit either choice from a prior flow. An existing active flow is continuation, not a new flow: recover its locked selection and do not ask again. The user's answers authorize creation of this initial selection record only; they do not authorize apply, archive, or Git operations.

A project-wide `openspec/config.yaml` may exist for unrelated OpenSpec tool settings, but it never selects SDD mode or store. Do not create a separate project-global Engram selector for these choices.

### Flow-local selection persistence

Persist the selected pair before the first SDD phase:

- `openspec`: record it in `openspec/changes/<change>/metadata.yaml`;
- `engram`: record it in the active `sdd.active-flow.<change>` observation;
- `hybrid`: record it authoritatively in `openspec/changes/<change>/metadata.yaml`, then copy only the compact selection revision/reference into the active Engram cursor.

The record contains `config_reference`, `config_revision`, `resolved_config_snapshot`, selection timestamp, change/flow identity, execution mode, artifact store, PRD policy when applicable, stable conventions, and lifecycle status.

Rules:

1. Before asking, inspect only the named change's active state. If a non-closed flow exists, treat the request as continuation or ask the user whether to continue, explicitly abandon it, or use another change slug.
2. For a genuinely new flow (no active state, or prior flow archived/explicitly abandoned), ask both questions and persist one new flow-local selection.
3. The selection is immutable until the flow is archived or explicitly abandoned. A request to change mode/store mid-flow is `blocked`; finish or abandon that flow, then start a new flow and ask again.
4. On continuation or `/reload`, recover the persisted selection, compare `config_reference`, `config_revision`, and `resolved_config_snapshot` with the next phase packet, and do not ask again.
5. Any locked selection-field mismatch or missing lock is `blocked`. For `hybrid`, a stale/missing/conflicting Engram cursor is rebuildable from verified OpenSpec and repository state when those authoritative sources are coherent; conflicting OpenSpec files or repository state are `blocked`. Never migrate an active flow between stores or silently rewrite its mode.
6. Phase subagents consume the locked snapshot supplied by the orchestrator. They never choose, persist, or change mode/store themselves.
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
3. On every durable update, write OpenSpec first, verify the write, then update Engram with compact state and pointers.
4. On reload or mismatch, inspect OpenSpec plus verified repository state and rebuild Engram from that evidence.
5. Engram must not overwrite OpenSpec. A missing/stale Engram record is repairable; conflicting OpenSpec files or repository state are `blocked` for user decision.

For `engram`, Engram remains the source of truth. For `openspec`, OpenSpec remains the sole source of truth.

`none` and legacy `memory` are not valid artifact-store values for the new SDD flow. If encountered, stop and ask the user to select `openspec`, `engram`, or `hybrid` rather than silently converting the value.

## Canonical OpenSpec Paths

Formal-flow paths:

- Change metadata: `openspec/changes/<change>/metadata.yaml`
- Optional PRD: `openspec/changes/<change>/prd.md`
- Optional PRD review: `openspec/changes/<change>/prd-review.md`
- Active change spec: `openspec/changes/<change>/spec.md`
- Implementation map: `openspec/changes/<change>/implementation-map.md`
- Active verification report: `openspec/changes/<change>/verify-report.md`
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

A named OpenSpec or hybrid flow maintains `openspec/changes/<change>/metadata.yaml` as the authoritative flow-selection record and compact operational metadata:

- slug, title, flow identity, flow type, and lifecycle status (`active`, `prd-review-complete-returned-to-triage`, `archived`, or `abandoned` as applicable);
- `config_reference`, immutable `config_revision`, and `flow_selection_locked: true`;
- the resolved execution mode/artifact store snapshot and selection timestamp;
- PRD policy/stable conventions when applicable;
- relevant artifact paths;
- concise summary and validation expectations.

For `engram`, store the same selection fields in the active `sdd.active-flow.<change>` observation. For `hybrid`, copy only the compact metadata revision/reference into Engram after the OpenSpec metadata write is verified.

Do not put detailed exploration, implementation plans, raw evidence, phase reports, or full handoffs in metadata. Formal SDD uses its appropriate phase artifacts; mini-SDD uses `mini-sdd.md`.

Do not add placeholder paths or statuses for artifacts that do not exist.

## Change Slug Rules

Use a stable kebab-case slug derived from the feature or change name.

Examples:

- `pi-sidebar-extension`
- `sdd-workflow-skill`
- `memory-command-validation`

Before reusing a slug, inspect the selected store's state to avoid accidental overwrite. An active slug means continuation with its locked selection; do not ask or overwrite it. A `prd-review-complete-returned-to-triage`, archived, or explicitly abandoned slug is non-active for downstream selection and may start a new flow only after asking mode/store again and creating a new selection revision. For `hybrid`, inspect authoritative OpenSpec state and refresh the Engram pointer before continuing.

## Phase Handoff and Context Compression

Invocation prompts are the immediate transport between subagents. Persisted stores support continuity and recovery; they are not a reason to copy full history into the orchestrator context.

Every phase invocation includes the locked flow-selection reference/revision/snapshot, `flow_selection_locked: true`, resolved mode/store, phase authorization, artifact-write authorization, and the relevant compact handoff. Apply and archive additionally include their mandatory persisted local approval records.

- Pass compact, phase-specific evidence and acceptance checks in the prompt.
- Update `mini-sdd.md` or Engram state after meaningful phase results according to the configured store.
- Keep raw discovery and verbose subagent output outside the orchestrator context unless a material decision requires it.
- Do not make a later phase rediscover evidence already preserved in a trustworthy handoff.

## Local Approval Records

This workflow runs in a trusted local single-user environment. Approval only records that the current local user accepted an exact work packet.

Before asking for apply approval, assign the exact apply-ready packet an immutable `packet_revision`. Before asking for archive approval, assign the exact completion summary/archive scope an immutable `completion_revision`. Any content change creates a new revision.

After approval and before invoking the phase, persist a minimal local record containing:

- `approval_id` and type (`apply` or `archive`);
- `approved_packet_revision` for apply or `approved_completion_revision` for archive;
- concise approved scope;
- `approval_record_ref`: OpenSpec path/section or Engram observation/topic pointer;
- `approval_recorded_at`;
- redacted summary and `approval_summary_redacted: true`.

Persistence by store:

- `openspec`: write the record into the active formal `implementation-map.md` or mini `mini-sdd.md`;
- `engram`: write it into `sdd.active-flow.<change>`;
- `hybrid`: write the OpenSpec record first, then copy only its revision, status, and pointer into Engram.

Local approvals remain valid after `/reload` or process restart when the durable record exists and the current packet/completion revision still matches exactly. Missing records, changed revisions, changed scope, failed writes, or conflicting OpenSpec/repository evidence require fresh approval. Conversation history alone is not continuation evidence, and legacy approval must not be synthesized or backdated.

Apply/archive agents retrieve `approval_record_ref` and compare the approved revision, scope, type, and store before acting. Do not reuse approval after scope, acceptance criteria, task slice, verification verdict, completion summary, or archive scope changes.

## Approval Retention and Redaction

Approval records preserve minimum audit provenance without retaining raw conversation:

- never store the raw user approval message, secrets, credentials, private data, sensitive payloads, or unnecessary file contents;
- keep scope summaries categorical and concise; replace sensitive identifiers with stable non-secret references or digests;
- set `approval_summary_redacted: true` only after checking the persisted summary;
- while a flow is active, retain the approval record and only the handoff needed for safe continuation;
- after archive or explicit abandonment, remove transient handoffs and duplicate summaries from Engram, retaining one compact closure record with approval id, approved revision, timestamp, scope category, final status, archive pointer, and accepted risks;
- archived OpenSpec approval records follow the project's documented retention policy. When no duration is configured, retain the minimal redacted provenance and do not invent an expiry;
- deletion or stronger retention requirements are user/project-policy decisions and must preserve any mandatory audit constraints.

A phase blocks if its required approval evidence can be reconstructed only from redacted-away content; the durable ids, revisions, scope, and decision must remain independently sufficient.

## Local Hybrid Archive Recovery

Hybrid archive follows one deterministic local order:

1. verify approval and verification evidence against the current completion revision;
2. sync mapped capability specs for formal SDD, or record `not-applicable` for mini-SDD;
3. move the OpenSpec change folder to its deterministic archive path;
4. refresh the Engram closure pointer from the archived OpenSpec state.

Each step is idempotent. Before writing, inspect capability content plus the source and target paths. An already-applied identical sync or move is a no-op. If the folder moved but Engram is stale/missing, rebuild Engram from the archived OpenSpec record. If Engram claims closure while OpenSpec remains active, rebuild Engram from OpenSpec rather than advancing OpenSpec from memory.

Conflicting source and target content, unexpected capability content, or an approval/completion revision mismatch is `blocked` for user decision. Do not roll back verified local files blindly. Archive is closed only after the OpenSpec archive path is verified and Engram has been refreshed when configured.

## Local Archive Retry Semantics

Archive retry behavior is idempotent for every local store:

- For `openspec`, if the active source is absent and the deterministic archive target already contains the expected artifacts for the matching completion revision, return a no-op `closed` result. If the source remains and the target is absent, continue the approved archive. Conflicting source/target content is `blocked`.
- For `engram`, if the active-flow/closure observation already records `closed` for the matching completion revision, return a no-op `closed` result. Otherwise complete the approved closure from the current active state.
- For `hybrid`, use the OpenSpec-first recovery order above and rebuild the Engram pointer before returning `closed`.

For every store, a revision mismatch, unexpected closure state, or conflicting persisted content is `blocked` for user decision. A no-op retry must still return an archive report identifying the previously completed effect; it must not repeat capability sync, move files again, duplicate closure records, or imply new approval.

## Archive Contract

Archive is never automatic, including in `auto` mode.

After successful verification:

1. Present the completion summary and explain what archive will close, move, or persist.
2. Wait for explicit user validation and archive approval.
3. Invoke `sdd-archive` only after approval.
4. Archive according to the configured store:
   - `openspec`: close or move the OpenSpec change and sync capability specs when applicable;
   - `engram`: close the active-flow state and preserve only durable decisions or handoff summaries;
   - `hybrid`: follow the local OpenSpec-first archive order, then refresh Engram from the verified archived state.
5. Report the archived state, Engram pointer status when configured, and any residual risks.

A failed or blocked verification cannot proceed to archive. Archive approval is separate from commit, tag, branch, or push approval.
