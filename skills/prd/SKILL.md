---
name: prd
description: "create and maintain one numbered Product Requirements Document per functional MVP module, grounded in approved ARD and MVP parents, with explicit questioning, coherence validation, approval, and no blocked PRD artifacts."
license: Apache-2.0
metadata:
  author: j0k3r
  version: "1.0"
---

# Product Requirements Document

## Registry Contract

Use this block as the machine-readable source for `.pi/skill-registry.json` generation. Keep it valid JSON.

```json
{
  "category": "workflow",
  "domains": ["product-requirements", "functional-modules", "requirements-traceability"],
  "triggers": {
    "paths": [
      "docs/product/prds/*.md"
    ],
    "keywords": [
      "create PRD",
      "crear PRD",
      "Product Requirements Document",
      "product requirements",
      "functional module PRD",
      "split MVP into PRDs"
    ]
  },
  "sdd_phases": ["explore", "proposal", "spec"],
  "related_skills": [
    "anti-overengineering",
    "cognitive-doc-design",
    "ard",
    "mvp"
  ],
  "priority": 92
}
```

## Activation Contract

Use this skill to create or explicitly revise one descriptive PRD for one functional capability from an approved MVP. Store PRDs under `docs/product/prds/` with immutable creation-order numbering such as `00-authentication.md`, `01-user-profile.md`, and `02-billing.md`.

Do not use this skill to create or revise an ARD or MVP without loading their governing skills, select an SDD workflow, create an SDD, design architecture, or implement software. Load and follow `anti-overengineering` whenever this skill is active.

## Hard Rules

- Read and use all of `docs/product/ard.md` and `docs/product/mvp.md` as mandatory parent contracts. Never guide downstream work from the PRD alone.
- Stop if either parent is missing, `BLOCKED`, or not explicitly `APPROVED`.
- Ask which language the user wants for the document unless the current request already specifies it. Offer English as the default, but never select it without the user's answer.
- One PRD describes exactly one functional product capability, regardless of size. A functional capability is not an assumed technical module.
- Ask every required question before writing the PRD. A PRD artifact must never contain workflow blockers.
- A new or revised PRD must have `Workflow Status: READY`, `Blockers: None`, `Coherence: VALID`, and approval `PENDING` until the user explicitly approves it.
- Never mark approval as `APPROVED` without explicit user approval of the current contents.
- Match the complete ARD and MVP. Do not silently reinterpret, contradict, or expand either parent.
- If the requested PRD exceeds a parent, identify the exact proposed expansion and ask the user. If approved, load and follow the `ard` and `mvp` skills, update the parents first, invalidate affected descendants, and only then create or revise the PRD.
- Number files from `00` upward in creation order. Use a lowercase English `kebab-case` capability slug.
- Never renumber an existing PRD automatically and never reuse a retired number. If the next number cannot be determined unambiguously, ask the user.
- Do not add architecture, implementation choices, migrations, rollout plans, speculative requirements, generic frameworks, or future capabilities.
- Do not create or select an SDD. Record only the approved neutral SDD-link placeholder.
- Every future consumer must use ARD, MVP, and PRD together. The PRD is not a standalone source of truth.

## Decision Gates

Before writing a PRD, resolve:

- document language;
- the exact MVP functional capability;
- objective and users relevant to that capability;
- scope and exclusions;
- expected behavior;
- functional requirements;
- error cases and boundaries;
- acceptance criteria;
- dependencies on other functional capabilities;
- any parent mismatch.

Keep asking concise, grouped questions until all required answers exist. Do not create a `BLOCKED` PRD as a substitute for the questionnaire.

If an ARD or MVP change invalidates an existing PRD, update it to:

```markdown
## Workflow Status
- Status: READY
- Blockers: None

## Approval
- Status: PENDING
- Approved by: None

## Coherence
- Status: REVIEW_REQUIRED
- Reason: <exact parent change requiring review>
```

Such a PRD cannot be used until reviewed, restored to `Coherence: VALID`, and explicitly approved again.

## Execution Steps

1. Read the complete `docs/product/ard.md` and `docs/product/mvp.md`.
2. Verify both parents are `READY` and `APPROVED`.
3. Ask for the document language unless already specified.
4. Ask which functional MVP capability this PRD covers.
5. Resolve every decision gate through the questionnaire before creating the file.
6. List existing `docs/product/prds/*.md`, choose the next unused creation-order number, and never rename existing files.
7. Verify the proposed PRD against both complete parent documents.
8. Write `docs/product/prds/<NN>-<english-kebab-case-slug>.md` using this structure:

```markdown
# <Functional Capability> — Product Requirements Document

## Workflow Status
- Status: READY
- Blockers: None

## Approval
- Status: PENDING | APPROVED
- Approved by: None | <explicit approver>

## Coherence
- Status: VALID | REVIEW_REQUIRED
- Reason: None | <exact reason>

## Parent Documents
- ARD: docs/product/ard.md
- MVP: docs/product/mvp.md

## Functional Capability

## Objective

## Relevant Users

## Scope

## Exclusions

## Expected Behavior

## Functional Requirements

## Error Cases and Boundaries

## Acceptance Criteria

## Functional Dependencies

## Migrations
- None | <explicitly authorized migration and authorizing source>

## SDD Link
- Status: NOT_CREATED
- Path: None
```

9. Present the `READY`, `VALID`, and `PENDING` PRD for explicit approval.
10. Mark it `APPROVED` only after the user approves its current contents.
11. Stop. Do not create, select, or start an SDD.

## Output Contract

Return:

- Skills applied: `prd` and `anti-overengineering`; `ard` or `mvp` only when an authorized parent revision occurred.
- PRD path and assigned immutable number.
- Parent paths and verified statuses.
- Language selected by the user.
- Workflow, coherence, and approval statuses.
- Parent mismatches found and resolved, or `None`.
- Migrations: `None` unless explicitly authorized, with the authorizing source.
- SDD created, selected, or started: `None`.
- Confirmation that future consumers must use ARD, MVP, and PRD together.

## References

- `docs/product/ard.md` — mandatory approved parent product contract.
- `docs/product/mvp.md` — mandatory approved parent MVP contract.
- `~/.pi/agent/skills/anti-overengineering/SKILL.md` — mandatory simplicity, ambiguity, scope, and migration controls.
- `~/.pi/agent/skills/ard/SKILL.md` — parent creation and revision contract.
- `~/.pi/agent/skills/mvp/SKILL.md` — parent creation and revision contract.
