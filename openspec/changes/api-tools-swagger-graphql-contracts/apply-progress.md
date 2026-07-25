# Apply Progress: Conditional API Tools, Rendering, and Lossless Output Contracts

## Mode
Strict TDD

## Approval Binding
- Approval id: `apply-dependency-contract-approval-20260725T062243Z`
- Packet revision: `dependency-contract-task-20260725T063500Z-v1`
- Approval record ref: `openspec/changes/api-tools-swagger-graphql-contracts/metadata.yaml#approval-records`
- Approved scope summary: Apply only the API Tools-owned Pi runtime dependency packet and its regression guards.
- Approval summary redacted: true
- Recorded at: `2026-07-25T06:22:43Z`

## Completed Tasks
- [x] 1.1 Add API Tools-owned Pi runtime peer declarations plus matching package-local development installs in `extensions/api-tools/package.json` and `extensions/api-tools/package-lock.json`.
- [x] 1.2 RED: tighten `extensions/api-tools/test/render.test.ts` to fail on sibling/custom Pi runtime resolution and missing package ownership.
- [x] 1.3 Record the focused baseline: `npm test -- --run test/render.test.ts` failed for the expected stale resolver reason; `npm run typecheck` passed before production edits.
- [x] 2.1 Replace `extensions/api-tools/src/pi-runtime.ts` custom package resolution with direct bare imports from `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui`.
- [x] 2.2 Preserve the local adapter seam in `extensions/api-tools/src/render.ts` and keep static package-boundary assertions green.
- [x] 3.1 Re-run focused GREEN validation for `test/render.test.ts`.
- [x] 3.2 Re-run full package regression validation: `npm test` and `npm run typecheck`.

## Files Changed
| File | Action | What Was Done |
|------|--------|---------------|
| `extensions/api-tools/package.json` | modified | Added only `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` as peer dependencies plus matching package-local dev installs. |
| `extensions/api-tools/package-lock.json` | modified | Recorded the API Tools-owned local installation for the two authorized Pi runtime packages. |
| `extensions/api-tools/src/pi-runtime.ts` | modified | Replaced `createRequire`/`searchPaths`/filesystem probing with direct bare imports and adapter re-exports. |
| `extensions/api-tools/test/render.test.ts` | modified | Added package-ownership and direct-import guard assertions while preserving renderer behavior checks. |
| `openspec/changes/api-tools-swagger-graphql-contracts/tasks.md` | modified | Marked tasks `1.1` through `3.2` complete and left `3.3` for verify. |
| `openspec/changes/api-tools-swagger-graphql-contracts/apply-progress.md` | modified | Recorded current approval binding, TDD evidence, touched files, and verify handoff. |
| `openspec/changes/api-tools-swagger-graphql-contracts/implementation-map.md` | modified | Updated apply execution notes, touched files, validations, and remaining verify evidence. |
| `openspec/changes/api-tools-swagger-graphql-contracts/metadata.yaml` | modified | Advanced authoritative phase state from task-ready to apply-completed and verify-ready. |

## Implementation Map Alignment
| Expected map entry | Actual result | Notes |
|--------------------|---------------|-------|
| `extensions/api-tools/package.json`, `extensions/api-tools/package-lock.json` add only the two authorized Pi runtime declarations | completed | Added only `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` as peer/dev ownership entries. |
| `extensions/api-tools/test/render.test.ts` RED guardrails | completed | The focused RED failed until the stale resolver and missing ownership were removed. |
| `extensions/api-tools/src/pi-runtime.ts` direct-import adapter | completed | `resolvePackage`, `searchPaths`, `createRequire`, filesystem probing, and sibling-extension fallback were removed. |
| `extensions/api-tools/src/render.ts` keeps local adapter seam | completed | Renderer still imports only `./pi-runtime.js`. |
| focused/full package validation | completed | Focused render suite, full package tests, and typecheck all passed after remediation. |

New files/symbols discovered during apply: None.
Deviations from implementation map: None.

## Validations
- RED: `cd extensions/api-tools && npm test -- --run test/render.test.ts` — FAIL (expected: `src/pi-runtime.ts` still used sibling/custom package resolution and package ownership was missing)
- Baseline: `cd extensions/api-tools && npm run typecheck` — PASS
- GREEN: `cd extensions/api-tools && npm test -- --run test/render.test.ts` — PASS
- GREEN: `cd extensions/api-tools && npm test` — PASS (`42` tests)
- GREEN: `cd extensions/api-tools && npm run typecheck` — PASS

## Metadata, PRD, Spec, and Security Alignment
- Metadata: `openspec/changes/api-tools-swagger-graphql-contracts/metadata.yaml`
- PRD: None
- metadata_alignment: aligned
- prd_alignment: not-applicable
- spec_alignment: aligned
- security_alignment: aligned
- Metadata/PRD/spec/security requirements implemented in this batch: API Tools-owned Pi runtime peer/dev ownership, direct bare imports through the local adapter seam, no sibling/custom package resolution, and package-local regression validation.
- Metadata/PRD/spec/security conflicts_detected encountered: None.

## Deviations from Design
None.

## Issues Found
- Engram memory provider was unreachable during apply-state refresh attempts, so hybrid-mode compact cursor persistence could not be updated from this environment.

## Remaining Tasks
- [ ] 3.3 Reload Pi and manually review collapsed/expanded API tool rendering during `formal_sdd_verify`.

## Status
6/7 tasks complete. Apply completed for packet revision `dependency-contract-task-20260725T063500Z-v1`; verify is next once the orchestrator records the interactive verify authorization. Manual Pi renderer review remains verify evidence.