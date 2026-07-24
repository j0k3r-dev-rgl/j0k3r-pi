# Design: Conditional API Tools, Rendering, and Lossless Output Contracts

## Technical Approach

Keep `extensions/api-tools/index.ts` as the thin entrypoint and make `registerApiTools` the composition root for a session-scoped runtime. Split provider-specific contract logic into `swagger.ts` and `graphql.ts`, keep all network URL construction and redirect enforcement in `client.ts`, and route every new tool result through one continuation finalizer that redacts before either public return or disk persistence.

Configuration parsing produces independent Swagger/GraphQL integration states. Invalid enabled blocks remain visible to safe status reporting but are not registered. Tool registration uses strict plain JSON Schema objects compatible with Pi's TypeBox contract: normal action branches explicitly forbid `cursor`, and continuation branches require only the matching `action` plus `cursor` with `additionalProperties: false`.

The current source confirms three architectural seams that must change rather than be bypassed: `createApiClient` is the sole request executor but GraphQL currently uses an unvalidated absolute URL; `applyOutputTruncation` currently destroys the remainder; and `registerApiTools` currently registers all three legacy GraphQL tools unconditionally whenever the overall extension is enabled.

The remediated status contract is implemented at the existing `buildStatusResult` seam: preserve its safe non-URL fields and configured-state booleans, remove `endpoints.rest_url` and `endpoints.graphql_url` (and do not introduce equivalent URL/origin/base-path fields), and add only top-level `swagger`/`graphql` objects with `enabled` plus a valid enabled `framework`. An invalid enabled framework remains a recoverable configuration warning, omits the invalid framework value from status, and prevents that tool from registering.

## Metadata and PRD Alignment

- Metadata: `openspec/changes/api-tools-swagger-graphql-contracts/metadata.yaml`
- PRD: None (`prd_policy: waived`; no `prd.md` exists)
- metadata_alignment: aligned
- prd_alignment: not-applicable
- spec_alignment: aligned
- Metadata/product constraints influencing design: hybrid OpenSpec authority, interactive phase authorization, strict TDD, exactly two independently enabled replacement tools, lossless bounded model output, Pi-owned rendering expansion, no new dependency, session-bound continuation, configured REST origin/base-path containment, and security-driven `api_status` URL-field removal.
- Metadata/PRD/spec conflicts_detected: None. The remediated `REQ-TOOL-011` and `REQ-STS-001` through `REQ-STS-003` explicitly authorize URL-field removal while preserving safe non-URL status behavior.

## Architecture Decisions

| `decision_id` | Revision | Status | `supersedes` | `superseded_by` | Choice | Alternatives considered | Rationale |
|---|---|---|---|---|---|---|---|
| `DES-ARCH-001` | `R1` | active | None | None | Preserve the thin entrypoint and compose config, client, continuation manager, domain modules, renderers, registration, and lifecycle in `registerApiTools`. | Move orchestration into `index.ts`; keep all behavior in `tools.ts`. | Matches the existing extension boundary while preventing `tools.ts` from retaining provider parsing, persistence, rendering, and lifecycle responsibilities. |
| `DES-NET-001` | `R1` | active | None | None | Centralize URL resolution, same-origin/base-path checks, credentials/control/traversal checks, and bounded manual redirect following in `client.ts`; expose dedicated Swagger-document and GraphQL request methods. | Validate URLs independently in `swagger.ts`/`graphql.ts`; rely on fetch automatic redirects. | One enforceable trust boundary prevents provider drift. Automatic redirects cannot prove the redirect target remained in bounds before the next request. |
| `DES-SCH-001` | `R1` | active | None | None | Define each tool schema as a strict `oneOf`: three normal action branches that forbid `cursor`, plus three continuation branches requiring exactly `action` and `cursor`. | One permissive schema plus runtime-only mutual exclusion; add TypeBox dependency. | Schema-level rejection satisfies `REQ-SCH-*`/`REQ-OUT-008` without a new dependency and keeps runtime validation as defense in depth. |
| `DES-OUT-001` | `R1` | active | None | None | Add one session-scoped `ContinuationManager` that receives the complete domain result, recursively redacts it, deterministically serializes model-facing text once, returns fitting output directly, or persists one immutable artifact and issues opaque registry cursors. | Keep destructive truncation; in-memory-only pages; public artifact retrieval tool. | This is the only option consistent with lossless reconstruction, bounded context, no third tool, and no path disclosure. |
| `DES-CUR-001` | `R1` | active | None | None | Represent each opaque random cursor as an in-memory record `{owner, tool, action, artifactId, startOffset, expiresAt}`. Generate a distinct next cursor; replaying an earlier cursor returns the same bytes. Retain artifacts until expiry/session shutdown even after the final chunk. | Cursor encodes path/offset; mutate one cursor in place; delete on final read. | Registry lookup keeps payload opaque and path-free, immutable offsets make replay deterministic, and retention preserves the spec's same-cursor determinism. |
| `DES-FS-001` | `R1` | active | None | None | Create an unguessable extension-owned temporary root with mode `0700`, create artifacts exclusively with `wx`/`0600`, never modify them after close, and verify `lstat` plus `realpath` containment before every read/delete. | Ordinary temp files; registry-only path checks; symlink-following reads. | Enforces confidentiality, immutability, and symlink/path containment before cursor data reaches model output. |
| `DES-LIFE-001` | `R1` | active | None | None | Rotate a non-public random session owner token on session start, lazily initialize if needed, clear the prior registry before rotation, sweep only stale extension-prefixed temp roots as crash defense, and perform idempotent cleanup on `session_shutdown`. | Persist cursor registry across reload; recover stale artifacts; use public filesystem paths as identity. | Extension-local ownership naturally invalidates reload/restart cursors and avoids treating stale files as recoverable session state. |
| `DES-REN-001` | `R1` | active | None | None | Implement one shared native renderer using installed Pi `keyHint('app.tools.expand', ...)` and Pi TUI `Text`; consume runtime `expanded`/`isPartial`, render bounded summaries collapsed, and render all current chunk content plus safe metadata expanded. | Copy hand-written ANSI width code; hard-code `ctrl+o`; custom expansion state. | The installed `context7` renderer proves the version-compatible native contract and avoids duplicated key/width behavior. |
| `DES-TDD-001` | `R1` | active | None | None | Implement in strict behavioral slices: config/registration, network hardening, Swagger, GraphQL, continuation/security, renderer, then documentation; record baseline, RED, GREEN, and refactor evidence for each slice. | Implement all production code before tests; one broad end-state test. | The public contract and security boundary are too broad for trustworthy big-bang validation, and existing package tests provide clear ownership seams. |
| `DES-STS-001` | `R1` | active | None | None | Modify `buildStatusResult` to preserve existing safe non-URL status fields and configured-state booleans, remove endpoint URL strings, and add only per-integration `enabled`/valid `framework` state; invalid framework values are omitted and represented by existing safe warnings. | Keep sanitized URLs; remove the whole `endpoints` object; expose endpoint paths or configuration errors inside integration objects. | This is the narrowest implementation of the user-approved security exception: it removes the prohibited disclosure without erasing unrelated retained status behavior or widening the exact integration objects. |

No decision supersession exists in this design revision. All listed links are non-circular and complete.

## Data Flow

```text
.pi/api.json (trusted project-local config)
        |
        v
loadApiConfig -> validated integration states -> conditional registerApiTools
        |                                          |
        |                                          +--> native renderResult (UI only)
        v
strict action/cursor schema + runtime validation
        |
        +-- cursor mode --> ContinuationManager registry --owner/tool/action check--+
        |                                                                    |
        |                                                                    v
        |                                                        contained immutable artifact
        |                                                                    |
        |                                                        deterministic bounded chunk
        |
        +-- normal mode --> swagger.ts / graphql.ts --> ApiClient boundary
                                                    |    - configured REST origin/base path
                                                    |    - URL/redirect hardening
                                                    |    - timeout + AbortSignal
                                                    v
                                               provider response
                                                    |
                                                    v
                                          domain result construction
                                                    |
                                                    v
                                     recursive redaction (trust boundary)
                                                    |
                                  +-----------------+------------------+
                                  |                                    |
                            fits both budgets                   exceeds either budget
                                  |                                    |
                          direct result, no cursor       serialize once -> private artifact
                                                                       |
                                                            first chunk + opaque cursor
```

Trust boundaries are the project-local configuration file, caller-controlled tool input, provider/network responses, and the extension-owned temporary filesystem area. Renderers consume only already-redacted public result envelopes and never access the cursor registry or filesystem.

## Security Controls and Failure Handling

| Concern | Design Control | Validation Expectation |
|---|---|---|
| Authn/authz | Reuse current configured headers/auth and `use_token`; never persist raw auth outside `.pi/api.json`; Swagger requests and GraphQL execute use the shared client. | Existing auth tests remain green; new request/execute tests prove opt-out and no public token leakage. |
| SSRF/origin/base path | Resolve every explicit/default URL against the configured REST base, require HTTP(S), reject userinfo/control/backslash/dot or encoded traversal, compare normalized origin and path boundary. | `client.test.ts` covers all precedence sources and no-request rejection cases. |
| Redirects | Use bounded `redirect: 'manual'`; validate every `Location` target before issuing the next request; preserve method/body semantics required by the existing REST policy. | Same-origin in-base redirect succeeds; cross-origin/out-of-base redirect is rejected before a second fetch. |
| Swagger document trust | Accept JSON only with `openapi` or `swagger`; Spring performs at most v3 then one v2 attempt; Node without explicit URL returns a safe configuration error; ignore document `servers`. | `swagger.test.ts` and `client.test.ts` verify markers, fallback count, no scans, and configured-origin requests. |
| Input validation | Strict action-specific schemas and equivalent runtime guards; bounded integer `max_depth`; continuation rejects every non-display action input. | Unknown fields/missing required fields return `validation_error`; cursor conflicts return the exact typed code. |
| Secrets/privacy | Apply `redactDeep`/`redactToolResult` to the complete result before serialization or persistence; public errors contain stable code plus safe message only. | Artifact and every public envelope/render path are inspected for configured secrets and internal paths; schema names such as `apiKey: null` remain intact. |
| Artifact confidentiality | `0700` root, `0600` exclusive files, random names, immutable writes, `lstat`/`realpath` containment, no path in cursor or public metadata. | Permission assertions, symlink escape rejection, and serialized path-leak scans in `continuation.test.ts`. |
| Cursor isolation | Random owner token plus tool/action binding, opaque random cursor keys, TTL default 3,600 seconds clamped to 86,400, bounded registry capacity, no network in continuation mode. | Wrong tool/action/session, malformed, expired, replay, and no-network continuation tests. |
| Losslessness/bounds | Clamp bytes to 50,000 and lines to 2,000, split only on UTF-8-safe byte and deterministic line boundaries, retain immutable artifact through TTL. | Concatenated cursor chain byte-equals the redacted artifact with no skips/duplicates; multibyte and line-boundary cases pass. |
| Cancellation | Propagate Pi's `AbortSignal` through Swagger fetch, introspection recursion, GraphQL execution, and REST requests; preserve cancellation classification. | Aborted operations stop and report cancellation rather than provider/timeout failure. |
| Cleanup/crash leftovers | Idempotent session shutdown removes entries/root; startup sweep removes only stale extension-prefixed directories and never rebuilds cursors. | Repeated shutdown succeeds; stale sweep removes eligible leftovers and does not restore continuation. |
| Dependencies | Use Node standard library plus installed Pi APIs already available to workspace extensions. | `package.json`/lockfile dependency diff remains empty; package tests and typecheck pass. |

Failure handling uses stable recoverable envelopes. Configuration/schema/URL failures are `validation_error` or a more specific safe configuration code; provider HTTP failures retain redacted status summaries; cursor failures use exactly `cursor_invalid`, `cursor_expired`, `cursor_wrong_tool`, `cursor_wrong_action`, or `cursor_execution_inputs_rejected`. Internal filesystem errors collapse to a path-free recoverable continuation error and trigger best-effort cleanup.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `extensions/api-tools/index.ts` | No change expected | Keep the thin default export; lifecycle remains reachable through `registerApiTools(pi, options)`. |
| `extensions/api-tools/src/types.ts` | Modify | Add integration config/state, exact action/result/continuation contracts, client operations, errors, and renderer-facing metadata. |
| `extensions/api-tools/src/config.ts` | Modify | Parse independent blocks, validate enabled frameworks, clamp limits/TTL if configured, and retain legacy `graphql_url` only as an explicitly enabled fallback. |
| `extensions/api-tools/src/client.ts` | Modify | Add shared hardened URL resolution, manual redirect validation, Swagger document fetch, hardened GraphQL endpoint execution, and cancellation continuity. |
| `extensions/api-tools/src/security.ts` | Modify | Preserve recursive redaction, add safe budget clamping/UTF-8 helpers, and retire destructive remainder-discarding use from new tools. |
| `extensions/api-tools/src/tools.ts` | Modify | Remove legacy registrations/helpers, define strict schemas, conditionally register replacements, compose domain handlers/continuation/rendering/lifecycle, and implement `DES-STS-001 R1` at `buildStatusResult`. |
| `extensions/api-tools/src/swagger.ts` | Create | Validate/normalize OpenAPI JSON, discover/filter operations, resolve bounded schemas, and adapt configured-origin REST requests. |
| `extensions/api-tools/src/graphql.ts` | Create | Own introspection discovery/schema traversal and execute adaptation over the hardened client. |
| `extensions/api-tools/src/continuation.ts` | Create | Own redaction finalization, serialization, private artifacts, registry cursors, deterministic chunks, TTL, containment, stale sweep, and shutdown. |
| `extensions/api-tools/src/render.ts` | Create | Shared Pi-native collapsed/expanded renderer for both new tools. |
| `extensions/api-tools/test/config.test.ts` | Modify | Add block parsing/framework errors/legacy fallback and limit-bound cases. |
| `extensions/api-tools/test/client.test.ts` | Modify | Add URL precedence, boundary, redirects, Swagger fetch, GraphQL hardening, and cancellation cases. |
| `extensions/api-tools/test/tools.test.ts` | Modify | Replace legacy contracts with conditional registration, strict schemas, retained-tool compatibility, status, and lifecycle wiring cases. |
| `extensions/api-tools/test/security.test.ts` | Modify | Preserve redaction semantics and add clamp/UTF-8 boundary and schema-name preservation cases. |
| `extensions/api-tools/test/swagger.test.ts` | Create | Own Swagger discover/schema/request behavior and no-scan/server-ignore contracts. |
| `extensions/api-tools/test/graphql.test.ts` | Create | Own GraphQL discover/schema/execute behavior and bounded depth/filter contracts. |
| `extensions/api-tools/test/continuation.test.ts` | Create | Own reconstruction, typed errors, ownership, expiry, permissions, containment, privacy, replay, and cleanup. |
| `extensions/api-tools/test/render.test.ts` | Create | Own partial/success/failure/empty/continuation, Pi key hint, and width behavior. |
| `extensions/api-tools/README.md` | Modify | Document independent config, migration, actions, continuation, lifecycle, rendering, trust boundary, and safe status behavior. |

## Implementation Map Updates

- `openspec/changes/api-tools-swagger-graphql-contracts/implementation-map.md` updated/read: Yes
- Files promoted from candidates to expected changes: `extensions/api-tools/test/swagger.test.ts`, `extensions/api-tools/test/graphql.test.ts`; `extensions/api-tools/test/security.test.ts` retained as a modified owner for redaction/budget behavior.
- Relevant symbols/interfaces added or refined: `ApiIntegrationConfig`, `ApiIntegrationState`, `ContinuationManager`, `finalizeApiToolResult`, hardened endpoint resolver/redirect executor, `executeSwaggerAction`, `executeGraphqlAction`, and `renderApiToolResult` are planned names; exact implementation naming may follow local conventions without changing contracts.
- Validation map updates: package has only `npm test` and `npm run typecheck`; there is no separate package validation script. Add focused ownership for Swagger/GraphQL suites and static dependency/status-path checks.
- Conflicts or stale entries: the mapped `examples/extensions/truncated-tool.ts` does not exist; current renderer references that hard-code `ctrl+o` are unsuitable, while `extensions/context7/src/render/index.ts` is the verified native `keyHint` reference. The prior `api_status` conflict is resolved by active decision `DES-STS-001 R1`.

## Interfaces / Contracts

```ts
type ApiFramework = 'spring' | 'node';

type ApiIntegrationConfig =
  | { enabled: false; framework?: undefined; url?: string }
  | { enabled: true; framework: ApiFramework; url?: string };

interface ApiContinuationMetadata {
  has_more: boolean;
  next_cursor?: string;
  returned_bytes: number;
  returned_lines: number;
  total_bytes: number;
  total_lines: number;
}

interface CursorRecord {
  owner: string;          // non-public session owner token
  tool: 'api_swagger' | 'api_graphql';
  action: 'discover' | 'schema' | 'request' | 'execute';
  artifactId: string;     // registry identifier, never a public path
  startOffset: number;
  expiresAt: number;
}

interface ContinuationManager {
  finalize(input: {
    owner: string;
    tool: CursorRecord['tool'];
    action: CursorRecord['action'];
    result: ApiToolResult;
    secretValues: string[];
    limits: ApiToolsConfig['limits'];
  }): Promise<ApiToolResult>;

  continue(input: {
    owner: string;
    tool: CursorRecord['tool'];
    action: CursorRecord['action'];
    cursor: string;
  }): Promise<ApiToolResult>;

  rotateSession(): Promise<string>;
  cleanup(): Promise<void>;
}
```

The remediated `api_status` output interface preserves `config_exists`, overall `enabled`, `auth_type`, `timeout_ms`, `limits`, safe configured-state booleans, warnings, and Git state. It removes `endpoints.rest_url`, `endpoints.graphql_url`, and every equivalent URL/origin/base-path string. It adds only `swagger` and `graphql` objects containing `enabled` and, when valid and enabled, `framework`. Invalid framework configuration is reported through the existing safe warning channel and never copied into the integration object.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Baseline | Existing retained tools and current 32-test historical surface | Run fresh `npm test` and `npm run typecheck` before edits; record any pre-existing failure. |
| Config unit | Independent blocks, enabled/framework validation, legacy fallback, safe warnings, clamped budgets | Extend `config.test.ts` first and capture RED before parser changes. |
| Network unit | URL resolution, fallback order, redirect target enforcement, cancellation, auth header reuse | Inject fetch in `client.test.ts`; assert rejected calls never reach fetch and redirect call sequence is exact. |
| Domain unit | Swagger and GraphQL action outputs, filtering, schema depth, validation, provider errors | New cohesive `swagger.test.ts` and `graphql.test.ts`; use minimal documents/introspection fixtures. |
| Registration/contract | Exact tool list matrix, strict schemas, no legacy aliases/third tool, retained tools, safe status | Adapt `tools.test.ts`; inspect JSON Schema branches and execute representative actions. |
| Continuation/security | Redaction-before-write, permissions, immutable reconstruction, cursor replay/binding/TTL, path privacy, cleanup | Use isolated temp roots, injected clock/random where needed, real filesystem containment checks, and a no-network spy. |
| Renderer unit | Runtime expansion/partial states, safe metadata, all current content, native hint, width safety | Instantiate returned component and assert rendered lines/state without custom expansion state. |
| Static/package | No dependency or lockfile additions; no legacy names, public `artifact_path`, or hard-coded expand key in changed renderer | Review diff plus targeted static checks after GREEN. |
| Full package | All supported behavior and TypeScript contracts | Run `npm test`, `npm run typecheck`; manually review collapsed/expanded Pi output after reload. |

Strict TDD ownership: modify existing test owners where they already own behavior; create only the five new suites whose production responsibilities do not exist today. No test framework, dependency, or test-root migration is planned.

## Migration / Rollout

No data migration is required. This is an intentional public tool-name/config migration: users must add explicit `swagger`/`graphql` blocks, migrate legacy GraphQL calls to the corresponding `api_graphql` action, and reload Pi. Existing cursors are not supported and any new cursor becomes invalid on reload/restart. Rollback restores legacy registrations/config behavior and removes extension-owned temporary artifacts; no durable user data is transformed.

## Open Questions

- [x] **Resolved and incorporated as `DES-STS-001 R1`:** `api_status` intentionally removes endpoint URL fields, preserves safe non-URL status behavior, and adds only `{enabled, framework}` integration state.
