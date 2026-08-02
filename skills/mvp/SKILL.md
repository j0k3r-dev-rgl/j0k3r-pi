---
name: mvp
description: "derive and maintain a minimal viable product document from an approved Application Requirements Document at project inception. use for explicit MVP scoping, functional module separation, user questioning, approval, and downstream consistency."
license: Apache-2.0
metadata:
  author: j0k3r
  version: "1.0"
---

# Minimum Viable Product

## Registry Contract

Use this block as the machine-readable source for `.pi/skill-registry.json` generation. Keep it valid JSON.

```json
{
  "category": "workflow",
  "domains": ["product-discovery", "project-inception", "mvp-scoping"],
  "triggers": {
    "paths": [
      "docs/product/mvp.md"
    ],
    "keywords": [
      "create MVP",
      "crear MVP",
      "define MVP",
      "minimum viable product",
      "minimal viable product",
      "derive MVP from ARD"
    ]
  },
  "sdd_phases": ["explore", "proposal", "spec"],
  "related_skills": [
    "anti-overengineering",
    "cognitive-doc-design",
    "ard",
    "prd"
  ],
  "priority": 92
}
```

## Activation Contract

Use this skill only to create or explicitly revise `docs/product/mvp.md` for a new project after `docs/product/ard.md` is `READY` and explicitly `APPROVED`.

Do not use it to invent a product vision, expand the ARD, create PRDs, select an SDD workflow, design architecture, or implement software. Load and follow `anti-overengineering` whenever this skill is active.

## Hard Rules

- Read and use the complete approved `docs/product/ard.md` as the parent contract. Do not work from a summary or from user memory alone.
- Stop if the ARD is missing, `BLOCKED`, or not `APPROVED`.
- Ask which language the user wants for the document unless the current request already specifies it. Offer English as the default, but never select it without the user's answer.
- Ask the user to choose the minimum product scope. Never decide which ARD capabilities belong in the MVP.
- Every included capability must trace to the ARD. If a proposal exceeds the ARD, explain the mismatch and ask whether the user wants to revise the ARD first.
- Optimize for the smallest product that can validate the explicitly chosen objective. Do not add speculative features, platform work, architecture, migrations, scalability, compatibility, or future-proofing.
- Divide the MVP into functional product capabilities, not assumed technical modules.
- Write the canonical artifact only at `docs/product/mvp.md`.
- Use only `READY | BLOCKED` for workflow status and `PENDING | APPROVED` for approval.
- `READY` means complete for review, not approved. Never mark `APPROVED` without explicit user approval of the current contents.
- Do not create PRDs automatically. After approval, only suggest PRD creation and ask the user.
- If an approved MVP changes, do not silently update PRDs. Set every existing PRD to coherence `REVIEW_REQUIRED` and approval `PENDING`, then report all affected paths.
- Never create or perform any migration.

## Decision Gates

Before writing or revising the MVP, resolve:

- document language;
- the single validation objective;
- included and excluded ARD capabilities;
- essential user journeys;
- success criteria;
- functional capability boundaries;
- dependencies or required ordering among those capabilities.

If answers remain missing, continue the questionnaire. Persist a `BLOCKED` MVP only when the user explicitly asks to save incomplete work; otherwise do not create a partial artifact.

If the requested MVP contradicts or expands the ARD, stop. Present the exact mismatch and ask whether the ARD should change. Load and follow the `ard` skill before editing the parent document.

## Execution Steps

1. Read `docs/product/ard.md` and verify `Workflow Status: READY` and `Approval: APPROVED`.
2. Ask for the document language unless already specified.
3. Ask the minimum grouped questions needed to define the MVP without choosing product scope for the user.
4. Verify every included capability against the complete ARD.
5. Write or update `docs/product/mvp.md` using this structure:

```markdown
# Minimum Viable Product

## Workflow Status
- Status: READY | BLOCKED
- Blockers: None | <specific blockers>

## Approval
- Status: PENDING | APPROVED
- Approved by: None | <explicit approver>

## Parent Document
- ARD: docs/product/ard.md

## Validation Objective

## Included Capabilities

## Excluded Capabilities

## Essential User Journeys

## Success Criteria

## Functional Modules

## Dependencies and Order
```

6. Present the completed `READY` MVP for explicit approval.
7. Mark it `APPROVED` only after the user approves its current contents.
8. If revising an approved MVP, invalidate existing PRDs as required and report their paths.
9. Stop. Do not create PRDs automatically.

## Output Contract

Return:

- Skills applied: `mvp` and `anti-overengineering`; `ard` when parent revision was authorized.
- Artifact path: `docs/product/mvp.md`.
- Parent ARD path and verified statuses.
- Language selected by the user.
- Workflow and approval statuses.
- Included and excluded capabilities explicitly selected by the user.
- PRDs invalidated, or `None`.
- ARD expansion, migrations, technical design, PRD creation, and implementation performed: `None` unless separately authorized.
- Next document suggested to the user, or `None`.

## References

- `docs/product/ard.md` — mandatory approved parent contract.
- `~/.pi/agent/skills/anti-overengineering/SKILL.md` — mandatory simplicity, ambiguity, scope, and migration controls.
- `~/.pi/agent/skills/ard/SKILL.md` — parent creation and revision contract.
- `~/.pi/agent/skills/prd/SKILL.md` — optional next artifact after explicit MVP approval.
