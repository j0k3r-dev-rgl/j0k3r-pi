# Implementation Map: Conditional API Tools, Rendering, and Lossless Output Contracts

## Purpose

Operational handoff for downstream SDD phases. This map is non-normative; `metadata.yaml`, `spec.md`, `design.md`, and eventual `tasks.md` take precedence. The earlier `api_status` compatibility/privacy blocker is resolved in the remediated spec and active design decision `DES-STS-001 R1`; the packet is ready for task planning.

## Explored Files

| Path | Status | Relevance | Key symbols / findings |
|------|--------|-----------|------------------------|
| `extensions/api-tools/index.ts` | Read | Entrypoint | `registerApiTools`; thin composition root, no expected change beyond possible re-export. |
| `extensions/api-tools/src/types.ts` | Read | Contracts | `ApiToolsConfig`, `ApiToolResult`, `ApiTruncationMetadata`; add integration/status/continuation/renderer types. |
| `extensions/api-tools/src/config.ts` | Read | Configuration | `loadApiConfig`, `parseAuth`, `parseLimits`; add blocks and exact endpoint precedence. |
| `extensions/api-tools/src/client.ts` | Read | Network boundary | `createApiClient`, `rest`, `graphql`, `buildRestUrl`; GraphQL currently lacks REST-equivalent validation. |
| `extensions/api-tools/src/security.ts` | Read | Redaction/bounds | `applyOutputTruncation`, `redactToolResult`, `redactDeep`; current truncation discards the remainder. |
| `extensions/api-tools/src/tools.ts` | Read | Registration/dispatch | `registerApiTools`, `API_TOOL_NAMES`, response and execution helpers; currently registers seven tools. |
| `extensions/api-tools/src/git.ts` | Read | Git exposure | `createApiJsonGitInspector`; unchanged. |
| `extensions/api-tools/test/config.test.ts` | Read | Config tests | Extend for enabled/framework validation and URL precedence. |
| `extensions/api-tools/test/client.test.ts` | Read | Client tests | Add Swagger fetch and hardened GraphQL URL cases. |
| `extensions/api-tools/test/tools.test.ts` | Read | Public contracts | Replace legacy GraphQL cases; add registration, action, status, and migration cases. |
| `extensions/api-tools/test/security.test.ts` | Read | Security tests | Retain truncation/redaction coverage; continuation receives a cohesive new suite. |
| `examples/extensions/truncated-tool.ts` | Missing during design | Stale exploration reference | The mapped file no longer exists; do not use it as implementation evidence. |
| `extensions/websearch/src/render/index.ts` | Read | Negative renderer reference | Has useful wrapping code but hard-codes `ctrl+o`, so it is not suitable for this spec. |
| `extensions/code-research/src/render.ts` | Read | Negative renderer reference | Uses a plain component but hard-codes `ctrl+o`; do not copy its key hint behavior. |
| `extensions/context7/src/render/index.ts` | Read | Native renderer reference | Version-compatible `keyHint('app.tools.expand', ...)`, runtime-owned `expanded`/`isPartial`, Pi TUI `Text`. |
| `extensions/agent-todo/index.ts` | Read | Lifecycle reference | Confirms `pi.on?.('session_start', ...)` and idempotent `session_shutdown` registration pattern. |
| Installed/project Pi keybinding documentation | Read | Runtime contract | `app.tools.expand` is the namespaced action; physical default is not part of renderer logic. |

## Scope-Confirmed Files

| Path | Impact | Expected change | Owner phase |
|------|--------|-----------------|-------------|
| `extensions/api-tools/src/types.ts` | Modified | Add Swagger/GraphQL config, exact action inputs, safe status state, continuation metadata, and renderer types. | spec/design |
| `extensions/api-tools/src/config.ts` | Modified | Parse independent blocks; require framework when enabled; implement exact Swagger/GraphQL URL precedence. | design/task |
| `extensions/api-tools/src/client.ts` | Modified | Add Swagger document fetch; apply same-origin/base-path/userinfo/traversal/control-character and redirect policy to GraphQL. | design/task |
| `extensions/api-tools/src/security.ts` | Modified | Guarantee recursive redaction before persistence and preserve bounded per-chunk metadata. | design/task |
| `extensions/api-tools/src/tools.ts` | Modified | Replace public registrations; exact action dispatch; same-tool cursor input; preserve safe non-URL `api_status` behavior while removing URL fields and adding integration state; renderer/lifecycle wiring. | design/task |
| `extensions/api-tools/src/swagger.ts` | New | JSON discovery, validation, filtering/schema inspection, and configured-origin request execution. | design/task |
| `extensions/api-tools/src/graphql.ts` | New | Introspection discovery/schema and hardened execution. | design/task |
| `extensions/api-tools/src/continuation.ts` | New | Session registry, opaque random cursors, immutable redacted artifacts, offsets, expiry, containment, and cleanup. | design/task |
| `extensions/api-tools/src/render.ts` | New | Shared collapsed/expanded renderer for partial/success/failure/empty/continuation states. | design/task |
| `extensions/api-tools/test/config.test.ts` | Modified | Block validation, registration prerequisites, URL precedence/default/failure cases. | task/apply |
| `extensions/api-tools/test/client.test.ts` | Modified | Swagger/GraphQL origin, base-path, userinfo, traversal, control-character, and redirect cases. | task/apply |
| `extensions/api-tools/test/tools.test.ts` | Modified | Registration matrix, exact action schemas/dispatch, safe status exposure, migration, and redaction. | task/apply |
| `extensions/api-tools/test/security.test.ts` | Modified | Preserve exact-secret/schema-name redaction and add budget clamp/UTF-8 boundary coverage. | task/apply |
| `extensions/api-tools/test/swagger.test.ts` | New | Swagger discover/schema/request, filtering, fallback, no-scan, and configured-origin behavior. | task/apply |
| `extensions/api-tools/test/graphql.test.ts` | New | GraphQL discover/schema/execute, filtering, depth, variables, and endpoint behavior. | task/apply |
| `extensions/api-tools/test/continuation.test.ts` | New | First chunk, reconstruction, ownership, expiry, replay, reload invalidation, path privacy/containment, and cleanup. | task/apply |
| `extensions/api-tools/test/render.test.ts` | New | Collapsed/expanded/partial/error/empty/continuation and width-safe output. | task/apply |
| `extensions/api-tools/README.md` | Modified | Public configuration, tools/actions, migration, continuation lifecycle, rendering, limits, and security. | task/apply |

## Relevant Symbols

| Symbol | Path | Why it matters |
|--------|------|----------------|
| `registerApiTools` | `extensions/api-tools/src/tools.ts` | Main registration and lifecycle wiring point. |
| `API_TOOL_NAMES` | `extensions/api-tools/src/tools.ts` | Must represent four retained tools plus independently conditional replacements. |
| `loadApiConfig` | `extensions/api-tools/src/config.ts` | Owns enabled/framework validation and endpoint precedence. |
| `createApiClient`, `rest`, `graphql`, `buildRestUrl` | `extensions/api-tools/src/client.ts` | Shared network trust boundary to extend and harden. |
| `applyOutputTruncation` | `extensions/api-tools/src/security.ts` | Supplies bounded chunk metadata without becoming destructive. |
| `redactToolResult`, `redactDeep` | `extensions/api-tools/src/security.ts` | Must precede public return and artifact persistence. |
| `buildResponseData` | `extensions/api-tools/src/tools.ts` | Candidate integration point for safe continuation metadata. |
| Existing GraphQL execution helpers | `extensions/api-tools/src/tools.ts` | Extract/adapt to `extensions/api-tools/src/graphql.ts`; remove obsolete public wrappers. |
| `buildStatusResult` | `extensions/api-tools/src/tools.ts` | Implement `DES-STS-001 R1`: retain safe non-URL status fields/configured booleans, remove URL strings, and add exact integration state. |
| `renderContext7ToolResult` | `extensions/context7/src/render/index.ts` | Verified installed Pi pattern for native `keyHint`, runtime expansion, partial state, and `Text`. |
| `agentTodoExtension` lifecycle handlers | `extensions/agent-todo/index.ts` | Verified `session_start`/`session_shutdown` hook pattern for continuation ownership and cleanup. |

## Design Decisions and Blocker Resolution

Active design decisions are defined in `design.md` as `DES-ARCH-001 R1`, `DES-NET-001 R1`, `DES-SCH-001 R1`, `DES-OUT-001 R1`, `DES-CUR-001 R1`, `DES-FS-001 R1`, `DES-LIFE-001 R1`, `DES-REN-001 R1`, `DES-TDD-001 R1`, and `DES-STS-001 R1`. No supersession links exist.

The prior design blocker is resolved:

- `REQ-TOOL-011` preserves `api_auth_status`, `api_login`, and `api_rest_request` unchanged.
- `DES-STS-001 R1` preserves safe non-URL `api_status` behavior and configured-state booleans while removing `endpoints.rest_url`, `endpoints.graphql_url`, and equivalent URL/origin/path disclosures.
- `REQ-STS-001` through `REQ-STS-003` permit only safe per-integration `enabled` and valid `framework` state. Invalid framework values stay out of status and are represented by the existing safe warning channel.

No design blocker remains; downstream tasks must reference active decision revisions only.

## Proposal-Confirmed Contracts

### Configuration and URLs

- Public blocks are `swagger` and `graphql`, each with `enabled`, `framework: spring | node`, and optional `url`; enabled blocks require a valid framework.
- `graphql_url` is only the second-priority URL source after `graphql.url` and only when GraphQL is explicitly enabled.
- Spring Swagger: explicit URL, otherwise `/v3/api-docs`, then one `/v2/api-docs` fallback after missing/non-success/invalid JSON or document.
- Node Swagger: explicit URL required; no route scan.
- Spring and Node GraphQL: explicit block URL, then legacy URL, then `/graphql` under the REST base.
- Swagger operation requests ignore OpenAPI `servers`; Swagger and GraphQL remain same-origin/base-path-contained and retain REST-equivalent URL/redirect protections.

### Public tools and status

- `api_swagger` actions are exactly `discover`, `schema`, and `request`.
- `api_graphql` actions are exactly `discover`, `schema`, and `execute`.
- `discover` returns bounded contract summaries; `schema` returns a selected bounded contract and supports bounded depth/filtering where applicable; request/execute perform network calls with existing authentication, timeout, cancellation, redaction, and error behavior.
- Both tools accept optional same-tool `cursor`; cursor use does not repeat the network request and rejects mismatched action/tool or execution arguments.
- Remove `api_graphql_query`, `api_graphql_schema_queries`, and `api_graphql_schema_query`.
- Preserve `api_auth_status`, `api_login`, and `api_rest_request` public behavior.
- `api_status` may add only per-integration `enabled` and enabled `framework`; no URLs, credentials, headers, schemas, cursors, artifacts, or paths.

### Continuation and rendering

- Redact the complete oversized result before writing one immutable artifact.
- Return a bounded first chunk, safe range/count metadata, `has_more`, and opaque random `next_cursor`.
- Bind cursors to session, tool, action, artifact, deterministic offset, and bounded expiry.
- Reload/restart invalidates old cursors with recoverable invalid-session/expired errors; stale startup cleanup is crash defense, not cursor restoration.
- `session_shutdown` deletes registry state and artifacts idempotently.
- Never expose `artifact_path` or any internal filesystem path in public content, details, errors, cursor data, or rendering.
- Rendering uses Pi-owned expansion state/hints, shows all current model-facing chunk content when expanded, handles all states, and adds no dependency.

## Constraints and Security Handoff

- No new dependency, third public tool, arbitrary endpoint scanning, cross-origin compatibility, OpenAPI `servers` routing, hard-coded expansion key, or custom expansion state.
- Preserve timeout and `AbortSignal` propagation; cancellation must not become a normal provider failure.
- Specify URL userinfo, traversal, control-character, same-origin, base-path, redirect, and invalid-document behavior normatively.
- Specify recursive redaction invariants, artifact permissions, unguessable names, symlink/realpath containment, bounded expiry, cursor ownership, and recoverable typed errors.
- Keep schema metadata names unless they contain actual configured secret values; do not over-redact merely secret-like field names.

## Rejected Paths

- Silent truncation.
- Public artifact paths or a third artifact-retrieval tool.
- In-memory-only output with no immutable redacted artifact.
- Cursor survival across reload/restart.
- Stale-startup artifact recovery as a continuation mechanism.
- OpenAPI `servers`, cross-origin GraphQL compatibility, route scanning, hard-coded keys, or new packages.

## Test and Validation Map

| Command / evidence | Purpose |
|--------------------|---------|
| `cd extensions/api-tools && npm test` | Focused and complete extension test suite after each meaningful TDD step. |
| `cd extensions/api-tools && npm run typecheck` | TypeScript contract validation. |
| No separate package validation script exists in `extensions/api-tools/package.json` | Use `npm test` and `npm run typecheck`; validate dependency/lockfile stability by diff/static review. |
| `extensions/api-tools/test/config.test.ts` | Config validation and endpoint precedence. |
| `extensions/api-tools/test/client.test.ts` | Network trust boundary and redirect behavior. |
| `extensions/api-tools/test/tools.test.ts` | Registration, exact actions, safe status, migration, redaction, errors. |
| `extensions/api-tools/test/continuation.test.ts` | Lossless reconstruction, session invalidation, privacy, containment, cleanup. |
| `extensions/api-tools/test/render.test.ts` | Native collapsed/expanded behavior and width safety. |
| Manual native renderer review | Collapsed/expanded key hint, partial, empty, failure, and continuation presentation. |
| Independent security/public-contract verification | Confirm no path/secret leakage and exact external contracts. |

Baseline evidence inherited from exploration: 32 tests passed and typecheck was clean before implementation. Downstream apply must establish fresh baseline/RED/GREEN/REFACTOR evidence rather than treating this historical count as current.

## Remaining Gaps for Spec

The earlier schema/test-path remediation gaps are closed, and the design-discovered `api_status` contradiction is resolved in the current `spec.md` and `DES-STS-001 R1`. No normative gap blocks task planning.

Previously closed gaps remain:

- Stable requirement/scenario identifiers assigned, including new `REQ-SCH-*` input-schema requirements and `REQ-OUT-008`–`REQ-OUT-012` output/continuation requirements.
- Exact TypeBox-compatible public input schemas with `additionalProperties: false`, action branches, filter fields, and bounded `max_depth` defined.
- Unknown-input policy enforced by strict schemas and `validation_error` recoverable typed errors.
- Cursor mutual exclusions defined: only `action` and `cursor` are accepted during continuation.
- Precise output/details envelope fields, continuation metadata, and path-free invariants defined.
- Byte/line budget semantics, safe default bounds, and chunk-boundary rules defined.
- Cursor TTL (default 3,600 s, max 86,400 s) and session ownership defined.
- Typed recoverable cursor errors (`cursor_invalid`, `cursor_expired`, `cursor_wrong_tool`, `cursor_wrong_action`, `cursor_execution_inputs_rejected`) defined.
- Redirect continuity, artifact containment/permissions, cancellation propagation, and abuse/failure scenarios already specified in `REQ-SEC-*` and `REQ-URL-*`.
- Acceptance/testability matrix and deterministic archive capability mapping completed.

## Spec Trace Notes

The normative change specification is `openspec/changes/api-tools-swagger-graphql-contracts/spec.md`. The following requirement-to-test trace notes are confirmed by the specification:

- `REQ-CFG-*` → `extensions/api-tools/test/config.test.ts`.
- `REQ-URL-*` → `extensions/api-tools/test/client.test.ts`.
- `REQ-TOOL-001`–`REQ-TOOL-003`, `REQ-TOOL-010`–`REQ-TOOL-011` → `extensions/api-tools/test/tools.test.ts`.
- `REQ-TOOL-004`–`REQ-TOOL-006` and `SCN-TOOL-005`–`SCN-TOOL-010` → `extensions/api-tools/test/swagger.test.ts` (new).
- `REQ-TOOL-007`–`REQ-TOOL-009` and `SCN-TOOL-011`–`SCN-TOOL-014` → `extensions/api-tools/test/graphql.test.ts` (new).
- `REQ-OUT-*` and `REQ-SEC-006`–`REQ-SEC-011` → `extensions/api-tools/test/continuation.test.ts` (new).
- `REQ-SCH-*` and `SCN-SCH-*` → `extensions/api-tools/test/tools.test.ts`, `extensions/api-tools/test/swagger.test.ts` (new), and `extensions/api-tools/test/graphql.test.ts` (new).
- `REQ-OUT-008`–`REQ-OUT-012` and `SCN-OUT-011`–`SCN-OUT-020` → `extensions/api-tools/test/continuation.test.ts` (new).
- `REQ-REN-*` → `extensions/api-tools/test/render.test.ts` (new).
- `REQ-STS-*` → `extensions/api-tools/test/tools.test.ts`.
- `REQ-SEC-001`–`REQ-SEC-005`, `REQ-SEC-012` → `extensions/api-tools/test/client.test.ts` and `extensions/api-tools/test/security.test.ts`.
- Archive capability targets:
  - `conditional-api-contract-tools` → `openspec/specs/conditional-api-contract-tools/spec.md` (add).
  - `lossless-bounded-api-results` → `openspec/specs/lossless-bounded-api-results/spec.md` (add).
  - `native-api-tool-rendering` → `openspec/specs/native-api-tool-rendering/spec.md` (add).
  - `api-contract-endpoint-security` → `openspec/specs/api-contract-endpoint-security/spec.md` (add).
  - `api-status` → `openspec/specs/api-status/spec.md` (modify).

## Handoff Notes

- Proposal decisions supersede exploration statements that claimed reload-surviving continuation or public `artifact_path` metadata.
- All implementation and documentation paths are workspace-relative under `extensions/api-tools/...`.
- No source code, tests, README, package, dependency, or runtime validation was changed or executed during proposal remediation.
- Proposal: `openspec/changes/api-tools-swagger-graphql-contracts/proposal.md`.
- Exploration: `openspec/changes/api-tools-swagger-graphql-contracts/exploration.md`.
- Specification: `openspec/changes/api-tools-swagger-graphql-contracts/spec.md`.
- OpenSpec is authoritative; Engram is a compact cursor only.
- Current design artifact: `openspec/changes/api-tools-swagger-graphql-contracts/design.md`.
- Current phase result: design rerun completed against the remediated `api_status` contract; all active decisions are aligned and no supersession links are unresolved.
- Next step: obtain revision-bound task-phase authorization, then run `sdd-task`; apply remains separately approval-gated.
