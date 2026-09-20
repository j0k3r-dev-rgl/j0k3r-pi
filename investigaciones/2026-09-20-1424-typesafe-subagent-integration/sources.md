# Sources

## Source Index

### S-001: extensions/typesafe/src/shadow/triage-shadow.ts
- Family: IMPLEMENTATION
- URL or locator: `extensions/typesafe/src/shadow/triage-shadow.ts`
- Date/version: Commit 641a0e4 / 2026-09-20
- Access method: `read`
- Used for: Section 1 (Triage Policy), Section 3 (Coordination), Section 6 (Shadow Telemetry)
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Contains `TRIAGE_POLICY_SUMMARY` injected into Jev state, question schemas (`suggested_lane`, `is_complex_workflow`, `requires_investigation`), discrepancy circuit breaker logic, and project context detection.

### S-002: extensions/typesafe/src/tools/convenience-factory.ts
- Family: IMPLEMENTATION
- URL or locator: `extensions/typesafe/src/tools/convenience-factory.ts`
- Date/version: Commit 99a42d7 / 2026-09-20
- Access method: `read`
- Used for: Section 4 (Thresholds & Calibration), Section 5 (Cost/Latency), Section 6 (Telemetry Bug Discovery)
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Standard factory for `typesafe_circuit_breaker` and `typesafe_check_overengineering`. Discovered defect on line 118 where `(response as any).tokens?.input_tokens` is read instead of `response.usage?.input_tokens`, causing 0-token records in SQLite for convenience tools.

### S-003: extensions/typesafe/src/tools/circuit-breaker-tool.ts
- Family: IMPLEMENTATION
- URL or locator: `extensions/typesafe/src/tools/circuit-breaker-tool.ts`
- Date/version: Commit cc441bf / 2026-09-20
- Access method: `read`
- Used for: Section 1 (Subagent Patterns), Section 4 (Thresholds)
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Configures `circuit_breaker_needed` (Noul) and `decision_type` (Choice: none, missing_product_decision, unauthorized_configuration_mutation, speculative_scope_creep, missing_technical_fact) with 0.70 threshold.

### S-004: extensions/typesafe/src/tools/overengineering-tool.ts
- Family: IMPLEMENTATION
- URL or locator: `extensions/typesafe/src/tools/overengineering-tool.ts`
- Date/version: Commit cc441bf / 2026-09-20
- Access method: `read`
- Used for: Section 1 (Planning and Apply Patterns), Section 4 (Thresholds)
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Configures `is_overengineering` (Noul) and `simplicity_verdict` (Choice: simplest_sufficient, moderate, overengineered) with 0.70 threshold.

### S-005: extensions/typesafe/src/tools/shadow-tool.ts
- Family: IMPLEMENTATION
- URL or locator: `extensions/typesafe/src/tools/shadow-tool.ts`
- Date/version: Commit 641a0e4 / 2026-09-20
- Access method: `read`
- Used for: Section 3 (Coordination), Section 6 (Shadow Telemetry Distinction)
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Defines `typesafe_record_shadow_triage`. Enforces canonical route enum (`direct_orchestrator`, `planned_workflow`, `deep_researcher`). Emits `discrepancy_detected: true` and user circuit breaker notice when Jev differs from orchestrator.

### S-006: extensions/typesafe/src/storage/telemetry-db.ts
- Family: IMPLEMENTATION
- URL or locator: `extensions/typesafe/src/storage/telemetry-db.ts`
- Date/version: Commit 641a0e4 / 2026-09-20
- Access method: `read`
- Used for: Section 5 (Token/Latency Budget), Section 6 (Telemetry Schema Analysis)
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Implements SQLite telemetry store with WAL mode, secure file permissions (0700/0600), 90-day pruning, and paginated queries. Lacks explicit `caller_agent` or `subagent_name` column.

### S-007: skills/workflow-triage/SKILL.md
- Family: PRIMARY
- URL or locator: `skills/workflow-triage/SKILL.md`
- Date/version: Version 12.0 / Commit 641a0e4
- Access method: `read`
- Used for: Section 1 (Orchestrator Role), Section 3 (Coordination), Section 6 (Routing Exclusivity)
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Authoritative specification for workflow triage in Pi. Explicitly defines the Discrepancy Circuit Breaker: when Jev disagrees with orchestrator, STOP immediately and ask user to choose. Non-authoritative shadow telemetry.

### S-008: skills/anti-overengineering/SKILL.md
- Family: PRIMARY
- URL or locator: `skills/anti-overengineering/SKILL.md`
- Date/version: Version 3.1
- Access method: `read`
- Used for: Section 1 (Planning & Apply Patterns), Section 2 (Anti-patterns)
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Mandates KISS, YAGNI, simplest-sufficient solutions. Defines decision gates for dependencies, migrations, architectural churn. Specifies Jev anti-overengineering sensor criteria.

### S-009: skills/typesafe-ai/SKILL.md
- Family: PRIMARY
- URL or locator: `skills/typesafe-ai/SKILL.md`
- Date/version: In-repo canonical skill
- Access method: `read`
- Used for: Section 1 (Primitives), Section 2 (Anti-patterns), Section 4 (Calibration)
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Fundamental design concepts of TypeSafe System One models (Jev): Choice, Noul, Score primitives; state construction; question design; confidence vs certainty; and avoiding generation for structured selection.

### S-010: skills/work-workflow/SKILL.md & skills/subagent-artifact-contracts/SKILL.md
- Family: PRIMARY
- URL or locator: `skills/work-workflow/SKILL.md`, `skills/subagent-artifact-contracts/SKILL.md`
- Date/version: Version 16.0 & Version 2.2
- Access method: `read`
- Used for: Section 1 (Lifecycle Integration), Section 3 (Coordination Contracts)
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Defines Planned Workflow lifecycle (`discovery.md` -> `plan.md` -> `apply.md` -> `verify.md`), seven-field delegation contracts, and strict circuit-breaker handoff mechanics (`BLOCKED` status).

### S-011: subagents/*.md (00-discovery, 01-planning, 02-apply, 03-verify, deep-researcher)
- Family: IMPLEMENTATION
- URL or locator: `subagents/{00-discovery,01-planning,02-apply,03-verify,deep-researcher}.md`
- Date/version: Commit f411de1 / 2026-09-20
- Access method: `read`
- Used for: Section 1 (Subagent Tool Allowances), Section 3 (Coordination Boundaries)
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Verified all 5 subagents have `typesafe_circuit_breaker`, `typesafe_check_overengineering`, and `typesafe_evaluate` in their frontmatter tool allowlists.

### S-012: TYPESAFE_STATUS.md
- Family: IMPLEMENTATION
- URL or locator: `TYPESAFE_STATUS.md`
- Date/version: Cut 2026-09-20T17:15:00-03:00 / Commit a392ad9
- Access method: `read`
- Used for: Section 4 (Calibration Benchmarks), Section 5 (Empirical Costs)
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Documents current experimental status on `jev-config`, 75% agreement rate on real-world prompts, circuit-breaker test scores (0.80-0.97 for violators, 0.16-0.49 for safe), and overengineering scores (0.84-0.97 for violators, 0.05-0.56 for sufficient).

### S-013: ~/.local/share/pi/typesafe/telemetry.sqlite
- Family: PRIMARY
- URL or locator: `~/.local/share/pi/typesafe/telemetry.sqlite` (accessed via `TelemetryDb`)
- Date/version: 2026-09-20
- Access method: `bash` (Node.js runtime query)
- Used for: Section 5 (Cost & Latency Budget), Section 6 (Telemetry Verification)
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: 56 real evaluation records. Real latencies measured between 828ms and 995ms. Shadow triage input tokens: 1,159–1,168; output tokens: 98–100. Revealed `tok: 0/0` in convenience tool records due to the `usage` vs `tokens` property bug.

### S-014: Engram Observations (obs-282a945255eb41c1, obs-39039133650babf4, obs-cf2565ced130511a, obs-3e7afc6a497b9160)
- Family: IMPLEMENTATION
- URL or locator: `mem:3058`, `mem:3062`, `mem:3060`, `mem:3063`
- Date/version: 2026-09-20
- Access method: `mem_search`
- Used for: Section 1, Section 3, Section 4
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Captured validation sessions, factory refactoring, skills injection into Jev, and test suites across real j0k3r-pi prompts.
