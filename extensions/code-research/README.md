# pi-code-research-extension

[English](#english) | [Español](#español)

## English

Global Pi extension for code navigation and codebase impact analysis. It provides symbol lookup, reference lookup, forward and reverse call trees, and workspace graph health reporting for TypeScript, JavaScript, and Java tools. The workspace graph also indexes Python files and symbols as a foundation for future Python-specific query tools.

### Supported languages

| Capability | TypeScript | JavaScript | Java | Python |
|------------|------------|------------|------|--------|
| `find_symbol` public tool | ✅ `ts` / `auto` | ✅ `js` / `auto` | ✅ `java` / `auto` | 🚧 indexed in graph only; no public `py` option yet |
| `find_references` public tool | ✅ `ts` | ✅ `js` | ✅ `java` | 🚧 not exposed yet |
| `function_call_tree` public tool | ✅ `ts` | ✅ `js` | ✅ `java` | 🚧 graph indexes symbols/entrypoints, but call-tree queries are not exposed yet |
| `reverse_function_call_tree` public tool | ✅ `ts` | ✅ `js` | ✅ `java` | 🚧 not exposed yet |
| Workspace graph indexing | ✅ files/symbols/calls | ✅ files/symbols/calls | ✅ files/symbols/calls | ✅ files/symbols/entrypoints; no Python call edges yet |

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

- `graph.enable` defaults to `false` and currently gates both graph refresh scheduling and graph-backed query usage.
- `graph.addGitignore` defaults to `true` and lets the graph writer maintain ignore entries for generated graph artifacts.
- Graph-backed tools use the persisted graph only when it is enabled, readable, schema-compatible, `fresh`, language-supported, and sufficient for the requested query.
- Tools automatically fall back to direct source inspection when the graph is disabled, missing, stale, partial, errored, incompatible, refreshing, unreadable, language-unsupported, or insufficient for the query.
- `find_references` has richer direct analyzers than the current graph edge model. The graph currently covers only `call`, `implements`, and `extends` relationships, while public `find_references` needs complete semantic references such as imports, instantiation, reads/writes, type references, callbacks, and method references. Public calls therefore fall back conservatively to avoid incomplete graph-only results.
- Fallback decisions are internal; public tool response contracts do not expose graph/fallback metadata.
- Python graph data is indexed for future use, but public query tools do not expose `py` parameters yet.

### Registered tools

#### `find_symbol`

Finds the definition and/or implementation of a TypeScript, JavaScript, or Java symbol in a file or directory.

##### Parameters

- `path` *(string, required)*: file or directory to search. Relative paths resolve against the current working directory.
- `symbol` *(string, required)*: symbol name.
- `language` *(string, optional)*: `ts`, `js`, `java`, or `auto` (default).
- `kind` *(string, optional)*: filters by `function`, `class`, `method`, `interface`, or `variable`.
- `include_signature` *(boolean, optional)*: when `true`, includes the symbol signature without the body.
- `include_code` *(boolean, optional)*: when `true` and `kind` is `function` or `method`, includes the symbol source text.
- `scope` *(string, optional)*: `file` or `directory`. When omitted, it is inferred from `path`.
- `glob` *(string, optional)*: glob pattern for filtering files while scanning a directory.
- `search_mode` *(string, optional)*: `exact`, `prefix`, or `contains`. Default: `exact`. Non-exact searches disable `include_code`.

##### Result

Array of locations with:

- `file`, `symbol`, `kind`
- `start_line`, `start_column`, `end_line`, `end_column`
- `is_definition`, `is_implementation`
- `definition_location` when applicable
- `implementation_locations` for interfaces
- `signature` when `include_signature=true`
- `code` when `include_code=true`

#### `find_references`

Finds where a TypeScript, JavaScript, or Java symbol is used. The direct analyzers cover semantic usages such as calls, imports, instantiation, inheritance, variable reads/writes, callbacks, method references, and type references.

##### Parameters

- `path` *(string, required)*: file or directory to search. Relative paths resolve against the current working directory.
- `symbol` *(string, required)*: target symbol name.
- `language` *(string, optional)*: `ts`, `js`, or `java`. Default: `java`.
- `kind` *(string, optional)*: filters by `function`, `class`, `method`, `interface`, or `variable`.
- `scope` *(string, optional)*: `file` or `directory`. When omitted, it is inferred from `path`.
- `glob` *(string, optional)*: glob pattern for filtering files while scanning a directory.

##### Result

Array of reference locations with:

- `file`, `line`, `column`, optional `end_line`, `end_column`
- `symbol`, `kind`
- `context_symbol`, `context_kind`, `context_class` when available
- `reference_kind`: `call`, `import`, `instantiate`, `implements`, `extends`, `read`, `write`, `type_reference`, `callback`, or `method_reference`
- receiver/call metadata when available
- `is_application`, `source`, and optional `reason`

#### `function_call_tree`

Builds a recursive forward call tree for a Java, TypeScript, or JavaScript function/method, expanding application-internal calls and optionally showing external framework/library/language calls as leaves.

##### Parameters

- `path` *(string, required)*: Java file containing the root method, or a directory to scan for TypeScript/JavaScript/Java project context.
- `symbol` *(string, required)*: root function or method name.
- `language` *(string, optional)*: `java`, `ts`, or `js`. Default: `java`.
- `kind` *(string, optional)*: `function`, `method`, or `class`.
- `max_depth` *(number, optional)*: maximum recursive depth. Default: `10`.
- `include_external` *(boolean, optional)*: when `true`, includes framework/library/language calls as external leaves. Default: `false`.
- `compacted` *(boolean, optional)*: when `true`, compacts trivial data-access sibling nodes where supported.

##### Result

Object with:

- `root`: root tree node
- `stats.total_nodes`
- `stats.application_nodes`
- `stats.external_nodes`
- `stats.max_depth_reached`

#### `reverse_function_call_tree`

Builds a reverse call tree for Java, TypeScript, or JavaScript code. It starts at a target function/method and recursively returns application callers to support impact analysis.

##### Parameters

- `path` *(string, required)*: Java file containing the target method, or a directory to scan for TypeScript/JavaScript/Java project context.
- `symbol` *(string, required)*: target function or method name.
- `language` *(string, optional)*: `java`, `ts`, or `js`. Default: `java`.
- `kind` *(string, optional)*: `function`, `method`, or `class`.
- `max_depth` *(number, optional)*: maximum caller expansion depth. Default: `10`.
- `include_external` *(boolean, optional)*: reserved for API parity with `function_call_tree`; reverse caller expansion returns application callers only.
- `compacted` *(boolean, optional)*: reserved for API parity with `function_call_tree`.

##### Result

Object with the same call-tree shape as `function_call_tree`, but caller relationships are attached through reverse expansion.

#### `workspace_graph_status`

Reports whether persisted workspace graph data is available, fresh, stale, partial, missing, disabled, errored, or incompatible. Use it when an agent needs graph health, coverage, and monorepo/subproject signals before relying on graph-backed inspection.

##### Parameters

No parameters.

##### Result

Object with:

- `status`: `disabled`, `missing`, `fresh`, `stale`, `partial`, `errored`, `incompatible`, or `refreshing`
- graph configuration and warnings when disabled
- graph root, manifest path, generation, updated time, and freshness age when available
- monorepo/subproject layout
- coverage counts for indexed/skipped/excluded/unreadable files and directories
- language coverage counts for `java`, `ts`, `js`, and `py`
- subproject details and errors when available

### Installation

The extension lives at `~/.pi/agent/extensions/code-research/`. Pi auto-discovers it at startup.

```bash
cd ~/.pi/agent/extensions/code-research
npm test
npm run typecheck
```

### Structure

```
code-research/
├── index.ts                 # entry point: registers all tools and graph lifecycle hooks
├── src/
│   ├── config.ts            # .pi/code-research.json loading
│   ├── types.ts             # shared public/internal types
│   ├── core/
│   │   ├── parser.ts        # Tree-sitter parser cache
│   │   ├── graph-policy.ts  # shared graph usability/fallback policy
│   │   ├── *resolver.ts     # tool resolvers and graph/direct fallback routing
│   │   └── workspace-*.ts   # workspace graph build/status/persistence helpers
│   ├── languages/
│   │   ├── typescript/      # TS/JS symbol, references, and call-tree extraction
│   │   ├── java/            # Java symbol, references, and call-tree extraction
│   │   └── python/          # Python workspace graph indexing foundation
│   └── tools/               # Pi tool registrations
├── test/                    # unit and integration tests
├── scripts/                 # manual verification scripts
└── examples/                # fixtures for testing the extension
    ├── typescript/
    ├── javascript/
    └── java/
```

### Notes

- Uses native `tree-sitter` with pinned parsers and exact versions.
- Implementation detection is syntactic (based on `implements Name` in TS/Java).
- TS/JS call-tree support prioritizes local/imported calls and methods on locally constructed instances.
- Java call-tree support includes Java-specific class/method resolution and interface/implementation relationships where available.
- Workspace graph indexing supports TypeScript, JavaScript, Java, and Python file/symbol nodes.
- Python graph support currently indexes `.py` files, classes, functions, methods, top-level assignments, and obvious entrypoints such as `__main__.py` and `if __name__ == "__main__"`; Python-specific query/call-tree tools will be added separately.

## Español

Extensión global de Pi para navegación de código y análisis de impacto en codebases. Provee búsqueda de símbolos, búsqueda de referencias, call trees directos e inversos, y estado del workspace graph para tools TypeScript, JavaScript y Java. El workspace graph también indexa archivos y símbolos Python como base para futuras tools específicas de Python.

### Lenguajes soportados

| Capacidad | TypeScript | JavaScript | Java | Python |
|-----------|------------|------------|------|--------|
| Tool pública `find_symbol` | ✅ `ts` / `auto` | ✅ `js` / `auto` | ✅ `java` / `auto` | 🚧 indexado solo en graph; todavía sin opción pública `py` |
| Tool pública `find_references` | ✅ `ts` | ✅ `js` | ✅ `java` | 🚧 todavía no expuesto |
| Tool pública `function_call_tree` | ✅ `ts` | ✅ `js` | ✅ `java` | 🚧 el graph indexa símbolos/entrypoints, pero las consultas call-tree no están expuestas todavía |
| Tool pública `reverse_function_call_tree` | ✅ `ts` | ✅ `js` | ✅ `java` | 🚧 todavía no expuesto |
| Indexado del workspace graph | ✅ archivos/símbolos/llamadas | ✅ archivos/símbolos/llamadas | ✅ archivos/símbolos/llamadas | ✅ archivos/símbolos/entrypoints; aún sin call edges Python |

### Workspace graph y comportamiento de fallback

La extensión puede persistir un workspace graph en `.pi/workspace-code-graph` cuando el soporte de graph está habilitado en `.pi/code-research.json`:

```json
{
  "graph": {
    "enable": true,
    "addGitignore": true
  }
}
```

- `graph.enable` es `false` por defecto y actualmente controla tanto el scheduling/refresco del graph como el uso del graph en consultas.
- `graph.addGitignore` es `true` por defecto y permite mantener entradas de ignore para los artefactos generados del graph.
- Las tools graph-backed usan el graph persistido solo cuando está habilitado, es legible, compatible con el schema, está `fresh`, soporta el lenguaje y tiene cobertura suficiente para la consulta.
- Las tools hacen fallback automático a inspección directa de código cuando el graph está deshabilitado, ausente, stale, partial, errored, incompatible, refreshing, ilegible, no soporta el lenguaje o no tiene cobertura suficiente.
- `find_references` tiene analizadores directos más ricos que el modelo actual de edges del graph. El graph cubre actualmente solo relaciones `call`, `implements` y `extends`, mientras que la tool pública necesita referencias semánticas completas como imports, instanciación, reads/writes, type references, callbacks y method references. Por eso las llamadas públicas hacen fallback conservador para evitar resultados incompletos solo desde el graph.
- Las decisiones de fallback son internas; los contratos públicos de respuesta no exponen metadata de graph/fallback.
- Los datos Python se indexan en el graph para uso futuro, pero las tools públicas todavía no exponen parámetros `py`.

### Tools registradas

#### `find_symbol`

Busca la definición y/o implementación de un símbolo TypeScript, JavaScript o Java en un archivo o directorio.

##### Parámetros

- `path` *(string, requerido)*: archivo o directorio a buscar. Las rutas relativas se resuelven contra el working directory actual.
- `symbol` *(string, requerido)*: nombre del símbolo.
- `language` *(string, opcional)*: `ts`, `js`, `java` o `auto` (por defecto).
- `kind` *(string, opcional)*: filtra por `function`, `class`, `method`, `interface` o `variable`.
- `include_signature` *(boolean, opcional)*: si es `true`, incluye la firma del símbolo sin el cuerpo.
- `include_code` *(boolean, opcional)*: si es `true` y `kind` es `function` o `method`, incluye el texto fuente del símbolo.
- `scope` *(string, opcional)*: `file` o `directory`. Si se omite, se infiere desde `path`.
- `glob` *(string, opcional)*: patrón glob para filtrar archivos al escanear un directorio.
- `search_mode` *(string, opcional)*: `exact`, `prefix` o `contains`. Por defecto: `exact`. Las búsquedas no exactas deshabilitan `include_code`.

##### Resultado

Array de ubicaciones con:

- `file`, `symbol`, `kind`
- `start_line`, `start_column`, `end_line`, `end_column`
- `is_definition`, `is_implementation`
- `definition_location` si aplica
- `implementation_locations` para interfaces
- `signature` si `include_signature=true`
- `code` si `include_code=true`

#### `find_references`

Encuentra dónde se usa un símbolo TypeScript, JavaScript o Java. Los analizadores directos cubren usos semánticos como calls, imports, instanciación, herencia, reads/writes de variables, callbacks, method references y type references.

##### Parámetros

- `path` *(string, requerido)*: archivo o directorio a buscar. Las rutas relativas se resuelven contra el working directory actual.
- `symbol` *(string, requerido)*: nombre del símbolo objetivo.
- `language` *(string, opcional)*: `ts`, `js` o `java`. Por defecto: `java`.
- `kind` *(string, opcional)*: filtra por `function`, `class`, `method`, `interface` o `variable`.
- `scope` *(string, opcional)*: `file` o `directory`. Si se omite, se infiere desde `path`.
- `glob` *(string, opcional)*: patrón glob para filtrar archivos al escanear un directorio.

##### Resultado

Array de ubicaciones de referencia con:

- `file`, `line`, `column`, y opcionalmente `end_line`, `end_column`
- `symbol`, `kind`
- `context_symbol`, `context_kind`, `context_class` cuando están disponibles
- `reference_kind`: `call`, `import`, `instantiate`, `implements`, `extends`, `read`, `write`, `type_reference`, `callback` o `method_reference`
- metadata de receiver/call cuando está disponible
- `is_application`, `source` y `reason` opcional

#### `function_call_tree`

Construye un call tree directo recursivo para una función o método Java, TypeScript o JavaScript, expandiendo llamadas internas de la aplicación y opcionalmente mostrando llamadas externas de framework/librería/lenguaje como hojas.

##### Parámetros

- `path` *(string, requerido)*: archivo Java que contiene el método raíz, o directorio para escanear contexto TypeScript/JavaScript/Java.
- `symbol` *(string, requerido)*: nombre de la función o método raíz.
- `language` *(string, opcional)*: `java`, `ts` o `js`. Por defecto: `java`.
- `kind` *(string, opcional)*: `function`, `method` o `class`.
- `max_depth` *(number, opcional)*: profundidad recursiva máxima. Por defecto: `10`.
- `include_external` *(boolean, opcional)*: si es `true`, incluye llamadas de framework/librería/lenguaje como hojas externas. Por defecto: `false`.
- `compacted` *(boolean, opcional)*: si es `true`, compacta nodos triviales de data-access donde esté soportado.

##### Resultado

Objeto con:

- `root`: nodo raíz del árbol
- `stats.total_nodes`
- `stats.application_nodes`
- `stats.external_nodes`
- `stats.max_depth_reached`

#### `reverse_function_call_tree`

Construye un call tree inverso para código Java, TypeScript o JavaScript. Empieza en una función/método objetivo y devuelve recursivamente callers de la aplicación para análisis de impacto.

##### Parámetros

- `path` *(string, requerido)*: archivo Java que contiene el método objetivo, o directorio para escanear contexto TypeScript/JavaScript/Java.
- `symbol` *(string, requerido)*: nombre de la función o método objetivo.
- `language` *(string, opcional)*: `java`, `ts` o `js`. Por defecto: `java`.
- `kind` *(string, opcional)*: `function`, `method` o `class`.
- `max_depth` *(number, opcional)*: profundidad máxima de expansión de callers. Por defecto: `10`.
- `include_external` *(boolean, opcional)*: reservado por paridad de API con `function_call_tree`; la expansión inversa devuelve callers de aplicación.
- `compacted` *(boolean, opcional)*: reservado por paridad de API con `function_call_tree`.

##### Resultado

Objeto con la misma forma de call-tree que `function_call_tree`, pero las relaciones de caller se adjuntan mediante expansión inversa.

#### `workspace_graph_status`

Reporta si los datos persistidos del workspace graph están disponibles, fresh, stale, partial, missing, disabled, errored o incompatible. Úsala cuando un agente necesita salud del graph, cobertura y señales de monorepo/subproyectos antes de depender de inspección graph-backed.

##### Parámetros

Sin parámetros.

##### Resultado

Objeto con:

- `status`: `disabled`, `missing`, `fresh`, `stale`, `partial`, `errored`, `incompatible` o `refreshing`
- configuración del graph y warnings cuando está disabled
- graph root, manifest path, generation, updated time y edad de freshness cuando están disponibles
- layout de monorepo/subproyectos
- contadores de cobertura para archivos/directorios indexados, omitidos, excluidos e ilegibles
- conteo de lenguajes para `java`, `ts`, `js` y `py`
- detalles de subproyectos y errores cuando están disponibles

### Instalación

La extensión está en `~/.pi/agent/extensions/code-research/`. Pi la auto-descubre al arrancar.

```bash
cd ~/.pi/agent/extensions/code-research
npm test
npm run typecheck
```

### Estructura

```
code-research/
├── index.ts                 # entry point: registra todas las tools y hooks de graph
├── src/
│   ├── config.ts            # carga de .pi/code-research.json
│   ├── types.ts             # tipos públicos/internos compartidos
│   ├── core/
│   │   ├── parser.ts        # caché de parsers Tree-sitter
│   │   ├── graph-policy.ts  # política compartida de uso/fallback del graph
│   │   ├── *resolver.ts     # resolvers de tools y ruteo graph/direct fallback
│   │   └── workspace-*.ts   # build/status/persistence del workspace graph
│   ├── languages/
│   │   ├── typescript/      # extracción TS/JS de símbolos, referencias y call trees
│   │   ├── java/            # extracción Java de símbolos, referencias y call trees
│   │   └── python/          # base de indexado Python para workspace graph
│   └── tools/               # registros de tools Pi
├── test/                    # tests unitarios e integración
├── scripts/                 # scripts de verificación manual
└── examples/                # fixtures para probar la extensión
    ├── typescript/
    ├── javascript/
    └── java/
```

### Notas

- Usa `tree-sitter` nativo con parsers fijos y versiones exactas.
- La detección de implementaciones es sintáctica (basada en `implements Nombre` en TS/Java).
- El soporte TS/JS de call-tree prioriza llamadas locales/importadas y métodos de instancias construidas localmente.
- El soporte Java de call-tree incluye resolución específica de clases/métodos Java y relaciones interfaz/implementación donde estén disponibles.
- El indexado de workspace graph soporta nodos de archivo/símbolo para TypeScript, JavaScript, Java y Python.
- El soporte Python del graph actualmente indexa archivos `.py`, clases, funciones, métodos, asignaciones top-level y entrypoints obvios como `__main__.py` e `if __name__ == "__main__"`; las tools específicas de consulta/call-tree Python se agregarán por separado.
