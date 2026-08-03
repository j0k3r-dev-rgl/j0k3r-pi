---
name: product-discovery
description: "guide evidence-based startup problem discovery and create numbered modular Markdown for opportunities, users, evidence, assumptions, and product direction without prematurely defining an MVP, architecture, or technology stack."
license: Apache-2.0
metadata:
  author: j0k3r
  version: "1.0"
---

# Product Discovery

## Registry Contract

Use this block as the machine-readable source for `.pi/skill-registry.json` generation. Keep it valid JSON.

```json
{
  "category": "product",
  "domains": ["product-discovery", "startup-inception", "customer-evidence", "assumption-testing"],
  "triggers": {
    "paths": [
      "docs/00-discovery/00-opportunity.md",
      "docs/00-discovery/01-users-and-stakeholders.md",
      "docs/00-discovery/02-evidence/**/*.md",
      "docs/00-discovery/03-assumptions/**/*.md",
      "docs/00-discovery/04-product-direction.md"
    ],
    "keywords": [
      "product discovery",
      "problem discovery",
      "startup idea",
      "validate idea",
      "validate startup idea",
      "define product problem",
      "customer evidence",
      "assumption mapping",
      "descubrimiento de producto",
      "validar idea de startup",
      "definir problema y usuarios"
    ]
  },
  "sdd_phases": ["explore", "proposal", "spec"],
  "related_skills": [
    "startup-documentation",
    "anti-overengineering",
    "cognitive-doc-design",
    "product-definition"
  ],
  "priority": 92
}
```

## Activation Contract

Use this skill when a startup idea still needs a clear problem, target users or stakeholders, behavior-based evidence, explicit assumptions, or an evidence-backed initial product direction. It owns modular documents under `docs/00-discovery/` except snapshot-bound `AS_IS` evidence under `docs/00-discovery/05-existing-project/`, which is owned by `existing-project-onboarding`.

Activate it when the request begins with a proposed feature or technology but lacks a demonstrated problem, when a critical product assumption needs validation before investment, or when new evidence may invalidate an approved product direction.

Do not activate it merely because discovery is available. Do not use it when an approved problem and evidence baseline already answer the current decision and no material new evidence exists. Do not define MVP scope, detailed requirements, architecture, languages, frameworks, libraries, sprints, or implementation.

## Hard Rules

- Load and follow `startup-documentation`, its `references/document-contract.md`, and `anti-overengineering` whenever this skill is active.
- Ask the user before defining any user, stakeholder, problem, outcome, market claim, evidence threshold, priority, or product direction not already established by supplied evidence.
- Start from the decision that discovery must inform. Do not conduct open-ended research or interviews without a decision purpose.
- Separate confirmed evidence, supported evidence, inference, assumption, and unknown in every artifact.
- Require every durable evidence record to follow the shared evidence-provenance contract.
- Prefer observed behavior, current alternatives, commitments, costs, and consequences over praise or hypothetical feature interest.
- Do not treat interview count as a universal validation threshold. Match evidence strength to the claim and risk.
- Investigate only assumptions that are material and weakly evidenced. Put the least expensive ethical test that can change the decision first.
- Do not require Jobs-to-be-Done, personas, Opportunity Solution Trees, Lean Canvas, or another branded method. Use a method only when it helps answer the current question.
- Do not name a proposed feature as the problem statement.
- Maintain explicit non-goals and research boundaries.
- Before collecting personal data, require an approved purpose and, when applicable, lawful or consent basis, minimization, access, retention, deletion, and redaction boundaries. Do not turn this conditional gate into a general compliance program.
- Treat discovery direction as provisional evidence-backed guidance. Only explicit user approval promotes selected elements into `product-definition` inputs.
- Predeclare experiment signals, guardrails, time/cost caps, and resulting decisions before collecting outcome evidence; the user may approve an opportunity, assumption, or discovery-test hypothesis solely for testing by `product-validation`. That approval does not promote it into product intent or `product-definition`.
- Reuse approved language, decision owners, scope, evidence references, and metadata unless they are absent, stale, contradicted, or specific to the current discovery decision.
- Stop when evidence is sufficient for the current decision, a blocker requires the user, or the approved research boundary is reached.
- Never generate all discovery documents automatically. Create only the modular artifacts required by the current discovery question.

## Decision Gates

Before creating discovery documentation, resolve:

- document language when no approved project convention exists;
- the decision discovery must inform;
- suspected users, buyers, operators, approvers, regulators, or other affected stakeholders;
- the problem context and current alternatives, while preserving unverified claims as assumptions;
- research scope, allowed sources or participants, depth, and ethical/privacy boundaries, including approved purpose and applicable lawful/consent basis, minimization, access, retention, deletion, and redaction for personal data;
- evidence threshold or decision rule appropriate to the claim;
- the user who owns proceed, investigate, pivot, pause, or stop decisions.

Stop and ask when:

- the request supplies only a solution and the underlying problem is unknown;
- multiple materially different target segments or problems remain viable;
- research would require access, participants, spending, external contact, or data use not authorized by the user;
- a proposed conclusion exceeds the evidence;
- the next step would define MVP scope, architecture, technology, delivery, or implementation.

## Execution Steps

1. State the decision to be informed and reuse current approved context without reconstructing it.
2. Ask one concise grouped questionnaire for missing problem, stakeholder, evidence, boundary, and decision-owner facts.
3. Create only the required discovery paths from this modular map:

```text
docs/00-discovery/
├── 00-opportunity.md
├── 01-users-and-stakeholders.md
├── 02-evidence/
│   └── 0001-<evidence-topic>.md
├── 03-assumptions/
│   └── 0001-<assumption-topic>.md
└── 04-product-direction.md
```

4. Use `00-opportunity.md` for the problem context, affected segment, desired outcome, known constraints, non-goals, and open questions.
5. Use `01-users-and-stakeholders.md` only when distinct users, buyers, operators, approvers, regulators, or partners materially affect decisions.
6. Store each independently sourced or independently reviewable evidence set in one numbered file under `02-evidence/`, following the shared evidence-provenance contract.
7. Store each coherent assumption family under `03-assumptions/`, recording importance, evidence, confidence, smallest test, and decision impact.
8. Create `04-product-direction.md` only when evidence is sufficient to propose a direction. Keep it provisional until the user approves promotion of selected elements into `product-definition`, and preserve remaining uncertainty.
9. Link artifacts using stable IDs rather than duplicating evidence or conclusions.
10. Present the smallest supported next action: more bounded evidence, product-definition work, pivot, pause, or stop.

## Output Contract

Return:

- Skills applied: `product-discovery`, `startup-documentation`, and `anti-overengineering`.
- Decision the discovery work informs.
- Documents created or updated under `docs/00-discovery/`.
- User decisions requested and resolved.
- Confirmed evidence, supported evidence, inferences, assumptions, and unknowns kept distinct.
- Research boundary and evidence limitations.
- Explicit non-goals.
- Outcome: investigate further, propose a provisional direction, proceed to product definition after explicit approval, pivot, pause, or stop; final authority remains with the user.
- Validation executed.
- One next permitted action.

## References

- `~/.pi/agent/skills/startup-documentation/SKILL.md` — startup documentation routing and modular ownership contract.
- `~/.pi/agent/skills/startup-documentation/references/document-contract.md` — canonical numbered Markdown structure and status contract.
- `~/.pi/agent/skills/anti-overengineering/SKILL.md` — mandatory simplicity and decision controls.
- `~/.pi/agent/skills/cognitive-doc-design/SKILL.md` — progressive disclosure and reviewability.
- `https://steveblank.com/tag/customer-development` — customer discovery and validation loops.
- `https://leanstartup.co/resources/articles/what-is-an-mvp/` — validated-learning framing used only as supporting discovery context.
- `https://www.gov.uk/service-manual/agile-delivery/how-the-discovery-phase-works` — discovery as a decision about whether to proceed.
- `https://www.producttalk.org/opportunity-solution-trees` — optional outcome, opportunity, assumption, and test linkage.
