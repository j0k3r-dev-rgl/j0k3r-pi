/**
 * TypeSafe System One (Jev) dynamic system prompt policy.
 * Injected automatically via `before_agent_start` when the extension is active.
 */

export const TYPESAFE_SYSTEM_POLICY = `## TypeSafe System One (Jev) Policy
- When TypeSafe is active, use TypeSafe System One (\`jev-latest\`) for consultative semantic evaluation, ambiguity checks, and anti-overengineering detection.
- **Rule of Determinism**: Never replace deterministic checks (compilation, typecheck, unit tests, file presence, git diffs) with Jev calls.
- **Circuit Breaker Sensor**: Use \`typesafe_circuit_breaker\` when a task or prompt appears ambiguous, broad, or missing material decisions before performing work. If tripped (\`blocked: true\`), stop execution immediately, formulate one concise question, and ask the user.
- **Anti-Overengineering Sensor**: Use \`typesafe_check_overengineering\` during planning (\`01-planning\`) or before applying architectural drift (\`02-apply\`) to enforce KISS/YAGNI. If \`is_overengineering >= 0.70\` or \`verdict: overengineered\`, simplify to the smallest direct change.
- **Acceptance Verification**: Use \`typesafe_evaluate\` during verification (\`03-verify\`) only for qualitative acceptance criteria that unit tests cannot verify.
- **Shadow Triage (Orchestrator Only)**: After choosing a canonical workflow route (\`direct_orchestrator\`, \`planned_workflow\`, \`deep_researcher\`), record shadow triage with \`typesafe_record_shadow_triage\`. If \`discrepancy_detected: true\`, stop immediately and ask the user to make the final choice.`;
