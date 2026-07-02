---
name: workflow-triage
description: "Mandatory routing gate before any non-trivial edit (including user-ordered fixes, corrections, and refactors). Determines whether to ask clarifying questions, stay inline, use simple TDD, delegate read-only discovery, or start mini-sdd or formal SDD."
license: Apache-2.0
metadata:
  author: j0k3r
  version: "1.2"
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
      "code research",
      "code-research",
      "evidence packet",
      "subagent delegation",
      "orchestrator evidence",
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
      "best workflow",
      "fix",
      "fix it",
      "corrige",
      "arregla",
      "refactor",
      "cambia",
      "modify",
      "update code",
      "bug fix",
      "patch",
      "correct"
    ]
  },
  "sdd_phases": ["explore", "proposal", "spec", "design", "task", "apply", "verify", "archive"],
  "related_skills": [
    "sdd-workflow",
    "persistent-memory",
    "skill-authoring"
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

Use this skill as the **mandatory routing gate before any non-trivial edit**, including user-ordered fixes, corrections, and refactors. Load it whenever the next workflow could plausibly be anything other than a truly trivial single-file change, and whenever the work is non-trivial enough that choosing the wrong route could waste time or change behavior incorrectly.

Typical triggers:

- the user asks to investigate, compare, analyze, diagnose, plan, design, or choose an approach;
- the request could plausibly be inline, simple TDD, discovery, mini-SDD, PRD-first, or formal SDD;
- the work touches agent behavior, skills, subagents, permissions, memory/config, workflow extensions, or future-agent behavior;
- the assistant is about to delegate or create artifacts mainly because of uncertainty.

Do not load this skill only for greetings or obvious direct answers. A user-ordered fix or correction does NOT count as "route already clear": load this skill and state the chosen route before editing, even when implementation was explicitly requested.

## Hard Rules

- The orchestrator owns workflow selection. Subagents do not load this skill, ask the user's workflow questions, or make the final workflow decision.
- Choose the lightest safe workflow.
- Never invent hidden requirements. Ask a concise clarifying question when intent, success criteria, scope, constraints, or approval are unclear.
- Investigation and diagnosis are read-only by default.
- Implementation approval is separate from investigation, planning, verification, and commit approval.
- For local workspace source-code inspection, use code-research tools first. Do not use `bash`/`rg`/`grep`/`find` as the primary code search mechanism for symbols, references, impact, or call flow when `find_symbol`, `find_references`, `function_call_tree`, `reverse_function_call_tree`, or `workspace_graph_status` can answer the question.
- Reserve `bash` search for non-code surfaces, file inventory, validation commands, or a stated fallback when code-research cannot express the lookup or lacks public language coverage.
- Do not call `discovery` before applying triage when routing is unclear.
- When the orchestrator lacks context, first gather targeted source-code evidence with code-research tools when those tools can answer the lookup.
- Use `discovery` as the default bounded read-only handoff when context remains missing, code-research is stale/insufficient, the touched surface is unclear, non-code evidence is needed, or risk is still material. For non-code/policy/document investigation, use bounded read-only inspection or `discovery`; code-research is required only when source-code context is needed. After the user has asked to investigate or approved work, `discovery` may run without an extra permission prompt, but discovery output is not implementation approval.
- Use formal SDD only when the change is genuinely cross-cutting, high-risk, contract-changing, architecture-bearing, or needs durable artifacts; formal SDD phases are delegated to `sdd-*` subagents by default.
- Let the orchestrator handle direct work only when it already has enough context, the change is localized and low-risk, and inline execution is the lightest safe path; otherwise use delegated discovery, `mini-sdd`, or SDD phase agents. Do not over-delegate when the selected route is `simple-tdd` / `simple-tdd-with-review` and the scope remains localized, low-risk, and sufficiently evidenced.
- PRDs are optional. Use PRD-first only when the user asks for a PRD or when product requirements genuinely need clarification before downstream SDD.
- For small localized implementation, always offer the route choice: *"¿Prefieres que arregle esto directamente (simple-tdd) o hacemos una revisión/propuesta primero (mini-sdd o investigación)?"* — unless the change is truly trivial (single file, no risk). A user order to "fix it" does not waive this offer.
- When the change touches multiple files or policy-sensitive surfaces, offer `mini-sdd` or proposal-first even if the user ordered a direct fix; do not default to `simple-tdd` for multi-file or behavior-bearing work.
- For user-requested commits, follow the Git commit policy in `AGENTS.md`; triage is not commit permission.

## Policy-Sensitive Gate

Treat changes to agent behavior as higher risk than ordinary docs/config edits.

Policy-sensitive surfaces include:

- `AGENTS.md`
- skills and subagents under project-local or global agent directories
- `.pi/permissions.json`, `.pi/memory.json`, `.pi/context7.json`, `.pi/subagents.json`
- workflow, memory, permission, skill-registry, or subagent extension code

Rules:

- if the user asked to investigate, stay read-only and report options first;
- if implementation is approved, state the chosen workflow before editing;
- inline/docs-only is acceptable only for small explicit localized fixes with low future-behavior risk.

## Code Evidence Packet

When code context is needed for routing, the orchestrator should turn code-research results into a compact evidence packet before deciding or delegating. Include:

- target files, symbols, entry points, and related tests;
- definitions, references, callers/callees, or call paths that explain impact;
- known constraints, assumptions, and confidence level;
- material unknowns and the exact questions `discovery` should answer if context is still insufficient.

Use this packet to avoid duplicate discovery when the code context is already clear. Give the same packet to `discovery`, `sdd-apply`, or `sdd-verify` when delegating so subagents can produce useful output instead of rediscovering basics.

## Route Catalog

Choose and state one route before editing non-trivial scope:

1. `inline-answer` — direct explanation or opinion.
2. `inline-readonly` — tiny inspection with no edits.
3. `inline-docs-only` — small approved wording/config/doc edit with low behavior risk.
4. `simple-tdd` — localized code change with clear behavior and cheap validation; must end with focused tests/validation plus a lightweight self-review of changed files, scope, and risks.
5. `simple-tdd-with-review` — localized but policy-sensitive or risk-bearing change implemented by the main agent with focused validation plus a mandatory final review checklist.
6. `mini-sdd` — medium taskable multi-file work where the orchestrator writes a compact task packet and `sdd-apply` plus `sdd-verify` do the execution/validation.
7. `minimal-delegated-apply` — tracker-backed mechanical multi-file migration with clear acceptance checks and no new design decisions.
8. `discovery` — default bounded read-only delegated research when evidence remains missing after direct code-research, when non-code context is needed, or when scope/risk is unclear.
9. `prd-first-sdd` — product requirements need clarification before formal SDD artifacts.
10. `use-existing-prd-sdd` — an existing PRD already exists and must be approved, revised, reviewed, or waived before downstream SDD.
11. `formal-sdd` — substantial or cross-cutting work needing proposal/spec/design/tasks, delegated to SDD phase subagents by default.
12. `sdd-apply`, `sdd-verify`, `sdd-archive` — continue an already-approved SDD phase, delegated by default unless the small-orchestrator exception applies.
13. `blocked-ask-user` — a required decision is missing.

## Routing Table

| Situation | Default route | Notes |
|---|---|---|
| simple question, explanation, opinion | `inline-answer` | no tools unless investigation is requested |
| tiny inspection of one obvious file/path | `inline-readonly` | inspect minimally |
| missing source-code context before route choice | code-research evidence packet, then `discovery` if still unclear | skip `discovery` only when the evidence packet is sufficient for a safe decision |
| user asks to investigate, compare, diagnose, analyze | code-research evidence packet when code context is needed; otherwise bounded read-only inspection or `discovery` | keep read-only, report findings, then wait for the next decision |
| small localized implementation with clear behavior | `simple-tdd` | ask route first unless truly trivial; if context is missing, gather evidence or delegate `discovery` before implementation |
| medium taskable multi-file change with low artifact value | `mini-sdd` | write a compact task packet; delegate `sdd-apply` then `sdd-verify` by default |
| tracker-backed mechanical migration | `minimal-delegated-apply` | bounded scope, no new design decisions |
| policy-sensitive but still localized edit | `simple-tdd-with-review` or `inline-docs-only` | only if scope is explicit and low-risk |
| product requirements unclear or PRD requested | `prd-first-sdd` | orchestrator drafts PRD with the user |
| existing PRD in scope | `use-existing-prd-sdd` | resolve approval/review state first |
| cross-cutting, new API/contract, durable handoff value | `formal-sdd` | load `sdd-workflow` core plus needed companions; delegate phases by default |
| existing approved SDD phase to continue | `sdd-apply` / `sdd-verify` / `sdd-archive` | use current artifacts/state; delegate by default unless the small-orchestrator exception applies |

Interpretation rules:

- “investigate/analyze/review” is not implementation approval;
- do not upshift a clear localized fix to formal SDD just because it is non-trivial;
- however, always offer `mini-sdd` or proposal-first as an option when the user did not explicitly choose a route, even for localized fixes; "do not upshift" does not mean "default to `simple-tdd` silently";
- do not downshift a cross-cutting or future-agent-behavior change to inline work just because it looks like docs/config.

## Decision Gates

Ask one concise question when any of these materially affect the route:

- desired outcome or success criteria;
- investigation only vs implementation;
- selected option when multiple materially different options exist;
- execution mode for a new formal SDD flow;
- artifact persistence when formal planning is requested;
- whether a PRD is needed, already approved, needs `prd-review`, needs revision, or is waived;
- dirty worktree scope when overlap is unclear;
- whether future agent behavior should change globally or only project-locally.

## Follow-On Skill Loading

After choosing the route:

- load `sdd-workflow` core when formal SDD/OpenSpec work is likely or requested, when `mini-sdd` / `minimal-delegated-apply` will use `sdd-apply` / `sdd-verify`, or when continuing an SDD phase;
- use `discovery` when bounded read-only evidence is still missing after the code-evidence packet, including when the orchestrator needs a scope/risk summary before deciding whether direct handling is reasonable;
- consider `skill-authoring` when creating or changing skills;
- consider `persistent-memory` when durable decisions, profile updates, consolidation, migration, or session-end memory policy matters.

## Execution Steps

1. Restate the request in one sentence.
2. Classify the user intent.
3. Identify risk factors: policy-sensitive surfaces, cross-cutting impact, contract/API/persistence/security changes, dirty worktree overlap, missing validation, external-doc uncertainty.
4. If local workspace code evidence is needed, choose the appropriate code-research tool before considering `bash` search; record any fallback reason.
5. If code-research was used, convert its output into an orchestrator evidence packet: files/symbols, definitions, references/call paths, likely impact, tests, unknowns, and confidence.
6. If the evidence packet is insufficient and investigation is needed, delegate bounded read-only `discovery` with the packet and explicit open questions.
7. Decide whether a clarifying question is required before any edit, delegated apply, or artifact creation.
8. Choose the lightest safe route from the route catalog.
9. State the chosen workflow before editing policy-sensitive files.
10. Before non-trivial edits, consult `skill_registry_resolve` (`stale_check=true`) when routing is ambiguous or the request involves fixing/refactoring; regenerate with `skill_registry_generate` if stale.
11. Load only the follow-on skills required by that route.
12. After meaningful work, perform the normal memory decision checkpoint from `AGENTS.md`.

## Output Contract

When this skill affects the answer, return a concise workflow decision:

- Skill applied: `workflow-triage`.
- Request classification.
- Key risks or why risk is low.
- Chosen workflow and why it is the lightest safe option.
- Code evidence packet summary when local code context was needed.
- Whether discovery is needed; if yes, the exact evidence or open questions delegated.
- Clarifying question or approval needed from the user, if any.
- Follow-on skills considered or loaded.
- Validation, memory, and commit implications when relevant, including the lightweight review/verify path for `simple-tdd`.

## References

- `AGENTS.md` — global guardrails, approvals, dirty worktree, TDD, memory, and Git policy.
- `skills/sdd-workflow/SKILL.md` — formal SDD/OpenSpec core routing and companion-module loading policy.
- `subagents/discovery.md` — bounded read-only research executor.
- `skills/skill-authoring/SKILL.md` — canonical skill format and registry contract conventions.
