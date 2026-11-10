# Contract-first parallel implementation

Use within Planned Workflow apply, not as another lifecycle or phase. User decisions and the Direct Orchestrator override remain authoritative. Existing plans keep their recorded contract; never retrofit active/historical changes automatically.

## Choose the split from project context

During planning, explicitly assess useful parallel work. Record the chosen split or the concrete reason for sequential execution in Risks & Constraints. Honor user choices about parallelism, file organization and architecture; transmit those decisions to every affected worker. Never assume a backend/frontend split, repository count, framework or worker count.

Separate information dependencies (a consumer needs an agreed interface) from implementation dependencies (a check needs a working provider). An agreed contract can unblock independent implementation before the provider exists. Do not remove real dependencies just to pass the checker.

Use actual project boundaries: HTTP APIs, local interfaces, server functions/actions, loader/action data, IPC commands/events, libraries or other existing seams. Next.js/React Router server code and UI may run in parallel when separate files and framework boundaries permit it; a shared route file has one writer. Go, Rust, Java, desktop and other stacks follow the same ownership rules. Do not introduce HTTP, restructure the application, add dependencies or split files merely to manufacture concurrency. A material organizational choice not already resolved by user instructions or repository conventions goes to the user through the orchestrator.

Plan disjoint concurrent write surfaces, necessary read access and isolated validation resources. Prefer directory roots; use multiple roots or exact files when existing sibling modules share a directory. Exact-file ownership is a concurrency boundary, not a requirement to predict every implementation file. Shared schemas, generated outputs, lockfiles, barrels and test setup have one owner; finish required shared writes before fan-out. Independent checks must not compete over ports, databases, fixtures or caches.

## Keep contracts in the project

Reuse the canonical contract and documentation convention already present. For a changed cross-unit interface, maintain concise project documentation outside openspec/workflow artifacts, divided by resource/capability with a small index when useful. Reference existing types/schemas instead of copying them into Markdown. HTTP may use an existing OpenAPI layout; server functions, actions and desktop IPC may use types/schemas plus focused behavioral documentation. Do not require OpenAPI, an ADR, a new skill, generators, dependencies or a documentation tree for every change.

Document only the necessary agreed inputs/results, errors, authorization/trust boundaries, serialization and relevant limits. Examples/fixtures must match that contract. List exact canonical files and all relevant modular fragments under Project Contracts; no recursive reference discovery is performed. A MINI owns authorized contract creation/update; 01-planning still writes only plan.md. Missing contract files are permitted at planning/apply authorization but must exist before consumers start and candidate capture.

Before fan-out, the orchestrator reads preparation evidence, validates the contract with the project's available checks, and records exact file SHA-256 identities in the existing preparation summary (or existing apply evidence for a reused contract). Pass the same references/identities to all consumers. Treat contracts as read-only during parallel execution. The orchestrator rechecks identities at fan-in. Discrepancies pause affected work: resolve the decision, update the canonical source through its assigned owner, review plan/consent continuity if affected, and revalidate affected consumers before resuming. Never let one worker silently change another's agreement.

New/changed contract files are candidate deliverables. Unchanged read-only contract inputs are additionally hashed by the checker in flow.json so later drift blocks verification/delivery; include them in the verifier's continuity snapshot as reviewed inputs as well. This does not parse contract semantics or replace conformance tests.

## Optional staged apply syntax

Simple independent changes retain Parallel Units alone. When actual preparation or integration implementation is needed, add Apply Sequence. It requires at least two units; each MINI belongs exactly once to Preparation, one unit, or Integration. Use None for an absent stage. This is a bounded three-part sequence, not a general task scheduler.

```text
## Apply Sequence
- Preparation: MINI-001
- Integration: MINI-004

## Parallel Units
- UNIT-SERVER: MINI-002 | Writable: /workspace/app/actions.ts ; /workspace/tests/server/**
- UNIT-UI: MINI-003 | Writable: /workspace/app/components/**

## Integrated Validation
- Owner: Integration worker
- Command: cd /workspace && npm test

## Project Contracts
- /workspace/docs/contracts/messages.md
- /workspace/app/contracts/messages.ts
```

Paths/commands here are examples, never executable authority. Separate multiple unit surfaces with exactly ` ; `. Unit surfaces may be directory roots ending in /** or exact files, inside Execution Scope Writable Paths. Concurrent surfaces may not overlap, including exact files under another unit's directory. Preparation depends only on preparation; a unit may depend on preparation and itself, never another unit or integration; integration may depend on all earlier work or itself, subject to acyclic MINI dependencies.

Integrated Validation names the owner and concrete command permitted by Allowed Bash. It is required with Apply Sequence; new plans with parallel units alone also specify it. Without integration implementation, the orchestrator runs the integrated command after fan-in. A sequential plan needs no empty sequence, unit or contract sections.

## Execute and join

1. Reuse applicable consent and capture the Surface Check baseline. If Preparation has items, delegate one 02-apply with only those items, its approved stage surface and apply-preparation.md. No unit starts before required preparation/checks pass.
2. Launch every independent unit concurrently in the same parent turn, one 02-apply each, respecting tool-selected mode and runtime capacity. Give each worker its MINI set, exclusive write surfaces, necessary read-only contract inputs, inherited user decisions, contract identities and apply-UNIT-ID.md. Do not give unit workers the whole writable scope as a fallback.
3. Read every result and perform baseline-relative attribution and contract-identity checks. A missing decision pauses its dependent work and phase advancement. Independent already-authorized units may continue only with unchanged contracts, disjoint surfaces and isolated resources. Never present a partial result as the complete candidate.
4. If Integration has items, delegate one 02-apply in a separate implementation session, after all prerequisite units have joined, with only integration items and explicitly bounded surfaces. It writes apply-integration.md and owns the integrated command. Its writes may touch prior unit surfaces only after those writers have settled. Otherwise the orchestrator owns the integrated command. Do not duplicate the run just to produce another report. Correct incompatibilities through assigned surfaces and applicable consent; verification is not an implementation worker.
5. Capture one complete candidate after all required checks pass. Supply every deliverable/deletion and every actual preparation/unit/integration implementation session. Each declared stage/unit needs its own READY apply summary and executor; later authorized remediation executors are also included. No monolithic apply.md or new phase artifact is required. One independent 03-verify reviews the complete MINI set, current canonical contracts, all apply summaries and integrated behavior, not merely mock-based unit tests.

## Questions without losing safe progress

Workers use ask_orchestrator when runtime provides it and wait in the same session; they do not guess, self-authorize or return terminal BLOCKED just to ask a live question. The parent checks supplied decisions and exact project evidence first, asks the user for any unresolved material choice, then relays the answer through subagent_run action: message. Product, architecture, scope and risk decisions remain user-owned. Messages carry context/answers, not implicit approval to expand authority.

Without a live question channel, return BLOCKED with the exact missing decision. Do not force background mode or relaunch a blocked/cancelled/failed task merely to keep the flow moving. Preserve usable independent work; apply existing continuation/retry consent limits. No sibling messaging tool or runtime behavior change is introduced here.
