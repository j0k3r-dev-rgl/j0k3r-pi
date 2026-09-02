# Code Research SIAS Audit — Current Status

Date: 2026-09-02
Repo audited: `/home/j0k3r/sias/app`

## Status

**ALMOST DONE — 1 TypeScript usability/default-kind issue remains.**

All original high-priority SIAS regression categories are now fixed or working with an explicit query shape. The only remaining issue is that TypeScript type-alias references work with `kind=variable`, but the same references are not returned when `kind` is omitted.

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

Query:

```text
code_find path=back_ia query=save relation=references language=ts kind=method reference_kinds=["call"]
```

Current result includes 3 confirmed refs, including the original optional-chain regression:

```text
back_ia/src/application/use-cases/analyze-image-readability.use-case.ts:26
back_ia/src/application/use-cases/fetch-to-ia.use-case.ts:39
back_ia/src/application/use-cases/start-review-analysis.use-case.ts:66
```

### TypeScript unfiltered adjacent-line false positives — PASS

After extension reload, the unfiltered `relation=references` smokes no longer return adjacent/callback lines.

Passing smokes:

```text
code_find path=front query=getDefaultRouteForRole relation=references language=ts kind=function
# 3 refs only: lines 29, 13, 42
# no home.tsx:31 or startup.tsx:15

code_find path=front query=buildModulesByDependencyModuleVariables relation=references language=ts kind=function
# 1 ref only: modules.query.server.ts:211
# no modules.query.server.ts:212

code_find path=front query=asRecord relation=references language=ts kind=function
# 11 refs only
# no review_analysis_ui.ts:199
```

### Graph health/status transparency — PASS

`workspace_graph_status` is fresh/usable and exposes unreadable paths safely.

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

## TypeScript Type Alias Status

Status: **PARTIAL / LAST REMAINING ISSUE**

Regression symbol:

```text
ReviewAnalysisStatus
```

### Declaration output — PASS

Declaration queries now expose the precise declaration kind:

```text
code_find path=. query=ReviewAnalysisStatus relation=declaration language=ts
```

Current output includes import aliases plus the two real type aliases. Type aliases are still coarse-rendered as `[variable]`, but now include precise metadata:

```text
back_ia/src/application/ports/output/review-analysis-repository.ts:4 [variable] declaration_kind=type_alias
front/app/server/features/review/review.query.server.ts:244 [variable] declaration_kind=type_alias
```

Explicit type-alias declaration query also works:

```text
code_find path=. query=ReviewAnalysisStatus relation=declaration language=ts declaration_kind=type_alias
# 2 matches, both declaration_kind=type_alias
```

This is acceptable because `[variable]` is preserved for compatibility while `declaration_kind=type_alias` is visible.

### References with explicit kind — PASS

Type-alias references now work when using the compatibility kind:

```text
code_find path=. query=ReviewAnalysisStatus relation=references language=ts kind=variable
```

Current result:

```text
47 references
```

Breakdown from focused checks:

```text
back_ia: 46 references
front: 1 reference
```

`rg` baseline:

```bash
rg -n '\bReviewAnalysisStatus\b' front back_ia --glob '!node_modules/**' --glob '!dist/**' | wc -l
# 45
```

The Code Research count is reasonable because it returns semantic import/read rows and can split import + read on the same line.

### References without kind — FAIL

The only remaining issue:

```text
code_find path=. query=ReviewAnalysisStatus relation=references language=ts
```

Current result:

```text
No references found
```

Expected behavior:

- When `kind` is omitted, Code Research should still consider TypeScript type aliases and return the same relevant references as `kind=variable`, or at least suggest the correct query shape.
- This is now a usability/default-kind bug, not a graph-generation failure.

Likely fix area:

- broad/no-kind reference candidate selection for TS type aliases;
- fallback from no-kind references to `declarationKind=type_alias` / compatibility `kind=variable` symbols;
- optional warning/suggestion when exact symbol exists only as `declaration_kind=type_alias`.

## Graph JSON Inspection Result for Type Aliases

Graph generation is not the remaining blocker.

Inspected shards:

```text
back_ia -> .pi/workspace-code-graph/graphs/0db2d2dc6313.json
front   -> .pi/workspace-code-graph/graphs/1b78eb3be0ae.json
```

Evidence found:

```text
back_ia type_alias declarations for ReviewAnalysisStatus: 1
back_ia incoming reads/imports to exact declaration: 42
back_ia related edges: contains=12, imports=7, reads=35

front type_alias declarations for ReviewAnalysisStatus: 1
front incoming reads/imports to exact declaration: 1
front related edges: contains=1, reads=1
```

Example edge reasons:

```text
typescript_type_alias_reference
typescript_type_alias_import
```

Declaration node shape:

```text
symbolKind=variable
declarationKind=type_alias
```

Conclusion: graph data exists and explicit-kind tool lookup can consume it. Only no-kind reference lookup remains inconsistent.

## Minimal Final Smoke Checklist

Run from `/home/j0k3r/sias/app` after the final fix/reload.

### Graph status

```text
workspace_graph_status
```

### Remaining type-alias default-kind smoke

```text
code_find path=. query=ReviewAnalysisStatus relation=references language=ts
```

Expected:

```text
non-zero references, ideally matching the explicit-kind query behavior
```

Compare with explicit working query:

```text
code_find path=. query=ReviewAnalysisStatus relation=references language=ts kind=variable
# currently 47 references
```

### Already passing regression smokes to keep green

```text
code_find path=back_ia query=save relation=references language=ts kind=method reference_kinds=["call"]

code_find path=front query=getDefaultRouteForRole relation=references language=ts kind=function
code_find path=front query=buildModulesByDependencyModuleVariables relation=references language=ts kind=function
code_find path=front query=asRecord relation=references language=ts kind=function
```

Expected:

- `save` includes `analyze-image-readability.use-case.ts:26`.
- No adjacent false-positive lines:
  - no `home.tsx:31`;
  - no `startup.tsx:15`;
  - no `modules.query.server.ts:212`;
  - no `review_analysis_ui.ts:199`.

## Secondary / Later Follow-ups

Not blocking this main audit:

- Frontend test/mock reference policy.
- Java record accessor classification.
- Framework entrypoint documentation for Spring MVC/Security lifecycle calls.

## Audit History Summary

- Initial audit found Java reference gaps, TS optional-chain gaps, duplicate Java refs, Mockito misses, TS adjacent false positives, TS type alias issues, and graph status transparency gaps.
- Java graph-generation remediation fixed sampled Java class/type/DTO refs after builder model version `3` graph regeneration.
- TS optional-chain remediation fixed sampled `save` optional-chain references after extension reload.
- TS adjacent-line false-positive remediation fixed sampled unfiltered TS reference output after extension reload.
- TS type-alias graph-consumption/rendering now works with explicit `kind=variable` and exposes `declaration_kind=type_alias`.
- Current remaining issue: no-kind TS type-alias references return zero despite explicit-kind references working.

No SIAS source files were modified during the audits or remediations.
