---
name: sdd-workflow
description: Operate the project's PRD/SDD/OpenSpec workflow as a thin orchestrator skill, loading companion guidance for PRD, artifacts, phase contracts, and mini-sdd only when the route needs them.
license: Apache-2.0
metadata:
  author: j0k3r
  version: "2.0"
---

# SDD Workflow

## Registry Contract

```json
{
  "category": "workflow",
  "domains": ["sdd", "prd", "openspec", "planning", "subagents", "workflow-routing"],
  "triggers": {
    "paths": [
      "openspec/**",
      "openspec/changes/**/prd.md",
      "openspec/changes/**/prd-review.md",
      "subagents/sdd-*.md",
      "subagents/prd-review.md",
      "skills/sdd-workflow/SKILL.md",
      "skills/sdd-workflow/*.md",
      ".pi/subagents/sdd-*.md",
      ".pi/subagents/prd-review.md",
      ".pi/skills/sdd-workflow/SKILL.md",
      ".agents/skills/sdd-workflow/SKILL.md",
      "~/.pi/agent/subagents/sdd-*.md",
      "~/.pi/agent/subagents/prd-review.md",
      "~/.pi/agent/skills/sdd-workflow/SKILL.md",
      "~/.agents/skills/sdd-workflow/SKILL.md"
    ],
    "keywords": [
      "sdd",
      "prd",
      "prd-first",
      "prd review",
      "product requirements",
      "existing prd",
      "use-existing-prd",
      "openspec",
      "proposal",
      "spec",
      "design",
      "tasks",
      "sdd apply",
      "sdd verify",
      "mini-sdd",
      "mini sdd",
      "sdd archive",
      "apply",
      "verify",
      "archive"
    ]
  },
  "sdd_phases": ["explore", "proposal", "spec", "design", "task", "apply", "verify", "archive"],
  "related_skills": ["workflow-triage", "skill-authoring"],
  "priority": 100
}
```

Field conventions:

- `category`: short grouping such as `base`, `transversal`, `workflow`, `quality`, `security`, or `runtime`.
- `domains`: stable domain tags used for routing.
- `triggers.paths`: glob-like project paths that should activate this skill.
- `triggers.keywords`: user/request/code keywords that should activate this skill.
- `sdd_phases`: phases where this skill is usually useful: `explore`, `proposal`, `spec`, `design`, `task`, `apply`, `verify`, `archive`.
- `related_skills`: skills that should be considered when this skill is active.
- `priority`: routing priority from 0 to 100. Higher means consider earlier when multiple skills match.

## Activation Contract

Use this skill as the main orchestrator when formal PRD/SDD/OpenSpec work is requested, likely, active, being continued, validated, or closed.

This is now a thin orchestration skill. The orchestrator must keep the core workflow decision in its own context, then read only the companion markdown files needed by the current route:

- `skills/sdd-workflow/prd-and-discovery.md`
- `skills/sdd-workflow/artifact-conventions.md`
- `skills/sdd-workflow/mini-sdd.md`
- `skills/sdd-workflow/phase-contracts.md`
- `skills/sdd-workflow/shared-phase-rules.md`
- `skills/sdd-workflow/phase-commit-contract.md`
- `skills/sdd-workflow/executor-contract.md`

Load this skill before:

- creating or reviewing a PRD, proposal, spec, design, task plan, verification plan, or archive decision;
- starting or continuing a named SDD/OpenSpec change;
- launching any `prd-review` or `sdd-*` subagent;
- applying or verifying an existing SDD task;
- recovering the state of an active SDD flow.

Do not load this skill for greetings, tiny inline answers, obvious one-line fixes, or simple code inspections that do not affect workflow choice.

## Hard Rules

- Keep the user in control.
- Choose the lightest safe workflow.
- Do not create SDD/OpenSpec artifacts or launch SDD subagents for a new flow until the user answers both flow-selection questions and the chosen mode/store pair is persisted in that flow.
- Use `workflow-triage` before discovery or SDD when the route is unclear.
- Treat investigation and discovery as read-only diagnosis, not permission to solve or implement.
- Use SDD subagents as the default phase executors for formal SDD phases; the main agent remains the orchestrator.
- For mini-SDD, use only the `sdd-explore → sdd-apply → sdd-verify → sdd-archive` phase chain. Do not insert proposal, spec, design, task, or other formal phases.
- The orchestrator may execute a small formal phase or direct correction itself only when it already has enough context, the change is bounded to at most four files, the edits are minimal, and delegation would add more overhead than value; state this exception explicitly in the phase report. This exception does not replace the required mini-SDD phase chain once mini-SDD is selected.
- When context is insufficient, apply the session-scoped discovery-executor choice from `AGENTS.md`. Use bounded direct orchestrator inspection or bounded read-only `discovery` according to the user's choice, then consume a compact scope/risk summary.
- Strict TDD still applies to implementation work.
- Respect the configured artifact store: `openspec`, `engram`, or `hybrid`. Generate authoritative Markdown artifacts for `openspec`/`hybrid`; use full Engram-backed state for `engram` and only compact index/cursor handoff for `hybrid`.
- Before every new formal SDD or mini-SDD, ask the user to choose the artifact store and execution mode; apply the same gate to a minimal delegated apply that starts a new lifecycle. Never inherit either choice from a PRD-first route or another SDD. For continuation, reload the named flow's locked selection from authoritative flow state without asking again.
- Persist the flow selection in OpenSpec change metadata for `openspec`/`hybrid` or the active observation for `engram`. Keep it immutable until archive or explicit abandonment; phase subagents never choose or change it.
- PRDs are optional, not mandatory for every SDD.
- If `openspec/changes/<change>/metadata.yaml` exists, every SDD phase and subagent must read it before acting and report alignment or conflicts.
- Skill Registry is orchestrator-owned and session-cached. Reuse an already loaded registry; before the first flow needing skill routing, generate once only if necessary or explicitly requested, and never generate again in that session. Known skill changes are handled by live resolution when needed. Resolve only for initial flow skills or a real reported `skill_gap`, then persist exact selected refs in `flow_skill_plan`. Phase subagents never call registry tools.
- During routine phase invocation, do not read subagent-definition Markdown files to reconstruct their system prompts before invocation. The subagent runtime injects those definitions. This restriction does not apply to explicit workflow/subagent maintenance or audit tasks. The invocation trigger stays zero-payload; phase agents read global config and per-flow metadata/Engram state and own routine phase-state transitions.
- Treat security as cross-phase SDD context, not a verify-only concern. Each phase must preserve or refine security/privacy/auth/trust-boundary implications relevant to its responsibility and report `security_alignment` in its return envelope.
- For formal OpenSpec/hybrid flows, `implementation-map.md` is the primary cross-phase handoff. Each fresh phase subagent reads the complete current map once before broader source inspection and caches it for that invocation; the orchestrator uses returned deltas rather than rereading it. For mini-SDD, apply the same rule to the complete current consolidated `mini-sdd.md` lifecycle record.
- Local workspace inspection, discovery delegation, evidence-packet handling, and source-search policy are governed by `AGENTS.md`. The named workspace scope is a hard boundary for the orchestrator and PRD/SDD phase agents; only explicitly approved discovery/documentation research may widen it.
- For mini-SDD and minimal delegated apply, do not invent missing design or product decisions; stop and return `blocked` when they appear.
- Formal SDD, mini-SDD, and minimal delegated apply use the configured `openspec`, `engram`, or `hybrid` store. Do not silently substitute `none` or a different persistence mode.
- Enforce strict OpenSpec directory separation: active flows live only under `openspec/changes/<change>/`, archived flows live only under `openspec/archive/YYYY-MM-DD-<change>/`, and `openspec/changes/archive/` is invalid. Archive must move the whole change folder out of `changes`, rewrite authoritative archived path references, and leave no archived folder mixed with active changes.
- PRD/SDD phase invocation is zero-payload. `openspec/config.yaml` supplies only global workflow configuration plus a transient `active_flow_invocation` cursor; the referenced per-flow metadata/Engram state supplies the current SDD instance state. `active_flow_reference` is only a default human/orchestrator convenience pointer and not proof that only one flow may exist. Invoke only the fixed trigger required by the subagent tool API. Any extra task payload is invalid.
- Routine phase transitions are subagent-owned and MUST obey `phase-commit-contract.md`. A phase writes owner artifacts first, proves complete input/evidence coverage from persisted outputs, commits authoritative flow state last against the expected revision and lease, updates only the exact persisted Engram id when configured, validates the committed receipt, and derives its return from that receipt. Success requires a validated committed Phase Commit Record. Successful artifact writes without a committed receipt are `partial`/`blocked`, never success. The orchestrator owns initial selection, invocation pointers/attempt ids, authorization/approval records, and user-approved targeted remediation reconciliation.
- After a phase return, require and validate the persisted Phase Commit Record before accepting `success`: exact attempt/lease/commit ids, previous/current flow revisions, complete input coverage, persisted parser/assertion evidence, committed artifact manifest, exact Engram identity/status, and next eligibility must match the envelope. Only then inspect the changed headings/ids and exact prior references required for consistency. Do not read every changed artifact completely, re-read unchanged artifacts, or inspect application files reported by apply. If remediation is chosen, directly reconcile affected artifacts from verify findings and user context without replaying planning.
- In `interactive`, the next phase requires a persisted revision-bound `phase_authorization` gate written by the orchestrator after explicit user approval. In `auto`, read-only/planning phases may use subagent-recorded `auto-authorized` next-phase eligibility; this never authorizes apply or archive. Apply/archive still require their dedicated approval records.
- `sdd-apply` always requires a persisted local revision-bound approval: `apply_approved_by_user: true`, approval id/time/redacted summary, approved packet revision, and `approval_record_ref`, all matching the current packet and configured store, even in `auto` mode.
- Formal apply also requires an aligned lightweight pre-apply traceability matrix from PRD (when in scope) through spec/design/tasks to acceptance and validation evidence.
- Every apply, remediation apply, and direct code-writing exception must load and obey `executor-contract.md`. Exact approved mechanisms are immutable; passing tests alone cannot establish success.
- Every approved slice needs the complete executable Slice Execution Contract: one primary safety invariant when risk-bearing, exact ordered operations/checks/first-use boundary, named RED/GREEN evidence, bounded canonical context refs, `completion_authority: sdd-verify`, and attempt/recurrence data. Outcome summaries cannot authorize apply.
- Apply may report `implemented-pending-independent-verify` but never close normative tasks/findings. Verify alone closes independently passed items or reopens failures.
- Verify must enumerate an applicability/coverage ledger before judging implementation. A completed PASS or remediation-ready FAIL requires `coverage_complete: true`; otherwise return `INCOMPLETE`/`partial` with every uninspected row named.
- Every CRITICAL/WARNING issue must be a complete stable Verification Finding Record as defined by `shared-phase-rules.md`, including exact location, lineage/classification, violated refs, actual/expected, root cause, reproducible RED evidence, existing required/forbidden mechanism constraints, affected scope, and closure criteria.
- Remediation packets map every blocking finding exactly once, preserve immutable root lineage in approval scope/fingerprints, and provide finding-indexed RED/GREEN evidence. Re-verify disposes every prior finding before broader validation and classifies genuinely new issues separately.
- Use risk-based execution. High workload/review risk or security, secrets, persistence, process lifecycle, concurrency, migrations, permissions, or destructive behavior requires separately invoked revisioned slices with independent review between safety-critical dependencies. A work-unit list inside one invocation is not a split.
- Failed verification remediation requires a first-class versioned `remediation.md` or authoritative Engram equivalent. The orchestrator authors it and reconciles every affected normative SDD artifact after the user chooses remediation planning. The packet consumes complete Verification Finding Records, maps every blocking root finding to exactly one disposition/slice, and preserves lineage; approval summaries, metadata handoff, and `implementation-map.md` cannot replace it.
- `sdd-archive` always requires a successful verification verdict, the orchestrator's versioned completion summary, and a persisted local revision-bound archive approval matching that completion revision. It never runs automatically, even in `auto` mode.
- Archive retries are idempotent for every local store only after a full closure invariant check passes. A no-op `closed` retry requires matching completion revision, approval fingerprint, capability-spec sync status, archive path/content, lifecycle closure, and Engram pointer status when configured. Folder movement alone is never sufficient evidence of closure; partial archive effects return `blocked-recovery-needed` with the failed invariant.
- `hybrid` is local OpenSpec + Engram: OpenSpec is authoritative and Engram is a rebuildable compact index/cursor. Write OpenSpec first and never advance OpenSpec from conflicting Engram state. Missing/stale Engram or cross-reference drift that can be deterministically rebuilt from coherent OpenSpec is a repairable warning, not a blocker; semantic OpenSpec conflicts still block.

## Decision Gates

Ask or stop when any of these are unresolved and material to the SDD route:

- execution mode for every new formal SDD or mini-SDD (`interactive` or `auto`), even when a prior flow used one;
- artifact store for every new formal SDD or mini-SDD (`openspec`, `engram`, or `hybrid`), even when a prior flow used one;
- change slug when multiple named changes could be affected;
- dirty worktree scope when pending changes may be unrelated;
- whether a PRD should be created first when requirements are unclear;
- whether an existing `prd.md` is approved, needs `prd-review`, conflicts with downstream artifacts, or is waived;
- implementation approval, which is separate from PRD approval and SDD planning approval;
- archive or closure approval after verification.

## Conditional Companion Loading

Read only the companions the route needs:

- **PRD-first, PRD review, existing-PRD handling, or discovery-vs-explore decisions** → `skills/sdd-workflow/prd-and-discovery.md`
- **OpenSpec persistence, change slugging, metadata, implementation-map, or artifact-store rules** → `skills/sdd-workflow/artifact-conventions.md`
- **Mini-SDD or minimal delegated apply** → `skills/sdd-workflow/mini-sdd.md`
- **Formal phase sequencing or high-level phase responsibilities** → `skills/sdd-workflow/phase-contracts.md`
- **Cross-phase apply/verify/archive rules, subagent task packets, or return envelopes** → `skills/sdd-workflow/shared-phase-rules.md`
- **Every `prd-review` or `sdd-*` invocation and transition** → `skills/sdd-workflow/phase-commit-contract.md` (mandatory, never conditional)
- **Any code-writing route, apply, remediation, workload split, or apply/verify success decision** → `skills/sdd-workflow/executor-contract.md`

Do not preload every companion by default. Load the minimum needed for the current route, except that `executor-contract.md` is mandatory for every code-writing route.

## Conflict Precedence

For formal SDD, when metadata and context artifacts diverge, use this precedence order:

1. current user approval for scope/intent, excluding the already locked mode/store;
2. `openspec/changes/<change>/metadata.yaml` for operational context and authoritative flow selection;
3. approved PRD artifacts when they are in scope;
4. `spec.md` as the normative requirement contract;
5. `design.md` and `tasks.md` as implementation constraints derived from spec;
6. `implementation-map.md` as non-normative operational handoff;
7. `verify-report.md` and runtime evidence as implementation outcome.

When the same domain is contradictory:

- for the active flow's mode/store, the referenced authoritative metadata/Engram state always wins until archive or explicit abandonment; it cannot be overridden mid-flow;
- for other scope and execution constraints, `metadata.yaml` wins unless the user explicitly approves a revision-compatible override;
- for behavioral or product intent, prefer the approved PRD;
- for implementation detail, prefer `spec.md` and treat design/tasks contradictions as blocking;
- for handoff detail, use `implementation-map.md` to reduce repeated investigation, but never let it override metadata, approved PRD, spec, design, or tasks.

Any blocking conflict must be reported explicitly before continuing.

For mini-SDD, formal proposal/spec/design/task precedence does not apply. The locked flow selection remains immutable; for the remaining scope use current user approval, configured metadata, the approved explore/apply packet, `mini-sdd.md` or active Engram state, and runtime verification evidence in that order. Stop on contradictions rather than introducing formal artifacts.

## Required Preflight for PRD/SDD

Before creating PRD/OpenSpec artifacts or launching a PRD/SDD subagent:

1. Reuse the session-cached worktree snapshot. Run `git status --short` only when starting a new lifecycle without a trustworthy snapshot, when overlap is ambiguous, after an external/unknown workspace mutation, after a material scope change, or before an explicitly requested Git operation. Never run it per phase/slice by default.
2. If the cached/refreshed snapshot shows unrelated dirty work, apply the `AGENTS.md` overlap rule once and retain that decision while the same related flow continues.
3. Reuse Skill Registry state already present in orchestrator context. Before the first workflow needing skill routing, generate once only when necessary or explicitly requested; after it has run in this session, do not generate again. Resolve live skill selection only for the initial flow plan or a real `skill_gap`.
4. Resolve the change slug and use the active-flow state already present in context when its revision is current. Read only missing current fields/deltas; do not reread the complete state mechanically.
5. For a new formal SDD or mini-SDD, ask the user for artifact store and execution mode, then persist/lock the selection. For continuation, reuse the locked selection from current authoritative context and reread only after reload/compaction, external phase writes, or a revision mismatch.
6. Confirm implementation approval separately from planning approval. This remains mandatory before every `sdd-apply`.

The git gate does not apply to tiny inline answers or low-risk inspections that do not create artifacts or change code.

## Execution Steps

1. Assume `workflow-triage` already ran (it is the mandatory gate before any non-trivial edit, including user-ordered fixes). If it did not run, load `workflow-triage` first and state the chosen route before proceeding.
2. Run the required PRD/SDD preflight before creating artifacts or launching SDD subagents.
3. For any persisted SDD route, load and apply `artifact-conventions.md`, then inspect the global config and named change's active state without creating artifacts.
4. If this is a new formal SDD or mini-SDD, ask both flow-selection questions and persist only the locked initial selection plus active-flow pointer. If it is continuation, validate/reuse the existing selection and do not ask again.
4a. For an interactive routine phase advance, after the user approves continuing, write only the narrow `phase_authorization` gate for the target phase/executor. During explicitly selected remediation, instead update the targeted affected artifacts/state coherently before requesting fresh apply approval.
5. Load only the remaining companion markdown files required by the current route.
6. If the route is PRD-first or depends on an existing PRD, apply `prd-and-discovery.md` before planning downstream phases.
7. If the route is mini-SDD or minimal delegated apply, apply `mini-sdd.md` before preparing its evidence handoff and persistence-aware phase chain.
8. For formal SDD phases, delegate to the matching `sdd-*` subagent by default after applying `phase-contracts.md`, `shared-phase-rules.md`, and mandatory `phase-commit-contract.md`; do not perform phase work directly unless the small-orchestrator exception applies and is reported.
9. If context is insufficient to decide whether the small-orchestrator exception applies, use the investigation executor selected under `AGENTS.md` and consume its compact scope/risk summary before choosing direct execution versus phase-subagent delegation.
10. Stop before every apply unless the user explicitly approved implementation for the selected scope, including in `auto` mode.
11. After successful verification, present a concise completion summary and stop for explicit archive approval. Invoke `sdd-archive` only after that approval.
12. After meaningful work, update the configured artifact store and report validation, risks, and the next recommended step.

## Execution Modes

Only two execution modes are valid. Ask the user to choose one for every new formal SDD or mini-SDD, together with an artifact store. Persist both as immutable flow-local state until archive or explicit abandonment. Never select them from project-global configuration or a previous flow.

- `interactive`: ask before each phase and before writing or updating artifacts.
- `auto`: advance through approved read-only/planning phases and from a completed apply into verify without routine phase prompts. It never bypasses blockers or material decisions.

Both modes retain two mandatory gates:

1. explicit user approval immediately before every `sdd-apply`;
2. explicit user approval immediately before every `sdd-archive`, after the orchestrator presents the successful verification and completion summary.

Required prompt before every new formal SDD or mini-SDD:

> Para este nuevo flujo, ¿qué persistencia quieres: `openspec`, `engram` o `hybrid`? ¿Y qué modo: `interactive` o `auto`?

## Flow Selection

Use the lightest safe route that fits the request:

| Situation | Flow |
|---|---|
| direct answer or tiny inspection | inline |
| read-only investigation before implementation | bounded direct inspection or `discovery`, according to the session-scoped choice in `AGENTS.md` |
| medium taskable multi-file work that does not need formal specification phases | `mini-sdd`: explore → approved apply → verify → approved archive |
| tracker-backed mechanical migration | `minimal delegated apply` |
| complex work that needs product requirements first | `prd-first` |
| named planning flow with proposal/spec/design/tasks value | formal SDD planning delegated to `sdd-*` phase subagents by default |
| implementation of approved existing SDD tasks | `sdd-apply` |
| validation of completed implementation | `sdd-verify` |
| closure after successful verification | `sdd-archive` |

For PRD-first, artifact policy, mini-SDD details, or formal phase contracts, read the matching companion before acting.

## Continue Router

When the user says continue, recover state in this order:

1. current conversation;
2. the active Engram observation when needed;
3. OpenSpec files under `openspec/changes/<change>/` when configured.

Identify `flow_type` before selecting a phase. Do not infer a formal chain from the mere existence of a change slug.

For a real continuation, reuse current global config and flow state when their revisions are already present and no other actor changed them. After reload/compaction, an external phase write, or a revision mismatch, read only the config invocation block and current flow-state fields needed to resolve the target, locked selection, and next phase without asking again. The orchestrator does not hand-write routine phase results; in `interactive` it may write only the narrow `phase_authorization` gate after user approval, then invokes the subagent matching the authorized current phase or non-blocked `next_phase`. Multiple SDD flows may be active in separate metadata records, but only one zero-payload phase invocation is leased at a time through `active_flow_invocation`; stale/missing/ambiguous invocation cursors block before phase work. Missing lock, missing required phase authorization, or semantic selection conflict is `blocked`; mechanical parse/format repair is allowed only under the repair policy. Prior apply/archive approval cannot cover a new revision. For `hybrid`, stale/missing Engram is rebuildable from verified OpenSpec. Consult repository state only when a material semantic conflict cannot be resolved from current OpenSpec artifacts and their deltas; unresolved conflicts remain `blocked`. Never migrate an active flow between stores or change its mode. If no active flow exists or the prior flow is archived/explicitly abandoned, this is a new flow: return to the selection gate and ask both questions.

### PRD-first continuation

- PRD missing or draft → continue orchestrator PRD work.
- PRD present but review missing/stale → `prd-review`.
- PRD blocked or needs revision → return to the user/orchestrator decision.
- persisted PRD review approved/continued whose lifecycle status is `prd-review-complete-returned-to-triage` → return to `workflow-triage`; treat its selection as non-active, and send any downstream formal/mini route through the new-flow selection gate;
- PRD approved/continued but its persisted PRD-flow selection is still active → `blocked` until the terminal lifecycle write succeeds; do not inherit it;
- approved existing PRD with no PRD-flow selection record → return to `workflow-triage` as requirements context only; any downstream formal/mini route uses the new-flow selection gate. PRD approval never selects implementation automatically.

### Mini-SDD continuation

- prior evidence missing → use the investigation executor selected under `AGENTS.md`;
- mini explore missing → `sdd-explore` with `mini_sdd: true`;
- explore complete but apply not approved → present the apply-ready packet and request approval;
- apply approved but incomplete → `sdd-apply`;
- apply complete but not verified → `sdd-verify`;
- verification failed/blocked → return to the user for a remediation-planning decision; if selected, the orchestrator directly reconciles the affected mini artifacts and creates a revised first-class remediation packet before fresh apply approval; do not rerun explore or archive;
- verification passed but completion summary not presented → present it;
- archive not approved → request archive approval and persist its redacted local record before invocation;
- archive approved but incomplete → resume `sdd-archive`, inspect authoritative OpenSpec paths when configured, and rebuild the Engram pointer from verified OpenSpec state in `hybrid`.

### Formal SDD continuation

- exploration missing → `sdd-explore` with formal flow type;
- proposal missing → `sdd-proposal`;
- spec missing → `sdd-spec`;
- design missing → `sdd-design`;
- tasks missing or incomplete → `sdd-task`;
- task-planning packet complete but apply not approved → present the complete apply-ready packet, traceability result, exact packet revision, and request explicit approval;
- tasks ready and revision-matched apply approval exists → apply the revisioned risk-based slice plan from `executor-contract.md`; bounded low-risk work may use one `sdd-apply`, while mandatory-split work uses one invocation per approved slice;
- failed verification → return to the user for a remediation-planning decision; if selected, the orchestrator directly revisions/supersedes affected formal artifacts and creates the first-class remediation packet plus complete Slice Execution Contract(s), then requests fresh apply approval and executes its revisioned slices without replaying planning phases or substituting mechanisms; if a finding recurs, the recurrence circuit breaker requires root-cause analysis and strengthened RED evidence before another approval;
- implementation complete but not verified → `sdd-verify`;
- verification passed but completion summary/archive approval missing → present the summary, request approval, and persist its redacted local record before invocation;
- archive approved but incomplete → resume `sdd-archive`, inspect authoritative OpenSpec paths when configured, and rebuild the Engram pointer from verified OpenSpec state in `hybrid`.

## Approval Checkpoints

Always separate these approvals:

- permission to research or read-only investigate;
- permission to start formal PRD/SDD;
- flow-local execution mode selected explicitly before every new formal SDD or mini-SDD;
- flow-local artifact store selected explicitly before every new formal SDD or mini-SDD;
- permission to persist artifacts or durable memory when not already part of the approved workflow;
- implementation or remediation approval for the selected option, required immediately before apply and persisted as a redacted local record before invocation;
- archive or closure approval, required after the completion summary and persisted before archive begins.

In `interactive` mode, ask before every phase and artifact write or update.
In `auto` mode, proceed without routine phase prompts except for blockers, material decisions, the mandatory apply gate, and the mandatory archive gate.

## Workflow Validation

After changing `AGENTS.md`, this skill/companions, or PRD/SDD subagent contracts:

1. run one targeted static validation batch for the changed Markdown/frontmatter/contract fields;
2. run an existing dedicated workflow validation script only when it covers the changed behavior;
3. use `git diff --check` at most once at the end only when Git diff evidence is actually needed and no equivalent targeted whitespace validation already ran;
4. run Skill Registry generation/resolution only when launchers/Registry Contract JSON changed and session registry policy permits it;
5. rerun only checks affected by review corrections and report when no executable workflow-contract suite exists.

Do not claim comprehensive executable contract coverage from Markdown inspection or registry validation alone. Report the checks that actually ran, their scope, and remaining runtime/integration blind spots.

## Output Contract

When this skill affects the answer, return a concise SDD workflow decision or phase report:

- Skill applied: `sdd-workflow`.
- Flow type: formal SDD, PRD-first, mini-SDD, SDD apply-only, verify-only, archive-only, or minimal delegated apply.
- Change slug, locked flow-selection reference/revision, artifact store, and execution mode.
- Approval state.
- Companion modules loaded.
- PRD status: absent, present/read, review absent/read, review needed, approved-by-prd-review, explicit user continue-as-is, or blocking conflict.
- Selected phase or next phase and why.
- Flow skill plan revision, selected phase skills, and any reported `skill_gap`; registry generation/resolution remains orchestrator-only.
- Subagents launched, or the explicit direct-orchestrator rationale when no phase subagent was used.
- Artifacts or Engram observations updated.
- Security alignment and implementation-map continuity notes when relevant.
- Validation, risks, blockers, and next recommended step.

## References

- `AGENTS.md` — primary orchestrator policy, dirty worktree rules, TDD, memory, and Git policy.
- `skills/workflow-triage/SKILL.md` — route selection before formal SDD when workflow is unclear.
- `skills/sdd-workflow/prd-and-discovery.md` — PRD-first, existing-PRD, and discovery-vs-explore rules.
- `skills/sdd-workflow/artifact-conventions.md` — per-flow mode/store selection, slug, metadata, persistence, and implementation-map rules.
- `skills/sdd-workflow/mini-sdd.md` — mini-SDD and minimal delegated apply lifecycle/handoff rules.
- `skills/sdd-workflow/phase-contracts.md` — phase sequencing and high-level phase responsibilities.
- `skills/sdd-workflow/shared-phase-rules.md` — cross-phase rules, delegation checklist, and return envelope.
- `skills/sdd-workflow/phase-commit-contract.md` — mandatory attempt/lease identity, input coverage, metadata-last commit, exact Engram identity, resume, persisted validation, and receipt-derived return contract.
- `skills/sdd-workflow/executor-contract.md` — mandatory exact-mechanism, slice, remediation, negative-evidence, and success contract for code-writing routes.
- `skills/skill-authoring/SKILL.md` — canonical skill format and registry contract conventions.

## Engram Rules for SDD

- The orchestrator creates the single active project-scoped observation with `type: progress` and topic key `sdd.active-flow.<change>` when initializing an `engram` or `hybrid` flow and persists its exact id in authoritative state.
- Phase subagents retrieve and update only that exact id. They never search for a candidate, select by topic, or create on miss; missing identity is a blocker for orchestrator repair.
- Long-form artifacts belong in OpenSpec when artifact store is `openspec` or `hybrid`; Engram stores compact state and handoff rather than duplicating those documents.
- For `engram`, the active-flow observation must preserve the locked flow selection plus enough approved context, phase output, acceptance evidence, and next-step state for safe continuation without OpenSpec files.
- Formal SDD operational handoff belongs in `implementation-map.md`; mini-SDD operational handoff belongs in its consolidated `mini-sdd.md`. Neither belongs in `metadata.yaml`.
- The orchestrator owns durable non-SDD observations, project-level decisions outside the active flow, and memory cleanup.
- Save only durable, non-sensitive decisions, constraints, commands, learnings, todos, and progress.
- Approval summaries must be redacted before persistence. After archive or abandonment, remove transient handoff detail and duplicate summaries while retaining only the local approval id/revision, timestamp, scope category, closure pointer, and accepted risks needed for recovery.

## End-of-Work Checkpoint

After meaningful SDD or discovery work, summarize:

- what changed;
- confirmed decisions;
- progress;
- validations;
- open todos or questions;
- accepted risks;
- reusable learnings.

Save only durable non-sensitive items to Engram when useful.
