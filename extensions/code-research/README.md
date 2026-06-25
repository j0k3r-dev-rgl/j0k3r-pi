# pi-code-research-extension

Extensión global de Pi para navegar símbolos TypeScript/JavaScript/Java con Tree-sitter nativo.

## Tool registrada

### `find_symbol`

Busca la definición y/o implementación de un símbolo TS/JS/Java en un archivo o directorio.

#### Parámetros

- `path` *(string, requerido)*: archivo o directorio a escanear.
- `symbol` *(string, requerido)*: nombre del símbolo.
- `language` *(string, opcional)*: `ts`, `js`, `java` o `auto` (por defecto).
- `kind` *(string, opcional)*: filtra por `function`, `class`, `method`, `interface`, `variable`.
- `include_signature` *(boolean, opcional)*: si es `true`, incluye la firma del símbolo sin el cuerpo.
- `include_code` *(boolean, opcional)*: si es `true` y `kind` es `function` o `method`, incluye el texto fuente del símbolo.
- `scope` *(string, opcional)*: `file` o `directory`. Si se omite, se infiere de `path`.
- `glob` *(string, opcional)*: patrón glob para filtrar archivos al escanear un directorio.
- `search_mode` *(string, opcional)*: `exact`, `prefix` o `contains`. Por defecto: `exact`.

#### Resultado

Array de ubicaciones con:

- `file`, `symbol`, `kind`
- `start_line`, `start_column`, `end_line`, `end_column`
- `is_definition`, `is_implementation`
- `definition_location` (si aplica)
- `implementation_locations` (para interfaces)
- `signature` (si `include_signature=true`)
- `code` (si `include_code=true`)

## Instalación

La extensión está en `~/.pi/agent/extensions/code-research/`. Pi la auto-descubre al arrancar.

```bash
cd ~/.pi/agent/extensions/code-research
npm test
npm run typecheck
```

## Estructura

```
code-research/
├── index.ts              # entry point: registra la tool
├── src/
│   ├── types.ts          # tipos compartidos
│   ├── core/
│   │   ├── parser.ts     # caché de parsers Tree-sitter
│   │   └── resolver.ts   # orquestación de búsqueda
│   ├── languages/
│   │   ├── typescript.ts # extracción de símbolos TS/JS
│   │   └── java.ts       # extracción de símbolos Java
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

## Notas

- Usa `tree-sitter` nativo con parsers fijos y versiones exactas.
- La detección de implementaciones es sintáctica (basada en `implements Nombre` en TS/Java).
