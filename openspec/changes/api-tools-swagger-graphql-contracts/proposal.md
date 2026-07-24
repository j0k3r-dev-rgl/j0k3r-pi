# Proposal: Conditional API Tools, Rendering, and Lossless Output Contracts

## Intent

Replace three legacy GraphQL tools with exactly two independently enabled API-contract tools, `api_swagger` and `api_graphql`, while adding native Pi rendering and session-bound lossless bounded output. Preserve the configured API trust boundary, keep internal filesystem paths private, and add no dependency.

## Scope

### In Scope

- Add explicit `swagger` and `graphql` configuration blocks with independent enablement.
- Register `api_swagger` and `api_graphql` only when their corresponding block is enabled.
- Remove `api_graphql_query`, `api_graphql_schema_queries`, and `api_graphql_schema_query`.
- Define exact action contracts for Swagger discovery/schema/request and GraphQL discovery/schema/execution.
- Add bounded first-page output and same-tool continuation backed by redacted session-owned temporary artifacts.
- Add native-compatible collapsed/expanded Pi rendering.
- Harden effective Swagger and GraphQL URLs to the configured REST origin and base path.
- Allow `api_status` to report only safe additive enablement/framework state.

### Out of Scope

- Changes to `api_auth_status`, `api_login`, or `api_rest_request` public behavior or schema.
- `api_status` disclosure of integration URLs, credentials, schemas, headers, cursor state, or internal paths.
- A third continuation/artifact tool, public artifact paths, or cross-session cursor recovery.
- YAML OpenAPI documents, generated clients, GraphQL subscriptions/schema mutation, arbitrary endpoint scanning, or OpenAPI `servers` routing.
- New runtime or development dependencies.

## Capabilities

### New Capabilities

- `conditional-api-contract-tools`: Expose exactly two independent opt-in tools with explicit framework, endpoint, action, and migration contracts.
- `lossless-bounded-api-results`: Return complete fitting results or a bounded first redacted chunk plus an opaque session-bound cursor that reconstructs the immutable redacted result without skips or duplicates.
- `native-api-tool-rendering`: Render partial, success, failure, empty, and continuation states in collapsed and expanded Pi tool rows while Pi owns expansion state and key hints.
- `api-contract-endpoint-security`: Keep Swagger and GraphQL fetches and executions inside the configured REST origin/base path, reject unsafe URLs, redact before persistence, and contain cursor artifacts.

### Modified Capabilities

- `api-status`: May add only `swagger` and `graphql` state objects containing `enabled` and, when enabled, `framework`; all sensitive or operational integration details remain excluded.

## Approach

### Configuration and URL precedence

Each optional block has `enabled: boolean`, `framework: "spring" | "node"`, and optional `url: string`. `framework` is required when `enabled` is `true`; missing or unsupported values are configuration errors. A missing block or `enabled: false` does not register its tool.

Swagger document URL precedence is exact:

1. When `swagger.url` is present, validate and use it for either framework.
2. Otherwise, `spring` requests `/v3/api-docs`; only a missing, non-successful, non-JSON, or invalid OpenAPI result permits one `/v2/api-docs` fallback.
3. Otherwise, `node` returns a recoverable configuration error requiring `swagger.url`; it performs no discovery scan.

GraphQL endpoint precedence is exact for both frameworks:

1. `graphql.url` when present.
2. Legacy `graphql_url` only when `graphql.enabled === true`.
3. `/graphql` resolved beneath the configured REST base URL.
4. If no valid REST base exists, return a recoverable configuration error.

All explicit and derived URLs must be HTTP(S), contain no userinfo/control characters/traversal, remain same-origin and within the configured REST base path, and preserve the existing redirect policy. Swagger operation execution ignores document `servers` and uses the configured REST origin.

### Public tool contracts

`api_swagger` has exactly these actions:

- `discover`: fetch and validate the configured/default JSON document, then return a bounded summary of document identity, tags, and operations; optional operation/tag filters may reduce output.
- `schema`: return the bounded schema/operation contract selected by operation identifier, with an optional bounded `max_depth`.
- `request`: require HTTP `method` and relative `path`, accept existing safe headers/body/token options, and execute through the REST request boundary.

`api_graphql` has exactly these actions:

- `discover`: introspect and return a bounded overview of available query/mutation operation names and types; filters may reduce output.
- `schema`: require a type/operation `name` and return its bounded contract with optional bounded `max_depth`.
- `execute`: require `query`; accept variables, operation name, safe headers, and token use, then execute against the hardened effective GraphQL endpoint.

Both tools require `action`. Both accept optional `cursor`. Without `cursor`, the selected action executes normally. With `cursor`, the same tool reads the next chunk of the original result without network re-execution; the action must match the cursor's bound tool/action, and execution-specific inputs are rejected. No third public tool is added.

### Session-bound continuation and rendering

Complete results within configured byte/line limits are returned directly. Oversized results are recursively redacted first, serialized once to an immutable artifact beneath an unguessable extension-owned temporary directory, and returned as a bounded first chunk with safe range/count metadata, `has_more`, and opaque random `next_cursor`. Public `content`, `details`, cursor payloads, errors, and renderers never contain `artifact_path` or any internal filesystem path.

Cursor registry state is owned by the active Pi session. Cursors are tool/action/session-bound, expire after a bounded lifetime, and advance by deterministic byte/line offsets. Invalid, expired, wrong-tool, or prior-session cursors return recoverable typed errors. Extension reload or process restart invalidates old cursors; stale startup cleanup only removes crash leftovers and does not restore continuation. `session_shutdown` idempotently removes registry entries and temporary artifacts.

Both tools share a native-compatible `renderResult`. Collapsed output shows status, action, useful identity/counts, continuation state, and Pi's runtime-owned expansion hint. Expanded output shows every model-facing value in the current chunk plus safe metadata, width-wrapped. Rendering never reads artifacts directly, changes continuation state, reveals internal paths, hard-codes a physical key, or adds a package.

## Metadata and PRD Alignment

- Metadata: `openspec/changes/api-tools-swagger-graphql-contracts/metadata.yaml`
- PRD: None (`prd_policy: waived`)
- metadata_alignment: aligned
- prd_alignment: not-applicable
- spec_alignment: not-applicable (spec not yet produced)
- Requirements/context carried forward: exactly two independently enabled replacement tools; four retained tools except safe additive `api_status` fields; Spring/Node framework contracts and URL precedence; REST-equivalent endpoint hardening; configured-origin Swagger execution; redaction before persistence; session-bound continuation; private internal paths; native Pi-owned expansion; strict TDD; no new dependency.
- Metadata/PRD conflicts_detected: None.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `extensions/api-tools/src/types.ts` | Modified | Configuration, action, result, status, continuation, and renderer contracts. |
| `extensions/api-tools/src/config.ts` | Modified | Independent blocks, required enabled-framework validation, and endpoint precedence. |
| `extensions/api-tools/src/client.ts` | Modified | Swagger fetch boundary and REST-equivalent GraphQL URL construction. |
| `extensions/api-tools/src/security.ts` | Modified | Redaction-before-persistence and bounded chunk integration. |
| `extensions/api-tools/src/tools.ts` | Modified | Legacy removal, conditional registration, exact dispatch, safe status fields, rendering, and lifecycle wiring. |
| `extensions/api-tools/src/swagger.ts` | New | Swagger discovery, filtering/schema inspection, and configured-origin request execution. |
| `extensions/api-tools/src/graphql.ts` | New | GraphQL discovery/schema inspection and execution. |
| `extensions/api-tools/src/continuation.ts` | New | Session registry, opaque cursors, redacted artifacts, expiry, containment, and cleanup. |
| `extensions/api-tools/src/render.ts` | New | Collapsed/expanded native-compatible rendering. |
| `extensions/api-tools/test/config.test.ts` | Modified | Configuration and URL precedence cases. |
| `extensions/api-tools/test/client.test.ts` | Modified | Swagger/GraphQL URL and network-boundary cases. |
| `extensions/api-tools/test/tools.test.ts` | Modified | Registration, exact actions, status exposure, dispatch, migration, and redaction. |
| `extensions/api-tools/test/continuation.test.ts` | New | Reconstruction, cursor ownership/expiry/session invalidation, containment, and cleanup. |
| `extensions/api-tools/test/render.test.ts` | New | Partial/success/failure/empty/continuation and width safety. |
| `extensions/api-tools/README.md` | Modified | Configuration, migration, tools/actions, continuation lifecycle, rendering, and security. |

## Security / Privacy Impact

- Impact: applicable.
- Trust boundaries, sensitive data, permissions, secrets, external calls, input validation, or dependencies affected: both integrations make external calls inside the configured REST trust boundary; URLs, redirects, userinfo, traversal, control characters, base-path containment, and provider errors need validation; payloads may contain secrets and must be redacted before model output or disk; temporary files require unguessable names, ownership, path/symlink containment, expiry, and cleanup; cursors must be session/tool/action-bound; no dependency is added.
- Required security follow-up for spec/design/tasks: normative rejection and redirect scenarios, exact cursor errors/expiry/bounds, path and symlink defenses, redaction invariants, artifact permissions, output budgets, cancellation propagation, and executable abuse/failure tests.

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Legacy GraphQL callers break after removal | High | Document one-to-one action migration and require reload; retain no ambiguous aliases. |
| Hardened GraphQL URLs reject existing cross-origin configuration | Medium | Document the intentional boundary and return actionable recoverable errors. |
| Temporary artifacts expose data or accumulate after crashes | Low | Redact first; use contained unguessable paths, restrictive permissions, bounded expiry, startup stale cleanup, and idempotent shutdown. |
| Cursor chunks skip, duplicate, or cross sessions | Low | Bind opaque registry cursors to immutable artifacts and deterministic offsets; test full reconstruction and invalidation. |
| Swagger fallback accepts an unrelated JSON endpoint | Medium | Require an OpenAPI/Swagger marker and allow exactly one Spring fallback. |
| Renderer diverges from Pi width/key behavior | Medium | Use installed callback contracts, Pi-owned hints, width tests, and manual collapsed/expanded review. |

## Rollback Plan

Revert the new configuration parsing, status additions, conditional registrations, renderer/lifecycle wiring, and new modules; restore the three legacy GraphQL registrations and their supported tests. Remove/disable the new blocks, delete extension-owned temporary artifacts, and reload Pi. No durable user data or dependency migration is involved.

## Dependencies

- Existing Pi extension lifecycle and renderer APIs.
- Existing API Tools REST URL validation, redaction, limits, authentication, timeout, and cancellation behavior.
- Node standard-library filesystem, temporary-directory, and cryptographic-randomness APIs.
- No new package dependency.

## Success Criteria

- [ ] Only `api_swagger` and `api_graphql` are added, each solely by its explicit enabled block; `graphql_url` alone never enables GraphQL.
- [ ] Enabled blocks require `framework: spring | node`, and URL precedence/default/error behavior matches this proposal exactly.
- [ ] `api_swagger` exposes only `discover | schema | request`; `api_graphql` exposes only `discover | schema | execute`; responsibilities and required inputs match this proposal.
- [ ] The three legacy GraphQL tools are removed; `api_auth_status`, `api_login`, and `api_rest_request` remain unchanged.
- [ ] `api_status` adds at most enabled/framework state and never exposes URLs, credentials, schemas, headers, cursors, artifacts, or paths.
- [ ] Swagger execution ignores document servers; all Swagger and GraphQL calls remain same-origin and base-path-contained with REST-equivalent validation.
- [ ] Oversized results return a bounded first redacted chunk and opaque same-tool cursor; continuation reconstructs the immutable redacted result without loss or duplication.
- [ ] Reload/restart invalidates prior cursors recoverably; shutdown cleanup is idempotent; stale startup cleanup is crash defense only.
- [ ] No public result, detail, error, renderer, or cursor contains `artifact_path` or another internal filesystem path.
- [ ] Collapsed/expanded renderers cover partial, success, failure, empty, and continuation states, use Pi-owned expansion hints, and remain width-safe.
- [ ] Strict RED-GREEN-REFACTOR evidence, focused/full tests, typecheck, package validation, renderer review, continuation verification, and independent security/public-contract verification pass without a new dependency.
