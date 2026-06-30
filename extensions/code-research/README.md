# pi-code-research-extension

[English](#english) | [Español](#español)

## English

Global Pi extension for TypeScript, JavaScript, and Java code navigation using native Tree-sitter parsers.

### Summary

Code Research helps agents inspect code structurally instead of relying only on text search. It can locate symbols, find references, and build forward or reverse call trees for application code.

### Tools and capabilities

- `find_symbol`: locates definitions and implementations.
- `find_references`: finds semantic usages and references.
- `function_call_tree`: traces outgoing application calls.
- `reverse_function_call_tree`: traces incoming callers.
- `workspace_graph_status`: reports persisted graph readiness when graph-backed inspection is available.

### Recommended use

Use it for refactors, impact analysis, onboarding, and understanding execution flow before editing code.

### Read more

The Spanish section contains the detailed parameter reference, result shapes, installation notes, structure, and caveats.

## Español

Extensión global de Pi para navegar símbolos TypeScript/JavaScript/Java con Tree-sitter nativo y construir call trees de funciones/métodos.

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
- La detección de implementaciones es sintáctica (basada en `implements Nombre` en TS/Java).
- El soporte TS/JS de `function_call_tree` prioriza llamadas locales/importadas y métodos de instancias construidas localmente.
