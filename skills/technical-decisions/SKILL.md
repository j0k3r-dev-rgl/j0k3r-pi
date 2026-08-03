---
name: technical-decisions
description: "evaluate and record one significant startup architecture, language, framework, library, datastore, vendor, dependency, or integration decision at a time using numbered ADRs and explicit user-owned trade-offs."
license: Apache-2.0
metadata:
  author: j0k3r
  version: "1.0"
---

# Technical Decisions

## Registry Contract

Use this block as the machine-readable source for `.pi/skill-registry.json` generation. Keep it valid JSON.

```json
{
  "category": "architecture",
  "domains": ["architecture-decisions", "technology-selection", "dependency-evaluation", "external-integrations"],
  "triggers": {
    "paths": [
      "docs/03-architecture/decisions/**/*.md",
      "docs/03-architecture/integrations/**/*.md"
    ],
    "keywords": [
      "architecture decision",
      "architecture decision record",
      "database decision",
      "technical decision",
      "technology selection",
      "choose programming language",
      "choose framework",
      "evaluate library",
      "evaluate integration",
      "ADR",
      "decision tecnica",
      "elegir lenguaje",
      "elegir framework",
      "evaluar integracion"
    ]
  },
  "sdd_phases": ["proposal", "spec", "design", "task"],
  "related_skills": [
    "startup-documentation",
    "architecture-definition",
    "requirements-definition",
    "delivery-planning",
    "anti-overengineering"
  ],
  "priority": 93
}
```

## Activation Contract

Use this skill when one architecturally significant choice or one external integration needs explicit alternatives, evidence, trade-offs, user approval, consequences, and a review trigger. It owns numbered ADRs under `docs/03-architecture/decisions/` and integration records under `docs/03-architecture/integrations/`.

Activate it for architecture shape, language, runtime, framework, library, datastore, protocol, vendor, build-versus-buy, external API, security mechanism category, or operational platform choices only when the decision materially affects requirements, reversal cost, data/security/compliance, several modules, external dependency, or cross-cutting standards.

Do not create an ADR for easily reversible local implementation details. Do not run broad ecosystem surveys, choose fashionable technology, or revisit an approved decision without a recorded trigger or material new evidence.

## Hard Rules

- Load and follow `startup-documentation`, `references/document-contract.md`, `architecture-definition`, and `anti-overengineering` whenever this skill is active.
- Evaluate one coherent decision at a time. Split decisions that have different drivers, owners, alternatives, or reversal boundaries.
- Ask the user before selecting evaluation criteria, weights, knockout constraints, alternatives, risk acceptance, cost commitments, vendor lock-in, or final technology.
- Begin with approved requirement IDs, architecture drivers, team capability, budget, data obligations, operating environment, and delivery constraints. Unknown facts remain unknown; do not convert forecasts into requirements.
- State the simplest viable option first and explain exactly why it fails before recommending a more complex option.
- Select the lowest-complexity option that passes every knockout constraint and leaves explicitly accepted risk. Scores support judgment; they never make the decision automatically.
- Record evidence and confidence for each material comparison. Do not use artificial numeric precision when evidence is qualitative.
- Run a time-boxed spike only when its result can change the decision. Predeclare question, representative test, pass/fail criteria, cost/time cap, data restrictions, and resulting decision. A spike must not silently become production code.
- Count operational burden as product cost: deployment, testing, monitoring, rollback, restore, patching, incident ownership, upgrades, support, and hiring/training.
- For dependencies, evaluate maintenance, documentation, release policy, compatibility, license, transitive dependencies, end-of-life, vulnerability response, update path, and team supportability.
- For integrations, evaluate data purpose/classification, legal and privacy obligations, authentication/scopes, secrets, contracts/versioning, rate limits, timeouts, retries, idempotency, duplicates, ordering, partial failure, outage behavior, sandbox, SLA/support, export, termination, and fallback only when applicable.
- Do not prescribe microservices, queues, events, CQRS, event sourcing, caching, specialized datastores, Kubernetes, service mesh, multiregion, SLO programs, feature flags, or vendor adapters without a current driver that a simpler option cannot satisfy.
- Supersede approved ADRs; do not rewrite their historical decision and rationale. Never renumber or reuse retired decision or integration IDs.
- An ADR authorizes a decision, not implementation or migration. Route delivery and implementation separately.

## Decision Gates

Before creating a decision record, resolve:

- exact decision and decision owner;
- approved requirements, drivers, and constraints it must satisfy;
- actual team skills, budget, operating environment, delivery horizon, and support ownership;
- viable alternatives including the simplest option and retaining the current state where applicable;
- knockout criteria and material trade-offs;
- evidence required, confidence, and whether a bounded spike is justified;
- reversibility, exit path, lock-in, data effects, security/privacy implications, operational burden, and accepted risk;
- validation method and evidence-based revisit trigger.

Stop and ask when:

- product requirements or architecture drivers are absent or contradictory;
- multiple alternatives remain valid under materially different user-owned trade-offs;
- the choice introduces spending, external contracts, data disclosure, migration, irreversible effects, or operational ownership not authorized by the user;
- a proposed spike lacks a decision-changing question;
- the request is a local implementation detail that does not warrant durable documentation.

## Execution Steps

1. State the one decision, its owner, and trace links to requirements and architecture drivers.
2. Ask one concise grouped questionnaire for unresolved criteria, alternatives, costs, risks, reversibility, and authority.
3. Determine whether the artifact is a general ADR or a detailed external integration record:

```text
docs/03-architecture/
├── decisions/
│   └── 0001-<decision>.md
└── integrations/
    └── 0001-<integration>.md
```

4. For an ADR, record context, drivers, knockout constraints, viable alternatives, simpler baseline, evidence/confidence, decision, user approval, consequences, risks, validation, owner, and revisit trigger.
5. For an integration, record business purpose, owner, data classification/flow, contract, authentication/scopes, failure semantics, limits, observability, cost, support, fallback, export/exit, evidence, and linked ADR when the selection is significant.
6. Create a spike record inside the relevant decision document only when approved; record adopt, reject, defer pending a named fact, or revise the requirement after the result.
7. Use the next unused four-digit creation-order number. Preserve prior records and use `Supersedes` for replacements.
8. Check that the chosen option passes every knockout constraint and that extra complexity has an explicit driver.
9. Update linked architecture views only through their owning skill when the approved decision materially changes them.
10. Stop before implementation, migration, procurement, or external delivery unless separately authorized.

## Output Contract

Return:

- Skills applied: `technical-decisions`, `architecture-definition`, `startup-documentation`, and `anti-overengineering`.
- Decision or integration record path and stable number.
- Approved requirements, drivers, and constraints used.
- Viable alternatives and simplest baseline considered.
- User-owned criteria, trade-offs, risk acceptance, and final decision.
- Evidence/confidence and spike results, or `None`.
- Consequences, operational burden, reversibility, and revisit trigger.
- Implementation, migration, procurement, external contact, and delivery performed: `None` unless separately authorized.
- Validation executed.
- One next permitted action.

## References

- `~/.pi/agent/skills/startup-documentation/SKILL.md` — documentation routing.
- `~/.pi/agent/skills/startup-documentation/references/document-contract.md` — modular Markdown and supersession contract.
- `~/.pi/agent/skills/architecture-definition/SKILL.md` — architecture view and driver owner.
- `~/.pi/agent/skills/requirements-definition/SKILL.md` — requirement and constraint owner.
- `~/.pi/agent/skills/anti-overengineering/SKILL.md` — mandatory simplicity and decision controls.
- `https://adr.github.io/` — architecturally significant decision records.
- `https://martinfowler.com/bliki/ArchitectureDecisionRecord.html` — short, single-decision, superseded ADRs.
- `https://martinfowler.com/bliki/MonolithFirst.html` — microservice premium and qualified monolith-first reasoning.
- `https://martinfowler.com/bliki/MicroservicePrerequisites.html` — operational prerequisites for service architectures.
- `https://csrc.nist.gov/pubs/sp/800/218/final` — adaptable secure-development practices.
- `https://cheatsheetseries.owasp.org/cheatsheets/Dependency_Graph_SBOM_Cheat_Sheet.html` — dependency and SBOM evaluation guidance.
- `https://www.ietf.org/rfc/rfc9205.html` — HTTP API design and interoperability considerations.
