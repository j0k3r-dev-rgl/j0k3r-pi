---
name: workflow-triage
description: "Determine the safest, lightest workflow for ambiguous or policy-sensitive requests, including when to ask clarifying questions, stay inline, use simple TDD, delegate read-only discovery, or start formal SDD."
license: Apache-2.0
metadata:
  author: j0k3r
  version: "1.0"
---

# Workflow Triage

## Registry Contract

Use this block as the machine-readable source for `.pi/skill-registry.json` generation. Keep it valid JSON.

```json
{
  "category": "workflow",
  "domains": ["workflow", "triage", "intake", "routing", "clarification", "discovery", "sdd"],
  "triggers": {
    "paths": [
      "AGENTS.md",
      "skills/workflow-triage/SKILL.md",
      "skills/sdd-workflow/SKILL.md",
      "subagents/discovery.md",
      "subagents/prd-review.md",
      "subagents/sdd-*.md",
      "~/.pi/agent/skills/workflow-triage/SKILL.md",
      "~/.pi/agent/subagents/discovery.md"
    ],
    "keywords": [
      "workflow",
      "triage",
      "intake",
      "route",
      "routing",
      "clarify",
      "ambiguous",
      "unclear",
      "investigate",
      "discovery",
      "prd",
      "product requirements",
      "prd-first",
      "prd-first-sdd",
      "use-existing-prd-sdd",
      "prd review",
      "simple tdd",
      "sdd",
      "openspec",
      "which workflow",
      "best workflow"
    ]
  },
  "sdd_phases": ["explore", "proposal", "spec", "design", "task", "apply", "verify", "archive"],
  "related_skills": [
    "sdd-workflow",
    "persistent-memory",
    "skill-authoring",
    "subagents-configuration"
  ],
  "priority": 95
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

Use this skill only as the main orchestrator when the next workflow is unclear, the request is ambiguous, the user asks how to proceed, or the work may be policy-sensitive, multi-step, cross-cutting, or costly enough that choosing the wrong workflow would waste time or change behavior incorrectly. Do not ask subagents to load or apply this skill.

Good triggers:

- the user proposes a new change, feature, behavior adjustment, or workflow improvement and the implementation path is not fully specified;
- the user asks to improve, review, investigate, analyze, diagnose, compare, design, plan, or choose an approach;
- the user asks for PRD-first work, product requirements, PRD review, or continuing SDD from an existing PRD;
- the request could be inline, simple TDD, read-only discovery, PRD-first SDD, existing-PRD SDD, or formal SDD and the best route is not obvious;
- the user pushes back that the selected workflow is too heavy or too light;
- the work touches agent behavior, skills, subagents, permissions, memory/config, workflow extensions, or future-agent behavior;
- the assistant is about to delegate or create artifacts mainly because of uncertainty.

Do not load this skill for greetings, obvious direct answers, or already-approved concrete implementation steps where the workflow is already clear.

## Hard Rules

- The orchestrator owns workflow selection and is the only agent that applies this skill. Subagents provide requested evidence and bounded observations only; they do not load this skill, ask the user's workflow questions, or make the final workflow decision.
- Choose the lightest safe workflow. Do not use SDD just to avoid thinking, asking one question, or making a small localized docs/skill edit.
- Never invent hidden requirements. If intent, success criteria, scope, constraints, or approval are unclear, ask a concise clarifying question before choosing an implementation workflow.
- Investigation and diagnosis are read-only by default. When discovery is delegated, it returns evidence to the orchestrator; the orchestrator presents options or questions and waits for the user decision.
- Implementation approval is separate from investigation, planning, verification, and commit approval.
- Do not call `discovery` before applying this triage when routing is unclear. First use the orchestrator's current context, startup context, loaded skills, and this checklist to decide whether delegation is needed.
- Use `discovery` only when delegated read-only research will materially improve the orchestrator's decision. Ask it for specific evidence, not for the final route. Do not delegate when the orchestrator already has enough context or when a small direct fix/answer is clearly safe.
- Use formal SDD when the change is genuinely cross-cutting, introduces or changes a durable contract/API, has high architecture or policy risk, or needs handoff artifacts.
- PRDs are optional, not mandatory for every SDD. Prefer a PRD-first SDD route for complex product, UX, integration, OAuth/auth, security, or architecture work where requirements need definition before proposal/spec/design/tasks. If a PRD already exists for the change, choose a PRD-aware route and require downstream SDD phases to use it.
- Use simple TDD for localized non-trivial code changes with clear expected behavior and cheap validation.
- Use inline/docs-only edits for small explicit wording/config/doc changes with low future-behavior risk, even when the touched files are policy-sensitive, if the user approved the path and no durable artifact value exists.
- For user-requested commits, follow the Git commit policy and precommit memory checkpoint rules in `AGENTS.md`; triage is not commit permission.

## Intake Model

When the user proposes a change or feature, the orchestrator should use this sequence:

1. Understand the requested outcome in plain language.
2. Identify what is known, what is assumed, and what is missing.
3. Ask only the questions needed to choose a safe workflow or avoid building the wrong thing.
4. If the missing information is factual and can be researched read-only, delegate a focused `discovery` task.
5. Once enough information is available, choose the lightest safe workflow.
6. State the selected workflow and why before editing policy-sensitive files or starting implementation.

Do not pick SDD, simple TDD, or inline implementation before the decision-critical questions are answered.

## Decision Gates

Ask one concise question when any of these are missing and materially affect the route:

- desired outcome or success criteria;
- whether the user wants investigation only or implementation;
- selected option when multiple materially different options exist;
- execution mode for a new formal SDD flow (`interactive`, `normal`, `defaults`);
- artifact persistence when formal planning is requested;
- scope boundary when dirty worktree changes are unrelated or unclear;
- whether to change future agent behavior globally or only project-locally.

Escalate or load related skills:

- Load `sdd-workflow` only when formal SDD/OpenSpec work is likely or requested, or when continuing/applying/verifying/archive SDD state.
- Use `discovery` when evidence is missing and the research is bounded/read-only.
- Consider `skill-authoring` when creating or changing skills.
- Consider `subagents-configuration` when changing subagent definitions/config.
- Consider `persistent-memory` when durable decisions, profile updates, consolidation, migration, or session-end memory policy matters and is not already available.

## Execution Steps

1. Restate the request in one sentence.
2. Classify the user intent:
   - direct answer;
   - read-only inspection/investigation;
   - docs-only update;
   - small localized code change;
   - policy-sensitive agent behavior change;
   - SDD/OpenSpec planning;
   - existing SDD apply/verify/archive;
   - commit/push;
   - unclear/mixed.
3. Identify risk factors:
   - policy-sensitive files/behavior;
   - cross-cutting or multi-module impact;
   - new/changed API, contract, persistence, security, permissions, or memory behavior;
   - dirty worktree overlap;
   - missing tests/validation;
   - external docs/API uncertainty.
4. Decide whether clarification is required before any tool use, delegation, artifact creation, or edit.
5. Decide whether the orchestrator already has enough context to proceed directly. If yes, do not delegate to `discovery` just to confirm the obvious.
6. Choose the lightest safe workflow:
   - `inline-answer` for simple explanation/opinion;
   - `inline-readonly` for tiny inspection;
   - `inline-docs-only` for small approved wording/doc/config changes;
   - `simple-tdd` for localized code changes with clear behavior;
   - `discovery` for bounded read-only research when evidence is missing;
   - `prd-first-sdd` for complex work that needs product requirements clarified before formal SDD artifacts;
   - `use-existing-prd-sdd` when `openspec/changes/<change>/prd.md` already exists and should be treated as mandatory context for SDD;
   - `formal-sdd` for substantial/cross-cutting/policy/API changes needing artifacts;
   - `sdd-apply`, `sdd-verify`, or `sdd-archive` for existing approved SDD phases;
   - `blocked-ask-user` when a required decision is missing.
7. State the chosen workflow before editing policy-sensitive files.
8. If using discovery, provide a focused read-only research task and ask for the exact evidence needed: facts, constraints, affected areas, options/trade-offs, risks, unknowns, or source references. Do not ask discovery to apply `workflow-triage` or make the final workflow decision.
9. After meaningful work, perform the normal memory decision checkpoint from `AGENTS.md`.

## Output Contract

When this skill affects the answer, return a concise workflow decision:

- Skill applied: `workflow-triage`.
- Request classification.
- Key risks or why risk is low.
- Chosen workflow and why it is the lightest safe option.
- Whether discovery is needed; if not, explicitly note that current context is sufficient. If yes, provide the exact evidence/research question.
- Clarifying question or approval needed from the user, if any.
- Related skills considered or loaded.
- Validation/memory/commit implications when relevant.

## References

- `AGENTS.md` — primary orchestrator behavior, approval gates, dirty worktree, TDD, memory, and Git policy.
- `skills/sdd-workflow/SKILL.md` — formal SDD/OpenSpec routing and phase policy.
- `subagents/discovery.md` — bounded read-only research executor used when evidence is missing; it informs the orchestrator but does not choose the workflow.
- `skills/skill-authoring/SKILL.md` — canonical skill format and registry contract conventions.
- `skills/subagents-configuration/SKILL.md` — subagent configuration and tool allowlist policy.
