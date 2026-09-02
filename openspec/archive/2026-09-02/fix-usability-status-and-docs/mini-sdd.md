## Workflow Status
- Status: READY
- Blockers: None

## Goal
Prepare a bounded implementation slice for fix-usability-status-and-docs that removes TypeScript adjacent-line reference noise, improves workspace_graph_status unreadable-directory transparency, and adds concrete Code Research guidance for common-name queries, dynamic call-hierarchy limits, semantic-vs-text fallback, and TypeScript type-alias expectations.

## Scope & Exclusions
- In scope:
  - TypeScript callable reference span/noise fixes adjacent to the actual call site.
  - workspace_graph_status compact output for unreadable directory summaries.
  - Code Research README and tool-help guidance for common names, semantic-vs-text fallback, dynamic/dependency-injection limits, and TypeScript type-alias expectations.
  - Relevant tests under extensions/code-research/**.
- Exclusions:
  - P0 Java and TypeScript semantic fixes already covered by Mini-SDDs 1-3.
  - New text-search mode.
  - Broad UI redesign.
  - Generated artifacts, secrets, and unrelated extensions.
  - Broad TypeScript symbol-model refactors beyond small type-alias doc/test confirmation.

## Execution Scope
- Root: /home/j0k3r/.pi/agent
- Allowed Paths:
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/typescript/find-references.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/tools/workspace-graph.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/tools/code-find.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/README.md
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/extension-entry.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/workspace-graph/permission-tolerance.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-symbol.test.ts
- Writable Paths:
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/typescript/find-references.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/tools/workspace-graph.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/tools/code-find.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/README.md
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/extension-entry.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/workspace-graph/permission-tolerance.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-symbol.test.ts
- Allowed Bash:
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npx vitest run test/find-references.test.ts
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npx vitest run test/extension-entry.test.ts test/workspace-graph/permission-tolerance.test.ts
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npx vitest run test/find-symbol.test.ts
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm test
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm run typecheck
- Notes: Keep the slice inside extensions/code-research with no implementation outside the listed source, doc, and test files.

### MINI-001: Tighten TypeScript callable reference spans to the actual call node
- Contract: Update TypeScript callable-reference construction so returned ranges describe the actual call site instead of the entire caller body when a semantic call match is resolved.
- Acceptance:
  - code_find relation=references for TypeScript callables no longer reports adjacent non-symbol lines as separate effective reference spans.
  - The regression fixture covers the roadmap cases where getDefaultRouteForRole and buildModulesByDependencyModuleVariables previously surfaced neighboring callback/body lines without the target symbol.
  - The returned line and end_line for the regression case stay on the line containing the matched symbol/call text.
- Canonical sources:
  - /home/j0k3r/.pi/agent/code-research-sias-audit-remediation.md
  - /home/j0k3r/.pi/agent/code-research-sias-audit-discovery.md
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/typescript/find-references.ts
- Paths:
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/typescript/find-references.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts
- Validation:
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npx vitest run test/find-references.test.ts
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm run typecheck
- Depends on: None

### MINI-002: Expose bounded unreadable-directory details in workspace_graph_status output
- Contract: Extend workspace_graph_status compact content so unreadable directory counts remain concise but also identify bounded relative unreadable directory paths or categories without exposing file contents or secret material.
- Acceptance:
  - When unreadable_dirs is greater than zero, workspace_graph_status content includes a bounded, relative summary derived from the existing unreadableDirectories state.
  - The summary remains compact for normal success output and does not remove existing count, freshness, or monorepo metadata.
  - Permission-tolerance coverage still proves unreadable directories are captured, and tool integration coverage asserts the compact user-facing summary.
- Canonical sources:
  - /home/j0k3r/.pi/agent/code-research-sias-audit-remediation.md
  - /home/j0k3r/.pi/agent/code-research-sias-audit-discovery.md
  - /home/j0k3r/.pi/agent/extensions/code-research/src/tools/workspace-graph.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/workspace-graph.ts
- Paths:
  - /home/j0k3r/.pi/agent/extensions/code-research/src/tools/workspace-graph.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/extension-entry.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/workspace-graph/permission-tolerance.test.ts
- Validation:
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npx vitest run test/extension-entry.test.ts test/workspace-graph/permission-tolerance.test.ts
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm run typecheck
- Depends on: None

### MINI-003: Add implementation-safe Code Research guidance for noisy queries and known limits
- Contract: Update review-facing docs and tool guidance so users can choose smaller paths and stronger filters for common names, understand semantic-vs-text fallback expectations, and see the current dynamic/dependency-injection and TypeScript type-alias limits without changing the public tool set.
- Acceptance:
  - README guidance explicitly recommends the smallest relevant path, explicit language, explicit kind, declaring-file path for common method names, and reference_kinds=["call"] only for call-only impact checks.
  - README guidance preserves the semantic-first contract and tells users to validate suspicious or audit-grade gaps with targeted rg or grep rather than presenting Code Research as exhaustive text search.
  - README or tool guidance explicitly documents that dynamic or dependency-injection call hierarchy may miss injected receiver calls.
  - TypeScript type-alias guidance is clarified as a small confirmation only: extraction supports declaration_kind=type_alias, while coarse kind may still appear as variable unless a narrow test expectation or doc note says otherwise.
- Canonical sources:
  - /home/j0k3r/.pi/agent/code-research-sias-audit-remediation.md
  - /home/j0k3r/.pi/agent/code-research-sias-audit-discovery.md
  - /home/j0k3r/.pi/agent/extensions/code-research/README.md
  - /home/j0k3r/.pi/agent/extensions/code-research/src/tools/code-find.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/typescript/symbol-extractor.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-symbol.test.ts
- Paths:
  - /home/j0k3r/.pi/agent/extensions/code-research/README.md
  - /home/j0k3r/.pi/agent/extensions/code-research/src/tools/code-find.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-symbol.test.ts
- Validation:
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npx vitest run test/find-symbol.test.ts
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm test
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm run typecheck
- Depends on: None

## Risks & Constraints
- Keep the status-line addition bounded; do not dump long path lists or any unreadable file contents.
- Do not reopen Mini-SDD 2 optional-chain behavior or Mini-SDD 1 and 3 Java extraction work while fixing TypeScript span noise.
- Keep common-name and fallback guidance consistent with the existing semantic-first contract in the remediation roadmap.
- Treat TypeScript type aliases as a documentation or narrow test-confirmation concern only unless a tiny expectation fix is required by the existing extractor behavior.

## Open Decisions
- None.

## Next Permitted Action
- sdd-apply for fix-usability-status-and-docs
