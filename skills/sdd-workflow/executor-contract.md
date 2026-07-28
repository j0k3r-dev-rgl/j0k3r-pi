# Implementation Executor Contract

Load this companion for every code-writing route: formal SDD apply, mini-SDD apply, minimal delegated apply, remediation apply, and direct orchestrator implementation.

## Normative Mechanism Fidelity

- Active user constraints, `REQ-*` revisions, `DES-*` revisions, approved packet acceptance criteria, and explicit mechanisms are immutable implementation constraints.
- An executor MUST implement the exact approved mechanism. It MUST NOT replace it with an allegedly equivalent mechanism, shortcut, fallback, or weaker control.
- Approval summaries and handoff prose must preserve exact mechanism constraints. A summary such as “no-persist handoff” cannot weaken a normative decision such as “one-use inherited pipe”.
- Canonical artifacts win over summaries: metadata and current user approval, then approved PRD when applicable, spec, design, tasks or mini packet, and finally operational handoff.
- If canonical artifacts conflict, are ambiguous, or cannot be implemented as written, return `blocked`. Do not choose an interpretation during apply.
- Any proposed mechanism change must return to the owning planning artifact, create a new revision with supersession links when applicable, and receive fresh user approval before implementation.

## Risk-Based Slice Execution

A real multi-invocation split is mandatory when any of these applies:

- workload forecast or review budget is High;
- expected change exceeds the configured review-size budget;
- security, secrets, authorization, persistence, process lifecycle, concurrency, migrations, destructive operations, or permission boundaries are involved;
- slices have independently testable safety invariants;
- one invocation would make requirement-by-requirement review unreliable.

Rules:

- A “work unit” inside one large apply is not a split.
- Each slice has an immutable revision, exact scope, exact mechanism constraints, forbidden substitutions, acceptance checks, and validation evidence.
- One user approval may authorize several named ordered slices only when every slice revision and boundary is recorded. Each slice still runs in a separate apply invocation.
- Run an independent review/verify gate after every safety-critical slice and before dependent slices consume it.
- `single-batch` is allowed only for bounded low-risk work or an explicit user exception that does not waive normative mechanisms, tests, or verification.

## Slice Execution Contract

Every apply-ready slice MUST persist a verbatim, executable contract rather than an outcome summary. The contract contains:

- `slice_revision` and `attempt_number`;
- `primary_safety_invariant`: exactly one independently verifiable safety invariant for risk-bearing work;
- `contract_refs`: exact active requirement, design, task, and remediation finding revisions;
- `allowed_files`, `allowed_symbols`, and forbidden surfaces;
- `ordered_operations`: a numbered operation sequence including required order, preconditions, API/syscall flags, identity/type checks, and the point after which data or a resource may first be used;
- `forbidden_substitutions`, including forbidden reorderings and omitted checks;
- `red_evidence`: for every behavior-changing row, owning test file, named case, command, adversarial fixture, expected pre-change failure, and bounded timeout/no-side-effect assertion when blocking or side effects are part of the risk; `not-applicable` is allowed only for an explicitly classified pure refactor/removal/non-behavioral row with recorded baseline/absence evidence and never for a bugfix or safety/security control;
- `green_evidence`: focused command and exact observable assertions required after implementation;
- `broader_validation`;
- `context_refs`: exact canonical artifact sections/ids needed by apply, not an instruction to reread every historical artifact;
- `source_finding_records` and a one-to-one `finding_mapping` for remediation work; each mapping preserves `finding_id`, immutable `root_finding_id`, recurrence lineage/classification, source verify revision, exact reproducer, required/forbidden mechanism constraints, target slice, and verify-owned closure criteria;
- `prior_finding_ids` and `recurrence_analysis` when a prior verify finding is being retried;
- `completion_authority: sdd-verify`.

A safety-critical slice has one `primary_safety_invariant`. Several tightly coupled contract rows may share one slice only when the same RED case and one bounded independent review can prove them together. Independently testable invariants require separately invoked slices. This rule prevents both oversized applies and artificial one-test-per-invocation fragmentation.

The orchestrator/task producer preserves the exact normative operation sequence in this contract. Apply MUST copy it verbatim into preflight evidence and MUST NOT paraphrase it into a weaker outcome such as “safe open”, “validate identity”, or “handle special files”. Missing operation order, named RED evidence, completion authority, or exact context refs blocks before edits.

A fresh apply executor reads the complete authoritative flow metadata and approval binding, the complete current remediation/task/slice artifact, every complete current normative artifact required by its `contract_refs`/`context_refs`, the complete current implementation map/progress artifact when applicable, and selected skills. It reads those required inputs once before editing and caches them for the invocation. It excludes only unrelated or superseded history not referenced by current authority. A stale, missing, or contradictory reference blocks instead of triggering Git inspection or inference.

## Independent Completion Authority

Apply implements and records evidence with state `implemented-pending-independent-verify`; it does not certify normative completion. Apply MUST NOT mark normative implementation tasks complete or close remediation findings. `sdd-verify` is the only phase that may close those tasks/findings after independently checking canonical mechanisms, implementation, and executable evidence.

An apply `status: success` means only that the authorized implementation slice and its required evidence were produced without a known blocker. It does not mean the requirement is verified, archive-ready, or allowed to display a completed normative checkbox.

## Recurring Finding Circuit Breaker

When verify reports the same immutable `root_finding_id`, active normative ref, or materially identical missing mechanism after a remediation apply, another apply is forbidden until the orchestrator persists a new packet revision. Renamed/split child ids inherit the same root and append to `recurrence_lineage`; approval scope/fingerprint includes the source verify revision, root ids, lineage, packet, and slice revisions. `recurrence_analysis` contains:

- why the previous slice contract or executor result allowed the miss;
- the exact violated or ambiguous instruction;
- a corrected `ordered_operations` sequence;
- new or strengthened RED evidence that would have caught the prior implementation;
- any required slice-boundary change;
- whether executor model/effort/profile review is needed, without changing it absent an explicit user decision.

Apply blocks when source records indicate recurrence but immutable root lineage, this analysis, or its new RED evidence is absent. Every source root must have exactly one current disposition; renaming/splitting a finding or slice, changing severity, or moving it between tasks never bypasses the circuit breaker.

## Formal Remediation Packet

A failed verification that needs code changes must produce a first-class versioned remediation packet. `sdd-verify` identifies exact findings but does not author the solution. After the user chooses remediation planning, the orchestrator directly reconciles every affected SDD artifact using verify evidence, current conversation, durable observations, and user corrections. It revisions/supersedes requirements, design decisions, tasks, maps, metadata, and the remediation packet where needed; it does not rerun formal or mini planning phases. Only then may it request apply approval. For OpenSpec/hybrid formal flows, use `openspec/changes/<change>/remediation.md`; for Engram, store the equivalent authoritative section in the active flow observation.

The packet must contain:

- `remediation_packet_revision`;
- source verify revision plus complete source Verification Finding Records;
- one disposition entry for every blocking `root_finding_id`: one target slice, one ordered target-slice set with disjoint responsibilities, explicit accepted-risk/out-of-scope user decision, or unresolved-decision blocker;
- active requirement and design revisions that remain authoritative;
- exact existing required mechanism for each finding, copied from canonical authority rather than invented by verify;
- forbidden substitutions and out-of-scope surfaces;
- affected files/symbols or bounded discovery gaps;
- RED tests and negative/abuse evidence required;
- acceptance criteria and validation commands;
- ordered slices and dependencies;
- a complete Slice Execution Contract for each slice, including the exact operation order and first-use boundary rather than mechanism labels alone;
- residual manual checks owned by verify.

Any content change creates a new remediation revision and requires fresh apply approval. Approval prose, metadata summaries, or `implementation-map.md` cannot substitute for this packet.

## Development-context evidence

Classify each approved packet as one or more contexts and preserve the corresponding evidence:

- `greenfield`: explicit contracts, scaffold boundaries, and first executable behavior;
- `legacy-continuation`: current-behavior characterization, debt boundaries, and compatibility obligations;
- `migration`: source/target state, invariants, compatibility/cutover, and rollback or recovery;
- `feature`: acceptance behavior and compatibility impact;
- `bugfix`: reproduction, expected behavior, regression test, and smallest sufficient correction;
- `refactor`: behavior-preservation baseline and proof of no hidden feature change;
- `removal`: dependent cleanup, deprecation/compatibility obligations, and absence evidence.

The context changes evidence and validation, not the fidelity, approval, TDD, slice, or independent verification gates.

## Apply Preflight

Before editing code, the executor must build a finding-indexed implementation compliance matrix with one row per source finding plus applicable active requirement, design decision, and security control:

| Finding/root id | Source verify + classification | Exact location/ref | Required mechanism + ordered operations | Planned files/symbols | Exact RED command/case | Expected and observed RED | Forbidden substitutions | Closure evidence | Status |
|---|---|---|---|---|---|---|---|---|---|

Every blocking source root has exactly one packet disposition; its target is one slice, one ordered slice set with disjoint responsibilities, or an explicit non-apply decision. The current apply handles only the responsibility assigned to its authorized slice. Each apply row must prove the complete finding record and approval fingerprint are current, reproduce the exact named RED failure before edits, and preserve ordered operations verbatim. Missing/duplicate/orphan mappings, unstable lineage, a RED that passes or fails for another reason, conflicting/partial/paraphrased/inferred rows, or an `uninspected` source finding block before production edits.

## TDD and Negative Assurance

- Passing tests are necessary but never sufficient for apply success.
- Security and safety controls require negative or adversarial evidence where observable: secrets absent from files, argv and environment; zero signals on identity mismatch; no replacement start before confirmed stop; no symlink escape; no state acceptance for malformed identities; no cross-process lock overlap.
- Tests must exercise production paths and fail when the exact approved mechanism or behavior is absent.
- RED evidence must exist before production edits for every behavior-changing row: the named case must run and fail for the expected behavioral/mechanism reason before any production file is changed. A passing test, unrelated failure, static assertion that does not exercise the production path, or promised future negative test is not RED and blocks implementation. If RED cannot be produced, block before production edits and return the missing validation-strategy decision to the orchestrator/user; do not relabel the behavior change non-testable. A pure refactor/removal/non-behavioral `not-applicable` row follows its recorded baseline/absence evidence instead; bugfix and safety/security rows cannot use that exception.
- The executor must record, for every mapped `root_finding_id`, the exact RED command and observed expected failure, focused GREEN result, adversarial/negative GREEN result, broader validation, and final `implemented-pending-independent-verify` state. Slice-level summaries cannot replace finding rows.

## Pre-Return Success Gate

This semantic implementation gate runs before, and in addition to, the persistence transaction in `phase-commit-contract.md`. Passing this matrix authorizes preparation of the apply Phase Commit Record; it does not itself commit the phase or authorize a success return.

Before returning `success`, the executor uses the cached immutable contract revision plus actual implementation/executable evidence to complete the final matrix. It rereads a contract section only if another actor changed its revision or a specific inconsistency exists; routine read-back is forbidden.

`success` is allowed only when:

- every applicable requirement/control row and every mapped source-finding row is `PASS`;
- every blocking source finding has exactly one approval-bound mapping, immutable root lineage, reproduced RED, focused/adversarial GREEN evidence, and no orphan/duplicate disposition;
- every assigned implementation step is produced and recorded as `implemented-pending-independent-verify`, while normative task/finding closure remains owned by verify;
- exact approved mechanisms and ordered operations were used;
- no control is described as partial, mostly implemented, deferred, approximate, equivalent, or “for verify to decide”;
- focused and broader validation passed or the packet explicitly marks a non-testable manual check as verify-owned;
- changed-file evidence comes from the executor's edit/write ledger and task counts from current artifact deltas; repository/Git inspection is fallback-only on material conflict;
- workflow artifact deltas and the return envelope agree.

If any condition fails, return `partial` only for an explicitly approved resumable split; otherwise return `blocked`. Independent verify discovers defects but is not permission for apply to defer known compliance work. After this gate passes, persist outputs and commit authoritative state through `phase-commit-contract.md`; success remains forbidden until its receipt is validated. Apply success must retain pending-verification state; only verify may convert independently proven work to completed task/finding state.

## Direct Implementation

When the user explicitly chooses direct orchestrator execution, the same fidelity, slice, remediation, TDD, and success gates apply. Policy-sensitive or safety-critical direct work requires an independent review path unless the user explicitly waives it after seeing the residual risk.

## Verify Independence

Verify must derive compliance from canonical artifacts, changed implementation, and executable evidence. It must first dispose every source root finding by rerunning its exact reproducer and inspecting its exact mechanism, then complete the broader applicability ledger. It must not trust apply’s alignment labels, finding matrix, task checkboxes, summaries, or claim of success. Any mechanism substitution or partial control is a failed requirement unless a newer approved normative revision explicitly permits it; any uninspected applicable row makes the verification `INCOMPLETE`, not PASS or remediation-ready FAIL.
