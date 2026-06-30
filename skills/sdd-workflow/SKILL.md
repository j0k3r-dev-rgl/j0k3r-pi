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
  "related_skills": ["workflow-triage", "persistent-memory", "skill-authoring"],
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
- Do not create SDD/OpenSpec artifacts or launch SDD subagents for a new flow until the mode gate is resolved.
- Use `workflow-triage` before discovery or SDD when the route is unclear.
- Treat investigation and discovery as read-only diagnosis, not permission to solve or implement.
- Use SDD subagents as the default phase executors for formal SDD phases; the main agent remains the orchestrator.
- The orchestrator may execute a small phase or direct correction itself only when it already has enough context, the change is bounded to at most four files, the edits are minimal, and delegation would add more overhead than value; state this exception explicitly in the phase report.
- When the orchestrator lacks enough context or suspects the scope is too broad for direct handling, delegate bounded read-only `discovery` first and ask it to summarize affected scope, risks, and whether direct orchestrator handling is reasonable.
- Strict TDD still applies to implementation work.
- Prefer `hybrid` artifact storage for named SDD features unless the user requests otherwise.
- PRDs are optional, not mandatory for every SDD.
- If `openspec/changes/<change>/metadata.yaml` exists, every SDD phase and subagent must read it before acting and report alignment or conflicts.
- Skill Registry selection is mandatory before SDD subagent launch: the orchestrator chooses the phase subagent, resolves relevant skills for that phase and touched paths, reads selected `SKILL.md` files when needed for routing confidence, and injects exact skill paths plus applicability notes into the subagent prompt.
- Treat security as cross-phase SDD context, not a verify-only concern. Each phase must preserve or refine security/privacy/auth/trust-boundary implications relevant to its responsibility and report `security_alignment` in its return envelope.
- For OpenSpec/hybrid flows, `implementation-map.md` is the primary context-compression handoff. Subagents should read it before broader source inspection, update it when they learn concrete files/symbols/validations, and avoid rediscovering already mapped context unless evidence is stale or incomplete.
- Local workspace source-code inspection must use code-research tools first. Orchestrator and subagents must not use `bash`/`rg`/`grep`/`find` as the primary mechanism for source-code symbol lookup, reference lookup, impact analysis, or call-flow analysis when `find_symbol`, `find_references`, `function_call_tree`, `reverse_function_call_tree`, or `workspace_graph_status` can answer the question.
- Use `bash` search only for non-code surfaces, file inventory, validation commands, or a stated fallback when code-research cannot express the lookup or lacks public language coverage.
- For mini-SDD and minimal delegated apply, do not invent missing design or product decisions; stop and return `blocked` when they appear.
- Formal SDD, mini-SDD, and minimal delegated apply must not use `artifact_store: none` unless the user explicitly requested no persistence and the prompt carries enough context to continue safely.

## Decision Gates

Ask or stop when any of these are unresolved and material to the SDD route:

- execution mode for a new PRD/SDD/OpenSpec flow (`interactive`, `normal`, or `defaults`);
- artifact store when it is not obvious or the user requested memory-only/no-artifact behavior;
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

When metadata and context artifacts diverge, use this precedence order:

1. current user approval for the flow;
2. `openspec/changes/<change>/metadata.yaml` for operational context;
3. approved PRD artifacts when they are in scope;
4. `spec.md` as the normative requirement contract;
5. `design.md` and `tasks.md` as implementation constraints derived from spec;
6. `implementation-map.md` as non-normative operational handoff;
7. `verify-report.md` and runtime evidence as implementation outcome.

When the same domain is contradictory:

- for scope and execution constraints, `metadata.yaml` wins unless the user explicitly approves an override;
- for behavioral or product intent, prefer the approved PRD;
- for implementation detail, prefer `spec.md` and treat design/tasks contradictions as blocking;
- for handoff detail, use `implementation-map.md` to reduce repeated investigation, but never let it override metadata, approved PRD, spec, design, or tasks.

Any blocking conflict must be reported explicitly before continuing.

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
4. Resolve the change slug and artifact store if needed.
5. Resolve the SDD execution mode for formal PRD/SDD/OpenSpec flows. Mini-SDD and minimal delegated apply do not require formal execution-mode selection; they require an OpenSpec-backed task packet and explicit implementation approval.
6. Confirm implementation approval separately from planning approval.

The git gate does not apply to tiny inline answers or low-risk inspections that do not create artifacts or change code.

## Execution Steps

1. Assume `workflow-triage` already ran (it is the mandatory gate before any non-trivial edit, including user-ordered fixes). If it did not run, load `workflow-triage` first and state the chosen route before proceeding.
2. Run the required PRD/SDD preflight before creating artifacts or launching SDD subagents.
3. Resolve execution mode, change slug, artifact store, and approval scope.
4. Load only the companion markdown files required by the current route.
5. If the route uses OpenSpec persistence, apply `artifact-conventions.md` before writing or updating artifacts.
6. If the route is PRD-first or depends on an existing PRD, apply `prd-and-discovery.md` before planning downstream phases.
7. If the route is mini-SDD or minimal delegated apply, apply `mini-sdd.md` before preparing the OpenSpec-backed task packet.
8. For formal SDD phases, delegate to the matching `sdd-*` subagent by default after applying `phase-contracts.md` and `shared-phase-rules.md`; do not perform phase work directly unless the small-orchestrator exception applies and is reported.
9. If context is insufficient to decide whether the small-orchestrator exception applies, delegate bounded read-only `discovery` first and use its scope/risk summary before choosing direct execution versus phase subagent delegation.
10. Stop before implementation unless the user explicitly approved apply for the selected scope.
11. After meaningful work, update active SDD state or memory as needed and report validation, risks, and the next recommended step.

## Execution Modes

For every new PRD/SDD/OpenSpec flow, ask which mode to use unless the user already stated it in the current conversation:

- `interactive`: ask before each SDD phase and before writing or updating artifacts;
- `normal`: proceed phase-by-phase with concise checkpoints at major transitions;
- `defaults`: use project defaults and ask only when blocked or when a decision materially affects scope, persistence, or implementation approval.

`openspec/config.yaml` may store `sdd.last_selected_mode` as a convenience and audit hint, but it does not replace asking the user for a new flow.

Suggested prompt:

> ¿Quieres que este SDD sea `interactive`, `normal`, o `defaults`?

## Flow Selection

Use the lightest safe route that fits the request:

| Situation | Flow |
|---|---|
| direct answer or tiny inspection | inline |
| read-only investigation before implementation | investigation or `discovery` when bounded delegated evidence is useful |
| medium taskable multi-file work with low artifact value | `mini-sdd` |
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
2. active SDD flow memory if needed;
3. OpenSpec files under `openspec/changes/<change>/`.

Then choose the next missing phase:

- no discovery/exploration and request unclear → discovery or `sdd-explore` depending on SDD approval;
- no proposal → `sdd-proposal`;
- no spec → `sdd-spec`;
- no design → `sdd-design`;
- no tasks → `sdd-task`;
- tasks incomplete and implementation approved → `sdd-apply`;
- implementation complete but not verified → `sdd-verify`;
- verification passed and closure requested → `sdd-archive`.

## Approval Checkpoints

Always separate these approvals:

- permission to research or read-only investigate;
- permission to start formal PRD/SDD;
- execution mode;
- artifact store when not obvious;
- permission to persist artifacts or durable memory when not already part of the approved workflow;
- implementation or remediation approval for the selected option;
- archive or closure approval.

In `interactive` mode, ask before every phase and artifact write or update.
In `normal` mode, provide concise status checkpoints between major phases.
In `defaults` mode, ask only for blockers or material decisions.

## Output Contract

When this skill affects the answer, return a concise SDD workflow decision or phase report:

- Skill applied: `sdd-workflow`.
- Flow type: formal SDD, PRD-first, mini-SDD, SDD apply-only, verify-only, archive-only, or minimal delegated apply.
- Change slug and artifact store.
- Execution mode and approval state.
- Companion modules loaded.
- PRD status: absent, present/read, review absent/read, review needed, approved-by-prd-review, explicit user continue-as-is, or blocking conflict.
- Selected phase or next phase and why.
- Selected skills injected into subagents, or why no skill matched.
- Subagents launched, or explicit small-orchestrator exception/discovery-first rationale when no phase subagent was used.
- Artifacts or memory updated.
- Security alignment and implementation-map continuity notes when relevant.
- Validation, risks, blockers, and next recommended step.

## References

- `AGENTS.md` — primary orchestrator policy, dirty worktree rules, TDD, memory, and Git policy.
- `skills/workflow-triage/SKILL.md` — route selection before formal SDD when workflow is unclear.
- `skills/sdd-workflow/prd-and-discovery.md` — PRD-first, existing-PRD, and discovery-vs-explore rules.
- `skills/sdd-workflow/artifact-conventions.md` — artifact-store, slug, config, metadata, and implementation-map rules.
- `skills/sdd-workflow/mini-sdd.md` — mini-SDD and minimal delegated apply task-packet rules.
- `skills/sdd-workflow/phase-contracts.md` — phase sequencing and high-level phase responsibilities.
- `skills/sdd-workflow/shared-phase-rules.md` — cross-phase rules, delegation checklist, and return envelope.
- `skills/skill-authoring/SKILL.md` — canonical skill format and registry contract conventions.

## Memory Rules for SDD

- Subagents may update only the active SDD flow memory and only as compact index, state, or handoff.
- Standardize active SDD flow memory with `metadata_json.type = "sdd_feature_project_state"` plus tags `sdd`, `active-flow`, and the change slug; do not rely on free-text type markers alone.
- Long-form artifacts belong in OpenSpec when artifact store is `openspec`, `hybrid`, or mini-SDD OpenSpec mode.
- Formal SDD and mini-SDD operational handoff belongs in `implementation-map.md`, not in `metadata.yaml`.
- The orchestrator owns durable non-SDD memories, project profile updates, and consolidation.
- Save only durable, non-sensitive decisions, constraints, commands, learnings, todos, and progress.

## End-of-Work Checkpoint

After meaningful SDD or discovery work, summarize:

- what changed;
- confirmed decisions;
- progress;
- validations;
- open todos or questions;
- accepted risks;
- reusable learnings.

Save only durable non-sensitive items to memory when useful.
