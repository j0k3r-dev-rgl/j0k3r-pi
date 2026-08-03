---
name: product-definition
description: "define a startup product's vision, measurable outcomes, MVP hypothesis, explicit scope, user journeys, and small functional capabilities as numbered modular Markdown after sufficient problem evidence exists."
license: Apache-2.0
metadata:
  author: j0k3r
  version: "1.0"
---

# Product Definition

## Registry Contract

Use this block as the machine-readable source for `.pi/skill-registry.json` generation. Keep it valid JSON.

```json
{
  "category": "product",
  "domains": ["product-definition", "mvp-scoping", "product-outcomes", "functional-capabilities"],
  "triggers": {
    "paths": [
      "docs/01-product/**/*.md"
    ],
    "keywords": [
      "product definition",
      "define product vision",
      "MVP",
      "define MVP",
      "create MVP",
      "define MVP hypothesis",
      "scope the MVP",
      "product scope",
      "product success metrics",
      "user journeys",
      "functional capabilities",
      "definir producto",
      "definir alcance del MVP",
      "modulos funcionales del producto"
    ]
  },
  "sdd_phases": ["explore", "proposal", "spec"],
  "related_skills": [
    "startup-documentation",
    "product-discovery",
    "anti-overengineering",
    "requirements-definition",
    "product-validation"
  ],
  "priority": 92
}
```

## Activation Contract

Use this skill when an evidence-backed opportunity or an explicitly accepted product premise must become a product vision, measurable outcome, MVP hypothesis, bounded scope, user journeys, or small functional capabilities. It owns modular documents under `docs/01-product/`.

Activate it after product discovery has produced sufficient evidence for the current decision, or when the user explicitly supplies and accepts the problem, target audience, assumptions, and uncertainty as the starting contract.

Do not use it to conduct customer research, invent market evidence, write detailed functional requirements, design architecture, select technology, plan sprints, or implement software. Do not redefine discovery evidence; issue a linked change request when new product reasoning challenges it.

## Hard Rules

- Load and follow `startup-documentation`, `references/document-contract.md`, and `anti-overengineering` whenever this skill is active.
- Read the minimum approved discovery artifacts required for the current product decision. Stop if the core problem, target audience, or decision owner is materially unresolved.
- Ask the user before selecting product vision, business outcome, success intent, MVP hypothesis, included capability, exclusion, journey, priority, or trade-off.
- The agent may recommend the smallest supported product slice, explain why broader items are premature, and present bounded alternatives. The user retains the final product decision.
- Define an MVP as the smallest credible experience that tests an explicit hypothesis or safely delivers the approved core outcome—not as an arbitrary reduced feature list.
- Every included MVP capability must support at least one approved hypothesis, core outcome, trustworthy measurement need, or mandatory product constraint.
- Keep experiment prototypes, pilots, and operational releases distinct. Ask which product level is intended because their quality and operational obligations differ.
- Product owns outcome, success, and guardrail intent. `product-validation` owns operational metric definitions, cohorts, collection and analysis, baselines, thresholds, observation periods, results, and learning decisions; product documents link those metric IDs instead of redefining them.
- Predeclare the decision rule and success, failure, and guardrail intent before execution. Never reinterpret success after results are observed.
- Keep explicit exclusions beside scope. Do not hide deferred ideas in the current commitment.
- Model journeys and capabilities as small vertical product behaviors, not frontend/backend/database layers or assumed technical modules.
- Split a capability only when its parts need independent review, value, risk, evidence, approval, or delivery handling now. Otherwise keep one cohesive vertical capability and list its sub-behaviors.
- Do not specify languages, frameworks, libraries, storage, APIs, architecture patterns, migrations, sprint dates, or implementation tasks.
- Reuse approved language, decision owners, scope, evidence references, and metadata unless they are absent, stale, contradicted, or specific to the current product decision.
- Create only the documents needed for the current approved decision; never generate the whole product group automatically.

## Decision Gates

Before defining product documentation, resolve:

- approved problem, target audience, evidence baseline, assumptions, and remaining uncertainty;
- document language when no project convention exists;
- product vision and user outcome;
- business outcome and why it matters now;
- MVP type: prototype, experiment, pilot, or operational release;
- critical hypothesis and decision it will inform;
- success, failure, and guardrail intent plus the decision rule;
- included scope, explicit exclusions, time/cost boundary, and mandatory constraints;
- essential end-to-end journeys and small functional capability boundaries;
- user who owns scope and trade-off decisions.

Stop and ask when:

- discovery evidence is insufficient for the proposed commitment;
- multiple materially different audiences, outcomes, MVP types, or scope options remain valid;
- a requested capability cannot be linked to current value, learning, measurement, or mandatory constraint;
- the request expands beyond the accepted opportunity;
- the next decision belongs to requirements, architecture, technology, delivery, or validation.

## Execution Steps

1. State the product decision being made and identify the minimum approved discovery inputs.
2. Ask one concise grouped questionnaire for unresolved user-owned choices.
3. Create only the required product paths from this modular map:

```text
docs/01-product/
├── 00-product-vision.md
├── 01-success-metrics.md
├── 02-mvp-hypothesis.md
├── 03-scope.md
├── 04-user-journeys/
│   └── 0001-<journey>.md
└── 05-capabilities/
    └── 0001-<capability>.md
```

4. Use `00-product-vision.md` for the approved target audience, problem link, desired future state, product outcome, strategic choices, and non-goals.
5. Despite its filename, use `01-success-metrics.md` only for product outcome, qualitative success/guardrail intent, decision intent, ownership, review moments, and links to operational metric IDs owned by validation. Operational definitions, cohorts, collection methods, baselines, thresholds, observation periods, and results belong only to `product-validation`.
6. Use `02-mvp-hypothesis.md` for audience, critical hypothesis, MVP type, current evidence/confidence, smallest credible experience, predeclared decision rule, time/cost boundary, and resulting decision.
7. Use `03-scope.md` for included capabilities, mandatory constraints, explicit exclusions, rationale, and unresolved trade-offs.
8. Store each independently reviewable end-to-end journey in a numbered file under `04-user-journeys/`.
9. Store each small, cohesive functional product capability in a numbered file under `05-capabilities/`, linking it to journeys, outcome, MVP hypothesis, and scope decision.
10. Validate that every inclusion has a current reason and that no technical design leaked into product documentation.
11. Present the approved next owner: further discovery, requirements definition, or product revision.

## Output Contract

Return:

- Skills applied: `product-definition`, `startup-documentation`, and `anti-overengineering`; `product-discovery` when discovery revision was separately authorized.
- Product decision and approved discovery inputs used.
- Documents created or updated under `docs/01-product/`.
- MVP type, hypothesis, smallest credible experience, and explicit exclusions.
- User-owned choices requested and resolved.
- Capabilities included with their value, learning, measurement, or mandatory-constraint links.
- Assumptions and unknowns preserved.
- Architecture, technology, sprint planning, and implementation performed: `None`.
- Validation executed.
- One next permitted action.

## References

- `~/.pi/agent/skills/startup-documentation/SKILL.md` — startup documentation routing.
- `~/.pi/agent/skills/startup-documentation/references/document-contract.md` — canonical modular Markdown contract.
- `~/.pi/agent/skills/product-discovery/SKILL.md` — upstream evidence and assumption owner.
- `~/.pi/agent/skills/anti-overengineering/SKILL.md` — mandatory simplicity and scope controls.
- `https://leanstartup.co/resources/articles/what-is-an-mvp/` — MVP as validated learning rather than arbitrary feature reduction.
- `https://www.svpg.com/product-strategy-overview/` — product strategy as explicit problem and outcome choices.
- `https://research.google.com/pubs/archive/36299.pdf` — goals, signals, and metrics for user-centered product measurement.
