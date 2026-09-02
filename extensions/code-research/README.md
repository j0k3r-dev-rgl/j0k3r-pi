# pi-code-research-extension

[English](#english) | [Español](#español)

## English

Global Pi extension for code navigation and codebase impact analysis across the languages intentionally supported by this workspace: **TypeScript, JavaScript, Java, and Go**.

The public surface is intentionally small:

- `code_find` — universal symbol-aware finder for declarations, implementations, and references.
- `code_call_hierarchy` — incoming/outgoing call hierarchy in one directional tool.
- `workspace_graph_status` — graph/monorepo health and coverage status for agents that need to know whether indexed graph data is usable.
- `code_change_surface` — bounded symbol-anchored change map for agents preparing an implementation.

### Supported languages

| Capability | TypeScript | JavaScript | Java | Go |
|------------|------------|------------|------|----|
| `code_find` declarations/implementations | ✅ `ts` / `auto` | ✅ `js` / `auto` | ✅ `java` / `auto` | ✅ `go` / `auto` |
| `code_find` references | ✅ `ts` / `auto` | ✅ `js` / `auto` | ✅ `java` / `auto` | ✅ `go` / `auto` |
| `code_call_hierarchy` outgoing/incoming | ✅ `ts` / `auto` | ✅ `js` / `auto` | ✅ `java` / `auto` | ✅ `go` / `auto` |
| Workspace graph indexing/status | ✅ | ✅ | ✅ | ✅ |
| `code_change_surface` bounded change map | ✅ `ts` / `auto` | ✅ `js` / `auto` | ✅ `java` / `auto` | ✅ `go` / `auto` |

No public tool supports Python or other languages.

### Workspace graph and fallback behavior

The extension can persist a workspace graph under `.pi/workspace-code-graph` when graph support is enabled in `.pi/code-research.json`:

```json
{
  "graph": {
    "enable": true,
    "addGitignore": true
  }
}
```

- `graph.enable` defaults to `false` and gates graph refresh scheduling plus graph-backed query usage.
- `graph.addGitignore` defaults to `true` and lets the graph writer maintain ignore entries for generated graph artifacts.
- Graph-backed queries use schema v4 persisted graph artifacts only when they are enabled, readable, schema-compatible, fresh enough, language-supported, and sufficient for the requested query.
- Older graph artifacts are treated as incompatible and regenerated instead of migrated.
- Tools automatically fall back to direct source inspection when the graph is disabled, missing, stale, partial, errored, incompatible, refreshing, unreadable, language-unsupported, or insufficient.
- Query results include concise provenance/diagnostics in `details` so the agent can distinguish graph, direct, and fallback behavior.
- Persisted graph call/reference occurrences store ranges, receiver metadata, target status, and resolution state, but do not persist raw callsite source text.
- `workspace_graph_status` remains public because monorepos often contain multiple subprojects/languages and agents need a quick health/coverage summary before relying on graph-backed analysis.

### Registered tools

#### `code_find`

Universal symbol-aware finder for TypeScript, JavaScript, Java, and Go. Use it for declarations, implementations, or references of variables, functions, methods, classes, interfaces, fields, enums, and related symbols.

Parameters:

- `path` *(string, required)*: file or directory to search. Relative paths resolve against the current working directory.
- `query` *(string, required)*: symbol name to find.
- `relation` *(string, optional)*: `declaration`, `implementation`, or `references`. Default: `declaration`.
- `language` *(string, optional)*: `auto`, `ts`, `js`, `java`, or `go`. Default: `auto`.
- `kind` *(string, optional)*: `function`, `class`, `method`, `interface`, or `variable`.
- `declaration_kind` *(string, optional)*: granular declaration filter for declaration/implementation lookup.
- `match` *(string, optional)*: `exact`, `prefix`, or `contains`. Default: `exact`.
- `include_signature` *(boolean, optional)*: include symbol signatures where supported.
- `include_code` *(boolean, optional)*: include source for exact executable declarations where supported.
- `scope` *(string, optional)*: `file` or `directory`; inferred when omitted.
- `glob` *(string, optional)*: glob filter for directory scans.
- `reference_kinds` *(array, optional)*: for `relation=references`, filter to graph-fast-path kinds such as `call`, `read`, `implements`, or `extends`.
- `limit` *(number, optional)*: maximum results in this page. Default `50`, max `100`.
- `cursor` *(string, optional)*: continuation cursor from a previous `code_find` response.

Result:

- `content`: bounded human/model-readable summary for the current page.
- `details.items` / `details.results`: current page of symbol or reference records.
- `details.summary`: `returned`, `total`, `has_more`, `next_cursor`, `offset`, and `limit`.
- `details.provenance`: graph/direct/fallback diagnostics.

#### `code_call_hierarchy`

Directional call hierarchy tool for TypeScript, JavaScript, Java, and Go.

Parameters:

- `path` *(string, required)*: file containing the root/target function or method, or a directory to scan for project context.
- `symbol` *(string, required)*: root or target function/method/class symbol name.
- `direction` *(string, required)*: `outgoing` for callees or `incoming` for callers.
- `language` *(string, optional)*: `auto`, `ts`, `js`, `java`, or `go`. Default: `auto`.
- `kind` *(string, optional)*: `method`, `function`, or `class`.
- `max_depth` *(number, optional)*: maximum recursive depth. Default `10`, max `10`.
- `include_external` *(boolean, optional)*: outgoing only; include framework/library/language calls as leaves.
- `compacted` *(boolean, optional)*: outgoing only; compact trivial data-access siblings where supported.

Result shape matches the existing call-tree contract with `root` and `stats`, plus `details.direction`.

#### `workspace_graph_status`

Reports whether persisted workspace graph data is available, fresh, stale, partial, missing, disabled, errored, incompatible, or refreshing. It also reports monorepo/subproject layout and language coverage counts so the agent can decide whether graph-backed inspection is trustworthy.

#### `code_change_surface`

Builds a bounded, implementation-ready map for one symbol-anchored change. It composes existing declaration, implementation, reference, and incoming-call inspection; it does not add graph persistence or infer broad natural-language change plans.

Parameters:

- `path` *(string, required)*: file or directory to inspect.
- `query` *(string, required)*: exact symbol name anchoring the potential change.
- `language` *(string, optional)*: `auto`, `ts`, `js`, `java`, or `go`. Default: `auto`.
- `kind` *(string, optional)*: `function`, `class`, `method`, `interface`, or `variable`.
- `scope` *(string, optional)*: `file` or `directory`.
- `glob` *(string, optional)*: optional file glob for directory scans.
- `implementation_mode` *(string, optional)*: `representative` or `exhaustive`. Default: `representative`.
- `test_mode` *(string, optional)*: `representative` or `exhaustive`. Default: `representative`.
- `caller_mode` *(string, optional)*: `representative` or `exhaustive`. Default: `representative`.
- `max_implementations` / `max_tests` / `max_callers` *(number, optional)*: caps for exhaustive mode. Default: `50`, max: `100`.

Result:

- `content`: compact bounded summary separating contract, implementations, callers to inspect, likely tests, validation suggestions, risks, trust, and follow-up inspection needs.
- `details.contract`, `details.implementations`, `details.callers`, and `details.likely_tests`: capped sections with `returned`, `total`, `omitted`, and `follow_up` metadata when additional inspection is needed.
- `details.implementation_reporting`, `details.caller_reporting`, and `details.test_reporting`: visible mode/completeness metadata, including `exhaustive-truncated` when an exhaustive result still hits its cap. Exhaustive means exhaustive over Code Research semantic evidence, not every raw textual match.
- `details.validation_suggestions`: heuristic, file-oriented suggestions only; the tool does not fabricate exact repository-specific runner commands.
- `details.trust` and `details.fallback`: explicit confidence state and exact existing-tool follow-up actions (`code_find` or `code_call_hierarchy`) when the map is ambiguous, missing, or truncated.

### Installation

The extension lives at `~/.pi/agent/extensions/code-research/`. Pi auto-discovers it at startup.

```bash
cd ~/.pi/agent/extensions/code-research
npm test
npm run typecheck
```

### Structure

```text
code-research/
├── index.ts                 # entry point: registers public tools and graph lifecycle hooks
├── src/
│   ├── config.ts            # .pi/code-research.json loading
│   ├── types.ts             # shared public/internal types
│   ├── core/                # resolver, graph, parser, policy, and workspace helpers
│   ├── languages/           # TypeScript/JavaScript, Java, Go analyzers
│   └── tools/               # Pi tool registrations
├── test/                    # unit and integration tests
└── scripts/                 # manual verification and benchmarks
```

### Notes

- Uses native `tree-sitter` with pinned parsers and exact versions.
- Resolution is syntax/graph based, not a full compiler or LSP server. Results include provenance and may be incomplete for dynamic dispatch, reflection, generated code, build tags, or unsupported language constructs.
- Symbol coverage details live in `docs/typescript-symbol-contract-v1.md`, `docs/typescript-symbol-coverage-v1.md`, `docs/java-symbol-coverage-v1.md`, and `docs/go-symbol-coverage-v1.md`.
- Text/regex search is intentionally not part of this extension; use Pi's built-in grep/bash tools for that.

## Español

Extensión global de Pi para navegación de código y análisis de impacto en los lenguajes que este workspace soporta intencionalmente: **TypeScript, JavaScript, Java y Go**.

La superficie pública es pequeña a propósito:

- `code_find` — buscador universal de símbolos para declaraciones, implementaciones y referencias.
- `code_call_hierarchy` — jerarquía de llamadas entrantes/salientes en una sola tool direccional.
- `workspace_graph_status` — salud/cobertura del graph y monorepo para que el agente sepa si puede confiar en datos indexados.
- `code_change_surface` — mapa acotado de cambio anclado a un símbolo para preparar implementación.

### Lenguajes soportados

| Capacidad | TypeScript | JavaScript | Java | Go |
|-----------|------------|------------|------|----|
| `code_find` declaraciones/implementaciones | ✅ `ts` / `auto` | ✅ `js` / `auto` | ✅ `java` / `auto` | ✅ `go` / `auto` |
| `code_find` referencias | ✅ `ts` / `auto` | ✅ `js` / `auto` | ✅ `java` / `auto` | ✅ `go` / `auto` |
| `code_call_hierarchy` incoming/outgoing | ✅ `ts` / `auto` | ✅ `js` / `auto` | ✅ `java` / `auto` | ✅ `go` / `auto` |
| Indexado/status del workspace graph | ✅ | ✅ | ✅ | ✅ |
| `code_change_surface` mapa acotado | ✅ `ts` / `auto` | ✅ `js` / `auto` | ✅ `java` / `auto` | ✅ `go` / `auto` |

Ninguna tool pública soporta Python u otros lenguajes.

### Workspace graph y fallback

La extensión puede persistir un workspace graph en `.pi/workspace-code-graph` cuando `.pi/code-research.json` habilita el graph:

```json
{
  "graph": {
    "enable": true,
    "addGitignore": true
  }
}
```

- `graph.enable` es `false` por defecto.
- Las consultas usan artifacts schema v4 solo cuando el graph está habilitado, legible, compatible, fresco, soporta el lenguaje y tiene cobertura suficiente.
- Los artifacts viejos se consideran incompatibles y se regeneran en vez de migrarse.
- Si no, hacen fallback automático a inspección directa.
- Los resultados incluyen provenance/diagnósticos en `details`.
- Las ocurrencias persistidas guardan rangos, metadata de receiver, target status y resolución, pero no guardan texto fuente crudo del callsite.
- `workspace_graph_status` sigue pública porque en monorepos el agente necesita saber qué subproyectos/lenguajes están indexados.

### Tools registradas

#### `code_find`

Busca símbolos y referencias en TypeScript, JavaScript, Java y Go.

Parámetros principales: `path`, `query`, `relation`, `language`, `kind`, `match`, `include_signature`, `include_code`, `scope`, `glob`, `reference_kinds`, `limit`, `cursor`.

#### `code_call_hierarchy`

Traza llamadas entrantes o salientes con `direction: "incoming" | "outgoing"`.

Parámetros principales: `path`, `symbol`, `direction`, `language`, `kind`, `max_depth`, `include_external`, `compacted`.

#### `workspace_graph_status`

Reporta estado del graph, monorepo/subproyectos y cobertura por lenguaje.

#### `code_change_surface`

Devuelve un mapa acotado para un cambio anclado a un símbolo: contrato, implementaciones, callers a inspeccionar, tests probables, sugerencias heurísticas de validación, riesgos, confianza y acciones de fallback con `code_find` o `code_call_hierarchy`. Requiere `path` y `query`; acepta `language`, `kind`, `scope`, `glob`, `implementation_mode`, `test_mode`, `caller_mode`, `max_implementations`, `max_tests` y `max_callers` como filtros opcionales. Los modos `exhaustive` amplían implementaciones/tests/callers hasta el límite configurado e indican `exhaustive-truncated` si todavía hay omitidos; exhaustivo significa sobre evidencia semántica de Code Research, no cada match textual crudo. No inventa comandos exactos de test runner del repositorio analizado.

### Desarrollo

```bash
cd ~/.pi/agent/extensions/code-research
npm test
npm run typecheck
```
