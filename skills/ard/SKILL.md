---
name: ard
description: "create and maintain an Application Requirements Document for a new software project through explicit user questioning, approval gates, minimal scope, and downstream consistency controls. use only during project inception or an authorized ARD revision."
license: Apache-2.0
metadata:
  author: j0k3r
  version: "1.0"
---

# Application Requirements Document

## Registry Contract

Use this block as the machine-readable source for `.pi/skill-registry.json` generation. Keep it valid JSON.

```json
{
  "category": "workflow",
  "domains": ["product-discovery", "project-inception", "requirements"],
  "triggers": {
    "paths": [
      "docs/product/ard.md"
    ],
    "keywords": [
      "create ARD",
      "crear ARD",
      "Application Requirements Document",
      "application requirements",
      "define a new software project",
      "start a new software project"
    ]
  },
  "sdd_phases": ["explore", "proposal", "spec"],
  "related_skills": [
    "anti-overengineering",
    "cognitive-doc-design",
    "mvp"
  ],
  "priority": 92
}
```

## Activation Contract

Use this skill to create `docs/product/ard.md` when a new software project begins, or to revise that file when the user explicitly requests an ARD change. Here, ARD always means **Application Requirements Document**, not Architecture Requirements Document.

Do not use this skill for an existing project's feature request, technical architecture, MVP definition, PRD creation, SDD creation, or implementation. Load and follow `anti-overengineering` whenever this skill is active.

## Hard Rules

- Ask which language the user wants for the document unless the current request already specifies it. Offer English as the default, but never select it without the user's answer.
- Interview the user before deciding any product requirement. Never invent or infer users, goals, capabilities, constraints, scope, exclusions, metrics, or priorities.
- Ask concise, grouped questions. Continue until every decision required by the ARD is explicitly resolved.
- Prefer the smallest adequate set of requirements. Do not add speculative capabilities, architecture, implementation details, migrations, future phases, or enterprise features.
- Keep the ARD focused on the application-level product contract. Do not define an MVP or split work into PRDs.
- Write the canonical artifact only at `docs/product/ard.md`.
- Use only `READY | BLOCKED` for workflow status and `PENDING | APPROVED` for approval.
- `READY` means the ARD is complete for user review. It does not mean approved.
- Never mark approval as `APPROVED` without explicit user approval of the current contents.
- Do not advance to or create an MVP automatically. After approval, only suggest the MVP as a possible next document and ask the user.
- If an approved ARD changes, do not silently synchronize descendants. Set the existing MVP to `BLOCKED` with approval `PENDING`, and set every existing PRD to coherence `REVIEW_REQUIRED` with approval `PENDING`. Report that downstream review is required.
- Never create or perform any migration.

## Decision Gates

Before writing or revising the ARD, resolve:

- document language;
- product vision and problem;
- intended users;
- goals and measurable success signals;
- required functional capabilities;
- constraints;
- explicit scope and exclusions;
- unresolved product decisions.

If answers remain missing, continue the questionnaire. Persist a `BLOCKED` ARD only when the user explicitly asks to save incomplete work; otherwise do not create a partial artifact.

Before changing an approved ARD, explain the requested change and its downstream invalidation effect, then obtain explicit authorization for that change. Never infer approval from an unrelated execution request.

## Execution Steps

1. Confirm this is a new-project ARD creation or an explicitly authorized ARD revision.
2. Ask for the document language unless already specified.
3. Ask the minimum grouped questions needed to populate the approved sections.
4. Check that no response requires invented details or introduces unnecessary scope.
5. Write or update `docs/product/ard.md` using this structure:

```markdown
# Application Requirements Document

## Workflow Status
- Status: READY | BLOCKED
- Blockers: None | <specific blockers>

## Approval
- Status: PENDING | APPROVED
- Approved by: None | <explicit approver>

## Vision and Problem

## Users

## Goals and Success Metrics

## Functional Capabilities

## Constraints

## Scope

## Exclusions

## Resolved Decisions

## Blocking Questions
```

6. Present the completed `READY` document for explicit approval.
7. Mark it `APPROVED` only after the user approves its current contents.
8. If revising an approved ARD, invalidate downstream documents as required and report the exact affected paths.
9. Stop. Do not create the MVP automatically.

## Output Contract

Return:

- Skill applied: `ard` and `anti-overengineering`.
- Artifact path: `docs/product/ard.md`.
- Language selected by the user.
- Workflow and approval statuses.
- Questions asked and decisions resolved.
- Downstream documents invalidated, or `None`.
- Unrequested capabilities, technical decisions, migrations, MVP work, and PRD work performed: `None`.
- Next document suggested to the user, or `None`.

## References

- `~/.pi/agent/skills/anti-overengineering/SKILL.md` — mandatory simplicity, ambiguity, scope, and migration controls.
- `~/.pi/agent/skills/mvp/SKILL.md` — optional next artifact after explicit ARD approval.
- `~/.pi/agent/AGENTS.md` — canonical user authority and workflow boundaries.
