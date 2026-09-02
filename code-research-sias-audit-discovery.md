# Code Research SIAS Audit — Implementation Discovery

Date: 2026-09-02
Root: `/home/j0k3r/.pi/agent`
Scope: one bounded read-only discovery for all four planned Mini-SDDs in `code-research-sias-audit-remediation.md`.

## Status

Code Research source/tests are under `extensions/code-research/**`.
Validation commands are defined in `extensions/code-research/package.json`.

Graph status during discovery:

```text
fresh | usable=yes | monorepo=yes | shards=17 | indexed_files=458 | unreadable_dirs=0 | workspace_projects=...,extensions/code-research,...
```

## Mini-SDD 1 — `fix-java-type-references`

Relevant implementation:

- `extensions/code-research/src/languages/java/find-references.ts`
  - `findJavaReferences`
  - `findTypeReferences`
  - Existing coverage includes imports, extends/implements, field types, constructor/instantiation regex.
  - Gaps: method parameter type references, method return type references, deeper generic type arguments, static member/class-qualified usages.
- `extensions/code-research/src/core/project-index.ts`
  - Field metadata carries `typeName/fullTypeName`.
  - Method metadata carries `returnType/fullReturnType` and parameter info.
  - May need extension if parameter spans/columns are required.

Existing tests/fixtures:

- `extensions/code-research/test/find-references.test.ts`
  - Java field/record/interface/diamond fixture around lines 670-707.
  - Java extends/implements metadata fixture around lines 762-856.
  - Graph/direct fallback coverage for Java interface refs around lines 709-728.

Test gaps:

- method parameter type references;
- method return type references;
- static utility/class-qualified references;
- explicit Java DTO/record constructor plus nested DTO generic fixture matching the roadmap.

## Mini-SDD 2 — `fix-ts-optional-chain-calls`

Relevant implementation:

- `extensions/code-research/src/languages/typescript/function-call-tree.ts`
  - `extractCalls`
  - `extractCall`
  - Current direct extraction handles `identifier` and `member_expression`; optional-chain node shape needs support.
- `extensions/code-research/src/languages/typescript/find-references.ts`
  - Callable refs use `extractCalls(..., { includeNestedCallableBodies: true })`.
- `extensions/code-research/src/core/workspace-graph.ts`
  - TS graph extraction has separate call extraction and currently handles only `identifier` and `member_expression`.

Existing tests/fixtures:

- `extensions/code-research/test/function-call-tree-typescript.test.ts`
  - normal TS method call hierarchy fixtures around lines 221-260.
- `extensions/code-research/test/find-references.test.ts`
  - existing class/method reference tests.

Test gaps:

- `obj?.save()`;
- `this.repo?.save({})`;
- `obj.method?.()`;
- outgoing call hierarchy fixture for optional chaining;
- graph/direct parity where relevant.

## Mini-SDD 3 — `fix-java-mockito-and-dedupe`

Relevant implementation:

- `extensions/code-research/src/languages/java/function-call-tree.ts`
  - `extractMethodCalls`
  - nested/lambda extraction;
  - `resolveJavaCallsForGraph`;
  - Mockito-like wrapper support currently unwraps only single-argument `verify`/`when`, likely missing `verify(mock, never())` and `verify(mock, times(1))`.
- `extensions/code-research/src/languages/java/find-references.ts`
  - method refs are built from resolved Java calls;
  - additional callback regex path may duplicate resolved lambda calls;
  - current Java dedupe key is weaker than target tuple.

Existing tests/fixtures:

- `extensions/code-research/test/find-references.test.ts`
  - simple Mockito `verify(useCase).deleteById("3")` fixture around lines 646-667;
  - `assertThrows(() -> useCase.export(...))` fixture around lines 858-876.
- `extensions/code-research/test/function-call-tree-java.test.ts`
  - Java call tree callback/compaction fixtures around lines 226-316.

Test gaps:

- `verify(mock, never()).method(...)`;
- `verify(mock, times(1)).method(...)`;
- explicit duplicate assertion for one reference per actual Java invocation node.

## Mini-SDD 4 — `fix-usability-status-and-docs`

Relevant implementation/docs:

- `extensions/code-research/src/languages/typescript/find-references.ts`
  - callable refs set `end_line` to full caller node end, not call-node span; likely contributes to adjacent-line/context noise.
  - TS dedupe exists.
- `extensions/code-research/src/tools/workspace-graph.ts`
  - summary details include `unreadableDirectories` internally;
  - compact content currently prints count, not bounded paths/categories.
- `extensions/code-research/src/core/workspace-graph.ts`
  - build/refresh collects unreadable directory relative paths safely.
- `extensions/code-research/README.md`
  - existing limitations mention dynamic/reflection/generated-code;
  - no explicit common-name recipes/guidance found.
- `extensions/code-research/src/languages/typescript/symbol-extractor.ts`
  - emits `type_alias`.
- `extensions/code-research/test/fixtures/typescript-symbol-cases.ts`
  - type alias fixture exists.
- `extensions/code-research/test/find-symbol.test.ts`
  - type alias test exists around line 347.

Existing tests/fixtures:

- `extensions/code-research/test/extension-entry.test.ts`
  - workspace status integration test around lines 251-294.
- `extensions/code-research/test/workspace-graph/permission-tolerance.test.ts`
  - permission tolerance verifies unreadable paths captured in graph state.
- `extensions/code-research/test/find-references.test.ts`
  - TS interface method dedupe fixture starts around lines 921-930.

Test gaps:

- TS adjacent-line false-positive fixture matching SIAS examples;
- compact `workspace_graph_status` output assertion for bounded unreadable paths/categories;
- docs/help test for common-name query guidance;
- documented dynamic/dependency-injection hierarchy limit test or doc assertion.

## Validation Commands

Full validation:

```bash
cd extensions/code-research
npm test
npm run typecheck
```

Targeted validation:

```bash
cd extensions/code-research
npx vitest run test/find-references.test.ts
npx vitest run test/function-call-tree-typescript.test.ts
npx vitest run test/function-call-tree-java.test.ts
npx vitest run test/extension-entry.test.ts test/workspace-graph/permission-tolerance.test.ts
```

## Worktree Note

Before Mini-SDD execution, the pre-existing dirty Code Research worktree was committed as baseline commit `3533bd2` after the roadmap commit `c228378`.

## Recommended Implementation Order

1. Java type references: extend `findTypeReferences` and Java index metadata/spans as needed.
2. TS optional-chain calls: fix direct `extractCall`, then graph extraction parity.
3. Java Mockito/dedupe: extend Java invocation unwrap for multi-argument `verify`, then strengthen dedupe.
4. Usability/status/docs: adjust TS call spans/adjacent-line behavior, compact unreadable-dir status content, and docs/help guidance.
