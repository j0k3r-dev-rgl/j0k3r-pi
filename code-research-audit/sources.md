# Sources

## Source Index

### S-001: Local extension composition root
- Family: IMPLEMENTATION
- URL or locator: `/home/j0k3r/.pi/agent/extensions/code-research/index.ts`
- Date/version: Local working copy; package version `0.1.0`
- Access method: `functions.read`
- Used for: Registered-tool inventory and lifecycle registration.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Registers five public tools at lines 1-20.

### S-002: Local public-tool registrations
- Family: IMPLEMENTATION
- URL or locator: `/home/j0k3r/.pi/agent/extensions/code-research/src/tools/{find-symbol,find-references,function-call-tree,reverse-function-call-tree,workspace-graph}.ts`
- Date/version: Local working copy; package version `0.1.0`
- Access method: `functions.read`
- Used for: Current schemas, descriptions, defaults, output construction, duplicate hierarchy parameters, and graph status behavior.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Direct source evidence; no runtime execution performed.

### S-003: Local language/config/type policy
- Family: IMPLEMENTATION
- URL or locator: `/home/j0k3r/.pi/agent/extensions/code-research/{package.json,src/types.ts,src/core/source-policy.ts,src/config.ts,src/core/graph-scheduler.ts}`
- Date/version: Local working copy; package version `0.1.0`
- Access method: `functions.read`
- Used for: Python dependency/index scope, supported extensions, graph configuration, project-config loading, and scheduler lifecycle review.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Python is explicitly present in dependency and graph-policy/type surfaces despite no public Python query option.

### S-004: Local symbol graph resolver and symbol contracts
- Family: IMPLEMENTATION
- URL or locator: `/home/j0k3r/.pi/agent/extensions/code-research/src/core/find-symbol-resolver.ts`; `/home/j0k3r/.pi/agent/extensions/code-research/docs/{typescript-symbol-contract-v1,java-symbol-coverage-v1}.md`
- Date/version: Local working copy; graph docs state schema versions 2/3 by language contract
- Access method: `functions.read`
- Used for: Direct/graph fallback, snapshot/coverage validation, bounded graph artifacts, and provenance recommendation.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: The two local documents have different stated schema floors; this was not treated as a resolved version claim.

### S-005: Local custom result renderer
- Family: IMPLEMENTATION
- URL or locator: `/home/j0k3r/.pi/agent/extensions/code-research/src/render.ts`
- Date/version: Local working copy
- Access method: `functions.read`
- Used for: Hard-coded `ctrl+o` finding and rendering review.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Hard-coded key strings appear in compact and expanded result helpers.

### S-006: Local reference/call resolvers and Go implementation
- Family: IMPLEMENTATION
- URL or locator: `/home/j0k3r/.pi/agent/extensions/code-research/src/core/{find-references-resolver,function-call-tree-resolver,reverse-function-call-tree-resolver}.ts`; `/home/j0k3r/.pi/agent/extensions/code-research/src/languages/go/{find-symbol,find-references,function-call-tree,reverse-function-call-tree}.ts`
- Date/version: Local working copy
- Access method: `functions.read`
- Used for: Go support confirmation, rejected auto modes, graph/direct routing, syntax-resolution limits, and forward/reverse merge rationale.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Go has concrete resolver implementations. The local Go reference implementation includes regex/line-pattern handling for variable references.

### S-007: Local README and package manifest
- Family: IMPLEMENTATION
- URL or locator: `/home/j0k3r/.pi/agent/extensions/code-research/{README.md,package.json}`
- Date/version: Local package version `0.1.0`
- Access method: `functions.read`
- Used for: Published tool inventory, stated language boundary, Python graph claims, structure, scripts, and dependency review.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: README is partly inconsistent with tool descriptions and requested language scope; implementation source was preferred when they differed.

### S-008: Pi Extensions documentation
- Family: PRIMARY
- URL or locator: `/home/j0k3r/.local/share/mise/installs/node/24.19.0/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`
- Date/version: Installed Pi documentation; version not stated in extracted file
- Access method: `functions.read`
- Used for: Tool schema/output bounds, continuations, dynamic loading, trust, lifecycle, renderer/keybinding, and compatibility guidance.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Read in three bounded sections. This is version-matched installed documentation, not a web summary.

### S-009: Navigating code on GitHub
- Family: PRIMARY
- URL or locator: https://docs.github.com/en/repositories/working-with-files/using-files/navigating-code-on-github
- Date/version: Live documentation; date not exposed in extraction
- Access method: `functions.web_search`, `functions.web_fetch`
- Used for: Comparison of tree-sitter-based code navigation, symbol panes, definitions/references, supported languages, and repository limits.
- Usefulness: MATERIAL
- Confidence impact: MEDIUM
- Notes: Fetch text was truncated after a large navigation shell, but search extraction contained the relevant capability/limit statements.

### S-010: About GitHub Code Search
- Family: PRIMARY
- URL or locator: https://docs.github.com/en/search-github/github-code-search/about-github-code-search
- Date/version: Live documentation; date not exposed in extraction
- Access method: `functions.web_search`
- Used for: Symbol-definition-only distinction and bounded/indexing limitations comparison.
- Usefulness: MATERIAL
- Confidence impact: MEDIUM
- Notes: Search-result extraction only; no full-page follow-up was required for the limited claim.

### S-011: Sourcegraph Symbol search
- Family: PRIMARY
- URL or locator: https://sourcegraph.com/docs/code-search/types/symbol
- Date/version: Live documentation; date not exposed in extraction
- Access method: `functions.web_search`, `functions.web_fetch`, `functions.context7_resolve_and_get_context`
- Used for: Declaration-oriented symbol search, categorization by kind, and index/query-path comparison.
- Usefulness: MATERIAL
- Confidence impact: MEDIUM
- Notes: Vendor documentation; does not establish local extension behavior.

### S-012: Sourcegraph Structural Search
- Family: PRIMARY
- URL or locator: https://sourcegraph.com/docs/code-search/types/structural
- Date/version: Live documentation; documentation says changed in version 5.3
- Access method: `functions.web_search`, `functions.web_fetch`
- Used for: Decision not to add structural search to the minimal extension surface.
- Usefulness: MATERIAL
- Confidence impact: MEDIUM
- Notes: Docs say the feature is disabled by default, has performance limitations, and is not actively developed; this is a cautionary comparison, not a universal verdict on structural search.

### S-013: ripgrep Guide
- Family: PRIMARY
- URL or locator: https://github.com/BurntSushi/ripgrep/blob/master/GUIDE.md
- Date/version: `master`; live repository guide, dated release not established
- Access method: `functions.context7_resolve_and_get_context`, `functions.web_fetch`
- Used for: Text/regex search separation, file-type/glob filtering, and JSON summary comparison.
- Usefulness: MATERIAL
- Confidence impact: MEDIUM
- Notes: Direct GitHub fetch was HTML-shell/truncated; Context7 extracted guide examples and repository source behavior. A GitHub repository metadata lookup under lowercase owner failed, so no release metadata was inferred.

### S-014: ast-grep introduction and documentation
- Family: PRIMARY
- URL or locator: https://ast-grep.github.io/guide/introduction.html; https://github.com/ast-grep/ast-grep
- Date/version: Live documentation/repository; dated release not established
- Access method: `functions.context7_get_context`, `functions.web_fetch`, `functions.github_get`
- Used for: Structural AST-pattern search as a distinct capability and decision not to add it to `code_find`.
- Usefulness: MATERIAL
- Confidence impact: MEDIUM
- Notes: Official project documentation/repository. Used only to characterize the separate problem space, not as best-practice proof.

### S-015: Language Server Protocol specification
- Family: PRIMARY
- URL or locator: https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/
- Date/version: Page labels LSP 3.18 as current and 3.17 as previous; fetched 3.17 URL
- Access method: `functions.web_search`, `functions.web_fetch`, `functions.github_get`
- Used for: Capability taxonomy: workspace symbols, definition, implementation, references, and incoming/outgoing call hierarchy.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: The fetched page was truncated, but its table of contents exposed the enumerated standardized capabilities. The recommendation does not claim Pi should implement LSP.

### S-016: gopls navigation features
- Family: PRIMARY
- URL or locator: https://go.dev/gopls/features/navigation
- Date/version: Live Go documentation; date not exposed in extraction
- Access method: `functions.web_search`, `functions.web_fetch`
- Used for: Fuzzy workspace-symbol matching, semantic-navigation limitations, and call-hierarchy incompleteness for dynamic calls.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Primary language-server documentation. Its build-configuration and dynamic-call caveats support transparent local-tool provenance; they do not prove identical local behavior.
