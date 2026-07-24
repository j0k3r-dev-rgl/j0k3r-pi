## Exploration: api-tools-swagger-graphql-contracts

> **Resolution status (proposal remediation):** Exploration is complete and all five proposal questions are resolved in `proposal.md`. The active contract is session-bound continuation: reload/restart invalidates old cursors, startup cleanup is crash defense only, and no public result, detail, renderer, or cursor exposes `artifact_path` or another internal filesystem path. Any contrary statement retained below is historical exploration context and is superseded by the proposal.

### Current State

The Pi `api-tools` extension lives at `extensions/api-tools/`. When `<ctx.cwd>/.pi/api.json` has `"enabled": true`, it registers seven tools in `src/tools.ts`:

- **Kept unchanged:** `api_status`, `api_auth_status`, `api_login`, `api_rest_request`.
- **Removed in this change:** `api_graphql_query`, `api_graphql_schema_queries`, `api_graphql_schema_query`.

Configuration is parsed in `src/config.ts` from `url`, `port`, `graphql_url`, `timeout_ms`, `limits`, `headers`, and `auth`. There is no support yet for the new `swagger`/`graphql` blocks.

The client boundary in `src/client.ts` is asymmetric:

- `rest()` enforces same-origin, base-path containment, path-traversal blocking, no absolute URLs, no control characters, and no URL credentials.
- `graphql()` executes against the raw `config.graphqlUrl` without origin/path validation or credential stripping.

The security/output layer in `src/security.ts` provides secret redaction (`redactToolResult`, `redactDeep`) and byte/line truncation via `applyOutputTruncation`. The truncation helper returns metadata but **silently discards** the remainder of the response.

The current tool-result envelope is:

```ts
{
  content: [{ type: 'text'; text: string }];
  details?: {
    status: 'success' | 'failure';
    data?: Record<string, unknown>;
    error?: { code: string; message: string; recoverable: boolean };
    response?: { status; status_text; headers; body; truncation };
  };
  isError?: boolean;
}
```

There is no custom rendering today; Pi's default tool row renders `content` text directly.

Baseline validation was run and confirmed: `npm test` passes 32 tests and `npm run typecheck` is clean.

### Affected Areas

- `extensions/api-tools/src/types.ts` — add `ApiSwaggerConfig`, `ApiGraphqlConfig`, continuation metadata, renderer types.
- `extensions/api-tools/src/config.ts` — parse new `swagger`/`graphql` blocks; keep `graphql_url` only as a URL fallback, not an enablement trigger.
- `extensions/api-tools/src/client.ts` — add Swagger-document fetch; harden GraphQL URL resolution to match REST protections; support `/graphql` default under the REST origin.
- `extensions/api-tools/src/security.ts` — keep redaction/truncation helpers; use them before writing artifacts.
- `extensions/api-tools/src/tools.ts` — replace registration list; remove legacy GraphQL tools; conditionally register `api_swagger` and `api_graphql`.
- `extensions/api-tools/src/swagger.ts` (new) — Swagger discovery, schema summary, and request execution.
- `extensions/api-tools/src/graphql.ts` (new) — GraphQL introspection/execution adapted to `api_graphql` actions.
- `extensions/api-tools/src/continuation.ts` (new) — redacted artifact writes, cursor-based chunk reads, lifecycle tracking.
- `extensions/api-tools/src/render.ts` (new) — native collapsed/expanded renderer component objects.
- `extensions/api-tools/test/*` — config, client, registration, continuation, renderer tests.
- `extensions/api-tools/README.md` — document new blocks, tools, migration, continuation, and rendering behavior.

### Approaches

1. **Tool swap only, keep silent truncation**
   - Pros: smallest footprint.
   - Cons: violates the lossless-bounded-model-output convention; does not address rendering.
   - Verdict: rejected.

2. **Tool swap + native collapsed/expanded renderer + redacted session-bound artifact/cursor continuation (recommended)**
   - Pros: satisfies the two-public-tool constraint, keeps per-turn output bounded while preserving all redacted data during the active session, and follows the websearch/code-research no-extra-dependency renderer pattern already present in this repository.
   - Cons: adds artifact lifecycle and cleanup; reload/restart intentionally invalidates cursors.
   - Verdict: recommended and confirmed by proposal.

3. **Tool swap + in-memory chunk cache**
   - Pros: no filesystem writes.
   - Cons: data is lost on extension reload, increases session memory, and cannot be reconstructed from the session if the process restarts.
   - Verdict: rejected as the primary strategy; may complement provider pagination where available.

### Renderer Architecture

The installed Pi version renders custom tool results through optional `renderResult(result, { expanded, isPartial }, theme, context)` on the tool definition. It must return a `Component` with `render(width): string[]` and `invalidate(): void`.

The extension can return a plain component object and use the injected `theme` callbacks (`theme.fg`, `theme.bold`, etc.) without importing `@earendil-works/pi-tui` or `@earendil-works/pi-coding-agent`. This is the same lightweight approach used by the in-tree `extensions/websearch/src/render/index.ts` and `extensions/code-research/src/render.ts`, and it avoids a dependency that is not resolvable in this extension's current `npm run typecheck`/`npm test` environment.

Planned renderer contract:

- **Collapsed:** tool name, status, action, key counts/identity, and a continuation/expansion hint.
- **Expanded:** the full current page/chunk content plus structured metadata (status, request summary, truncation/continuation info), wrapped to the supplied width.
- **States handled deliberately:** `isPartial`, success, failure, empty, and continuation.
- **Width safety:** implement a local ANSI-aware `wrapLines` helper or reuse the repo's existing width helpers pattern.

Resolved renderer decision: Pi owns expansion state and its runtime key hint. The implementation must use the installed native callback/shell contract without a hard-coded physical key or new dependency; exact import/type mechanics belong in design after checking the installed API.

### Lossless Output Option Matrix

| Strategy | Fits the two-tool constraint | Lifecycle ownership | Deterministic continuation | SSRF/filesystem risk | Best suited for |
|---|---|---|---|---|---|
| Provider pagination (offset/limit/page/cursor query params) | Yes, if the model passes cursors in the same tool | Provider owns state | Only when API guarantees it | No local storage | REST `request` against APIs that already paginate |
| In-memory cursor/chunk cache | Yes, cursor is an input on the same tool | Extension process/session memory | Yes, within one process lifetime | No filesystem, but memory pressure and loss on reload | Short-lived turns with no reload risk |
| Redacted artifact retrieval | Yes, with only an opaque cursor returned publicly; no new public tool | Active session; cleaned on `session_shutdown`, with stale startup sweep only for crash leftovers | Yes, line/byte offsets against an immutable artifact | Must contain paths, redact before write, and keep every internal path private | Swagger docs, GraphQL introspection, large new-tool responses |
| Combined artifact + bounded cursor (recommended) | Yes | Active session only | Yes within the owning session | Same as artifact plus cursor ownership/expiry | All actions of both `api_swagger` and `api_graphql` |

Confirmed strategy: **combined session-bound artifact + bounded cursor**. The tool returns the complete result when it fits configured limits. Otherwise it writes the full redacted response to an extension-owned temporary artifact, returns the first bounded chunk, and exposes only safe continuation metadata such as `has_more`, an opaque cursor, and counts/ranges. The same tool accepts the cursor to retrieve the next chunk without network re-execution. Internal paths are never public; reload/restart invalidates old cursors recoverably.

### Recommendation

Adopt the tool-swap + native renderer + artifact/cursor continuation architecture:

1. Parse explicit `swagger` and `graphql` blocks in `src/config.ts`; ignore legacy `graphql_url` for enablement, but allow it as a URL fallback when `graphql.enabled === true` and no explicit URL is given.
2. Add `src/swagger.ts` for discovery (`/v3/api-docs` then one deterministic `/v2/api-docs` fallback for Spring; explicit URL for Node), schema summary, and request execution that ignores OpenAPI `servers` and uses only the configured REST origin.
3. Add `src/graphql.ts` by extracting and adapting the existing introspection/execution logic to the new `api_graphql` actions.
4. Add `src/continuation.ts` for redacted artifact writes, line/byte cursor reads, and temp-directory lifecycle tracking.
5. Add `src/render.ts` with plain component objects for collapsed/expanded rendering.
6. Refactor `src/client.ts` to expose `swaggerFetch()` and a hardened `buildGraphqlUrl()` that applies the same origin/base-path/userinfo validations as REST.
7. Refactor `src/tools.ts` to conditionally register only `api_swagger` and `api_graphql` when the corresponding blocks are enabled.
8. Add optional `cursor` inputs to both tool schemas so continuation stays within the two public tools.
9. Update tests in strict TDD order and refresh the README.

### Metadata and PRD Alignment

- Metadata found: **yes**
- PRD: **waived / not applicable**
- Metadata alignment: **aligned**
- PRD alignment: **not-applicable**
- Spec alignment: **not-applicable**
- Security alignment: **aligned; proposal resolutions recorded below**
- Conflicts detected: **none**

Relevant metadata points: locked `hybrid` store, `interactive` mode, `strict-tdd`, `native-collapsed-expanded-rendering`, `lossless-bounded-model-output`, `openspec-authoritative`, `engram-compact-cursor`. All scope constraints are compatible.

### Proposal Resolutions

1. **Keybinding hint:** Pi owns expansion state and the runtime key hint; no hard-coded key or new dependency.
2. **GraphQL URL hardening:** enforce REST-equivalent same-origin, base-path, userinfo, traversal, control-character, and redirect protections.
3. **Cursor contract:** opaque random server-side cursor bound to session, tool, action, immutable redacted artifact, offset, and bounded expiry; no embedded/public path.
4. **Schema limits:** support operation/name filtering and bounded `max_depth` where applicable; exact fields and bounds belong in spec.
5. **First chunk:** oversized results include the first bounded redacted chunk plus safe range/count metadata and continuation cursor.

### Risks

- **Breaking migration:** removing the three legacy GraphQL tools will break existing sessions that resume old tool calls. Mitigation: document the one-to-one action migration and require reload; the proposal rejects legacy aliases/shims.
- **Node Swagger discovery:** no universal route; explicit `swagger.url` is required. Mitigation: clear recoverable error message.
- **Spring `/v2/api-docs` fallback:** may return non-Swagger JSON. Mitigation: validate `swagger` or `openapi` field before treating it as a schema.
- **Artifact security:** temporary files must be written only after redaction, stored under an unguessable path, and validated on read. Mitigation: path-prefix check, `realpath` comparison, and cleanup hooks.
- **GraphQL URL hardening:** may break users who currently set `graphql_url` to a different origin. This is an intentional security improvement that must be explicit in the proposal.

### Proposal Status

**Completed and reconciled.** `proposal.md` resolves all five questions, supersedes reload-survival and public-artifact-path claims, and is ready to serve as the basis for `sdd-spec` after orchestrator review.
