# Sources

## Source Index

### S-001: Local graph builder, discovery, source policy, freshness, and scheduler
- Family: IMPLEMENTATION
- URL or locator: `/home/j0k3r/.pi/agent/extensions/code-research/src/core/{workspace-graph.ts,project-detector.ts,source-policy.ts,freshness.ts,graph-scheduler.ts}`
- Date/version: Local working copy; workspace graph schema v3
- Access method: `functions.read`
- Used for: Build pipeline, source eligibility, snapshots, full rebuild assessment, Python graph branch, edge construction, scheduler, callsite-text persistence, and concurrency findings.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Static source review. `workspace-graph.ts` builds Java, TS/JS, Go, and Python branches, writes mutable named shards, then manifest/state. No runtime execution.

### S-002: Local graph schema and shared type contract
- Family: IMPLEMENTATION
- URL or locator: `/home/j0k3r/.pi/agent/extensions/code-research/src/core/graph-schema.ts`; `/home/j0k3r/.pi/agent/extensions/code-research/src/types.ts`
- Date/version: Local working copy; `WORKSPACE_GRAPH_SCHEMA_VERSION = 3`
- Access method: `functions.read`
- Used for: Node/edge schema, ID strategy, validation, coverage proofs, graph states, permitted languages, artifact limits, and schema-gap assessment.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Strong validation of nodes/coverage, but `py` remains a permitted file/symbol language and edge uniqueness is not checked.

### S-003: Local graph persistence and workspace state
- Family: IMPLEMENTATION
- URL or locator: `/home/j0k3r/.pi/agent/extensions/code-research/src/core/{graph-persistence.ts,workspace-state.ts}`
- Date/version: Local working copy
- Access method: `functions.read`
- Used for: Atomic per-file rename, artifact size limits, cache behavior, mutable shard paths, `.gitignore` mutation, and state timestamps.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Rename makes individual writes atomic, not a manifest-plus-all-shards transaction. No cross-process lock was found in the reviewed files.

### S-004: Local graph policy and graph query implementations
- Family: IMPLEMENTATION
- URL or locator: `/home/j0k3r/.pi/agent/extensions/code-research/src/core/{graph-policy.ts,graph-queries.ts,reference-graph-queries.ts,reverse-graph-queries.ts}`
- Date/version: Local working copy
- Access method: `functions.read`
- Used for: Fresh/stale policy, reference coverage, name/path target selection, all-shard query fan-in, language-filter gap, tree traversal, and status/query inconsistency.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Query code does not apply `input.language` when filtering graph symbol targets. Reference query reconstructs Java relationship metadata by reopening source and regex matching.

### S-005: Local direct resolvers and public tool query paths
- Family: IMPLEMENTATION
- URL or locator: `/home/j0k3r/.pi/agent/extensions/code-research/src/core/{find-symbol-resolver.ts,find-references-resolver.ts,function-call-tree-resolver.ts,reverse-function-call-tree-resolver.ts}`; `/home/j0k3r/.pi/agent/extensions/code-research/src/tools/{code-find.ts,code-call-hierarchy.ts,workspace-graph.ts}`
- Date/version: Local working copy
- Access method: `functions.read`
- Used for: Symbol graph-authority validation, direct fallback, current paging/cursor behavior, auto-language behavior, hierarchy output, and graph-status assessment.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Symbol authority validates current source bytes and coverage; reference/hierarchy graph paths do not perform equivalent file rehashing. `code_find` uses numeric offset cursors; hierarchy has no page limit/cursor.

### S-006: Local TS/JS, Java, and Go adapters and symbol identity code
- Family: IMPLEMENTATION
- URL or locator: `/home/j0k3r/.pi/agent/extensions/code-research/src/languages/{typescript/{function-call-tree.ts,find-references.ts,symbol-extractor.ts,symbol-model.ts},java/{function-call-tree.ts,find-references.ts,symbol-extractor.ts,symbol-model.ts},go/{workspace-graph.ts,find-references.ts,find-symbol.ts,symbol-extractor.ts}}`; `/src/core/project-index.ts`
- Date/version: Local working copy
- Access method: `functions.read`
- Used for: Per-language resolution capabilities/limits, overload/interface behavior, Go package/receiver behavior, source-hash-derived IDs, and language leakage assessment.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: The reviewed code is syntax/heuristic based. TS/Java/Go all derive canonical `symbolId` from full source hash and ranges; no claim of compiler accuracy is made.

### S-007: Local Go coverage contract
- Family: IMPLEMENTATION
- URL or locator: `/home/j0k3r/.pi/agent/extensions/code-research/docs/go-symbol-coverage-v1.md`
- Date/version: Local working copy; coverage model v1
- Access method: `functions.read`
- Used for: Claimed Go graph declaration/relationship coverage comparison.
- Usefulness: SUPPORTING
- Confidence impact: MEDIUM
- Notes: Documentation is consistent with the reviewed Go builder for same-package calls and syntactic implementations, but source implementation remains stronger evidence.

### S-008: Local extension public contract and package manifest
- Family: IMPLEMENTATION
- URL or locator: `/home/j0k3r/.pi/agent/extensions/code-research/{README.md,package.json,index.ts,src/config.ts}`; `/src/languages/java/symbol-extractor.ts`; `/docs/{typescript-symbol-contract-v1.md,java-symbol-coverage-v1.md}`
- Date/version: Local package version `0.1.0`; README current working copy
- Access method: `functions.read`
- Used for: Supported-language boundary, public tools, Python dependency/config drift, entrypoint lifecycle, Java coverage, and direct/graph diagnostics.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: README says only TS/JS/Java/Go are public; `package.json`, config/source policy, and graph builder still retain Python. Language coverage documents are design contracts, not runtime proof.

### S-009: Installed Pi extensions documentation
- Family: PRIMARY
- URL or locator: `/home/j0k3r/.local/share/mise/installs/node/24.19.0/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`
- Date/version: Installed documentation; version not stated in file
- Access method: `functions.read`
- Used for: Project trust, session shutdown, extension lifecycle, cancellation, and sensitive local-path/security comparison.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Documents `ctx.isProjectTrusted()` for project-local configuration and idempotent cleanup at `session_shutdown`. Local extension config/scheduler does not receive/use context trust.

### S-010: SCIP Code Intelligence Protocol repository
- Family: PRIMARY
- URL or locator: https://github.com/scip-code/scip
- Date/version: Live `main`; release date not established
- Access method: `functions.github_get`
- Used for: Language-agnostic code-navigation indexing model and comparison boundary.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Official protocol repository describes SCIP as language-agnostic and lists definition, reference, and implementation navigation. Used as a conceptual reference, not a recommendation to adopt SCIP artifacts.

### S-011: SCIP Protobuf schema
- Family: PRIMARY
- URL or locator: https://github.com/scip-code/scip/blob/main/scip.proto
- Date/version: Live `main`, retrieved SHA `9ae8c9633492d34f9fe4894b414c606c150fcbfc`
- Access method: `functions.github_get`, `functions.web_fetch`
- Used for: Separate symbols/occurrences, canonical relative paths, position encoding, symbol roles, occurrence ranges, relationship semantics, and streaming/compact-index comparison.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: The source says indexers range from compiler-backed precision to syntax-directed heuristics. It is not evidence that the local graph already has SCIP semantics.

### S-012: Language Server Protocol specification 3.18
- Family: PRIMARY
- URL or locator: https://microsoft.github.io/language-server-protocol/specifications/lsp/3.18/specification/ and https://github.com/microsoft/language-server-protocol/blob/gh-pages/_specifications/lsp/3.18/specification.md
- Date/version: LSP 3.18 current specification; source change log labels 3.18.0 `2026-06-04`
- Access method: `functions.web_fetch`, `functions.github_get`
- Used for: Navigation capability taxonomy, partial-result/stale-content comparison, and date limitation.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: The specification is under development and is a capability taxonomy, not an instruction to implement LSP. Its source was unusually future-dated relative to the requested freshness target; no broader as-of date is inferred.

### S-013: Tree-sitter Code Navigation Systems documentation
- Family: PRIMARY
- URL or locator: https://github.com/tree-sitter/tree-sitter/blob/master/docs/src/4-code-navigation.md
- Date/version: Live `master`, retrieved SHA `02a9fa4d25c62ddd81f8a91577f749c6ec5b7177`
- Access method: `functions.github_get`
- Used for: Definitions/references role-and-kind vocabulary, tags-query testing, and limit of syntax tagging.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Official Tree-sitter documentation. It supports the minimal fixture strategy; tags are not treated as semantic reference resolution.

### S-014: GitHub Code Navigation implementation documentation
- Family: PRIMARY
- URL or locator: https://github.com/github/code-navigation
- Date/version: Live `main`; date not stated
- Access method: `functions.github_get`
- Used for: Fully-qualified-name and Go receiver-scope comparison; Tree-sitter code-navigation implementation reference.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Shows that syntactic navigation benefits from qualified names and explicit receiver scope. It does not establish compiler-grade correctness.

### S-015: Navigating code on GitHub
- Family: PRIMARY
- URL or locator: https://docs.github.com/en/repositories/working-with-files/using-files/navigating-code-on-github
- Date/version: Live documentation; date not exposed
- Access method: `functions.web_search`, `functions.web_fetch`
- Used for: Background corroboration of Tree-sitter-based definitions/references and repository-scale limits.
- Usefulness: CONTEXT
- Confidence impact: LOW
- Notes: Not a material basis for a recommendation because its retrieved HTML was navigation-shell heavy; retained to record corroborating external comparison.

### S-016: TypeScript Language Service API documentation
- Family: PRIMARY
- URL or locator: https://github.com/microsoft/TypeScript/wiki/Using-the-Language-Service-API
- Date/version: Live wiki; date not exposed
- Access method: `functions.web_search`, `functions.web_fetch`
- Used for: TS dependency graph/reference-resolution comparison and the decision not to label syntax-only local results semantic.
- Usefulness: MATERIAL
- Confidence impact: MEDIUM
- Notes: Search extraction states that TypeScript language service resolves imports and triple-slash references through a program dependency graph and supports host-managed file state. Full page extraction was HTML-shell heavy.

### S-017: gopls navigation features
- Family: PRIMARY
- URL or locator: https://go.dev/gopls/features/navigation; https://github.com/golang/tools/blob/master/gopls/doc/features/navigation.md
- Date/version: Live Go documentation / `master`; retrieved SHA `df4598dac0b21a794e148fdedf159f7b4cb5c2b7`
- Access method: `functions.web_search`, `functions.web_fetch`, `functions.github_get`
- Used for: Go references, interface/concrete method relationships, package/build-configuration scope, workspace symbols, and dynamic-call hierarchy limits.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Strong primary comparison. gopls itself documents non-exhaustive dynamic-call hierarchy and build-configuration-dependent references; it does not prove identical local behavior.

### S-018: Eclipse JDT Language Server README
- Family: PRIMARY
- URL or locator: https://github.com/eclipse-jdtls/eclipse.jdt.ls/blob/main/README.md
- Date/version: Live `main`, retrieved SHA `cb0967aa8054193135c5fe557d8fbed12de8f468`
- Access method: `functions.web_search`, `functions.web_fetch`, `functions.github_get`
- Used for: Java semantic-navigation/build-system comparison and explicit LSP-daemon non-goal rationale.
- Usefulness: MATERIAL
- Confidence impact: MEDIUM
- Notes: Official project README says JDT LS uses Eclipse JDT/Maven/Gradle support and provides navigation, references/implementations, call hierarchy, and type hierarchy. It is not used to prescribe adoption.

### S-019: Sourcegraph Precise Code Navigation documentation
- Family: PRIMARY
- URL or locator: https://sourcegraph.com/docs/code-navigation/precise-code-navigation
- Date/version: Live documentation; date not exposed
- Access method: `functions.web_search`, `functions.web_fetch`
- Used for: Comparison of precise, language-specific indexes and syntax/search fallback; rationale for keeping compiler/build-aware precision out of the minimal local scope.
- Usefulness: MATERIAL
- Confidence impact: MEDIUM
- Notes: Vendor documentation. It describes SCIP-based per-language indexers for Go, TS/JS, and Java and search-based fallback. Used as architecture context, not performance or quality proof.

## Access Limitations and Discarded Material

- **Local graph tests:** `functions.read` on `/home/j0k3r/.pi/agent/extensions/code-research/test/workspace-graph` returned `EISDIR`; direct attempted locators under that directory and `test/workspace-graph.test.ts` were absent. The available read-only tool could not enumerate the directory. Test coverage was therefore not inferred.
- **External freshness:** several live documentation pages do not expose publication dates. They are reported as live/current at access, not certified as of the user-supplied future target date.
- **No YouTube, academic papers, community threads, or social posts** were used as evidence.
