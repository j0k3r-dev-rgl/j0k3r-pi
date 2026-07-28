# Phase Commit Contract

Load this companion for every `prd-review` or `sdd-*` invocation. It is the single normative contract for phase-attempt identity, evidence consumption, artifact persistence, metadata transition, hybrid Engram cursor update, partial/resume behavior, persisted-state validation, and the return envelope.

Phase-specific prompts define semantic work and allowed owner artifacts. They MUST NOT redefine or weaken this commit protocol.

## Success Invariant

A phase may return `status: success` only when one persisted **Phase Commit Record** proves that all of these agree:

- the active invocation lease and authorized phase attempt;
- the expected prior flow/packet revisions;
- every required input and evidence row;
- every phase-owned output artifact and its current revision;
- the authoritative flow-state transition;
- the exact next-phase eligibility or terminal state;
- the configured Engram cursor when the store is `hybrid` or `engram`;
- the return envelope.

Useful work, successful artifact writes, passing tests, an in-memory candidate, or a self-reported delta list is not a committed phase result. A phase that cannot prove the complete invariant returns `partial` only under the resumable protocol below; otherwise it returns `blocked`. It never returns `success` and leaves reconciliation to the orchestrator.

## Authorized Phase Attempt

Before phase work, authoritative state MUST identify one attempt with:

- `attempt_id`;
- `phase` and `executor`;
- `invocation_lease_id`;
- `expected_flow_revision`;
- `expected_packet_revision` or `not-applicable`;
- `authorization_revision` and authorization/approval reference;
- `artifact_writes_authorized`;
- `started_from_attempt_id` or `None`;
- `resume_checkpoint_ref` or `None`.

The phase reads the live `active_flow_invocation` lease and authoritative flow state, then verifies every field. A stale agent, mismatched attempt, changed expected revision, released/replaced lease, or unauthorized write set blocks before writes.

The attempt tuple is immutable. A retry is a new attempt with its own id and `started_from_attempt_id`; it may reuse only output explicitly listed in the prior resumable checkpoint after validating its revision and provenance.

## Exact Engram Identity

The orchestrator creates the single active-flow observation when the flow selection is initialized and persists its exact observation id:

- in `metadata.yaml` as `engram_observation_id` for `hybrid`;
- in the invocation/default flow reference for `engram`.

Phase subagents update only that exact id with `mem_update` after retrieving it with `mem_get_observation`.

Phase subagents MUST NOT use natural-language search to select the active observation, create an observation on miss, or update a same-topic candidate with a different id. Missing, deleted, ambiguous, or mismatched identity is `blocked` for `engram`. For `hybrid`, a stale/missing cursor is rebuilt only at the exact persisted id; a missing exact observation is a state-repair blocker for the orchestrator, not permission for the phase to create a duplicate. `openspec` phases do not require or create an Engram observation.

## Required Input and Evidence Manifest

Before semantic work, the phase builds an input manifest from authoritative references. Each row records:

- stable `input_id` or `evidence_id`;
- source path/observation id and revision;
- required heading, symbol, finding, requirement, or evidence packet row;
- owning prior phase/source;
- applicability;
- intended disposition/output reference.

Every referenced current authority is read completely once when the phase contract requires the complete artifact. Compact orchestrator summaries and prior return envelopes are never input substitutes.

Before commit, every applicable row MUST have one disposition:

- `consumed` with exact output artifact and heading/id;
- `not-applicable` with rationale;
- `blocked` with the missing decision/evidence.

Omitted or uninspected rows make `input_coverage_complete: false` and forbid success.

### Discovery-to-explore coverage

A discovery evidence packet uses stable evidence ids. Before formal or mini explore can succeed, every confirmed file/symbol, behavior/call-path, impact, test surface, constraint, risk/unknown, and required follow-up row has a disposition in the explore input coverage ledger. Formal explore maps consumed rows to `exploration.md` and/or `implementation-map.md`; mini explore maps them to `mini-sdd.md` or the authoritative Engram section. Silent omission is forbidden.

## Phase-Owned Write Set

The phase-specific definition lists its owner artifacts. The effective write set is exactly:

1. those owner artifacts;
2. the authoritative per-flow state (`metadata.yaml` for `openspec`/`hybrid`, the exact active observation for `engram`);
3. for `hybrid`, the exact existing Engram observation id as a compact cursor only;
4. application files explicitly approved for the current apply slice;
5. archive source/target and mapped capability specs explicitly approved for archive.

Anything else is forbidden. Every phase-specific OpenSpec/hybrid write list MUST name `metadata.yaml` explicitly; wording such as “only these artifacts” never excludes the required authoritative flow-state transition.

## Logical Commit Protocol

Tool calls cannot atomically update multiple files, so phases use metadata-last logical commit. Unreferenced/prepared writes are not authoritative phase completion.

### 1. Revalidate before writes

Revalidate the attempt tuple, expected revisions, authorization, exact write set, required inputs, and live invocation lease. Record the result in the commit candidate.

### 2. Write owner outputs without advancing the phase

Write/update only phase-owned output artifacts. Give every changed artifact a current revision. Do not yet set the phase successful or make the next phase eligible.

For apply/verify/archive, perform the additional executor, coverage, approval, and side-effect gates before recording outputs.

### 3. Validate outputs and coverage from persisted state

Run one targeted persisted-state parser/assertion against the actual written files or exact Engram observation. It MUST validate:

- required artifact paths and revisions exist;
- required headings/ids and cross-references resolve;
- input/evidence coverage is complete;
- blockers/status/next-phase semantics are coherent;
- phase-specific matrices/counts/invariants are coherent;
- no forbidden write is present in the phase edit/write ledger.

Validation from in-memory prose alone is invalid. A parser/assertion command and its result are recorded in `persisted_validation`.

### 4. Prepare the Phase Commit Record

Prepare one record containing:

- `commit_id`;
- attempt tuple and `committed_by_executor`;
- `previous_flow_revision` and `current_flow_revision`;
- previous/current packet revision;
- `result`: `success`, `partial`, or `blocked`;
- `artifact_manifest`: path or observation id, prior/current revision, changed headings/ids, and new/existing;
- `input_coverage_complete`, coverage-row count, and uncovered ids;
- `persisted_validation`: parser/assertion command or tool, result, and checked refs;
- `authorization_consumed` and approval binding when applicable;
- blockers and required decision;
- exact `next_phase`/executor/eligibility or terminal state;
- exact Engram observation id/status when configured;
- resume checkpoint when result is `partial`;
- `return_envelope_projection` containing the persisted values from which the return is built.

### 5. Commit authoritative state

For `openspec`:

- update `metadata.yaml` last using an exact expected-revision replacement;
- persist the complete Phase Commit Record;
- make the next phase eligible only in this final write.

For `hybrid`:

1. write a metadata `commit_state: prepared` record with next-phase eligibility blocked;
2. update only the exact existing Engram observation id with the prepared commit id and target OpenSpec revision;
3. revalidate the live lease and expected prepared revision;
4. finalize `metadata.yaml` with `commit_state: committed` and only then make the next phase eligible.

If the cursor update or final metadata write fails, return resumable `partial`; OpenSpec remains authoritative and the next phase remains ineligible. Never claim success from a prepared record.

For `engram`:

- update the exact active observation id with the complete Phase Commit Record and flow transition in one `mem_update`;
- retrieve that exact observation and validate its current revision/content before success.

For archive, the authoritative record moves with the archived flow. The final archived metadata/Engram closure record is the commit authority.

### 6. Validate the committed receipt

After the authoritative write, run one targeted parser/assertion against persisted authority. This required read/parse is not a prohibited mechanical reread. It verifies:

- `commit_state: committed`;
- attempt and lease ids match the authorized invocation;
- expected previous and current revisions match;
- artifact manifest and input coverage agree with persisted outputs;
- phase status, blockers, and next phase are coherent;
- hybrid/Engram exact observation identity and cursor status agree;
- the return projection equals the committed values.

Any mismatch forbids success.

### 7. Derive the return envelope

Construct the return envelope only from the validated committed record. Do not reconstruct fields from memory or from earlier draft output.

The return MUST include:

- `attempt_id`;
- `invocation_lease_id`;
- `phase_commit_id`;
- `commit_state`;
- `previous_flow_revision`;
- `current_flow_revision`;
- `input_coverage_complete` and uncovered ids;
- `persisted_validation`;
- `artifact_deltas` copied from the committed manifest;
- `engram_observation_ids` copied from the committed identity/status;
- all normalized base fields from `shared-phase-rules.md`.

`status: success` with missing/mismatched receipt fields is invalid even if semantic phase work is correct.

## Partial and Resume Protocol

`partial` is valid only when the current work is safely resumable and authoritative state records:

- current attempt id and immutable parent attempt id;
- `commit_state: partial` or `prepared`;
- completed artifact writes with exact revisions;
- completed input/evidence rows;
- pending operations and the first operation to resume;
- blocker/required decision, when any;
- `next_phase.eligible: false`;
- `resume_checkpoint_ref` and allowed reusable outputs;
- whether the current lease is still valid or must be replaced.

A partial result MUST NOT create another flow observation, mark the phase complete, or authorize the next phase. A new invocation receives a new attempt id, validates the checkpoint, and either resumes it or blocks on drift. It does not repeat completed discovery or artifact work without a recorded invalidation reason.

A non-resumable failure is `blocked`, not `partial`.

## Lease Release and Orchestrator Review

The subagent never releases or retargets `active_flow_invocation`. The orchestrator may release the lease only after receiving a return and validating that its attempt/lease/commit ids match persisted authority.

For success, the orchestrator reads the committed receipt and only the reported changed headings/ids. It advances/invokes the next phase only when the receipt is committed and next eligibility is exact.

For partial/blocked, the orchestrator does not hand-author routine semantic completion. It may issue a new attempt bound to the persisted checkpoint, request the named decision, or perform only the mechanical/approved remediation allowed by global policy.

## Phase Completion Matrix

Every phase-specific definition MUST state before success:

- required semantic outputs;
- exact owner artifacts;
- required input/evidence coverage rows;
- exact successful next phase or terminal state;
- phase-specific validation;
- required commit-receipt fields.

The shared contract owns transaction order and return derivation. A phase prompt may add stricter checks but may not omit or reorder these gates.
