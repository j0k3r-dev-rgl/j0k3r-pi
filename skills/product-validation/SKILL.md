---
name: product-validation
description: "define and record startup measurement plans, bounded experiments, observed evidence, and explicit persevere, iterate, pivot, pause, or stop decisions as numbered modular Markdown."
license: Apache-2.0
metadata:
  author: j0k3r
  version: "1.0"
---

# Product Validation

## Registry Contract

Use this block as the machine-readable source for `.pi/skill-registry.json` generation. Keep it valid JSON.

```json
{
  "category": "product",
  "domains": ["product-validation", "experiments", "product-metrics", "learning-decisions"],
  "triggers": {
    "paths": [
      "docs/05-validation/**/*.md"
    ],
    "keywords": [
      "product validation",
      "validate product",
      "measurement plan",
      "MVP validation",
      "validate MVP",
      "product experiment",
      "learning decision",
      "persevere",
      "pivot",
      "persevere or pivot",
      "validar producto",
      "medir MVP",
      "experimento de producto",
      "pivotar o continuar"
    ]
  },
  "sdd_phases": ["explore", "proposal", "spec", "task", "apply", "verify"],
  "related_skills": [
    "startup-documentation",
    "product-discovery",
    "product-definition",
    "delivery-planning",
    "anti-overengineering"
  ],
  "priority": 92
}
```

## Activation Contract

Use this skill when an approved product hypothesis, MVP, functional increment, sprint outcome, pilot, or release needs a measurement plan, bounded experiment, evidence interpretation, or explicit learning decision. It owns modular documents under `docs/05-validation/`.

Activate it only when observation can inform a named decision. It may send evidence-linked change requests back to discovery, product, requirements, architecture, technical decisions, or delivery, but it never silently rewrites their canonical artifacts.

Do not use it to invent success thresholds after results are known, collect unauthorized personal data, define implementation instrumentation, expand product scope, or treat output/delivery metrics as proof of customer value.

## Hard Rules

- Load and follow `startup-documentation`, `references/document-contract.md`, and `anti-overengineering` whenever this skill is active.
- Begin with one approved hypothesis or outcome and the named decision the evidence will inform. Do not measure because instrumentation is available.
- Ask the user before selecting metrics, thresholds, cohorts, observation periods, guardrails, experiment methods, data collection, confidence requirements, or final learning decisions.
- Predeclare supporting, weakening, invalidating, and guardrail-breach conditions before exposure or observation. Never move thresholds after seeing results without recording a new experiment.
- Match evidence to the claim: behavior for problem/value, usability observation for usability, payment or commitment for willingness-to-pay, technical measurement for feasibility/performance, and operational signals for reliability.
- Distinguish quantitative evidence, qualitative evidence, inference, assumption, confounder, limitation, and unknown. Small qualitative samples can identify issues but must not be presented as population statistics.
- Use the smallest ethical evidence set capable of changing the decision. Do not build analytics platforms, dashboards, warehouses, or exhaustive event taxonomies for one bounded question.
- Collect only data necessary for the approved decision and respect privacy, consent, retention, access, and deletion obligations.
- Every metric must have a definition, owner, decision, cohort/context, baseline or explicit unknown, review moment, guardrail, and retirement condition.
- Do not use sign-ups, downloads, visits, compliments, velocity, coverage, story points, or deployment frequency alone as proof of sustained value.
- Interpret results against the predeclared decision rule: persevere, iterate, pivot, pause, or stop. The agent recommends; the user owns the product decision.
- A new result invalidates downstream artifacts only through explicit trace and impact review. Preserve unaffected approvals.
- Create only the measurement, experiment, and decision records needed now; do not generate speculative future experiments.

## Decision Gates

Before defining or interpreting validation, resolve:

- approved hypothesis, audience/cohort, product outcome, functional increment, and linked requirement IDs;
- exact decision the evidence must inform and its owner;
- metric definitions, qualitative methods, baseline, supporting/weakening/invalidating thresholds, guardrails, and observation period;
- ethical, consent, privacy, security, retention, and access boundaries;
- known confounders, sample limitations, instrumentation confidence, and evidence sufficiency;
- cost/time cap and stop condition;
- allowed outcomes: persevere, iterate, pivot, pause, or stop.

Stop and ask when:

- no decision could change based on the measurement;
- thresholds would be chosen after observing results;
- data collection, external contact, spending, release exposure, or personal-data processing lacks authorization;
- the evidence cannot support the proposed claim;
- results create a product, requirement, architecture, technology, delivery, migration, or external-release decision owned elsewhere.

## Execution Steps

1. Identify one approved hypothesis/outcome, its trace links, and the user-owned decision.
2. Ask one concise grouped questionnaire for signals, thresholds, guardrails, cohort, period, ethics/privacy, limitations, and authority.
3. Create only the required validation paths:

```text
docs/05-validation/
├── 00-measurement-plan.md
├── 01-experiments/
│   └── 0001-<experiment>.md
└── 02-decisions/
    └── 0001-<learning-decision>.md
```

4. Use `00-measurement-plan.md` as a concise registry of decision-linked product, quality, and operational measures with definitions, owners, cohorts, baselines/unknowns, guardrails, review moments, and retirement conditions.
5. Store each bounded experiment under `01-experiments/` with hypothesis, audience, method, evidence type, predeclared signals/thresholds, guardrails, observation period, time/cost cap, privacy/ethical boundary, limitations, result, and linked decision ID.
6. Store each user-approved learning decision under `02-decisions/` with evidence used, comparison to predeclared criteria, confounders/limitations, outcome, rationale, affected trace links, change requests, owner, and next review condition.
7. Classify the result:
   - `PERSEVERE`: supported outcome and acceptable guardrails;
   - `ITERATE`: supported problem/value with a bounded correctable weakness;
   - `PIVOT`: central assumption weakened and another direction supported;
   - `PAUSE`: evidence, authority, or dependency is insufficient;
   - `STOP`: evidence or risk does not justify further investment.
8. Route each material change request to the canonical owning skill. Do not directly rewrite upstream artifacts.
9. Retire metrics and experiments that no longer inform a decision.
10. Validate traceability, predeclared criteria, evidence labels, privacy boundaries, and absence of post-hoc success claims.

## Output Contract

Return:

- Skills applied: `product-validation`, `startup-documentation`, and `anti-overengineering`.
- Hypothesis/outcome, linked artifacts, and decision owner.
- Measurement, experiment, or learning-decision documents created or updated.
- Predeclared signals, thresholds, guardrails, cohort, period, and cost/time boundary.
- Evidence, confidence, confounders, limitations, assumptions, and unknowns.
- User-approved outcome: `PERSEVERE | ITERATE | PIVOT | PAUSE | STOP`.
- Change requests and affected canonical owners; silent upstream edits: `None`.
- Unauthorized data collection, instrumentation implementation, scope expansion, and release performed: `None`.
- Validation executed.
- One next permitted action.

## References

- `~/.pi/agent/skills/startup-documentation/SKILL.md` — documentation routing.
- `~/.pi/agent/skills/startup-documentation/references/document-contract.md` — modular Markdown and change-impact contract.
- `~/.pi/agent/skills/product-definition/SKILL.md` — product hypothesis, scope, outcome, and metrics owner.
- `~/.pi/agent/skills/delivery-planning/SKILL.md` — increment, sprint, and release-planning owner.
- `~/.pi/agent/skills/anti-overengineering/SKILL.md` — mandatory scope and evidence proportionality.
- `https://theleanstartup.com/` — Build–Measure–Learn and explicit learning decisions.
- `https://research.google.com/pubs/archive/36299.pdf` — Goals–Signals–Metrics and user-centered measurement.
- `https://www.nngroup.com/articles/5-test-users-qual-quant/` — qualitative findings versus quantitative generalization.
- `https://www.svpg.com/product-discovery/` — value, usability, feasibility, and viability validation.
