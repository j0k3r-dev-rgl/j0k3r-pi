---
name: sdd-workflow
description: Operate the project's PRD/SDD/OpenSpec workflow as a thin orchestrator skill, loading companion guidance for PRD, artifacts, phase contracts, and mini-sdd only when the route needs them.
license: Apache-2.0
metadata:
  author: j0k3r
  version: "1.2"
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
- Before every new formal SDD or mini-SDD, ask the user to choose the artifact store and execution mode; apply the same gate to a minimal delegated apply that starts a new lifecycle. Never inherit either choice from a PRD-first route or another SDD. For continuation, reuse the named flow's locked snapshot without asking again.
- Persist the flow selection in OpenSpec change metadata for `openspec`/`hybrid` or the active observation for `engram`. Keep it immutable until archive or explicit abandonment; phase subagents never choose or change it.
- PRDs are optional, not mandatory for every SDD.
- If `openspec/changes/<change>/metadata.yaml` exists, every SDD phase and subagent must read it before acting and report alignment or conflicts.
- Skill Registry selection is mandatory before SDD subagent launch: the orchestrator chooses the phase subagent, resolves relevant skills for that phase and touched paths, reads selected `SKILL.md` files when needed for routing confidence, and injects exact skill paths plus applicability notes into the subagent prompt.
- Do not read subagent-definition Markdown files to reconstruct their system prompts before invocation. The subagent runtime injects those definitions; the orchestrator supplies only phase evidence, scope, constraints, selected skills, acceptance checks, and the expected return envelope.
- Treat security as cross-phase SDD context, not a verify-only concern. Each phase must preserve or refine security/privacy/auth/trust-boundary implications relevant to its responsibility and report `security_alignment` in its return envelope.
- For formal OpenSpec/hybrid flows, `implementation-map.md` is the primary context-compression handoff. For mini-SDD, use the consolidated `mini-sdd.md` lifecycle record instead. Subagents should consume the relevant compact handoff before broader source inspection and avoid rediscovering trustworthy context unless evidence is stale or incomplete.
- Local workspace inspection, discovery delegation, evidence-packet handling, and source-search tool policy are governed by `AGENTS.md`; do not restate or override them here.
- For mini-SDD and minimal delegated apply, do not invent missing design or product decisions; stop and return `blocked` when they appear.
- Formal SDD, mini-SDD, and minimal delegated apply use the configured `openspec`, `engram`, or `hybrid` store. Do not silently substitute `none` or a different persistence mode.
- Every PRD/SDD subagent task packet must include an immutable packet revision, locked flow-selection reference/revision/snapshot, `flow_selection_locked: true`, resolved mode/store, phase and artifact-write authorization, compact handoff, allowed/forbidden actions, expected return envelope, and output limit. A phase agent must return `blocked` when any required packet field is missing, invalid, or conflicts with the active flow; it must not infer values or ask the user directly.
- In `interactive`, phase authorization must represent explicit user approval. In `auto`, read-only/planning phases may use `phase_authorization: auto-authorized`; this never authorizes apply or archive.
- `sdd-apply` always requires a persisted local revision-bound approval: `apply_approved_by_user: true`, approval id/time/redacted summary, approved packet revision, and `approval_record_ref`, all matching the current packet and configured store, even in `auto` mode.
- Formal apply also requires an aligned lightweight pre-apply traceability matrix from PRD (when in scope) through spec/design/tasks to acceptance and validation evidence.
- Plan for one complete approved packet, one `sdd-apply`, and one independent `sdd-verify` by default. Split or remediate only for workload constraints, material blockers, failed verification, or explicit user choice.
- `sdd-archive` always requires a successful verification verdict, the orchestrator's versioned completion summary, and a persisted local revision-bound archive approval matching that completion revision. It never runs automatically, even in `auto` mode.
- Archive retries are idempotent for every local store: an already-completed matching revision returns a reported no-op `closed` result, while revision mismatch or conflicting persisted state is `blocked`.
- `hybrid` is local OpenSpec + Engram: OpenSpec is authoritative and Engram is a rebuildable compact index/cursor. Write OpenSpec first and never advance OpenSpec from conflicting Engram state.

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

Do not preload every companion by default. Load the minimum needed for the current route.

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

- for the active flow's mode/store, the locked metadata/Engram snapshot always wins until archive or explicit abandonment; it cannot be overridden mid-flow;
- for other scope and execution constraints, `metadata.yaml` wins unless the user explicitly approves a revision-compatible override;
- for behavioral or product intent, prefer the approved PRD;
- for implementation detail, prefer `spec.md` and treat design/tasks contradictions as blocking;
- for handoff detail, use `implementation-map.md` to reduce repeated investigation, but never let it override metadata, approved PRD, spec, design, or tasks.

Any blocking conflict must be reported explicitly before continuing.

For mini-SDD, formal proposal/spec/design/task precedence does not apply. The locked flow selection remains immutable; for the remaining scope use current user approval, configured metadata, the approved explore/apply packet, `mini-sdd.md` or active Engram state, and runtime verification evidence in that order. Stop on contradictions rather than introducing formal artifacts.

## Required Preflight for PRD/SDD

Before creating PRD/OpenSpec artifacts or launching any PRD/SDD subagent:

1. Run `git status --short`.
2. If the worktree is dirty, apply the dirty worktree overlap rule from `AGENTS.md`.
3. Run the skill-registry preflight:
   - use `skill_registry_resolve` as the primary routing helper;
   - call it with `stale_check=true` before formal SDD planning or delegation when skills may affect routing;
   - if the resolver reports stale, missing, or invalid cache, use `skill_registry_generate` with `write=true`;
   - read each selected `SKILL.md` before relying on it;
   - pass selected skill names, paths, match reasons, and applicability notes into delegated SDD subagent context.
4. Resolve the change slug and inspect only that slug's active-flow state.
5. For a new formal SDD or mini-SDD, always ask the user for artifact store and execution mode, then persist/lock the selection before the first phase. For continuation, recover the locked selection without asking and block on packet mismatch.
6. Confirm implementation approval separately from planning approval. This confirmation is mandatory before every `sdd-apply`, regardless of mode.

The git gate does not apply to tiny inline answers or low-risk inspections that do not create artifacts or change code.

## Execution Steps

1. Assume `workflow-triage` already ran (it is the mandatory gate before any non-trivial edit, including user-ordered fixes). If it did not run, load `workflow-triage` first and state the chosen route before proceeding.
2. Run the required PRD/SDD preflight before creating artifacts or launching SDD subagents.
3. For any persisted SDD route, load and apply `artifact-conventions.md`, then inspect the named change's active state without creating artifacts.
4. If this is a new formal SDD or mini-SDD, ask both flow-selection questions and persist the locked result. If it is continuation, validate/reuse the existing selection and do not ask again.
5. Load only the remaining companion markdown files required by the current route.
6. If the route is PRD-first or depends on an existing PRD, apply `prd-and-discovery.md` before planning downstream phases.
7. If the route is mini-SDD or minimal delegated apply, apply `mini-sdd.md` before preparing its evidence handoff and persistence-aware phase chain.
8. For formal SDD phases, delegate to the matching `sdd-*` subagent by default after applying `phase-contracts.md` and `shared-phase-rules.md`; do not perform phase work directly unless the small-orchestrator exception applies and is reported.
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

For a real continuation, recover the locked flow-selection snapshot from authoritative active state and do not ask again. Compare its `config_reference`, `config_revision`, and `resolved_config_snapshot` with the next packet. Any missing lock or selection mismatch is `blocked`; prior apply/archive approval cannot cover it. For `hybrid`, a stale/missing/conflicting Engram cursor is rebuildable from verified OpenSpec and repository state when those authoritative sources are coherent; conflicting OpenSpec files or repository state are `blocked`. Never migrate an active flow between stores or change its mode. If no active flow exists or the prior flow is archived/explicitly abandoned, this is a new flow: return to the selection gate and ask both questions.

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
- verification failed/blocked → return to remediation decision; do not archive;
- verification passed but completion summary not presented → present it;
- archive not approved → request archive approval and persist its redacted local record before invocation;
- archive approved but incomplete → resume `sdd-archive`, inspect authoritative OpenSpec paths when configured, and rebuild the Engram pointer from verified OpenSpec state in `hybrid`.

### Formal SDD continuation

- exploration missing → `sdd-explore` with formal flow type;
- proposal missing → `sdd-proposal`;
- spec missing → `sdd-spec`;
- design missing → `sdd-design`;
- tasks missing or incomplete → `sdd-task`;
- tasks complete but apply not approved → present the complete apply-ready packet, traceability result, exact packet revision, and request explicit approval;
- tasks ready and revision-matched apply approval exists → `sdd-apply` once for the complete approved packet unless an explicit split was approved;
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

1. run `git diff --check`;
2. run any relevant validation scripts that actually exist in the current workspace;
3. run Skill Registry generation/resolution when skill launchers or Registry Contract JSON changed;
4. report explicitly when no dedicated executable workflow-contract suite exists instead of citing or inventing one.

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
- Selected skills injected into subagents, or why no skill matched.
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
- `skills/skill-authoring/SKILL.md` — canonical skill format and registry contract conventions.

## Engram Rules for SDD

- Subagents may update only the active project-scoped observation with `type: progress` and topic key `sdd.active-flow.<change>`.
- Locate it with bounded `mem_search`, retrieve the selected observation with `mem_get_observation`, then update it by id with `mem_update` or create it with `mem_save` when absent.
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
