# Tasks: Conditional API tools, rendering, and lossless output contracts

## Metadata and PRD Alignment
- Metadata: `openspec/changes/api-tools-swagger-graphql-contracts/metadata.yaml`
- PRD: None
- metadata_alignment: aligned
- prd_alignment: not-applicable
- spec_alignment: aligned
- Metadata/PRD-driven task constraints: Preserve `hybrid` OpenSpec authority, `interactive` approval gates, strict TDD, active `DES-DEP-001 R1`, `REQ-TOOL-013 R2`, existing `api_swagger`/`api_graphql` public contracts, and the requirement that API Tools own the two official Pi runtime package declarations without sibling-extension or custom resolver fallback.
- Metadata/PRD/spec gaps/conflicts_detected before apply: None

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 180-420 |
| 400-line budget risk | Medium |
| Suggested task split | No — one bounded dependency-remediation packet covering package ownership, direct-import adapter cleanup, static guardrails, and regression validation |
| Delivery strategy | single-batch |

Decision needed before apply: No
Suggested task split: No
400-line budget risk: Medium

### Suggested Work Units
| Unit | Goal | Suggested task range | Notes |
|------|------|----------------------|-------|
| A | Re-establish package ownership and fail first on stale dependency-contract assumptions | 1.1-1.3 | `package.json`, `package-lock.json`, `test/render.test.ts` |
| B | Remove sibling/custom Pi runtime resolution and keep renderer imports stable | 2.1-2.2 | `src/pi-runtime.ts`, `src/render.ts` |
| C | Re-run focused and full package validation, leaving manual Pi reload evidence to verify | 3.1-3.3 | `npm test`, `npm run typecheck`, manual review deferred |

## Implementation Map Coverage
| Task/Phase | Map path/symbol/validation reference | Coverage notes |
|------------|--------------------------------------|----------------|
| 1.1 | `extensions/api-tools/package.json`, `extensions/api-tools/package-lock.json`, `REQ-TOOL-013 R2`, `DES-DEP-001 R1` | Add only `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` as API Tools-owned peer declarations plus matching package-local development installs and lockfile entries. |
| 1.2 | `extensions/api-tools/test/render.test.ts`, `extensions/api-tools/src/pi-runtime.ts`, symbol `resolvePackage` | RED static assertions must fail while `createRequire`, `searchPaths`, sibling `context7`, filesystem probing, or missing package ownership remain. |
| 1.3 | `cd extensions/api-tools && npm test -- --run test/render.test.ts`, `npm run typecheck` | Establish current failing baseline for the dependency-contract remediation without reopening unrelated behavior. |
| 2.1 | `extensions/api-tools/src/pi-runtime.ts`, symbol `resolvePackage`; `extensions/api-tools/src/render.ts`, symbol `renderApiToolResult` | Replace the custom resolver with direct bare imports from the two official Pi runtime packages while preserving the local adapter seam used by renderers/tests. |
| 2.2 | `extensions/api-tools/test/render.test.ts`, `extensions/api-tools/package.json`, `extensions/api-tools/package-lock.json` | GREEN static/package-boundary assertions: no sibling/custom resolution, no arbitrary package additions, renderer still imports only `./pi-runtime.js`. |
| 3.1 | `cd extensions/api-tools && npm test -- --run test/render.test.ts` | Focused GREEN evidence for the dependency-contract slice. |
| 3.2 | `cd extensions/api-tools && npm test`, `cd extensions/api-tools && npm run typecheck` | Full package regression and type validation after package-contract changes. |
| 3.3 | Manual Pi reload / collapsed-expanded renderer review | Verify-phase evidence only; keep unchecked until `formal_sdd_verify`. |

## Security Task Coverage
| Security Requirement | Implementation Task | Validation Task | Result |
|---|---|---|---|
| `REQ-TOOL-013 R2` package-boundary dependency contract | 1.1, 2.1 | 1.2, 2.2, 3.1, 3.2 | covered |
| `REQ-REN-001`-`REQ-REN-004` renderer adapter continuity without sibling borrowing | 2.1 | 2.2, 3.1, 3.3 | covered |
| Existing `REQ-SEC-*` and bounded-output controls remain unchanged by this packet | not-applicable for new implementation work beyond regression protection | 3.2 regression suite | not-applicable |

## Pre-Apply Traceability
| PRD requirement (if in scope) | Active spec requirement/scenario revision | Active design decision/control revision | Implementation task | Acceptance criterion | Planned validation evidence | Result |
|---|---|---|---|---|---|---|
| None | `REQ-TOOL-013 R2`, `SCN-TOOL-018` | `DES-DEP-001 R1` | 1.1, 2.1, 2.2 | API Tools owns the two official Pi runtime packages and `src/pi-runtime.ts` resolves them only through direct package imports | `package.json`/`package-lock.json` review, `test/render.test.ts`, `npm run typecheck` | aligned |
| None | `REQ-REN-001`-`REQ-REN-004` (`R1`) | `DES-REN-001 R1`, `DES-DEP-001 R1` | 2.1, 2.2 | Renderer continues to use the local adapter seam and Pi-owned expansion hints after resolver cleanup | `test/render.test.ts`, manual Pi review in verify | aligned |
| None | `REQ-TOOL-011` retained public behavior, plus unchanged Swagger/GraphQL contracts | `DES-ARCH-001 R1` | 3.2 | Dependency remediation does not regress the existing extension test/type surface | `npm test`, `npm run typecheck` | aligned |

Overall pre-apply traceability: aligned
Apply-ready packet revision: `dependency-contract-task-20260725T063500Z-v1`

## Phase 1: Foundation
- [x] 1.1 Update `extensions/api-tools/package.json` and `extensions/api-tools/package-lock.json` to declare only `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` as API Tools-owned peer dependencies plus matching package-local development installs required by `DES-DEP-001 R1`.
- [x] 1.2 RED: tighten `extensions/api-tools/test/render.test.ts` so the dependency-contract slice fails while `extensions/api-tools/src/pi-runtime.ts` still uses `createRequire`, `searchPaths`, sibling `../../context7/`, filesystem probing, or missing package ownership.
- [x] 1.3 Run focused baseline validation from `extensions/api-tools`: `npm test -- --run test/render.test.ts` and `npm run typecheck`, recording the expected RED evidence before production edits.

## Phase 2: Implementation
- [x] 2.1 Replace `extensions/api-tools/src/pi-runtime.ts` custom package resolution (`resolvePackage`, `searchPaths`, `createRequire`, filesystem fallback) with direct bare imports from `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui`, while preserving the adapter exports consumed by `src/render.ts`.
- [x] 2.2 GREEN: update any affected static assertions in `extensions/api-tools/test/render.test.ts` and confirm `extensions/api-tools/src/render.ts` still imports only `./pi-runtime.js`, with no sibling-extension path or arbitrary dependency regression.

## Phase 3: Testing / Verification
- [x] 3.1 Run focused GREEN validation: `cd extensions/api-tools && npm test -- --run test/render.test.ts`.
- [x] 3.2 Run full package regression validation: `cd extensions/api-tools && npm test` and `cd extensions/api-tools && npm run typecheck`.
- [ ] 3.3 Reload Pi and manually review collapsed/expanded API tool rendering after the package-contract remediation; defer this evidence to `formal_sdd_verify` if apply completes without live Pi access.
