---
name: requirements-definition
description: "translate approved product capabilities into small, traceable functional, quality, and constraint requirements. Use when defining requirements, acceptance criteria, user questions, quality attributes, or constraints as Markdown records; do not choose architecture, technology, or implementation."
license: Apache-2.0
metadata:
  author: j0k3r
  version: "1.1"
registry:
  category: "product"
  domains: "requirements-engineering, functional-requirements, quality-requirements, requirements-traceability"
  paths: "docs/02-requirements/**/*.md"
  keywords: "requirements definition, product requirements, application requirements, functional module requirements, define functional requirements, quality requirements, acceptance criteria, requirements traceability, definir requisitos, requisitos funcionales, criterios de aceptacion, requisitos de calidad"
  related: "startup-documentation, product-definition, architecture-definition, product-validation, delivery-planning, anti-overengineering, cognitive-doc-design"
  priority: 92
---

# Requirements Definition

## Activation Contract

Use this skill when approved product scope, journeys, and capabilities must become explicit, testable, traceable functional requirements, applicable quality requirements, or product constraints. It owns modular documents under `docs/02-requirements/`.

Activate it for one small functional capability or one coherent quality/constraint family at a time. Prefer vertical, user-observable behavior that can be implemented and accepted independently.

Do not use it to discover the problem, choose MVP scope, design architecture, select languages/frameworks/libraries/vendors, plan sprints, prescribe migrations, or implement software. Requirements state what must be true and how it is verified; downstream design decides how.

## Hard Rules

- Consume the `startup-documentation` and `references/document-contract.md` context already supplied by the router. If no router context was supplied, load them once for the shared contract without re-entering documentation routing. Load and follow `anti-overengineering` whenever this skill is active.
- Use approved product documents as parent contracts. Stop if the relevant product capability, scope decision, user, or outcome is not approved or is materially inconsistent.
- Ask the user before defining behavior, business rules, data obligations, priorities, error handling, boundary conditions, quality targets, compatibility requirements, or acceptance criteria not established by approved inputs.
- Assign stable identifiers to every requirement and acceptance criterion. Never renumber or reuse retired identifiers.
- Link each functional requirement to an approved product capability, user journey, outcome, MVP hypothesis, or mandatory constraint. A requirement without a current parent reason is blocked or excluded.
- Write requirements as observable capabilities or constraints. Do not prescribe internal components, frameworks, tables, queues, services, patterns, or deployment mechanisms.
- Keep one functional record focused on one small, cohesive, independently reviewable capability slice. Split it when behaviors have independent outcomes, rules, acceptance, or risk.
- Include normal behavior, relevant alternatives, errors, boundaries, permissions, and data effects needed for complete functional behavior. “Fully functional” means the approved slice satisfies all of its applicable acceptance and quality conditions, not that speculative future cases are added.
- Identify quality categories early but specify only those justified by user impact, risk, regulation, contract, or release level. Do not invent scale, latency, availability, security certification, or compatibility targets.
- Use measurable quality scenarios when a quality requirement matters: context, stimulus, expected response, measure, and evidence source.
- Distinguish acceptance criteria for one requirement from the shared Definition of Done owned by delivery documentation.
- Require downstream evidence to link requirement and acceptance IDs when it claims implementation or conformance validation.
- Keep migration strategy out of requirements. Record only approved data preservation, import/export, continuity, or compatibility outcomes; architecture and delivery own the mechanism.
- Reuse approved language, decision owners, scope, evidence references, and metadata unless they are absent, stale, contradicted, or specific to the current requirement decision.
- Do not create all possible functional, quality, and constraint documents. Create only what the current capability and risk require.

## Decision Gates

Before writing requirements, resolve:

- approved parent product capability, journey, scope, MVP hypothesis, and target users;
- the small behavior slice being specified;
- business rules and actor permissions;
- expected behavior, alternatives, errors, boundaries, and data outcomes;
- applicable privacy, security, accessibility, reliability, performance, regulatory, contractual, interoperability, retention, or compatibility obligations;
- measurable acceptance examples and decision owner;
- dependencies on other approved capabilities without assuming implementation order.

Stop and ask when:

- the parent product decision is missing, unapproved, or contradicted;
- several valid business rules or boundary behaviors remain;
- a quality target has no user, risk, regulatory, or contractual basis;
- a requirement implies expansion beyond approved scope;
- satisfying the request requires architecture, technology, migration design, delivery planning, or implementation.

## Execution Steps

1. Identify one approved product capability or one coherent quality/constraint family and its trace links.
2. Ask one concise grouped questionnaire for unresolved behavior, rules, boundaries, quality obligations, and acceptance.
3. Create only the required paths from this modular map:

```text
docs/02-requirements/
├── 00-requirements-index.md
├── 01-functional/
│   └── 0001-<capability-slice>.md
├── 02-quality/
│   └── 0001-<quality-area>.md
└── 03-constraints/
    └── 0001-<constraint>.md
```

4. Maintain `00-requirements-index.md` as a concise registry of stable IDs, titles, statuses, canonical paths, parent capability links, and dependency links—not as a duplicate specification.
5. Store each small functional slice under `01-functional/` with stable requirement IDs, actors, preconditions, observable behavior, business rules, alternatives, errors, boundaries, data outcomes, acceptance IDs, exclusions, and trace links.
6. Store each justified quality family under `02-quality/` with scenario, measure or unresolved target, evidence source, affected functional IDs, priority, validation expectation, and the requirement or acceptance IDs that conformance evidence must reference.
7. Store regulatory, contractual, platform, data-residency, retention, interoperability, accessibility, or compatibility constraints under `03-constraints/` only when explicitly applicable.
8. Use concrete acceptance examples when they reduce ambiguity. Ensure each criterion is observable and does not prescribe implementation.
9. Check completeness only against the approved slice and applicable risks; do not add speculative edge cases.
10. Update the requirements index and present the next owner: product revision, architecture decisions, product validation for implementation/conformance evidence, or another approved requirement slice.

## Output Contract

Return:

- Skills applied: `requirements-definition`, `startup-documentation`, and `anti-overengineering`; `product-definition` only when a parent revision was separately authorized.
- Parent product documents and stable IDs used.
- Requirement, acceptance, quality, and constraint IDs created or updated.
- Documents created or updated under `docs/02-requirements/`.
- User decisions requested and resolved.
- Applicable quality areas included with justification; speculative quality targets added: `None`.
- Traceability from requirement to product outcome, capability, journey, hypothesis, or mandatory constraint, plus requirement/acceptance links expected from conformance evidence.
- Architecture, technology, migration mechanism, sprint planning, and implementation performed: `None`.
- Validation executed.
- One next permitted action.

## References

- `~/.pi/agent/skills/startup-documentation/SKILL.md` — startup documentation routing.
- `~/.pi/agent/skills/startup-documentation/references/document-contract.md` — canonical modular Markdown contract.
- `~/.pi/agent/skills/product-definition/SKILL.md` — upstream product scope, journey, and capability owner.
- `~/.pi/agent/skills/product-validation/SKILL.md` — implementation and conformance evidence owner linking requirement and acceptance IDs.
- `~/.pi/agent/skills/anti-overengineering/SKILL.md` — mandatory scope and simplicity controls.
- `https://standards.ieee.org/standard/29148-2018.html` — lifecycle requirements-engineering principles and requirement quality.
- `https://gojko.net/lists/specification-by-example.html` — concrete examples for shared, testable behavior.
- `https://scrumguides.org/scrum-guide.html` — distinction between product backlog refinement and Definition of Done.
