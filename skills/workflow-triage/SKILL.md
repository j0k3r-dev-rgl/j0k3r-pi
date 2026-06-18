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
      "minimal delegated apply",
      "mini-sdd",
      "mini sdd",
      "delegated batch apply",
      "tracker-based apply",
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

Use this skill only as the main orchestrator when the next workflow is unclear, the request is ambiguous, the user asks how to proceed, or the work may be policy-sensitive, multi-step, cross-cutting, or costly enough that choosing the wrong workflow would waste time or change behavior incorrectly. For any code/config/docs change or implementation beyond a trivial direct answer, this skill is the mandatory routing gate unless the route was already explicitly decided in-session. The main agent must keep this workflow skill loaded/applied in its own context for routing decisions. Do not ask subagents to load or apply this skill.

Good triggers:

- the user proposes a new change, feature, behavior adjustment, or workflow improvement and the implementation path is not fully specified;
- the user asks to improve, review, investigate, analyze, diagnose, compare, design, plan, or choose an approach;
- the user asks for PRD-first work, product requirements, PRD review, improving requirements, or continuing SDD where an optional PRD may or may not exist;
- the request could be inline, simple TDD, read-only discovery, PRD-first SDD, existing-PRD SDD, or formal SDD and the best route is not obvious;
- the user pushes back that the selected workflow is too heavy or too light;
- the work touches agent behavior, skills, subagents, permissions, memory/config, workflow extensions, or future-agent behavior;
- the assistant is about to delegate or create artifacts mainly because of uncertainty.

Do not load this skill for greetings, obvious direct answers, or already-approved concrete implementation steps where the workflow is already clear.

## Hard Rules

- The orchestrator owns workflow selection and is the only agent that applies this skill. The main agent must use workflow skills itself before delegating when routing matters. Subagents provide requested evidence and bounded observations only; they do not load this skill, ask the user's workflow questions, or make the final workflow decision.
- Choose the lightest safe workflow. Do not use SDD just to avoid thinking, asking one question, or making a small localized docs/skill edit.
- Never invent hidden requirements. If intent, success criteria, scope, constraints, or approval are unclear, ask a concise clarifying question before choosing an implementation workflow.
- Investigation and diagnosis are read-only by default. When discovery is delegated, it returns evidence to the orchestrator; the orchestrator presents options or questions and waits for the user decision.
- Implementation approval is separate from investigation, planning, verification, and commit approval.
- Do not call `discovery` before applying this triage when routing is unclear. First use the orchestrator's current context, startup context, loaded skills, and this checklist to decide whether delegation is needed.
- Use `discovery` only when delegated read-only research will materially improve the orchestrator's decision. Ask it for specific evidence, not for the final route. Do not delegate when the orchestrator already has enough context or when a small direct fix/answer is clearly safe.
- Use formal SDD when the change is genuinely cross-cutting, introduces or changes a durable contract/API, has high architecture or policy risk, or needs handoff artifacts.
- PRDs are optional, not mandatory for every SDD. Prefer a PRD-first route only when the user asks for a PRD or when complex product, UX, integration, OAuth/auth, security, or architecture work genuinely needs requirements definition before proposal/spec/design/tasks. The main orchestrator drafts or revises the PRD directly with the user because it has the full conversation and decision context; do not create or delegate extra PRD draft/analyzer subagents just to transform context. Use `prd-review` only to validate PRD ambiguity, debt, testability, contradictions, missing questions, acceptance-criteria coverage, implementation-detail leakage, and readiness before the PRD is approved, revised, blocked, or waived. Once a PRD is approved or explicitly in scope, downstream SDD phases must read and preserve it as mandatory product/requirements context; if PRD review is waived, the orchestrator must state that waiver and any accepted risks.
- Use simple TDD for localized non-trivial code changes with clear expected behavior and cheap validation. **Crucial Rule:** Even for small, localized changes that qualify for an inline fix or Simple TDD, you must NEVER assume. Always ask the user: *"¿Prefieres que arregle esto directamente o hacemos una revisión y propuesta primero?"* (Unless the user explicitly ordered a direct fix).
- Use simple TDD with an explicit review gate when the main agent can implement safely but the change is policy-sensitive, multi-file, or risk-bearing enough that a final diff/tests/risk review is required.
- Use mini-SDD for medium-sized, taskable, multi-file work when behavior is clear enough to write a compact task packet, full PRD/spec/design would add little value, and independent apply/verify execution would reduce mistakes. Mini-SDD means the orchestrator writes the task packet, `sdd-apply` implements, and `sdd-verify` validates by default.
- Use minimal delegated apply for broad but mechanically scoped migrations when a user-approved tracker/checklist exists, behavior/design is already settled, validation is clear, and delegation would reduce orchestration load without requiring a full PRD/spec/design SDD. Minimal delegated apply is a specialized mini-SDD shape.
- Use inline/docs-only edits only for small explicit wording/config/doc changes with low future-behavior risk, even when the touched files are policy-sensitive, if the user approved the path and no durable artifact value exists.
- For user-requested commits, follow the Git commit policy in `AGENTS.md`; triage is not commit permission.

## Policy-sensitive workflow gate

Treat changes to agent behavior as higher risk than ordinary docs/config edits.

Policy-sensitive paths include:
- `AGENTS.md`;
- project-local skills and subagents such as `.pi/skills/**`, `.agents/skills/**`, and `.pi/subagents/**`;
- global/user agent skills and subagents such as `~/.pi/agent/skills/**`, `~/.agents/skills/**`, and `~/.pi/agent/subagents/**`;
- `.pi/permissions.json`;
- `.pi/memory.json`;
- `.pi/context7.json`;
- `.pi/subagents.json` and `~/.pi/agent/subagents.json`;
- workflow, memory, permission, skill-registry, or subagent extension code.

Rules:
- If the user asks to investigate or diagnose policy-sensitive behavior, stay read-only and report options first.
- If implementation is approved for a policy-sensitive change, state the selected workflow before editing and explain why it is inline/simple TDD, discovery, or SDD.
- Use formal SDD planning by default when the change is multi-file, cross-cutting, changes future agent behavior, introduces or changes a contract/API, or needs durable handoff artifacts.
- Use `workflow-triage` before SDD or discovery when the scope, impact, or right workflow is unclear; delegate to `discovery` only when read-only evidence is actually needed and current context is insufficient.
- Inline/docs-only edits are allowed only for small, explicit, localized policy wording fixes with low future-behavior risk.

## Mandatory workflow decision protocol

Before any non-trivial change, the orchestrator must choose and state one route:

1. `inline` / `simple-tdd`: the main agent implements because scope is small, behavior is clear, affected surface is localized, and validation is cheap. (Requires explicit user permission to fix directly).
2. `simple-tdd-with-review`: the main agent implements because scope is still localized, but a policy-sensitive/risk-bearing final review checklist is mandatory before reporting done.
3. `mini-sdd`: the main agent writes a compact task packet/checklist, delegates implementation to `sdd-apply`, then runs `sdd-verify` by default. Use this when the work is medium-sized, spans multiple related files, is easy to task, and does not need full PRD/spec/design artifacts.
4. `prd-first`: the main agent drafts/updates a PRD and normally runs `prd-review` before downstream SDD when product requirements, UX, acceptance criteria, or user-visible behavior are not settled.
5. `formal-sdd`: use full proposal/spec/design/tasks/apply/verify for cross-cutting, architectural, security-sensitive, API/contract, persistence, or high-handoff-value work.

If the route is `mini-sdd`, `prd-first`, or `formal-sdd`, the orchestrator must not silently implement the work itself. It must create the required task/PRD/SDD context and use the appropriate subagents unless the user explicitly chooses a different route.

## Workflow routing quick table

Use this table before acting when the request may involve reading files, changing code/docs/config, adding tests, or delegating:

| User intent / work shape | Default workflow | Approval rule |
|---|---|---|
| Simple question, explanation, or opinion with no need to inspect files | Inline answer | Answer directly; do not use tools unless the user asks for investigation. |
| Tiny inspection of one obvious file/path, no change requested | Inline read-only | Inspect minimally and report; do not edit. |
| User asks to investigate, analyze, review, compare, diagnose, or “look at” behavior | Read-only investigation; use `workflow-triage` when routing is unclear; use `discovery` only if isolated research is broad enough to benefit from delegation | Report findings/options and wait for the user to choose next action. |
| Small localized implementation with clear expected behavior and existing cheap validation | Simple TDD | Always ask: "¿Prefieres que arregle esto directamente o hacemos una revisión/propuesta primero?". Add/update failing test before code when non-trivial. |
| One-extension or one-module change with tests, limited architecture risk, and no durable PRD/spec value | Simple TDD, not full SDD by default | State expected behavior and validation plan; ask before implementing if the user has not explicitly approved implementation. |
| Medium multi-file change with clear behavior and taskable scope, but no PRD/full SDD value | Mini-SDD | Orchestrator writes task packet/checklist, delegates implementation to `sdd-apply`, then runs `sdd-verify` unless user explicitly waives verification. |
| Policy-sensitive change touching agent instructions, skills, subagents, permissions, memory/config, workflow extensions, or future agent behavior | Use `workflow-triage`; inline/docs-only is allowed only for small explicit localized fixes; otherwise prefer simple-tdd-with-review, mini-SDD, or formal SDD according to scope/risk | State workflow choice before editing and perform a post-change review/verify gate. |
| Multi-file or multi-extension change, new API/contract, cross-cutting behavior, unclear requirements, or durable handoff value | Formal SDD planning | Load `sdd-workflow`; resolve git gate, execution mode, artifact store, and planning approval before artifacts/subagents. |
| User explicitly asks for PRD/spec/design/tasks/OpenSpec/SDD | Formal SDD | Do not create artifacts or launch SDD subagents until git gate and mode gate are resolved. |
| Existing SDD task artifact and user asks to implement approved tasks | SDD apply-only | Confirm implementation approval and task slice/range before `sdd-apply`. |
| User asks to verify/check completed SDD work | SDD verify-only | Verification reports issues only; do not fix without new apply approval. |
| Documentation-only cleanup with no behavior change | Inline edit or Simple TDD-style validation | Keep changes minimal; validate with formatting/tests only when relevant. |

Important interpretation rules:

- “Investigate/analyze/review” is not implementation approval.
- “Hagamos eso”, “apply the patch”, or “implement it” after options is implementation approval only for the discussed option; confirm if multiple materially different options remain.
- Do not escalate a localized, well-understood change to full SDD just because it is non-trivial; use Simple TDD or inline docs-only when durable artifacts would add little value.
- Do not downshift policy-sensitive, cross-cutting, or future-agent-behavior changes to inline/simple TDD just because they look like docs/config edits.
- Do not skip TDD/validation for non-trivial code changes just because the workflow is not full SDD.
- Do not skip the post-change review/verify gate for non-trivial, multi-file, delegated, or policy-sensitive work. If no subagent verification is used, perform an explicit orchestrator review of diff, tests, risks, and next steps before final response.

## Intake Model

When the user proposes a change or feature, the orchestrator should use this sequence:

1. Understand the requested outcome in plain language.
2. Identify what is known, what is assumed, and what is missing.
3. Ask only the questions needed to choose a safe workflow or avoid building the wrong thing.
4. If PRD-level requirements are needed, keep PRD drafting with the main orchestrator and the user; use the canonical PRD structure from `sdd-workflow`, keep implementation/file/symbol details out of the PRD, and use `prd-review` only as a validation gate before PRD approval/revision/block/waiver.
5. If the missing information is factual and can be researched read-only, delegate a focused `discovery` task.
6. Once enough information is available, choose the lightest safe workflow.
7. Decide explicitly who should implement: main agent for inline/simple TDD, or `sdd-apply` for mini-SDD/minimal delegated apply/formal SDD apply.
8. Decide explicitly whether post-change validation is orchestrator review only, `sdd-verify`, or formal archive/closure.
9. State the selected workflow and why before editing policy-sensitive files or starting implementation.

Do not pick SDD, simple TDD, or inline implementation before the decision-critical questions are answered.

## Decision Gates

Ask one concise question when any of these are missing and materially affect the route:

- desired outcome or success criteria;
- whether the user wants investigation only or implementation;
- selected option when multiple materially different options exist;
- execution mode for a new formal SDD flow (`interactive`, `normal`, `defaults`);
- artifact persistence when formal planning is requested;
- whether a PRD is actually requested or warranted, and whether an existing PRD is already approved, needs `prd-review`, needs revision, or is waived;
- scope boundary when dirty worktree changes are unrelated or unclear;
- whether to change future agent behavior globally or only project-locally.

Escalate or load related skills:

- Load `sdd-workflow` when formal SDD/OpenSpec work is likely or requested, when mini-SDD/minimal delegated apply will use `sdd-apply`/`sdd-verify`, or when continuing/applying/verifying/archive SDD state.
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
6. Decide whether a PRD is needed: if the user explicitly asks for one or requirements are genuinely unclear/complex, draft/revise it as the main orchestrator using `sdd-workflow` PRD lifecycle/status guidance; otherwise do not add PRD overhead.
7. Choose the lightest safe workflow:
   - `inline-answer` for simple explanation/opinion;
   - `inline-readonly` for tiny inspection;
   - `inline-docs-only` for small approved wording/doc/config changes;
   - `simple-tdd` for localized code changes with clear behavior;
   - `simple-tdd-with-review` for localized but risk-bearing or policy-sensitive changes implemented by the main agent with a mandatory post-change review gate;
   - `mini-sdd` for medium taskable multi-file work where the orchestrator creates a compact task packet, `sdd-apply` implements, and `sdd-verify` validates;
   - `minimal-delegated-apply` for tracker-backed mechanical multi-file migrations with approved scope, clear acceptance checks, and no new design decisions;
   - `discovery` for bounded read-only research when evidence is missing;
   - `prd-first-sdd` for complex work that needs product requirements clarified before formal SDD artifacts; the orchestrator writes/revises the PRD with the user using the canonical PRD format and may use `prd-review` before approving, revising, blocking, or waiving it;
   - `use-existing-prd-sdd` when `openspec/changes/<change>/prd.md` already exists; the orchestrator decides whether it is approved/in scope, needs `prd-review`, needs revision, is blocked, or is waived; when approved/in scope, downstream SDD must read and preserve PRD context alongside metadata, phase artifacts, and `implementation-map.md`;
   - `formal-sdd` for substantial/cross-cutting/policy/API changes needing artifacts;
   - `sdd-apply`, `sdd-verify`, or `sdd-archive` for existing approved SDD phases;
   - `blocked-ask-user` when a required decision is missing.
8. State the chosen workflow before editing policy-sensitive files.
9. If using discovery, provide a focused read-only research task and ask for the exact evidence needed: facts, constraints, affected areas, options/trade-offs, risks, unknowns, or source references. Do not ask discovery to apply `workflow-triage` or make the final workflow decision.
10. After meaningful work, perform the normal memory decision checkpoint from `AGENTS.md`.

## Output Contract

When this skill affects the answer, return a concise workflow decision:

- Skill applied: `workflow-triage`.
- Request classification.
- Key risks or why risk is low.
- Chosen workflow and why it is the lightest safe option.
- Whether discovery is needed; if not, explicitly note that current context is sufficient. If yes, provide the exact evidence/research question.
- Clarifying question or approval needed from the user, if any.
- Related skills considered or loaded.
- For `simple-tdd-with-review`, name the review checklist and validation commands.
- For `mini-sdd` or `minimal-delegated-apply`, name the approved task packet/tracker, allowed scope, forbidden scope, validation commands, why full SDD is unnecessary, and whether `sdd-verify` is required or explicitly waived.
- Validation/memory/commit implications when relevant.

## References

- `AGENTS.md` — primary orchestrator behavior, approval gates, dirty worktree, TDD, memory, and Git policy.
- `skills/sdd-workflow/SKILL.md` — formal SDD/OpenSpec routing and phase policy.
- `subagents/discovery.md` — bounded read-only research executor used when evidence is missing; it informs the orchestrator but does not choose the workflow.
- `skills/skill-authoring/SKILL.md` — canonical skill format and registry contract conventions.
- `skills/subagents-configuration/SKILL.md` — subagent configuration and tool allowlist policy.
