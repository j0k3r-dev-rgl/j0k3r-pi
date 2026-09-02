## Workflow Status
- Status: READY
- Blockers: None

## Workflow & Contracts
- Change slug: fix-graph-java-type-references
- Change type: Mini-SDD remediation after BLOCKED verify
- Authority artifact: /home/j0k3r/.pi/agent/openspec/changes/fix-graph-java-type-references/mini-sdd.md
- Scope source artifact containing Execution Scope: /home/j0k3r/.pi/agent/openspec/changes/fix-graph-java-type-references/mini-sdd.md
- Failed verify artifact remediated: /home/j0k3r/.pi/agent/openspec/changes/fix-graph-java-type-references/verify.md
- Artifact contract: /home/j0k3r/.pi/agent/skills/subagent-artifact-contracts/SKILL.md
- Supporting artifact read-only: /home/j0k3r/.pi/agent/code-research-sias-audit-remediation.md
- User clarification applied: do not rely on model-facing Code Research tool invocation as acceptance; prioritize graph/shard generation correctness and JSON edge assertions, with resolver/query changes kept minimal for graph-backed consumption.

## Authorization Record
- Authorized by: User
- Authorization reference: current user remediation request in this session citing failed verify artifact /home/j0k3r/.pi/agent/openspec/changes/fix-graph-java-type-references/verify.md and workflow next action “sdd-apply remediation for fix-graph-java-type-references”.
- Authorized action: remediate blocked Mini-SDD apply issues and update apply artifact.
- Authorized scope: exactly the Execution Scope in /home/j0k3r/.pi/agent/openspec/changes/fix-graph-java-type-references/mini-sdd.md, limited to field type-reference coordinate precision and SIAS-category regression mapping.
- Authority artifact: /home/j0k3r/.pi/agent/openspec/changes/fix-graph-java-type-references/mini-sdd.md
- Candidate/change slug: fix-graph-java-type-references

## MINI-001 Evidence
- Implementation files:
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/project-index.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/workspace-graph.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/graph-schema.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/types.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/workspace-graph/shard-content.test.ts
- Evidence: Java project indexing records `IndexedJavaTypeReference` entries for imports, field/simple type positions, local/generic type usage, constructor/record instantiation, `.class`-compatible type tokens through AST type identifiers, and static class-qualified method/field reads. Workspace graph building persists those as `imports` or semantic `reads` edges to Java class/interface symbol nodes with `occurrenceRange`, `calledAs`, `reason`, and target resolution metadata.
- Evidence: Existing Java implements/extends edges persist occurrence metadata and `calledAs` for relationship tokens while retaining existing resolved/external relationship behavior.
- Evidence: `WORKSPACE_GRAPH_BUILDER_MODEL_VERSION` changed from 2 to 3 because persisted shard semantics changed.
- Remediation evidence for verify ISSUE-001: `IndexedField` now stores the field type AST node range separately from the variable declarator/field-name range, and `collectJavaTypeReferences` uses `typeLine`, `typeColumn`, `typeEndLine`, and `typeEndColumn` for simple field `type_reference` edges.
- Test evidence: /home/j0k3r/.pi/agent/extensions/code-research/test/workspace-graph/shard-content.test.ts includes `persists SIAS-mapped java type reference edges with token coordinates for ReviewPersistenceModel, MongoIdUtils, DocumentationItemDTO, and MongoConfigs`, which builds a Java fixture modeled on the named SIAS failure categories and asserts generated shard JSON edges directly for import, implements, type_reference, instantiate, and static class-qualified read categories with persisted coordinates.
- Remediation test evidence for verify ISSUE-001: the shard test directly asserts the `ReviewPersistenceModel` simple field type edge has `occurrenceRange: { startLine: 10, startColumn: 16, endLine: 10, endColumn: 38 }` and `calledAs: 'ReviewPersistenceModel'`, proving the edge points at the type token rather than the `current` field-name token.

## MINI-002 Evidence
- Implementation files:
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/reference-graph-queries.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/graph-policy.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/types.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references-graph-fallback.test.ts
- Evidence: Graph-backed reference querying consumes persisted Java `imports` and Java semantic `reads` edges and maps edge reasons to `import`, `type_reference`, `instantiate`, and `read` reference kinds without rereading source for those categories. Relationship metadata prefers persisted edge coordinates/calledAs and only falls back to source text for legacy relationship edges.
- Evidence: Graph coverage policy includes the new persisted reference kinds so fresh graph-backed Java class/interface reference queries can be served from graph artifacts when those kinds are requested or unfiltered.
- Test evidence: /home/j0k3r/.pi/agent/extensions/code-research/test/find-references-graph-fallback.test.ts includes `uses graph-backed SIAS-mapped java type reference edges for ReviewPersistenceModel, MongoIdUtils, DocumentationItemDTO, and MongoConfigs after source consumers are removed`, which builds the graph, removes the Java consumer source file, and verifies non-zero graph-backed Java references for import, type_reference, instantiate, read, and implements categories from persisted graph artifacts alone.

## MINI-003 Evidence
- Implementation/test files:
  - /home/j0k3r/.pi/agent/extensions/code-research/test/workspace-graph/shard-content.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references-graph-fallback.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts
- Evidence: Regression coverage now names and asserts audited failure shapes directly: `ReviewPersistenceModel` class/model references, `MongoIdUtils` static utility qualification, `DocumentationItemDTO` DTO/record constructor/generic references, and `MongoConfigs` config/interface relationship coverage.
- Evidence: Shard-level proof is the direct JSON edge assertion test in shard-content; query-level proof is the graph-backed source-removed test in find-references-graph-fallback. Existing find-references Java class/interface/type reference tests remained passing under the new graph semantics.
- Remediation evidence for verify ISSUE-002: shard and graph-backed regression test names and assertion messages contain the four SIAS category names (`ReviewPersistenceModel`, `MongoIdUtils`, `DocumentationItemDTO`, `MongoConfigs`) instead of only generic MyType/MyUtils/ItemDTO/MyPort aliases.

## Approved Deviations
- None.

## Attempt Record
- Initial apply RED evidence: `cd /home/j0k3r/.pi/agent/extensions/code-research && npm test -- test/workspace-graph/shard-content.test.ts test/find-references-graph-fallback.test.ts test/find-references.test.ts` initially failed 2 existing Java graph/direct alignment assertions for diamond instantiation called_as/column and extends column compatibility.
- Initial apply remediation: preserved token-precise shard coordinates while normalizing graph query output to existing direct-result compatibility for Java instantiation and relationship columns.
- Initial apply GREEN evidence: `cd /home/j0k3r/.pi/agent/extensions/code-research && npm test -- test/workspace-graph/shard-content.test.ts test/find-references-graph-fallback.test.ts test/find-references.test.ts` passed with 3 test files and 65 tests.
- Verify remediation RED evidence: after renaming the fixtures to SIAS category names, the focused validation initially failed because the `ReviewPersistenceModel` import end column and `DocumentationItemDTO` graph-backed assertion expected pre-normalization values.
- Verify remediation: corrected the import coordinate assertion to the exact shard token range, used persisted field type AST ranges for simple field edges, and asserted DTO/record graph-backed instantiation by `java_instantiate` evidence.
- Verify remediation GREEN evidence: `cd /home/j0k3r/.pi/agent/extensions/code-research && npm test -- test/workspace-graph/shard-content.test.ts test/find-references-graph-fallback.test.ts test/find-references.test.ts` passed with 3 test files and 65 tests.
- Typecheck evidence: `cd /home/j0k3r/.pi/agent/extensions/code-research && npm run typecheck` passed.

## Candidate Identity
- Candidate/change slug: fix-graph-java-type-references
- Workspace root: /home/j0k3r/.pi/agent
- Modified implementation/test paths:
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/graph-policy.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/graph-schema.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/project-index.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/reference-graph-queries.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/workspace-graph.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/types.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references-graph-fallback.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/workspace-graph/shard-content.test.ts
- Pre-existing modified file not overwritten: /home/j0k3r/.pi/agent/code-research-sias-audit-remediation.md

## Residual Risks
- The implementation intentionally focuses on Java graph generation and minimal graph consumption; broader TypeScript resolver issues, frontend mock policy, Java record accessor call hierarchy, SIAS source changes, and framework documentation remain excluded by scope.
- Persisted semantics changed and stale shard reuse is prevented by builder model version 3; existing external shards must be regenerated before they can expose the new Java type reference evidence.

## Verification Inputs
- Authority artifact: /home/j0k3r/.pi/agent/openspec/changes/fix-graph-java-type-references/mini-sdd.md
- Failed verify artifact remediated: /home/j0k3r/.pi/agent/openspec/changes/fix-graph-java-type-references/verify.md
- Apply artifact: /home/j0k3r/.pi/agent/openspec/changes/fix-graph-java-type-references/apply.md
- Validation commands:
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm test -- test/workspace-graph/shard-content.test.ts test/find-references-graph-fallback.test.ts test/find-references.test.ts
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm run typecheck
- Key verification focus: inspect generated shard JSON edge assertions for Java import/type/instantiate/static-qualified/read/relationship evidence, including the simple field type token range and SIAS category names, rather than relying on model-facing tool invocation.

## Next Permitted Action
sdd-verify for fix-graph-java-type-references
