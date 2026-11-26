# j0k3r-model-picker

Selector de modelo para Pi con panel flotante y colapsable.

Jerarquía **proveedor → cuenta → modelo**: eliges el proveedor, luego la cuenta
(o fabricante) dentro, y finalmente el modelo. Con filtro por texto, navegación
con teclado y soporte de mouse. La selección se asigna a Pi mediante
`pi.setModel()`.

La "cuenta" se deriva del id del modelo:
- ids con `/` (p.ej. `deepseek/deepseek-v4-pro`, típico de CLIProxyAPI) agrupan
  por el segmento **antes** de la barra;
- ids sin `/` agrupan por **fabricante** usando una lista fija de 15 prefijos (`VENDOR_PREFIXES`: `deepseek`, `glm`, `grok`, `gpt`, `kimi`, `longcat`, `minimax`, `mimo`, `muse`, `omen`, `qwen`, `claude`, `gemini`, `llama`, `hy`; p.ej. `glm-5.1/5.2/5.3` → `glm`, `gpt-5.6-luna` → `gpt`); cualquier otro id sin `/` cae en la categoría `"otros"`.

## Comando

```
/model-select       → abre el panel
/ms                 → alias corto
/model-select <ref> → match exacto: asigna directo; sin match: abre el panel con el filtro
```

`<ref>` acepta `proveedor/id`, `proveedor/id` sin distinguir mayúsculas, o un `id` único.

## Interfaz

```
╭──────────────────────────────────────────────────────╮
│ Selector de modelo                                   │
├──────────────────────────────────────────────────────┤
│ actual: opencode-go/gpt-5.6-luna                     │
│ 3 proveedores · 21 cuentas · 41 modelos              │
│                                                      │
│ / filtrar (escribe para buscar)▌                     │
│                                                      │
│ ▶ ✓ OPENCODE-GO  12 cuentas · 28 modelos             │
│ ▶ ✗ OPENAI-CODEX  8 modelos                          │
│ ▶ ✓ CLIPROXYAPI  5 cuentas · 13 modelos              │
│                                                      │
│ ▲ ▼ 1-14 de 41                                       │
│ enter elige/expande · espacio colapsa todo · r refresca│
│ [ ⟳ Refrescar ]  [ ✕ Cerrar ]                        │
╰──────────────────────────────────────────────────────╯
```

Al expandir un proveedor con cuentas:

```
▼ ✓ OPENCODE-GO  12 cuentas
    ▸ deepseek (3)
    ▸ glm (4)
    ▸ qwen (5)
    ▸ kimi (3)
```

- **Todo empieza colapsado**; `espacio`/`e` colapsa o expande todo
- `▼`/`▶` nodo expandido/colapsado
- `✓` proveedor con credenciales · `✗` sin credenciales
- Proveedores autenticados primero, luego alfabético
- Los grupos con un solo elemento no se muestran como nivel aparte
- **Indicadores de scroll**: `▲`/`▼` más el rango `1-14 de 41`; el borde
  superior/inferior se colorea cuando hay contenido oculto

## Teclado

| Tecla | Acción |
|---|---|
| `↑` `↓` / `k` `j` | mover cursor |
| `pageUp` / `pageDown` | salto de página |
| `←` `→` / `h` `l` | colapsar / expandir nodo |
| `tab` / `shift+tab` | expandir / colapsar nodo |
| `enter` | expandir/colapsar · **elegir modelo** (asigna) |
| `espacio` / `e` | colapsar o expandir todo |
| escribir texto | filtrar (aplana a lista de modelos) |
| `backspace` | borrar un carácter del filtro |
| `c` | limpiar filtro |
| `r` | refrescar catálogo |
| `esc` / `q` / `ctrl+c` | cerrar |

> **Nota sobre el filtro:** las letras de atajo `j`, `k`, `h`, `l`, `e`, `r`, `c` y `q` (tanto minúsculas como mayúsculas) ejecutan siempre su acción de navegación/control y no se insertan en el texto del filtro.

## Mouse

- **click** en proveedor/cuenta → expandir/colapsar
- **click** en modelo → seleccionar y asignar
- **click** en botones `[ ⟳ Refrescar ]`, `[ ✕ Cerrar ]` (o `[ ⟳ Reintentar ]` en error) → ejecutar acción
- **rueda** → scroll
- **hover** → resalta la fila (las filas largas hacen wrapping automático con mapeo coherente de regiones de click)

## Comportamiento y límites

- **Alcance del catálogo**: muestra los modelos disponibles del registry. Si la sesión
  tiene modelos limitados (`ctx.scopedModels`), solo muestra esos y lo indica con
  "sesión limitada".
- **Asignación**: usa `pi.setModel()`. Solo afecta la sesión actual; no modifica
  `defaultProvider`/`defaultModel` de settings ni escribe archivos de configuración.
- **Sin credenciales**: si `pi.setModel()` falla, el panel muestra el error y permanece
  abierto (no se pierde la navegación).
- **No interactivo**: fuera de modo TUI, `/model-select <ref>` y `/ms <ref>` asignan directo; el panel interactivo no está disponible y se notifica.
- **Nombre del comando**: se usa `/model-select` (y `/ms`) en lugar de `/model` porque Pi
  reserva `/model` en el handler del editor antes de consultar extensiones. La extensión
  además instala un editor envolvente (`ModelCommandEditor` vía `setEditorComponent`) para
  interceptar `/model-select` y `/ms` antes de `session.prompt()`. Si otra extensión reemplaza el editor, la última gana.
- **Ciclo de vida**: el editor se restaura en `session_shutdown` (quit, reload, cambio
  de sesión). La caché del catálogo se invalida al abrir el panel y en shutdown.

## Estructura

```
j0k3r-model-picker/
├── index.ts        # registro de /model-select y /ms, override del editor, ciclo de vida
├── package.json    # peer dependencies y script typecheck
├── tsconfig.json   # typecheck local
├── src/
│   ├── api.ts      # lectura del registry, agrupación proveedor→cuenta, match exacto
│   └── modal.ts    # componente TUI: árbol, filtro, wrapping, scroll, teclado, mouse
└── test/
    └── modal.test.ts # pruebas unitarias del modal y wrapping
```

## Validación

```bash
cd ~/.pi/agent/extensions/j0k3r-model-picker
npm run typecheck
node --test test/modal.test.ts
```

Requiere recargar Pi (`/reload`) para activar la extensión.
