# Code Research SIAS Audit — Current Status

Date: 2026-09-02
Repo audited: `/home/j0k3r/sias/app`

## Status

**NEEDS_FIX — 2 TypeScript issues remain.**

Most earlier issues are resolved. The remaining active failures are:

1. TypeScript type alias references are persisted in the graph but not returned by `code_find relation=references`.
2. Unfiltered TypeScript `relation=references` still emits adjacent/callback lines that do not contain the queried symbol.

## Confirmed Fixed

### Java graph/reference issues — PASS

After SIAS graph regeneration with builder model version `3`, sampled Java regressions pass:

- `ReviewPersistenceModel`: `61` Code Research refs vs `48` `rg` lines.
- `MongoIdUtils`: `281` Code Research refs vs `313` `rg` lines.
- `DocumentationItemDTO`: `25` Code Research refs vs `26` `rg` lines.
- `MongoConfigs`: refs returned in both `back` and `back_files`.

Also fixed on sampled cases:

- Java duplicate lambda/assertion references.
- Mockito verification calls such as `verify(..., never())`.

### TypeScript optional-chained calls — PASS

After extension reload, this query now returns the previously missing optional-chain call:

```text
code_find path=back_ia query=save relation=references language=ts kind=method reference_kinds=["call"]
```

Current result includes 3 confirmed refs:

```text
back_ia/src/application/use-cases/analyze-image-readability.use-case.ts:26
back_ia/src/application/use-cases/fetch-to-ia.use-case.ts:39
back_ia/src/application/use-cases/start-review-analysis.use-case.ts:66
```

The first line is the key regression:

```ts
await this.aiLogRepository?.save({ ... })
```

### Graph health/status transparency — PASS

`workspace_graph_status` is fresh/usable and now exposes unreadable paths safely.

```text
fresh | usable=yes | monorepo=yes | shards=5 | indexed_files=1465
workspace_projects=lab,back,front,back_ia,back_files
unreadable_dirs=4
```

Unreadable paths:

```text
docker_compose_sias/volumes/clamav_db/tmp.5c9d80a0a7
docker_compose_sias/volumes/mongo_data/_tmp
docker_compose_sias/volumes/mongo_data/diagnostic.data
docker_compose_sias/volumes/mongo_data/journal
```

Graph metadata:

```text
.pi/workspace-code-graph/graph-manifest.json: builderModelVersion=3, schemaVersion=4
.pi/workspace-code-graph/workspace-state.json: builderModelVersion=3, schemaVersion=4
```

## Remaining Issue 1 — TypeScript type alias references

Status: **FAIL in tool result; graph evidence exists.**

Regression symbol:

```text
ReviewAnalysisStatus
```

Tool smoke results:

```text
code_find path=. query=ReviewAnalysisStatus relation=declaration language=ts
# 13 matches, still rendered as [variable]

code_find path=. query=ReviewAnalysisStatus relation=declaration language=ts declaration_kind=type_alias
# 2 matches, still rendered as [variable]

code_find path=. query=ReviewAnalysisStatus relation=references language=ts
# No references found
```

`rg` baseline:

```bash
rg -n '\bReviewAnalysisStatus\b' front back_ia --glob '!node_modules/**' --glob '!dist/**' | wc -l
# 45
```

### Graph JSON inspection result

The graph **does contain** type-alias declarations and semantic reference edges. This suggests the remaining bug is likely in `code_find` graph-backed consumption/filtering or output rendering, not graph generation.

Inspected shards:

```text
back_ia -> .pi/workspace-code-graph/graphs/0db2d2dc6313.json
front   -> .pi/workspace-code-graph/graphs/1b78eb3be0ae.json
```

Back IA graph evidence:

```text
type_alias declarations for ReviewAnalysisStatus: 1
incoming reads/imports to exact declaration: 42
related edges: contains=12, imports=7, reads=35
```

Example edge reasons:

```text
typescript_type_alias_reference
typescript_type_alias_import
```

Front graph evidence:

```text
type_alias declarations for ReviewAnalysisStatus: 1
incoming reads/imports to exact declaration: 1
related edges: contains=1, reads=1
```

The declaration node has:

```text
symbolKind=variable
declarationKind=type_alias
```

Expected next fix:

- `code_find relation=references` should consume `reads`/`imports` edges whose target has `declarationKind=type_alias`.
- User-facing output should render precise `declarationKind=type_alias` when available instead of only `[variable]`, or at least show both.

## Remaining Issue 2 — TypeScript unfiltered adjacent-line false positives

Status: **FAIL in tool result; graph call edges look cleaner than output.**

`reference_kinds=["call"]` returns correct call-only results, but unfiltered `relation=references` still emits callback/body lines that do not contain the queried symbol.

### Failing smokes

#### `getDefaultRouteForRole`

```text
code_find path=front query=getDefaultRouteForRole relation=references language=ts kind=function
```

Incorrect extra lines:

```text
front/app/routes/home.tsx:31
front/app/routes/startup.tsx:15
```

Those are `redirect(route)` lines, not `getDefaultRouteForRole` references.

Call-only mode is correct:

```text
reference_kinds=["call"] -> lines 29, 13, 42 only
```

Graph inspection: graph has only 3 call edges for this symbol, at the correct lines `29`, `13`, and `42`.

#### `buildModulesByDependencyModuleVariables`

```text
code_find path=front query=buildModulesByDependencyModuleVariables relation=references language=ts kind=function
```

Incorrect extra line:

```text
front/app/server/features/modules/modules.query.server.ts:212
```

Correct call line is `211`. Call-only mode returns only `211`.

#### `asRecord`

```text
code_find path=front query=asRecord relation=references language=ts kind=function
```

Incorrect extra line:

```text
front/app/utils/review_analysis_ui.ts:199
```

That line calls `normalizeRevisionDecision(rawDecision)`, not `asRecord`.

Call-only mode returns 11 correct call references.

Graph inspection: graph has 11 true `asRecord` call edges and does not need the line `199` false positive.

Expected next fix:

- Unfiltered `relation=references` should not add parent callback/body lines as independent references.
- If callback/body context is useful, expose it as contextual metadata, not as a reference row.
- Prefer actual occurrence ranges from graph edges when present.

## Secondary / Later Follow-ups

These are not blocking the main audit but should be tracked:

- Frontend test/mock reference policy: decide whether semantic refs should include test imports/mocks consistently.
- Java record accessor classification: verify record accessors such as `VerifiedToken.subject()` / `role()`.
- Framework entrypoint documentation: Spring MVC/Security incoming callers may be framework-invoked and not local references.

## Minimal Validation Checklist for Next Agent

Run from `/home/j0k3r/sias/app` after reload/regeneration if needed.

### Graph status

```text
workspace_graph_status
```

### Type alias smoke

```text
code_find path=. query=ReviewAnalysisStatus relation=declaration language=ts
code_find path=. query=ReviewAnalysisStatus relation=declaration language=ts declaration_kind=type_alias
code_find path=. query=ReviewAnalysisStatus relation=references language=ts
```

Expected:

- declaration output exposes `declarationKind=type_alias` clearly;
- references are non-zero and include persisted type alias import/read edges.

### Adjacent false-positive smoke

```text
code_find path=front query=getDefaultRouteForRole relation=references language=ts kind=function
code_find path=front query=buildModulesByDependencyModuleVariables relation=references language=ts kind=function
code_find path=front query=asRecord relation=references language=ts kind=function
```

Expected:

- no `home.tsx:31` or `startup.tsx:15` for `getDefaultRouteForRole`;
- no `modules.query.server.ts:212` for `buildModulesByDependencyModuleVariables`;
- no `review_analysis_ui.ts:199` for `asRecord`.

## Audit History Summary

- Initial audit found Java reference gaps, TS optional-chain gaps, duplicate Java refs, Mockito misses, TS adjacent false positives, TS type alias issues, and graph status transparency gaps.
- Java graph-generation remediation fixed sampled Java class/type/DTO refs after builder model version `3` graph regeneration.
- TS optional-chain remediation fixed sampled `save` optional-chain references after extension reload.
- Current remaining active issues are only:
  1. TS type alias graph-backed consumption/rendering;
  2. TS unfiltered adjacent-line false positives.

No SIAS source files were modified during the audits or remediations.
