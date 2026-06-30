# pi-code-research-extension

[English](#english) | [Español](#español)

## English

Global Pi extension for navigating TypeScript, JavaScript, and Java symbols with native Tree-sitter and building function/method call trees. The workspace graph also indexes Python files and symbols as a foundation for Python-specific tools.

### Registered tool

#### `find_symbol`

Finds the definition and/or implementation of a TypeScript, JavaScript, or Java symbol in a file or directory.

##### Parameters

- `path` *(string, required)*: file or directory to scan.
- `symbol` *(string, required)*: symbol name.
- `language` *(string, optional)*: `ts`, `js`, `java`, or `auto` (default).
- `kind` *(string, optional)*: filters by `function`, `class`, `method`, `interface`, or `variable`.
- `include_signature` *(boolean, optional)*: when `true`, includes the symbol signature without the body.
- `include_code` *(boolean, optional)*: when `true` and `kind` is `function` or `method`, includes the symbol source text.
- `scope` *(string, optional)*: `file` or `directory`. When omitted, it is inferred from `path`.
- `glob` *(string, optional)*: glob pattern for filtering files while scanning a directory.
- `search_mode` *(string, optional)*: `exact`, `prefix`, or `contains`. Default: `exact`.

##### Result

Array of locations with:

- `file`, `symbol`, `kind`
- `start_line`, `start_column`, `end_line`, `end_column`
- `is_definition`, `is_implementation`
- `definition_location` when applicable
- `implementation_locations` for interfaces
- `signature` when `include_signature=true`
- `code` when `include_code=true`

#### `function_call_tree`

Builds a recursive call tree for a Java, TypeScript, or JavaScript function/method, expanding application-internal calls.

##### Parameters

- `path` *(string, required)*: root file or directory to scan.
- `symbol` *(string, required)*: root function or method name.
- `language` *(string, optional)*: `java`, `ts`, or `js`. Default: `java`.
- `kind` *(string, optional)*: `function`, `method`, or `class`.
- `max_depth` *(number, optional)*: maximum recursive depth. Default: `10`.
- `include_external` *(boolean, optional)*: when `true`, includes external calls as leaves.
- `compacted` *(boolean, optional)*: optional compaction of trivial nodes where the language supports it.

##### Result

Object with:

- `root`: root tree node
- `stats.total_nodes`
- `stats.application_nodes`
- `stats.external_nodes`
- `stats.max_depth_reached`

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
├── index.ts              # entry point: registers the tool
├── src/
│   ├── types.ts          # shared types
│   ├── core/
│   │   ├── parser.ts     # Tree-sitter parser cache
│   │   ├── find-symbol-resolver.ts
│   │   └── function-call-tree-resolver.ts
│   ├── languages/
│   │   ├── typescript/   # TS/JS symbol and call-tree extraction
│   │   └── java/         # Java symbol and call-tree extraction
│   └── tools/
│       └── ...           # future additional tools
├── test/
│   ├── find-symbol.test.ts
│   └── find-symbol-java.test.ts
├── scripts/
│   └── manual-*.ts       # manual verification scripts
└── examples/             # fixtures for testing the tool
    ├── typescript/
    └── javascript/
```

### Notes

- Uses native `tree-sitter` with pinned parsers and exact versions.
- Workspace graph indexing supports TypeScript, JavaScript, Java, and Python file/symbol nodes.
- Python graph support currently indexes `.py` files, classes, functions, methods, and top-level assignments; detects common Python project markers and ignores environment/cache directories; marks obvious entrypoints such as `__main__.py` and `if __name__ == "__main__"` direct or wrapper calls. Python-specific query/call-tree tools will be added separately.
- Implementation detection is syntactic (based on `implements Name` in TS/Java).
- TS/JS `function_call_tree` support prioritizes local/imported calls and methods on locally constructed instances.

## Español

Extensión global de Pi para navegar símbolos TypeScript/JavaScript/Java con Tree-sitter nativo y construir call trees de funciones/métodos. El workspace graph también indexa archivos y símbolos Python como base para tools específicas de Python.

### Tool registrada

#### `find_symbol`

Busca la definición y/o implementación de un símbolo TS/JS/Java en un archivo o directorio.

##### Parámetros

- `path` *(string, requerido)*: archivo o directorio a escanear.
- `symbol` *(string, requerido)*: nombre del símbolo.
- `language` *(string, opcional)*: `ts`, `js`, `java` o `auto` (por defecto).
- `kind` *(string, opcional)*: filtra por `function`, `class`, `method`, `interface`, `variable`.
- `include_signature` *(boolean, opcional)*: si es `true`, incluye la firma del símbolo sin el cuerpo.
- `include_code` *(boolean, opcional)*: si es `true` y `kind` es `function` o `method`, incluye el texto fuente del símbolo.
- `scope` *(string, opcional)*: `file` o `directory`. Si se omite, se infiere de `path`.
- `glob` *(string, opcional)*: patrón glob para filtrar archivos al escanear un directorio.
- `search_mode` *(string, opcional)*: `exact`, `prefix` o `contains`. Por defecto: `exact`.

##### Resultado

Array de ubicaciones con:

- `file`, `symbol`, `kind`
- `start_line`, `start_column`, `end_line`, `end_column`
- `is_definition`, `is_implementation`
- `definition_location` (si aplica)
- `implementation_locations` (para interfaces)
- `signature` (si `include_signature=true`)
- `code` (si `include_code=true`)

#### `function_call_tree`

Construye un árbol recursivo de llamadas para una función o método de Java, TypeScript o JavaScript, expandiendo llamadas internas de la aplicación.

##### Parámetros

- `path` *(string, requerido)*: archivo raíz o directorio a escanear.
- `symbol` *(string, requerido)*: nombre de la función o método raíz.
- `language` *(string, opcional)*: `java`, `ts` o `js`. Por defecto: `java`.
- `kind` *(string, opcional)*: `function`, `method` o `class`.
- `max_depth` *(number, opcional)*: profundidad máxima recursiva. Por defecto: `10`.
- `include_external` *(boolean, opcional)*: si es `true`, incluye llamadas externas como hojas.
- `compacted` *(boolean, opcional)*: compresión opcional de nodos triviales donde el lenguaje lo soporte.

##### Resultado

Objeto con:

- `root`: nodo raíz del árbol
- `stats.total_nodes`
- `stats.application_nodes`
- `stats.external_nodes`
- `stats.max_depth_reached`

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
├── index.ts              # entry point: registra la tool
├── src/
│   ├── types.ts          # tipos compartidos
│   ├── core/
│   │   ├── parser.ts     # caché de parsers Tree-sitter
│   │   ├── find-symbol-resolver.ts
│   │   └── function-call-tree-resolver.ts
│   ├── languages/
│   │   ├── typescript/   # extracción de símbolos y call tree TS/JS
│   │   └── java/         # extracción de símbolos y call tree Java
│   └── tools/
│       └── ...           # futuras tools adicionales
├── test/
│   ├── find-symbol.test.ts
│   └── find-symbol-java.test.ts
├── scripts/
│   └── manual-*.ts       # scripts de verificación manual
└── examples/             # fixtures para probar la tool
    ├── typescript/
    └── javascript/
```

### Notas

- Usa `tree-sitter` nativo con parsers fijos y versiones exactas.
- El indexado de workspace graph soporta nodos de archivo/símbolo para TypeScript, JavaScript, Java y Python.
- El soporte Python del graph actualmente indexa archivos `.py`, clases, funciones, métodos y asignaciones top-level; detecta markers comunes de proyectos Python e ignora directorios de entornos/cache; marca entrypoints obvios como `__main__.py` e invocaciones directas o con wrappers dentro de `if __name__ == "__main__"`. Las tools de consulta/call-tree específicas de Python se agregarán por separado.
- La detección de implementaciones es sintáctica (basada en `implements Nombre` en TS/Java).
- El soporte TS/JS de `function_call_tree` prioriza llamadas locales/importadas y métodos de instancias construidas localmente.
