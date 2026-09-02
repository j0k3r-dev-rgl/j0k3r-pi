# Code Research SIAS Audit — Updated Remediation Plan

Date: 2026-09-02
Repo audited: `/home/j0k3r/sias/app`

## Current Status

Status: **NEEDS_FIX / TYPESCRIPT TYPE ALIASES + UNFILTERED REFERENCES REMAINING**

After regenerating the SIAS graph with builder model version `3`, the previous Java P0 class/type/DTO reference failures are resolved on the sampled SIAS regressions.

After the latest extension reload, TypeScript optional-chained calls are also resolved for `code_find relation=references` on the sampled SIAS regression.

Remaining work is concentrated in two TypeScript reference behaviors:

1. TypeScript type alias classification and references;
2. unfiltered TypeScript `relation=references` adjacent-line false positives.

## Graph Health

Current SIAS graph is regenerated and usable.

`workspace_graph_status`:

```text
fresh | usable=yes | monorepo=yes | shards=5 | indexed_files=1465
workspace_projects=lab,back,front,back_ia,back_files
partial_projects=0 | empty_projects=0
unreadable_dirs=4
```

Graph metadata inspection:

```text
.pi/workspace-code-graph/graph-manifest.json: builderModelVersion=3, schemaVersion=4
.pi/workspace-code-graph/workspace-state.json: builderModelVersion=3, schemaVersion=4
```

Unreadable paths are now exposed safely:

```text
docker_compose_sias/volumes/clamav_db/tmp.5c9d80a0a7
docker_compose_sias/volumes/mongo_data/_tmp
docker_compose_sias/volumes/mongo_data/diagnostic.data
docker_compose_sias/volumes/mongo_data/journal
```

Status: **PASS**.

## Fixed or Improved

### Java class/type/DTO references after graph regeneration

Status: **PASS on sampled regressions**

The previous P0 Java issue is fixed after SIAS graph regeneration with builder model version `3`.

#### `ReviewPersistenceModel`

Query:

```text
code_find path=back query=ReviewPersistenceModel relation=references language=java kind=class
```

Result:

```text
61 references
```

`rg` baseline:

```bash
rg -n '\bReviewPersistenceModel\b' back --glob '!target/**' | wc -l
# 48
```

Code Research now includes imports, type references, `.class` references, builder/static reads, method signatures, and local variable types.

#### `MongoIdUtils`

Query:

```text
code_find path=back query=MongoIdUtils relation=references language=java kind=class
```

Result:

```text
281 references
```

`rg` baseline:

```bash
rg -n '\bMongoIdUtils\b' back --glob '!target/**' | wc -l
# 313
```

Result is acceptable because Code Research returns semantic refs while `rg` includes textual/Javadoc/non-semantic hits.

#### `DocumentationItemDTO`

Query:

```text
code_find path=back_files query=DocumentationItemDTO relation=references language=java kind=class
```

Result:

```text
25 references
```

`rg` baseline:

```bash
rg -n '\bDocumentationItemDTO\b' back_files/src --glob '*.java' | wc -l
# 26
```

Code Research now includes imports, generic usage, return types, constructor calls, local variables, and test references.

#### `MongoConfigs`

Queries:

```text
code_find path=back query=MongoConfigs relation=references language=java kind=class
code_find path=back_files query=MongoConfigs relation=references language=java kind=class
```

Results:

```text
back: 3 references
back_files: 6 references
```

Status: **PASS**. Imports, constructor calls, and type references in tests are now returned.

### Java duplicate lambda/assertion references

Status: **PASS on sampled cases**

Previously duplicated call sites now appear once.

Examples retested:

- `createReview`
- `start`
- `loadFile`
- `toResponse`

Representative paths:

```text
back/src/test/java/.../CreateReviewUseCaseRegisterTypeScopeTest.java:26
back/src/test/java/.../StartReviewAnalysisUseCaseTest.java:149
back/src/test/java/.../StartReviewAnalysisUseCaseTest.java:184
back_files/src/test/java/.../StorageServiceTest.java:121
back_files/src/test/java/.../StorageServiceTest.java:148-150
back_files/src/test/java/.../StorageServiceTest.java:176-178
```

### Mockito verification calls

Status: **PASS on sampled cases**

`verify(..., never())` and related Mockito verification calls are now returned for:

```text
validateAndStageDocumentationUpload
```

Previously missed lines now appear:

```text
back_files/src/test/java/.../UploadFileBySlotUseCaseTest.java:167
back_files/src/test/java/.../UploadFileBySlotUseCaseTest.java:185
back_files/src/test/java/.../UploadFileBySlotUseCaseTest.java:293
back_files/src/test/java/.../UploadFileBySlotUseCaseTest.java:308
```

### TypeScript optional chaining in `code_find references` and call hierarchy

Status: **PASS on sampled regression after extension reload**

Both `code_call_hierarchy` and `code_find relation=references` now detect optional-chained method calls.

Confirmed example:

```text
back_ia/src/application/use-cases/analyze-image-readability.use-case.ts:26
```

```ts
await this.aiLogRepository?.save({ ... })
```

Retested query:

```text
code_find path=back_ia query=save relation=references language=ts kind=method reference_kinds=["call"]
```

Current result:

```text
3 confirmed references
back_ia/src/application/use-cases/analyze-image-readability.use-case.ts:26
back_ia/src/application/use-cases/fetch-to-ia.use-case.ts:39
back_ia/src/application/use-cases/start-review-analysis.use-case.ts:66
```

`AnalyzeImageReadabilityUseCase.execute` outgoing hierarchy also includes:

```text
AiLogRepository.save
call_line=26
```

### DI/dynamic call hierarchy transparency

Status: **IMPROVED / PARTIAL**

`startSiasAi` outgoing hierarchy reports dynamic dependency calls such as:

```text
deps.loadConfig
deps.buildServer
```

These are classified as probable/external leaves rather than resolved concrete implementations. This is acceptable if documented clearly.

### Frontend broad route declaration counts

Status: **PASS on sampled cases**

Broad `loader` / `action` declaration counts match `rg` under `front`:

```text
loader: 88
action: 27
```

## Remaining Problems

## P0 — TypeScript optional-chain calls in `code_find references`

Status: **PASS on sampled regression after extension reload**

A targeted Mini-SDD fixed graph-backed TypeScript optional-chain call consumption in `code_find relation=references`.

Implemented change:

```text
fix-ts-optional-chain-code-find-references
status: PASS / archived
archive: openspec/archive/2026-09-02/fix-ts-optional-chain-code-find-references/
```

Validation performed in Code Research repo:

```bash
cd /home/j0k3r/.pi/agent/extensions/code-research
npm test -- test/find-references.test.ts test/find-references-graph-fallback.test.ts
npm run typecheck
```

Result: **PASS**.

SIAS retest after extension reload:

```text
code_find path=back_ia query=save relation=references language=ts kind=method reference_kinds=["call"]
```

Current result:

```text
3 confirmed references
back_ia/src/application/use-cases/analyze-image-readability.use-case.ts:26
back_ia/src/application/use-cases/fetch-to-ia.use-case.ts:39
back_ia/src/application/use-cases/start-review-analysis.use-case.ts:66
```

The previously missing optional-chain call is now present:

```text
back_ia/src/application/use-cases/analyze-image-readability.use-case.ts:26
```

Source pattern:

```ts
await this.aiLogRepository?.save({ ... })
```

Status: **resolved on sampled SIAS regression**.

## P1 — TypeScript type alias classification and references fail

Status: **FAIL**

Observed with:

```text
ReviewAnalysisStatus
```

Declaration query still reports TypeScript type aliases as `[variable]`.

Failing query:

```text
code_find path=. query=ReviewAnalysisStatus language=ts relation=declaration
```

Observed results include declarations/import-like matches reported as variables:

```text
back_ia/src/application/ports/output/review-analysis-repository.ts:4 [variable]
front/app/server/features/review/review.query.server.ts:244 [variable]
```

References query fails:

```text
code_find path=. query=ReviewAnalysisStatus language=ts relation=references
```

Observed result:

```text
0 references
```

`rg` baseline:

```bash
rg -n '\bReviewAnalysisStatus\b' front back_ia --glob '!node_modules/**' --glob '!dist/**' | wc -l
# 45
```

Expected fix:

- classify `export type X = ...` as `type_alias` where possible;
- `relation=references` should include imports and type positions;
- if type aliases are internally represented as variables for compatibility, expose this limitation clearly and make `declaration_kind=type_alias` reliable.

## P1 — TypeScript adjacent-line false positives remain in unfiltered references

Status: **FAIL**

`reference_kinds=["call"]` works well for sampled call-only lookups, but unfiltered `relation=references` still returns adjacent/body lines that do not contain the symbol.

### `getDefaultRouteForRole`

Failing query:

```text
code_find path=front query=getDefaultRouteForRole relation=references language=ts kind=function
```

Observed result includes false positives:

```text
front/app/routes/home.tsx:31
front/app/routes/startup.tsx:15
```

Those lines are `redirect(route)` lines and do not contain `getDefaultRouteForRole`.

Call-only mode passes:

```text
code_find path=front query=getDefaultRouteForRole relation=references language=ts kind=function reference_kinds=["call"]
```

Correct result:

```text
front/app/routes/home.tsx:29
front/app/routes/startup.tsx:13
front/app/server/auth/session-flow.server.ts:42
```

### `buildModulesByDependencyModuleVariables`

Failing query:

```text
code_find path=front query=buildModulesByDependencyModuleVariables relation=references language=ts kind=function
```

False positive:

```text
front/app/server/features/modules/modules.query.server.ts:212
```

This is an adjacent `fetchToGraphql(...)` line after the real call.

Call-only mode passes:

```text
code_find path=front query=buildModulesByDependencyModuleVariables relation=references language=ts kind=function reference_kinds=["call"]
```

Correct result:

```text
front/app/server/features/modules/modules.query.server.ts:211
```

### `asRecord`

Failing query:

```text
code_find path=front query=asRecord relation=references language=ts kind=function
```

False positive:

```text
front/app/utils/review_analysis_ui.ts:199
```

Line content is unrelated to the symbol:

```ts
return normalizeRevisionDecision(rawDecision);
```

Call-only mode passes:

```text
code_find path=front query=asRecord relation=references language=ts kind=function reference_kinds=["call"]
```

Correct result:

```text
11 call references
```

Expected fix:

- reference results should point to the actual AST node span or at least a line containing the referenced symbol;
- parent callback/body lines should not be emitted as independent references;
- unfiltered `relation=references` should not be less precise than call-only mode for symbol locations.

## P2 — Frontend test/mock references still need policy clarification

Status: **PARTIAL / CONTRACT QUESTION**

Some frontend refs in tests/mocks were previously missed.

Examples:

```text
front/app/server/features/modules/modules.query.server.test.ts:69
front/app/server/features/modules/modules.query.server.test.ts:88
front/app/components/ImageUploader.test.ts
front/app/components/RouteErrorPanel.test.ts:2
```

Observed with:

- `buildModulesByDependencyModuleVariables`
- `ImageUploader`
- `RouteErrorPanel`

Clarify intended contract:

- If Code Research should include tests, these are false negatives.
- If test/mocks/textual refs are intentionally excluded, document that clearly and expose a way to request test refs if supported.

Note from latest manual retest:

- `buildModulesByDependencyModuleVariables` call-only currently returns the production call at line `211`, but not test calls at lines `69` and `88`.

## P2 — Framework entrypoints remain expected blind spots

Status: **EXPECTED / DOCUMENT**

Examples:

- Spring MVC invoking `DocumentController.getFile`;
- Servlet/Spring Security invoking `JwtFilter.doFilterInternal`.

These are not local application callers and should not necessarily be returned as incoming references.

Expected action:

- document this clearly;
- optionally classify framework overrides/entrypoints as framework-invoked when declaration extends known framework classes or has route/filter annotations.

## P2 — Java record accessor classification issue

Status: **POSSIBLE ISSUE**

Previously observed in `JwtFilter.doFilterInternal` outgoing hierarchy:

```text
VerifiedToken.subject
VerifiedToken.role
```

These were marked as probable external because Java record accessors may not be recognized as declared methods.

Expected action:

- verify Java record accessor symbol extraction;
- classify record component accessors as local methods/read references where appropriate.

## Regression Fixtures to Add

### Java fixtures

Java P0 class/type/DTO refs now pass on SIAS samples, but fixtures should remain to prevent regressions.

1. Class/type reference coverage:

```java
import example.MyType;

class UsesMyType {
  private MyType field;
  MyType method(MyType input) { return new MyType(); }
  Class<?> c = MyType.class;
  List<MyType> items;
}
```

2. Static utility class references:

```java
import example.MyUtils;

class UsesUtils {
  void run() {
    MyUtils.normalize("x");
  }
}
```

3. Record/DTO references:

```java
record ItemDTO(String id) {}
class UsesDto {
  ItemDTO build() { return new ItemDTO("1"); }
  List<ItemDTO> all() { return List.of(new ItemDTO("2")); }
}
```

4. Mockito verification calls:

```java
verify(service).save(any());
verify(service, never()).save(any());
verify(service, times(1)).save(any());
```

5. Lambda/assertion dedupe:

```java
assertThatThrownBy(() -> service.execute());
assertDoesNotThrow(() -> service.execute());
```

6. Record accessors:

```java
record VerifiedToken(String subject, String role) {}
class UsesToken {
  String read(VerifiedToken token) { return token.subject(); }
}
```

### TypeScript fixtures

1. Optional chaining calls:

```ts
await this.repo?.save({ id: "1" });
obj?.generate();
obj.method?.();
```

2. Adjacent false-positive guard:

```ts
const route = getDefaultRouteForRole(role);
return redirect(route);
```

Expected: only the first line is a reference to `getDefaultRouteForRole`.

3. Type alias references:

```ts
export type ReviewAnalysisStatus = "PENDING" | "DONE";
import type { ReviewAnalysisStatus } from "./types";
const status: ReviewAnalysisStatus = "PENDING";
```

4. JSX/default-export components and tests:

```tsx
export default function RouteErrorPanel() { return null; }
<RouteErrorPanel />
```

Clarify whether test imports and mocks should be returned.

## Validation Matrix

For each fixture and each real SIAS regression symbol, compare:

- `code_find relation=declaration`
- `code_find relation=references`
- `code_find relation=references reference_kinds=["call"]`
- `code_find relation=implementation` where applicable
- `code_call_hierarchy direction=outgoing`
- `code_call_hierarchy direction=incoming`
- targeted `rg` baseline

### Real SIAS regression symbols

Java regression symbols now passing after graph regeneration:

```text
ReviewPersistenceModel
MongoIdUtils
DocumentationItemDTO
MongoConfigs
CreateAuditLog
validateAndStageDocumentationUpload
loadFile
toResponse
```

TypeScript regression symbols still relevant:

```text
ReviewAnalysisStatus
getDefaultRouteForRole
buildModulesByDependencyModuleVariables
asRecord
ImageUploader
RouteErrorPanel
loader
action
```

TypeScript regression symbols now passing on sampled SIAS checks:

```text
save
```

## Recommended Fix Order

1. **TS type alias classification and references**
   - Fix `ReviewAnalysisStatus` declaration kind and refs.

2. **TS adjacent-line false positives**
   - Ensure unfiltered `relation=references` returns actual symbol lines/spans only.

3. **Frontend test/mock reference policy**
   - Either include test refs consistently or document/expose filtering semantics.

4. **Java record accessors**
   - Verify and improve record component accessor resolution/classification.

5. **Framework entrypoint documentation**
   - Document Spring MVC/Security lifecycle limitations or classify framework-invoked declarations.

## Temporary User-Facing Guidance

Until all TypeScript fixes are complete, keep this guidance:

```text
Code Research is semantic, not a replacement for exhaustive text search.
Use it first for declarations, implementations, references, and call hierarchy.
For audit-grade completeness, validate with targeted rg/grep, especially for TypeScript type aliases,
tests/mocks, framework-reflection entrypoints, generated files, and common names.
For Java class/type/DTO references, builder model version 3 has fixed the sampled SIAS regressions,
but keep rg validation for audit-grade changes until broader coverage is proven.
```

## Best-Practice Query Recipes

### Always start with graph status

```text
workspace_graph_status
```

### Java class references — now passing on SIAS samples

```text
code_find path=back query=ReviewPersistenceModel relation=references language=java kind=class
```

```bash
rg -n '\bReviewPersistenceModel\b' back --glob '!target/**'
```

### Java interface implementation

```text
code_find path=back_files query=CreateAuditLog relation=implementation language=java kind=interface
```

### TS optional-chain fallback

```bash
rg -n '\?\.\s*save\s*\(' back_ia --glob '!node_modules/**' --glob '!dist/**'
```

### TS call-only references to avoid adjacent false positives

```text
code_find path=front query=getDefaultRouteForRole relation=references language=ts kind=function reference_kinds=["call"]
```

### TS type alias fallback

```bash
rg -n '\bReviewAnalysisStatus\b' front back_ia --glob '!node_modules/**' --glob '!dist/**'
```

## Audit History

### First audit

Initial finding: Code Research was strong for declarations, implementations, JSX, and call hierarchy, but had issues with Java type references, TS optional chaining, duplicate Java references, Mockito verifications, TS adjacent lines, type aliases, and graph status transparency.

### Second audit after initial fixes/reload

Confirmed improvements:

- graph status unreadable paths;
- Java duplicate call ref dedupe;
- Mockito verification calls;
- optional chaining in call hierarchy;
- DI/dynamic call hierarchy transparency;
- broad `loader` / `action` declaration counts.

Remaining failures at that point:

- Java class/type/DTO references;
- TS optional-chain calls in `code_find references`;
- TS type alias classification/references;
- TS adjacent-line false positives;
- incomplete frontend test/mock refs.

### Graph inspection before Java remediation

A direct SIAS graph JSON inspection found:

- graph cache path: `/home/j0k3r/sias/app/.pi/workspace-code-graph/graphs/*.json`;
- Java declarations existed for failing symbols;
- `ReviewPersistenceModel` and `DocumentationItemDTO` had only `contains` edges;
- `MongoIdUtils` and `MongoConfigs` had method `calls` edges but lacked class/type/import reference modeling;
- TypeScript optional-chain `save` already existed as a call edge, suggesting that issue is resolver/query filtering rather than graph generation.

### Mini-SDD Java graph-generation remediation

Completed:

```text
fix-graph-java-type-references
commit: 570e30a
status: PASS / archived
```

This addressed Java graph generation/modeling and persisted semantic Java type/reference edges.

### Manual retest after SIAS graph regeneration

SIAS graph regenerated with:

```text
builderModelVersion=3
schemaVersion=4
```

Confirmed:

- Java class/type/DTO references now pass on sampled regressions;
- TypeScript optional-chain references still failed in `code_find` before the latest resolver-consumption Mini-SDD;
- TypeScript type aliases still fail classification/references;
- TypeScript unfiltered references still produce adjacent-line false positives.

### Mini-SDD TypeScript optional-chain reference remediation

Completed:

```text
fix-ts-optional-chain-code-find-references
status: PASS / archived
```

This addressed graph-backed `code_find relation=references` consumption for optional-chained TypeScript method calls.

### Manual retest after TypeScript optional-chain extension reload

Confirmed:

```text
code_find path=back_ia query=save relation=references language=ts kind=method reference_kinds=["call"]
```

returns:

```text
3 confirmed references, including back_ia/src/application/use-cases/analyze-image-readability.use-case.ts:26
```

Remaining TypeScript failures after this retest:

- `ReviewAnalysisStatus` type alias classification/references;
- unfiltered `relation=references` adjacent-line false positives for `getDefaultRouteForRole`, `buildModulesByDependencyModuleVariables`, and `asRecord`.

No SIAS source files were modified during the audits or remediations.
