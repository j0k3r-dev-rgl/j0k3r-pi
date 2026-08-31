# Code Research Workspace Graph Builder, Schema, and Query Architecture Audit

## Executive Summary

**Recommendation — HIGH confidence:** retain the language-adapter architecture and the persisted per-subproject graph, but make a small **schema-v4 correctness reset** before extending query capability. Keep the three public tools. Do **not** add an LSP daemon, a database, a watcher service, embeddings, or another language.

The current graph is a useful, cautious accelerator for declarations and a partial static-call/reference index. It has strong source-boundary checks, source hashes, per-file coverage proofs, bounded artifact reads, schema rejection, direct-analysis fallback, and meaningful TS/JS, Java, and Go adapters. [S-001] [S-002] [S-003] [S-006]

It is not yet a durable language-agnostic navigation graph. The main correctness blockers are:

1. schema-v3 still persists and discovers Python despite the explicit TS/JS/Java/Go boundary;
2. `symbolId` and graph node IDs include source hashes and/or coordinates, so ordinary edits change identity;
3. edges lack a common occurrence range, resolution state, target identity/ambiguity representation, and several reference roles;
4. queries choose the first same-name candidate, ignore `input.language` in graph query filters, and expose no stable target ID;
5. full-workspace rebuilds publish mutable shard filenames without a cross-process commit protocol; and
6. graph artifacts persist unredacted call expressions and honor project-local config without checking Pi project trust. [S-001] [S-002] [S-003] [S-004] [S-005] [S-009]

The minimal end state is a **syntax-backed, source-snapshot-verified graph** with four entity types (workspace, subproject, file, symbol), occurrence-bearing relationships, a stable logical symbol key separate from snapshot identity, and explicit confidence/completeness. It should answer only facts each adapter can prove and fall back directly otherwise.

## Research Question

How should the Code Research graph be built, persisted, refreshed, and queried so it is correct as practical, language-agnostic, durable, and minimal for TypeScript/JavaScript, Java, and Go declarations, references, and call hierarchy?

## Recommendation or Answer

Adopt schema v4 with these contract changes:

- **Supported source set:** only `.ts/.tsx/.js/.jsx/.mjs/.cjs`, `.java`, and `.go`; remove Python source discovery, markers, types, builder branch, dependency, status counters, and old-artifact acceptance. [S-001] [S-002] [S-008]
- **Two identities:** `logicalSymbolKey` is stable across body-only and line-only edits; `snapshotSymbolId` (or source hash + range) proves the exact indexed revision. Do not call a source-hash-derived value a stable ID. [S-002] [S-006]
- **One relationship/occurrence representation:** every queryable import, call, read/write, type use, instantiate, extends/implements/permits fact records a precise source range, enclosing symbol/file, target status (`resolved | ambiguous | external | unresolved`), and adapter provenance. This eliminates query-time Java regex recovery and makes limitations inspectable. [S-004] [S-006] [S-011]
- **Explicit language scope keys:** adapters create language-specific container keys; the core stores and compares them, but does not infer them. Use TS/JS module identity, Java package plus owner plus overload signature key, and Go module/import path plus package plus receiver/signature key. [S-006] [S-010] [S-011] [S-012]
- **Atomic immutable publication:** write generation-addressed shards, validate them, then atomically publish one manifest/state pointer. Do not overwrite live `graphs/<id>.json` while another process may read or build. [S-001] [S-003]
- **One shared target selector:** `code_find` returns `symbol_id` / logical key and accepts it on follow-up; references and hierarchy require it when name/path/kind are ambiguous. Every graph query filters by requested language and subproject before selecting a target. [S-004] [S-005]
- **Truthful status and bounds:** `workspace_graph_status` must use the same query-readiness policy as queries and distinguish “recorded fresh” from “validated for this query.” Add total-node/output limits and deterministic continuation/chunking to call hierarchy. [S-004] [S-005]

This is deliberately **not** a migration to compiler-accurate navigation. The graph remains syntactic/heuristic for local Pi research. The current direct fallbacks remain necessary, particularly for overloads, aliases, dynamic dispatch, reflection, generated code, Go build constraints, and incomplete project configuration. [S-005] [S-006] [S-012] [S-017]

## Key Findings

| Finding | Evidence | Confidence |
|---|---|---|
| The build pipeline is real and shared: discover subprojects → collect source files/snapshot → build one shard per subproject → write manifest → write state. | `workspace-graph.ts:36-156`; `project-detector.ts:17-55`; `freshness.ts:6-44`. [S-001] | HIGH |
| It always rebuilds every detected subproject after any snapshot difference; it is not incremental. | `ensureWorkspaceGraphFreshness()` calls `buildWorkspaceGraph()` after one stale comparison; `buildWorkspaceGraph()` loops every detected project. [S-001] | HIGH |
| Schema v3 validates many artifact invariants and TS/Java/Go coverage proofs, but still admits `py` file/symbol languages and no Python coverage proof. | `graph-schema.ts:15-26,69-221`; `types.ts:1-8,244-314`. [S-002] | HIGH |
| Current logical IDs are unstable: TS/Java/Go `symbolId` hashes the complete source hash plus range; graph node IDs also include line/column. | `typescript/symbol-model.ts:48-71`; `java/symbol-model.ts:105-128`; `go/symbol-extractor.ts:8-44`; `graph-schema.ts:37-45`. [S-002] | HIGH |
| Graph read authority for symbols is conservative and unusually strong: current stat, snapshot hash, file coverage proof, source hash, and node count are checked before use. | `find-symbol-resolver.ts:160-357`; `graph-schema.ts:159-279`. [S-005] [S-002] | HIGH |
| Graph reference/call queries are less safe semantically: they select the first same-name target and do not filter graph symbols/edges by `input.language`. | `reference-graph-queries.ts:31-62`; `graph-queries.ts:31-57`; `reverse-graph-queries.ts:31-57`. [S-004] | HIGH |
| Current status can say stale data is usable although reference/call policies reject stale data, and it does not rescan before reporting freshness. | `workspace-graph.ts:70-75,109-128`; `graph-policy.ts:76-96`. [S-004] | HIGH |
| Call expressions with string literals are persisted verbatim in `callsite.text`; signature redaction does not protect this field. | `workspace-graph.ts` calls `sanitizePersistedSignature()` only for signatures but writes `call.text`/`call.callText`/`callsite.text`; `graph-schema.ts:isCallsite()`. [S-001] [S-002] | HIGH |
| TS/JS, Java, and Go adapters have different resolution quality and semantics; the core currently leaks these differences through coarse kinds, owner labels, external IDs, and relationship heuristics. | `typescript/function-call-tree.ts`; `java/function-call-tree.ts`; `go/workspace-graph.ts`. [S-006] | HIGH |

## Evidence Review

### Current build-to-query pipeline

| Stage | Current behavior and local evidence | Assessment |
|---|---|---|
| Discovery | `detectWorkspaceSubprojects()` recursively detects markers, hashes the relative root for a subproject ID, and filters nested projects with shared markers (`project-detector.ts:17-55`). It still recognizes Python markers. | Good monorepo intent; marker-only nesting is heuristic and Python must leave. |
| Source policy | `collectWorkspaceSourceFiles()` recursively walks allowed extensions below a size cap of 100 KiB, excludes `.pi`, dot directories, and named build/vendor directories (`source-policy.ts:4-123`). It does not honor `.gitignore`, build tags, generated-file policy, or project build config. | Safe default boundary, but the recorded `skippedLargeFiles` and `skippedUnsupportedFiles` counters are initialized and never incremented. |
| Freshness | A snapshot stores mtime, size, and SHA-256 per eligible source file (`freshness.ts:6-44`). A difference in any one subproject triggers `buildWorkspaceGraph()` for all subprojects (`workspace-graph.ts:36-83`). | Source hash verification is correct; full rebuild is expensive and state changes are not transactional. |
| Adapter build | Java uses Tree-sitter extraction/project index; TS/JS combines a Tree-sitter call index with TypeScript symbol extraction; Go builds a Tree-sitter package/call/type index (`workspace-graph.ts:158-560`). | Correct separation direction, but semantic quality is adapter-specific and must be stated on edges/results. |
| Persistence | Each mutable shard is atomically renamed to `.pi/workspace-code-graph/graphs/<subprojectId>.json`; manifest and state are written afterward (`graph-persistence.ts:38-94`, `workspace-graph.ts:120-156`). | Per-file rename is helpful, but not a multi-file commit. Two builders can interleave shards, manifest, and state. |
| Symbol query | `resolveFindSymbol()` validates state/manifest, shard generation, per-file snapshot, source hash, coverage proof, and canonical shape; unproven files parse directly (`find-symbol-resolver.ts:72-357`). | Best current read path. It trades re-reading every queried file for correctness. |
| Reference/query hierarchy | Reference, outgoing, and incoming graph queries load all manifest shards in parallel, concatenate them, match by name/path, and traverse edges (`reference-graph-queries.ts:10-143`; `graph-queries.ts:10-140`; `reverse-graph-queries.ts:10-130`). | Simpler but weaker: no language filter in the actual query, first-candidate selection, all-shard memory fan-in, and no target-ID disambiguation. |
| Tool path | `code_find` paginates result arrays after resolving; `code_call_hierarchy` probes languages for `auto`; `workspace_graph_status` summarizes state/shards (`tools/code-find.ts`; `tools/code-call-hierarchy.ts`; `tools/workspace-graph.ts`). | `code_find` has useful bounds but its numeric cursor is not snapshot-bound. Hierarchy remains unbounded by breadth/output. |

### Current schema, state, and coverage

**Keep:** schema versioning, `createdBy`, path-relative files, explicit workspace/subproject/file/symbol nodes, `contains` edges, source ranges, source hashes, per-language grammar/model coverage, shard-generation checks, artifact-size caps (256 MiB), and direct fallback diagnostics. These are a strong foundation for a local persisted index. [S-002] [S-003] [S-005]

**Current nodes and edges.** `GraphNode` has workspace, subproject, file, and symbol variants; `GraphEdge` has `contains`, `imports`, `calls`, `reads`, `implements`, `extends`, `permits`, and legacy `entrypoint`. Symbol metadata includes coarse/fine kind, owner, qualified name, signature, relationship ID, source hash, and definition/implementation booleans. Edge metadata includes an optional callsite, external target description, and a `reason`. [S-002]

**Schema strengths.** Shard validation rejects unknown edge kinds, duplicate node IDs, dangling non-external targets, unsafe ranges, mismatched coverage generations, missing proof files, bad hashes, and missing canonical fields for TS/JS/Go. Java and Go coverage additionally ties node source hashes to each file proof. [S-002]

**Schema gaps.** It does not require unique edge IDs, validate a manifest/state/subproject root relationship, cap most arbitrary strings/arrays or total node/edge count, record source-position encoding, validate an artifact's `projectRoot` against the active root, or represent resolution ambiguity. It permits `external:*` targets without a target node, so external symbols cannot carry a stable identity or distinguish package/module ownership. [S-002] [S-003]

**Snapshots and freshness.** State stores an inventory snapshot and an `updatedAt`, while coverage proves what a successful extractor saw. This is good evidence for `code_find`, but “fresh” means only that the last builder recorded success until a new freshness comparison runs. The status tool reports age/state, not a new snapshot comparison. [S-001] [S-004] [S-005]

### Language-agnostic core: strengths and leakage

The core is mostly well partitioned: adapter imports are concentrated in `workspace-graph.ts`, direct resolver adapters are selected in `find-symbol-resolver.ts`, and generic query/persistence code sees `GraphNode`/`GraphEdge`. This should be retained. [S-001] [S-005]

However, the core is not neutral enough for durable navigation:

- `SupportedLanguage`, file node unions, source policy, subproject markers, and graph-status counters carry `py`; public tools do not. [S-001] [S-002] [S-008]
- `SymbolKind` has only function/class/method/interface/variable/unknown. It compresses Go structs, Java records/enums/annotation elements, TS type aliases/properties/namespaces, and packages/modules into misleading buckets. Keep a small presentation kind, but let adapters persist a stable fine kind. [S-002] [S-006]
- The core writes Java-specific external IDs (`external:java:<name>`) and reference matching rules. `reference-graph-queries.ts` reopens Java source and uses a regex to reconstruct an extends/implements range because the edge did not persist it. [S-001] [S-004]
- Go uses `class` as a struct-like owner kind and matches local package imports by package basename; TS uses project config/import candidates; Java uses package/import heuristics. These are reasonable adapter choices, but their distinct confidence cannot be inferred from `external` alone. [S-006]

### Correctness by language and relation

| Area | Current capability | Important limit / required contract |
|---|---|---|
| TS/JS symbols/modules | TypeScript API extraction provides rich declarations; the project index resolves imports, path aliases, selected re-exports, local class receiver types, and some JSX reads. | It is not TypeScript-program/type-checker reference resolution. Re-export parsing includes regexes; aliases, overload/type relations, dynamic property access, CommonJS interop, and runtime dispatch remain partial. [S-006] [S-016] |
| Java packages/classes/interfaces | Java extractor records package/module/type/member/binding declarations and explicit extends/implements/permits facts. Java calls use syntax-only receiver/argument heuristics. | Wildcards, generics, inherited members, overloaded calls, anonymous classes, lambdas, reflection, annotation processing, Maven/Gradle classpaths, and generated sources are not compiler-resolved. Preserve `ambiguous` instead of an external false negative. [S-006] [S-008] [S-018] |
| Go packages/receivers/interfaces | Go records package clauses, functions, receiver methods, named types, interface methods, imports, same-package calls, and syntactic implementation edges. | No module/import-path identity, build tags, `go.work`, cross-package local-call resolution, embedding/method sets across packages, aliases, generic instantiation, or robust explicit assertion parsing. Name-only interface implementation can collide across packages. gopls itself documents build-configuration, visibility, and dynamic-call limits. [S-006] [S-007] [S-017] |
| Imports | TS/JS and Go graph import edges only materialize when a workspace target file is resolved; Java imports are used by its project index but are not persisted as graph import edges. | Persist each import occurrence, its binding/alias and target state. An unresolved import is a useful fact, not an absent edge. [S-001] [S-006] |
| References | Graph supports only call/read/implements/extends fast paths; direct paths use mixtures of AST and line regexes. | A declaration-to-reference result must say which roles are complete. No empty `reference_kinds` graph query is trusted, correctly causing direct fallback today. [S-004] [S-005] |
| Call hierarchy | Call edges are static syntactic edges with a depth bound and cycle suppression. | Dynamic dispatch/callbacks are incomplete; graph tree traversal globally suppresses a visited symbol, which loses valid alternate paths. Include edge/cycle/depth truncation and result cap metadata. [S-004] [S-006] [S-017] |

### Stable ID and incremental-indexing assessment

**Current IDs are snapshot locators, not stable identities.** `createSymbolNodeId()` embeds subproject ID, file, owner, name, line, and column. Canonical TS/Java/Go `symbolId` additionally hashes the complete file source hash and declaration range. A whitespace change anywhere in the file changes every canonical symbol ID; a preceding line changes graph node IDs. `relationshipId` is more stable for selected callable/accessor relations, but omits overload signature details and is not universally available. [S-002] [S-006]

This is acceptable for validating that a persisted record belongs to an exact source snapshot, but it cannot support durable cursors, target follow-ups, delta replacement, or identity-aware reference joins. SCIP offers a relevant model, not an implementation mandate: standardized symbol identifiers are separate from document occurrences; roles identify definition/import/read/write; relationships distinguish implementation, reference, type definition, and definition semantics. [S-010] [S-011]

**Current indexing is full rebuild.** The snapshot comparison correctly identifies changed files, but discards that information and rebuilds all detected subprojects. Since each build reparses/builds complete language indexes, this is workspace-scale work scheduled at `session_start` and each `turn_end`. The scheduler deduplicates only in-process work by root; there is no cancellation, shutdown cleanup, inter-process lock, or generation transaction. [S-001] [S-008] [S-009]

**Minimal answer:** v4 should first support immutable whole-subproject rebuilds, not a document database. On change, mark state stale, serve direct fallback, rebuild only affected subprojects from a captured source snapshot, and atomically switch the manifest. Add document-level delta shards only if measured subproject rebuild latency proves it necessary.

### Persistence, concurrency, stale graph, and security

**Persistence/concurrency risks — HIGH.** Atomic rename protects a single JSON file, but a build publishes many mutable files. Builder A and B can overwrite the same shard paths in different generations; either can then write a manifest/state that names its own generation while a shard contains the other. Queries usually reject the mismatch, but availability degrades and a timing window remains. A predictable temp filename (`pid` + `Date.now()`) is also not a uniqueness guarantee for same-process concurrent writes. Build errors are not caught into `state.error`; a previously written `refreshing` state can remain. [S-001] [S-003]

**Staleness risks — HIGH.** Symbol reads independently revalidate file bytes, which is excellent. Reference and hierarchy graph reads only trust state/manifest/status/generation; they do not re-hash query files. The lifecycle's next refresh normally repairs this, but a source edit between refreshes can produce a stale call/reference answer. `workspace_graph_status` also says stale is usable while the graph policy rejects stale for these operations. [S-004] [S-005]

**Trust and file boundary — HIGH.** The source walker resolves and bounds source paths below its root and excludes `.pi`; this is a meaningful protection. Artifact reads have a size ceiling and schema checks. But the global extension ascends from `cwd` to load `.pi/code-research.json`, does not use `ctx.isProjectTrusted()`, and may enable scheduled writes plus automatic `.gitignore` modification from untrusted project content. Pi explicitly says to check project trust before honoring project-local configuration and to clean session-scoped resources on `session_shutdown`. [S-003] [S-008] [S-009]

**Secret exposure — HIGH.** Persisted symbols omit bodies and signatures are redacted for quoted literals, which is good. Callsite text is not redacted, so calls such as `client.login("token")` can be written into `.pi/workspace-code-graph` and later returned in hierarchy details. `workspace_graph_status` also returns absolute `projectRoot` and graph root. Store no callsite text by default; store range plus a small structural callee/receiver representation, and read/redact a current source snippet only under an explicit bounded request. [S-001] [S-002] [S-009]

## Trade-offs and Risks

| Choice | Benefit | Cost / mitigation |
|---|---|---|
| Keep syntax-backed adapters, no LSP | Small local footprint; no processes, build imports, credentials, or platform lifecycle. | Do not promise compiler accuracy; persist resolution state/provenance and fall back. JDT LS and Sourcegraph demonstrate why semantic precision requires build-aware tooling, which is intentionally excluded. [S-018] [S-019] |
| Logical ID separate from snapshot proof | Durable selection/cursors and stable cross-file relationships. | Renames and ambiguous local bindings still need re-resolution; a logical key is not an eternal identity. |
| Occurrence-bearing edges | Accurate references without source regex recovery; uniform language-neutral query path. | More edge records. Mitigate with compact range encoding and no source text, as SCIP does. [S-011] |
| Immutable generation publication | No mixed graph generation; readers have a coherent view. | Temporary storage/cleanup logic. Keep only latest successful generation plus one previous generation. |
| Full affected-subproject rebuild first | Correct, reversible, minimal. | May be slow for huge modules; add document deltas only after benchmarks. |
| Keep public graph status | Satisfies current operational preflight guidance and supports debugging. | Define it as advisory/readiness, not evidence of current source freshness; do not expose absolute paths by default. |

## Alternatives Considered

1. **Keep schema v3 and patch query filters only — rejected.** It leaves Python scope drift, unstable IDs, unsafe callsite persistence, missing occurrence data, and publication races.
2. **Adopt SCIP files directly — rejected.** SCIP is a strong reference design for IDs, occurrences, roles, and relationships, but introduces a protocol/binding/storage migration beyond the local extension's needs. Borrow its concepts, not its runtime. [S-010] [S-011]
3. **Run TypeScript, gopls, and JDT language servers — rejected for this scope.** It would improve semantic precision but adds daemons, build/import configuration, Java runtime and workspace state, cancellation/lifecycle, and trust complexity. [S-016] [S-017] [S-018]
4. **Use Tree-sitter tags only — rejected.** Tags provide a useful standard vocabulary for definitions/calls/implementations and test fixtures, but cannot resolve references, overloads, imports, or dispatch on their own. [S-013] [S-014]
5. **Add a graph database/vector store — rejected.** JSON shards are sufficient for the bounded local corpus and explicit graph query shapes. The primary deficiencies are fact quality and atomicity, not query language expressiveness.

## Recommended Minimal Graph Contract and Migration Path

### v4 core contract

```text
Artifact identity
  schemaVersion, producerVersion, generationId, sourcePolicyFingerprint,
  workspaceRootKey, createdAt, buildStatus

File
  fileKey = normalized workspace-relative path
  language = ts | js | java | go
  sourceHash, byteSize, snapshotGeneration
  adapterContext = opaque adapter-owned fields (e.g. module/package key)

Symbol
  logicalSymbolKey = language + file/module/package scope + owner key +
                     fine kind + canonical signature/disambiguator
  snapshotSymbolId = hash(logicalSymbolKey + sourceHash + declaration range)
  displayName, qualifiedName, fineKind, presentationKind,
  declarationRange, selectionRange, ownerLogicalKey?, exported,
  definitionState, adapterContext

Relationship occurrence
  kind = imports | calls | reads | writes | type_uses | instantiates |
         implements | extends | permits
  from = enclosing symbol/file logical key
  to = target logical key OR external descriptor OR null
  occurrenceRange, enclosingRange?, targetStatus,
  role(s), resolution = exact | heuristic | ambiguous | unresolved,
  adapterReasonCode?
```

`contains` remains a structural edge. `relationship` facts such as implementation/override can remain symbol-to-symbol facts, but call/import/reference edges must retain the occurrence range. External descriptors should include language plus module/package/owner/name/signature when known; they must not masquerade as a resolved local symbol.

**Adapter obligations:** normalize paths, provide a fine kind and scope key, emit only facts it can classify, state `resolution`, provide no source text, and declare coverage/unsupported forms. **Core obligations:** validate/serialize facts, enforce roots and size limits, publish coherent generations, filter by language/scope, paginate, and never upgrade an adapter heuristic to “complete.”

### Migration

1. **Lock correctness with fixtures first.** Build common fixtures for ambiguous same-name symbols across languages, TS aliases/re-exports, Java overloads/interfaces/packages, Go modules/packages/receivers/interfaces/build-tag exclusions, stale source after a successful graph, torn generations, string-literal secret canaries, and page continuation. Test adapter output plus graph/direct parity only for declared coverage. Tree-sitter's tag-query testing model is a useful compact pattern. [S-013] [S-014]
2. **Make the boundary safe.** Remove Python throughout, introduce a single source-policy fingerprint, add trusted-project gating for config/write scheduling, stop persisting callsite source text, and make `.gitignore` modification explicit opt-in. Add scheduler disposal at `session_shutdown`. [S-001] [S-008] [S-009]
3. **Publish v4 atomically.** Treat v3 as incompatible and use direct fallback; do not transform old shards. Build immutable generation paths, validate all shards/manifest, then atomically swap one small current pointer. Garbage-collect only generations not referenced by current/previous pointer.
4. **Replace IDs and facts.** Add logical keys plus snapshot IDs; replace Java regex range reconstruction with persisted occurrences; implement language/subproject filtering and target-ID selection in the shared query layer. Preserve existing direct resolvers behind the same result provenance.
5. **Correct public query behavior.** `code_find` returns logical and snapshot IDs, source mode, validated generation, result role/resolution, and snapshot-bound cursors. `code_call_hierarchy` adds node/edge/output caps, cycle/depth/ambiguous counts, and continuation/chunk retrieval. `workspace_graph_status` reports per-query readiness using the shared policy.
6. **Only then optimize.** Rebuild only changed subprojects first. Measure build and query p95 on representative TS/JS, Java, and Go fixtures; add per-document deltas only if that evidence justifies their complexity.

## Unknowns and Limits

- No code was edited, no process was started, and no tests/benchmarks were executed; this is a static audit.
- The available local read interface could read the named implementation files but could not enumerate `test/workspace-graph` (`EISDIR`), and three plausible direct test locators were absent. Exact current graph-test coverage is therefore unknown rather than assumed.
- The audit did not inspect every language-adapter file or generated parser grammar. Findings identify architectural limits from the executed paths, not a claim that every construct fails.
- External documentation was accessed as live/current material where available. Several pages do not publish a document date. The requested “current as of 2026-08-31” target cannot be independently certified from undated live pages; source versions/dates are recorded in `sources.md`. The LSP 3.18 source itself labels its 3.18 change entry `2026-06-04`. [S-012]

## Recommended Next Actions

1. Approve schema-v4 reset and the explicit non-goals: no LSP daemon, no database, no extra languages, and no attempt at compiler-equivalent semantics.
2. Resolve the user-owned compatibility choice: should v3 artifacts be immediately invalidated (recommended) or kept read-only until their next rebuild? Do not implement a lossy transformer.
3. Implement the fixture/correctness gates before schema code, especially mixed-generation publication, language filtering, ambiguous target selection, literal redaction, and stale reference/call fallback.
4. Implement v4 atomic publication and the shared selector/occurrence query path, then remove Python in the same bounded change.
5. Benchmark full affected-subproject rebuilds before authorizing document-level incremental shards.
