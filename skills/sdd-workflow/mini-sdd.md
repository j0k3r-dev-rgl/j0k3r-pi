# Mini-SDD Companion

Load this companion when the selected route is `mini-sdd` or `minimal-delegated-apply`.

## Purpose

Use mini-SDD for approved, taskable implementation that is too broad or risk-bearing for comfortable inline/simple TDD but does not need formal proposal, spec, design, or task phases.

Mini-SDD is a lightweight delegated lifecycle:

```text
prior evidence → sdd-explore → approved sdd-apply → sdd-verify → completion summary → approved sdd-archive
```

Do not insert formal proposal, spec, design, task, or other SDD phases into this route.

Minimal delegated apply is the tracker-backed mechanical variant. It may skip `sdd-explore` only when the cited tracker and prior evidence already provide the complete scope, acceptance checks, and validation plan. It retains the mandatory apply, verify, summary, and archive gates.

## Preconditions

- The user selected or approved mini-SDD for a named change, slice, or batch.
- Expected behavior is already designed, obvious from existing patterns, or can be bounded by read-only explore without inventing product behavior.
- Security applicability and known constraints can be stated explicitly.
- No new external contract, persistence model, security policy, or architecture decision is being invented.
- For minimal delegated apply, a tracker or checklist exists and its path/content reference is persisted in authoritative flow state.
- The user selected execution mode and artifact store specifically for this new mini-SDD, and the selection plus phase/artifact authorization are persisted/locked before the fixed-trigger invocation.
- The approved packet contains the complete slice execution contract required by `executor-contract.md`: exact ordered operations, named RED/GREEN evidence, bounded context refs, one primary safety invariant per risk-bearing slice, and `completion_authority: sdd-verify`.

If any precondition becomes false, stop and return `blocked`; do not silently promote the flow, invent missing decisions, or weaken an exact mechanism.

## Execution Modes and Mandatory Gates

For every new mini-SDD, and every minimal delegated apply that starts a new lifecycle, ask the user to choose `interactive` or `auto` and independently choose `openspec`, `engram`, or `hybrid`. Persist that pair in the flow-local metadata/active observation before explore. Keep it immutable through archive/abandonment. On continuation, reuse it without asking; never inherit it from a prior flow.

### `interactive`

Ask before each phase and before writing or updating persisted artifacts.

### `auto`

After mini-SDD selection, advance through approved read-only work and from successful apply into verify without routine phase prompts. Stop for blockers or material decisions.

### Gates that mode cannot bypass

1. **Apply gate:** assign the exact apply packet and every mandatory slice an immutable revision, persist its complete slice execution contract without paraphrasing ordered operations, preserve exact mechanism constraints and forbidden substitutions, present scope/acceptance/validation summary, wait for explicit approval, and persist its redacted local record before every `sdd-apply`.
2. **Archive gate:** after successful `sdd-verify`, assign the completion summary a revision, present what archive will close, wait for explicit approval, and persist its redacted local record before invoking `sdd-archive`.

Choosing mini-SDD is not apply approval. `auto` is not apply or archive approval.

If verify fails or is blocked, do not invoke or offer automatic archive. Report exact finding ids and wait for the user to choose remediation planning, further investigation, acceptance of risk, or deferral. When remediation planning is chosen, the orchestrator directly reconciles affected sections of authoritative `mini-sdd.md`/Engram state and creates a new versioned remediation packet from verify evidence and user context; do not rerun `sdd-explore`. Every remediation apply then requires new explicit approval; summaries or non-normative handoff cannot replace that packet.

## Prior Evidence and Explore Handoff

Before mini-SDD begins, workspace investigation follows the discovery-executor choice in `AGENTS.md`. The resulting evidence may come from `discovery` or direct orchestrator inspection.

Before invoking `sdd-explore`, ensure the initial mini-SDD selection and compact prior evidence exist in `mini-sdd.md` or authoritative Engram flow state. Give every prior-evidence row a stable `evidence_id`; mini explore must disposition every id under `phase-commit-contract.md` before success. The orchestrator may create only this initial user-approved evidence/selection record; the `sdd-explore` subagent owns the phase transition and must validate, refine, or block it. Initial evidence should include:

- user request and confirmed expected behavior;
- known scope, files, symbols, and references;
- observed impact and likely test surfaces;
- constraints, forbidden surfaces, and security applicability;
- material unknowns and confidence;
- exact questions explore must resolve;
- initial packet revision when available;
- authorization, handoff references, expected return contract, and output limit.

Then invoke only the project-configured fixed trigger.

Do not make `sdd-explore` repeat prior investigation without a specific stale or missing-evidence reason. Do not copy raw research into the main context when a compact decision-oriented packet is sufficient.

During routine SDD execution, the orchestrator must not read subagent-definition Markdown files to reconstruct system prompts. Those definitions are injected by the subagent runtime. Read only the workflow skills and project artifacts needed for routing and handoff. This restriction does not apply when the explicit task is to audit, maintain, or edit the workflow/subagent definitions themselves.

## Phase Contracts

### 1. `sdd-explore`

Explore is read-only with respect to implementation. It must:

- validate the proposed scope and identify affected files, symbols, and tests;
- identify risks, security implications, dependencies, and forbidden surfaces;
- produce a complete slice execution contract with one primary safety invariant for risk-bearing work, exact ordered operations/checks/first-use boundaries, named RED/GREEN evidence, forbidden substitutions, and bounded context refs;
- define measurable acceptance checks and validation commands;
- report unresolved decisions and return `blocked` when necessary;
- return a compact apply-ready packet.

Explore must not implement, refactor, or create formal proposal/spec/design/task artifacts.

### 2. `sdd-apply`

Invoke only after explicit apply approval has been persisted. Authoritative mini lifecycle state must contain `apply_approved_by_user: true`, approval id/time/redacted summary, current packet revision, matching approved packet revision, approval record reference, and the compact explore packet plus:

- approved scope refs/fingerprint and task slice;
- the complete slice execution contract, copied without weakening or reordered operations;
- allowed and forbidden files or surfaces;
- acceptance criteria and validation commands;
- strict TDD expectations from `AGENTS.md`, or the user-approved validation strategy when no test framework exists;
- security/privacy/auth/data constraints;
- `flow_skill_plan` revision/coverage or fallback skill-resolution notes;
- configured persistence requirements;
- compact handoff, expected return envelope, and output limit.

Apply first loads project config, resolves `active_flow_invocation` when active or the default flow reference otherwise, reads `executor-contract.md`, and reads the approved mini packet from authoritative lifecycle state. It copies the ordered operations verbatim, proves every behavior-changing RED case before production edits, and records successful implementation as `implemented-pending-independent-verify`. If RED cannot be produced, it blocks for an explicit validation-strategy decision rather than labeling the behavior change non-testable. Bounded low-risk work may run once. High workload/review risk or security, secrets, persistence, process lifecycle, concurrency, migrations, permissions, or destructive behavior requires separate revisioned apply invocations with independent review between safety-critical slices. Apply returns changed files/symbols, RED/GREEN evidence, validation, compliance rows, deviations, blockers, skill-plan usage/fallback, and residual risks. It must not close normative acceptance, expand scope, substitute mechanisms, leave partial controls, or make new product, architecture, API, persistence, privacy, or security decisions.

### 3. `sdd-verify`

After successful apply, independent `sdd-verify` is mandatory for normative closure and archive eligibility. A user may defer or abandon verification, but cannot waive it while retaining completed acceptance or archive readiness; without verify, implementation remains pending and archive stays blocked. Persist explicit phase authorization in `interactive` or `auto-authorized` in `auto`, plus artifact-write authorization, before invoking the fixed trigger.

Verify reads the approved apply packet, acceptance criteria, changed-file summary, and validation evidence from authoritative mini lifecycle state. It checks:

- scope and behavioral acceptance;
- tests and validation evidence;
- security applicability and forbidden surfaces;
- unexpected changes or unresolved risks;
- exact approved ordered-operation fidelity and absence of partial/mostly/deferred controls;
- negative/adversarial RED/GREEN evidence for safety and security constraints;
- closure of normative acceptance only by verify after independent PASS;
- persistence continuity for the configured artifact store.

A failed or blocked verification stops the lifecycle before archive.

### 4. Completion Summary and `sdd-archive`

After successful verify, the orchestrator presents a concise summary containing:

- implemented scope and changed files;
- acceptance and verification result;
- tests and validation commands executed;
- security alignment;
- persisted artifacts or Engram observations updated;
- residual risks, accepted deviations, and follow-up work;
- what archive will close or move.

Wait for explicit user validation and archive approval in both `interactive` and `auto`. Persist `archive_approved_by_user: true`, archive approval id/time/scope, `approval_record_ref`, the successful verification verdict, the versioned orchestrator completion summary, and a matching `approved_completion_revision` in authoritative flow state. Then invoke `sdd-archive` using only the configured fixed zero-payload trigger. For `openspec`/`hybrid`, move the complete mini-SDD folder from `openspec/changes/<change>/` to `openspec/archive/YYYY-MM-DD-<change>/`; never place it under `openspec/changes/archive/`. For `hybrid`, refresh Engram from the verified archived path after the move.

Archive closes the configured persistence state and reports what was archived. It must not create commits, tags, branches, or pushes without separate explicit Git approval.

## Persistence

Use the artifact store configured for the flow. Valid stores are `openspec`, `engram`, and `hybrid`; do not silently replace one with another. Every mini phase loads `phase-commit-contract.md`, writes the consolidated lifecycle output before authoritative state, and derives its return only from the committed receipt.

### `openspec`

Maintain a lightweight OpenSpec change folder. Use one consolidated Markdown lifecycle record by default:

- `openspec/changes/<change>/mini-sdd.md` — evidence summary, explore packet, approved apply scope, apply result, verify result, completion summary, and approval checkpoints.

Create or update required OpenSpec metadata according to the project's artifact conventions. Archive the change only after the archive gate.

### `engram`

Keep compact active-flow state and phase handoffs in Engram. Do not create OpenSpec Markdown solely for mini-SDD.

### `hybrid`

Maintain the authoritative lightweight `mini-sdd.md` record and a compact Engram index/cursor. Write OpenSpec first; on reload or mismatch, rebuild Engram from `mini-sdd.md` and verified repository state. Mini archive moves the OpenSpec change folder idempotently, then refreshes the Engram closure pointer.

Authoritative flow state and lifecycle artifacts are the only phase-to-phase transport. The invocation prompt is a fixed zero-payload trigger.

## Return Envelope

Every mini-SDD phase returns the normalized base envelope from `shared-phase-rules.md`: status, phase, flow type, packet revision, executive summary, alignment object, conflicts, required decision, skills loaded, context efficiency, artifacts, Engram ids, validations, risks, and next recommendation.

Put mini-specific scope/files, apply-ready packet, acceptance evidence, verification verdict, or archive report inside `phase_output`. The phase subagent writes its routine lifecycle transition through the mandatory metadata-last `phase-commit-contract.md`. The orchestrator first validates the persisted receipt, then reads only the changed lifecycle sections named by its artifact manifest. It does not hand-author routine phase state, but after a user remediation decision it directly revisions affected mini artifacts/state before requesting fresh apply approval.
