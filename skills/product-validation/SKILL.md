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
      "pre-requirement experiment",
      "conformance validation",
      "acceptance verification",
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
    "requirements-definition",
    "delivery-planning",
    "anti-overengineering"
  ],
  "priority": 92
}
```

## Activation Contract

Use this skill when a user-approved discovery opportunity, assumption, or test hypothesis, or an approved product hypothesis, MVP, functional increment, sprint outcome, pilot, or release needs a measurement plan, bounded experiment, evidence interpretation, or explicit learning decision. It owns modular documents under `docs/05-validation/`.

Activate it only when observation can inform a named decision. It may send evidence-linked change requests back to discovery, product, requirements, architecture, technical decisions, or delivery, but it never silently rewrites their canonical artifacts.

Do not use it to invent success thresholds after results are known, collect unauthorized personal data, define implementation instrumentation, expand product scope, or treat output/delivery metrics as proof of customer value.

## Hard Rules

- Consume the `startup-documentation` and `references/document-contract.md` context already supplied by the router. If no router context was supplied, load them once for the shared contract without re-entering documentation routing. Load and follow `anti-overengineering` whenever this skill is active.
- Begin with one user-approved discovery opportunity, assumption, or test hypothesis, or one approved product hypothesis or outcome, plus the named decision the evidence will inform. Discovery approval authorizes testing only and does not promote provisional content into product intent.
- Ask the user before selecting metrics, thresholds, cohorts, observation periods, guardrails, experiment methods, data collection, confidence requirements, or final learning decisions.
- Product owns outcome, success, and guardrail intent. Validation owns operational metric definitions, cohorts, collection and analysis methods, baselines, thresholds, observation periods, results, and learning decisions.
- Predeclare supporting, weakening, invalidating, and guardrail-breach conditions before exposure or observation. Never move thresholds after seeing results without recording a new experiment.
- Match evidence to the claim: behavior for problem/value, usability observation for usability, payment or commitment for willingness-to-pay, technical measurement for feasibility/performance, and operational signals for reliability.
- Distinguish quantitative evidence, qualitative evidence, inference, assumption, confounder, limitation, and unknown. Small qualitative samples can identify issues but must not be presented as population statistics.
- Use the smallest ethical evidence set capable of changing the decision. Do not build analytics platforms, dashboards, warehouses, or exhaustive event taxonomies for one bounded question.
- Collect only data necessary for the approved decision. Before personal-data collection, require an approved purpose and, when applicable, lawful or consent basis, minimization, access, retention, deletion, and redaction boundaries; do not create a general compliance subsystem.
- Treat material privacy harm, unauthorized personal-data processing, or a privacy guardrail breach as invalidating or weakening evidence as applicable. Route the user-owned learning decision to `ITERATE | PAUSE | STOP`, request a canonical change record when approved content is challenged, and do not interpret or close the result as successful while the material privacy condition remains unresolved.
- Every metric must have a stable ID, definition, owner, decision, cohort/context, collection and analysis method, baseline or explicit unknown, threshold, observation period, review moment, guardrail, and retirement condition.
- Every durable evidence record must follow the shared evidence-provenance contract.
- Validation or verification evidence must link requirement and acceptance IDs when it claims implementation or conformance validation. Pre-requirement validation may instead trace to opportunity, assumption, hypothesis, journey, capability, or outcome IDs.
- For comparative causal-effect claims only, require a comparator or control, eligibility and assignment method, primary metric, sample or duration rationale, analysis method, and stopping rule. Do not require these fields for qualitative, usability, or simple observational validation.
- Reuse approved language, decision owners, scope, evidence references, and metadata unless they are absent, stale, contradicted, or specific to the current validation decision.
- Do not use sign-ups, downloads, visits, compliments, velocity, coverage, story points, or deployment frequency alone as proof of sustained value.
- Interpret results against the predeclared decision rule: persevere, iterate, pivot, pause, or stop. The agent recommends; the user owns the product decision.
- A new result invalidates downstream artifacts only through explicit trace and impact review. Preserve unaffected approvals.
- Create only the measurement, experiment, and decision records needed now; do not generate speculative future experiments.

## Decision Gates

Before defining or interpreting validation, resolve:

- user-approved discovery opportunity, assumption, or test hypothesis, or approved product hypothesis/outcome, plus audience/cohort and applicable trace IDs;
- functional increment plus linked requirement and acceptance IDs only when claiming implementation or conformance validation;
- exact decision the evidence must inform and its owner;
- metric definitions, qualitative methods, baseline, supporting/weakening/invalidating thresholds, guardrails, and observation period;
- ethical, privacy, and security boundaries, including approved purpose and applicable lawful/consent basis, minimization, access, retention, deletion, and redaction for personal data;
- known confounders, sample limitations, instrumentation confidence, and evidence sufficiency;
- comparator/control, eligibility and assignment, primary metric, sample or duration rationale, analysis method, and stopping rule only for comparative causal-effect claims;
- cost/time cap and stop condition;
- allowed outcomes: persevere, iterate, pivot, pause, or stop.

Stop and ask when:

- no decision could change based on the measurement;
- thresholds would be chosen after observing results;
- data collection, external contact, spending, release exposure, or personal-data processing lacks authorization;
- the evidence cannot support the proposed claim;
- results create a product, requirement, architecture, technology, delivery, migration, or external-release decision owned elsewhere.

## Execution Steps

1. Identify one user-approved discovery opportunity/assumption/test hypothesis or approved product hypothesis/outcome, its trace links, provisional or canonical status, and the user-owned decision.
2. Ask one concise grouped questionnaire for signals, thresholds, guardrails, cohort, period, ethics/privacy, limitations, and authority.
3. Create only the required validation paths:

```text
docs/05-validation/
├── 00-measurement-plan.md
├── 01-experiments/
│   └── 0001-<experiment>.md
├── 02-decisions/
│   └── 0001-<learning-decision>.md
└── 03-change-requests/
    └── 0001-<target-and-change>.md
```

4. Use `00-measurement-plan.md` as a concise registry of decision-linked product, quality, and operational measures with definitions, owners, cohorts, baselines/unknowns, guardrails, review moments, and retirement conditions.
5. Store each bounded experiment under `01-experiments/` with hypothesis, audience, method, evidence type and provenance, applicable trace IDs, predeclared signals/thresholds, guardrails, observation period, time/cost cap, privacy/ethical boundary, limitations, result, and linked decision ID. Add the conditional causal-effect fields only when that claim is made.
6. Store each user-approved learning decision under `02-decisions/` with evidence used, comparison to predeclared criteria, confounders/limitations, outcome, rationale, affected trace links, material change-request IDs, owner, and next review condition.
7. When evidence materially challenges another owner's approved content, create or update the single canonical `CR-####` record under `03-change-requests/`, route it to the target owner, record the returned disposition/rationale, and close it only after accepted changes and impact-review evidence satisfy the closure condition. Validation never applies the target semantic change.
8. Classify the result:
   - `PERSEVERE`: supported outcome and acceptable guardrails;
   - `ITERATE`: supported problem/value with a bounded correctable weakness;
   - `PIVOT`: central assumption weakened and another direction supported;
   - `PAUSE`: evidence, authority, or dependency is insufficient;
   - `STOP`: evidence or risk does not justify further investment.
9. Route each material change request to the canonical owning skill. Do not directly rewrite upstream artifacts.
10. Retire metrics and experiments that no longer inform a decision.
11. Validate traceability, predeclared criteria, evidence labels, privacy boundaries, change-request uniqueness/lifecycle, and absence of post-hoc success claims.

## Output Contract

Return:

- Skills applied: `product-validation`, `startup-documentation`, and `anti-overengineering`.
- Discovery opportunity/assumption/test hypothesis or product hypothesis/outcome, its provisional or canonical status, linked artifacts, and decision owner.
- Measurement, experiment, learning-decision, or canonical change-request documents created or updated.
- Predeclared signals, thresholds, guardrails, cohort, period, and cost/time boundary.
- Evidence, confidence, confounders, limitations, assumptions, and unknowns.
- User-approved outcome: `PERSEVERE | ITERATE | PIVOT | PAUSE | STOP`.
- Canonical `CR-####` records and affected owners; duplicate change requests and silent upstream edits: `None`.
- Unauthorized data collection, instrumentation implementation, scope expansion, and release performed: `None`.
- Validation executed.
- One next permitted action.

## References

- `~/.pi/agent/skills/startup-documentation/SKILL.md` — documentation routing.
- `~/.pi/agent/skills/startup-documentation/references/document-contract.md` — modular Markdown and change-impact contract.
- `~/.pi/agent/skills/product-definition/SKILL.md` — product hypothesis, scope, outcome, and success/guardrail intent owner.
- `~/.pi/agent/skills/requirements-definition/SKILL.md` — requirement and acceptance owner for implementation or conformance validation.
- `~/.pi/agent/skills/delivery-planning/SKILL.md` — increment, sprint, and release-planning owner.
- `~/.pi/agent/skills/anti-overengineering/SKILL.md` — mandatory scope and evidence proportionality.
- `https://theleanstartup.com/` — Build–Measure–Learn and explicit learning decisions.
- `https://research.google.com/pubs/archive/36299.pdf` — Goals–Signals–Metrics and user-centered measurement.
- `https://www.nngroup.com/articles/5-test-users-qual-quant/` — qualitative findings versus quantitative generalization.
- `https://www.svpg.com/product-discovery/` — value, usability, feasibility, and viability validation.
