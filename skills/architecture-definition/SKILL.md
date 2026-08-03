---
name: architecture-definition
description: "define evidence-driven startup architecture drivers, system context, boundaries, data and trust boundaries, and deployment view as modular Markdown without selecting unjustified technologies or speculative scale mechanisms."
license: Apache-2.0
metadata:
  author: j0k3r
  version: "1.1"
---

# Architecture Definition

## Registry Contract

Use this block as the machine-readable source for `.pi/skill-registry.json` generation. Keep it valid JSON.

```json
{
  "category": "architecture",
  "domains": ["software-architecture", "architecture-drivers", "system-boundaries", "data-and-trust-boundaries"],
  "triggers": {
    "paths": [
      "docs/03-architecture/00-architecture-drivers.md",
      "docs/03-architecture/01-system-context.md",
      "docs/03-architecture/02-system-boundaries.md",
      "docs/03-architecture/03-data-and-trust-boundaries.md",
      "docs/03-architecture/04-deployment-view.md"
    ],
    "keywords": [
      "define software architecture",
      "architecture drivers",
      "system context",
      "system boundaries",
      "data and trust boundaries",
      "deployment view",
      "definir arquitectura",
      "limites del sistema",
      "atributos de calidad"
    ]
  },
  "sdd_phases": [],
  "related_skills": [
    "startup-documentation",
    "requirements-definition",
    "technical-decisions",
    "delivery-planning",
    "anti-overengineering"
  ],
  "priority": 92
}
```

## Activation Contract

Use this skill when approved product requirements need an architectural model: prioritized drivers, external context, internal responsibility boundaries, data and trust boundaries, or a deployment view. It owns the fixed architecture views under `docs/03-architecture/00-architecture-drivers.md` through `04-deployment-view.md`.

Activate it only to the depth required by approved requirements, material risks, and the next technical decision. Use `technical-decisions` for architecture decision records, technology comparisons, dependencies, vendors, and integrations.

Do not use this skill to discover the product, expand MVP scope, invent quality targets, select languages/frameworks/libraries/vendors, plan sprints, create implementation tasks, or produce a complete future-state architecture.

## Hard Rules

- Consume the `startup-documentation` and `references/document-contract.md` context already supplied by the router. If no router context was supplied, load them once for the shared contract without re-entering documentation routing. Load and follow `anti-overengineering` whenever this skill is active.
- Use approved product and requirements artifacts as drivers. Stop if the critical flow, applicable quality requirement, constraint, data class, or decision owner needed for the current view is unresolved.
- Ask the user before choosing architecture boundaries, ownership, deployment shape, data placement, trust assumptions, security posture, availability approach, or trade-offs not already approved.
- Express architecture drivers as measurable scenarios when applicable: source/stimulus, context, affected artifact, expected response, measure or unresolved target, evidence, priority, and owner.
- Use knockout constraints for legal, contractual, security, privacy, safety, accessibility, data-residency, interoperability, or recovery obligations that cannot be traded away.
- Prefer the smallest reversible architecture satisfying current drivers. A well-modularized single deployment is a valid baseline while boundaries are uncertain, but never prescribe it when an explicit constraint requires another shape.
- Show the simpler viable alternative whenever proposing additional deployables, datastores, asynchronous infrastructure, caches, gateways, regions, or operational platforms.
- Model functional responsibility boundaries, not speculative microservices. A diagram boundary does not authorize a separate deployment.
- Classify data and identify trust boundaries before deciding sensitive storage or external data flows. When the application includes AI/agent capabilities, include applicable tool permissions, prompt/instruction boundaries, model context—including retrieval/vector/embedding context when used—memory, human-approval gates, and external tool-execution boundaries without imposing them on conventional applications.
- When a current requirement, data class, trust boundary, integration, or deployment exposure is security- or privacy-relevant, perform a proportionate threat/risk assessment. Include applicable privacy-only harms such as profiling or inference harms, excessive observability, chilling effects, autonomy or dignity impacts, and unfair downstream effects without imposing a universal privacy framework. Record material threats, affected assets/boundaries, evidence or assumptions, disposition (`MITIGATE | ACCEPT | TRANSFER | DEFER`), decision owner, linked requirement or ADR when needed, and expected security/privacy-verification evidence. For `ACCEPT` or `DEFER`, also record a review/expiry event, closure condition, and responsible owner. Do not require a separate document, branded method, score, or speculative control; unresolved risk acceptance belongs to the user.
- Keep diagrams text-reviewable using Markdown and Mermaid unless the user explicitly approves another durable format.
- Describe deployment responsibilities and required operational capabilities without selecting a vendor unless a separate technical decision approves it.
- Link approved quality and constraint IDs and add only architecture interpretation, priority, and trade-off implications. Never redefine the canonical target.
- Record risk-proportional security/privacy verification expectations and the owner or response path for discovered vulnerabilities, privacy incidents, or control failures; route tool and platform selection to `technical-decisions`.
- Do not duplicate requirements or ADR rationale. Link stable IDs and summarize only what is necessary to understand the architecture view.
- Create or update only the views needed for the current approved decision. Do not generate all five architecture files automatically.

## Decision Gates

Before defining an architecture view, resolve:

- approved functional slices and applicable quality/constraint IDs;
- critical user and operational flows;
- system actors and external systems;
- data classes, ownership, retention obligations, trust boundaries, material security/privacy threats, and risk disposition relevant now, including applicable AI/agent tool, prompt, retrieval/vector/embedding context, memory, human-approval, and external-execution boundaries;
- actual team, budget, environment, delivery, and operational constraints;
- measurable or explicitly unresolved reliability, recovery, latency, throughput, security, privacy, accessibility, and interoperability needs;
- architecture decision owner and acceptable risk.

Stop and ask when:

- requirements are missing, contradictory, or speculative;
- several materially different boundaries or deployment shapes remain valid;
- a target such as scale, availability, latency, recovery, or geography has no approved basis;
- a proposed mechanism adds complexity without a current driver;
- the next action requires a technology/vendor choice, migration, delivery commitment, or implementation.

## Execution Steps

1. Identify the exact architecture question and trace it to approved product and requirement IDs.
2. Ask one concise grouped questionnaire for missing drivers, data/trust facts, constraints, trade-offs, and decision ownership.
3. Create only the required architecture views:

```text
docs/03-architecture/
├── 00-architecture-drivers.md
├── 01-system-context.md
├── 02-system-boundaries.md
├── 03-data-and-trust-boundaries.md
└── 04-deployment-view.md
```

4. Use `00-architecture-drivers.md` as a concise prioritized index of functional drivers, linked quality/constraint IDs, architecture interpretation, knockout constraints, evidence/confidence, owners, and review triggers.
5. Use `01-system-context.md` for users, external systems, responsibilities, data exchanges, trust relationships, and a context diagram.
6. Use `02-system-boundaries.md` for current functional responsibility boundaries, ownership, permitted dependencies, invariants, and explicit non-boundaries; do not imply independent deployment unless approved.
7. Use `03-data-and-trust-boundaries.md` for data classification, sources, owners, flows, trust zones, retention/deletion obligations, applicable AI/agent trust surfaces, and any proportionate threat/risk assessment and disposition without inventing controls.
8. Use `04-deployment-view.md` for deployable units actually required now, environments, configuration/secrets responsibilities, build/deploy/rollback/restore expectations, observability baseline, applicable security/privacy verification, vulnerability/privacy-incident response ownership, and external runtime dependencies without unapproved vendor selection.
9. When a significant choice remains, request one numbered ADR from `technical-decisions` rather than hiding the choice in a diagram.
10. Validate traceability, simplicity, diagram syntax when present, and absence of unsupported future architecture.

## Output Contract

Return:

- Skills applied: `architecture-definition`, `startup-documentation`, and `anti-overengineering`; `technical-decisions` only for a separately authorized decision.
- Architecture question and approved requirement/constraint IDs used.
- Architecture views created or updated.
- Drivers, linked quality/constraint IDs, knockout constraints, assumptions, applicable security/privacy threat/risk dispositions and `ACCEPT`/`DEFER` review conditions, verification/response ownership, and unknown targets kept explicit.
- User-owned boundary and trade-off decisions requested and resolved.
- Simpler viable baseline considered.
- Technology/vendor choices, migrations, sprint plans, and implementation performed: `None`.
- ADRs required, linked, or `None`.
- Validation executed.
- One next permitted action.

## References

- `~/.pi/agent/skills/startup-documentation/SKILL.md` — documentation routing.
- `~/.pi/agent/skills/startup-documentation/references/document-contract.md` — modular Markdown contract.
- `~/.pi/agent/skills/requirements-definition/SKILL.md` — upstream functional, quality, and constraint owner.
- `~/.pi/agent/skills/technical-decisions/SKILL.md` — significant architecture and technology decision owner.
- `~/.pi/agent/skills/anti-overengineering/SKILL.md` — mandatory simplicity and scope controls.
- `https://www.sei.cmu.edu/library/reasoning-about-software-quality-attributes` — quality attributes as architecture drivers and trade-offs.
- `https://martinfowler.com/articles/evo-arch-forward.html` — evolutionary architecture through small changes and feedback.
- `https://www.thoughtworks.com/radar/techniques/evolutionary-architecture` — driving requirements and latest responsible decisions.
- `https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html` — conditional agent tool, instruction, memory/context, and human-approval security boundaries.
- `https://doi.org/10.6028/NIST.AI.600-1` — NIST Generative AI risk vocabulary for conditional model, data, provenance, monitoring, and misuse concerns.
- `https://owasp.org/www-project-top-10-for-large-language-model-applications/` — current LLM/GenAI risks including prompt injection, sensitive disclosure, supply chain, and vector/embedding weaknesses.
