# TypeSafe en Pi — Estado actual

> **Corte del informe:** `2026-09-19T16:57:06-03:00` — hora local del sistema, zona `-03` (`UTC-03:00`).
>
> **Última telemetría incluida:** `shadow-33dddf03-b15e-4695-821f-505dcebb62d2`.
>
> Este documento sirve como línea base para observar, medir y analizar la integración durante su etapa de *shadow mode*.

## Resumen ejecutivo

La integración de TypeSafe System One (Jev) está instalada, activa y validada en el orquestador principal de Pi. Aporta juicios semánticos tipados y telemetría completa sin sustituir las reglas deterministas de `AGENTS.md` ni la autoridad de `workflow-triage`.

El sistema opera actualmente en **shadow mode**:

1. El orquestador elige la ruta oficial mediante las reglas existentes.
2. Registra la petición original y esa ruta con TypeSafe.
3. Jev produce una predicción independiente.
4. SQLite conserva la comparación, probabilidades, coste, latencia y errores.
5. La predicción de Jev no modifica ni bloquea el workflow.

La primera prueba real de triaje registrada para crear este informe produjo acuerdo: el orquestador y Jev eligieron `direct_orchestrator`.

## Estado rápido

| Área | Estado |
|---|---|
| Extensión | Activa después de `/reload` |
| Alcance | Solo orquestador principal |
| Modelo solicitado | `jev-latest` |
| Modelo observado | `jev-1.13.0` |
| Modo de decisión | Shadow, no autoritativo |
| Persistencia | SQLite local con WAL |
| Retención | 90 días, sin límite adicional de filas |
| Seguridad del archivo | Directorio `0700`, base `0600` |
| Dependencias npm de runtime | Ninguna |
| Renderer | Tarjeta hueca propia, amarillo eléctrico `#ffe600` |
| Tests de la extensión | 25/25 |
| Typecheck | Sin errores |
| Verificación independiente | PASS |

## Flujo operativo

```text
Petición del usuario
        │
        ▼
AGENTS.md + workflow-triage
        │
        ├── seleccionan la ruta oficial
        │   direct_orchestrator | planned_workflow | deep_researcher
        │
        ▼
typesafe_record_shadow_triage
        │
        ├── envía estado sanitizado a Jev
        ├── recibe predicción y probabilidades
        └── guarda comparación en SQLite
        │
        ▼
Pi continúa usando exclusivamente la ruta oficial ya elegida
```

Los mensajes de confirmación como “sí”, “vamos” o “continúa” no deben evaluarse como nuevas decisiones de triaje.

## Tools disponibles

### `typesafe_evaluate`

Evaluación consultiva genérica mediante:

- `Choice`: selecciona una opción definida y devuelve probabilidades;
- `Noul`: calcula la probabilidad de que una condición sea verdadera;
- `Score`: puntúa una dimensión ordinal.

Cada ejecución guarda su telemetría en SQLite.

### `typesafe_record_shadow_triage`

Registra una decisión de routing ya tomada por el orquestador. Recibe:

- `original_prompt`: petición original completa;
- `route`: `direct_orchestrator`, `planned_workflow` o `deep_researcher`.

Compara la ruta oficial con la predicción de Jev sin alterar la ejecución.

Alias disponible: `typesafe_shadow_triage`.

### `typesafe_telemetry`

Consulta paginada y acotada de evaluaciones almacenadas. Permite revisar:

- registros recientes;
- origen de la evaluación;
- latencia y tokens;
- acuerdos y discrepancias;
- errores;
- continuación mediante offset.

### `/typesafe`

Comando interactivo para consultar un resumen de las estadísticas de shadow triage y las discrepancias recientes.

## Telemetría SQLite

La base predeterminada se encuentra en:

```text
${XDG_DATA_HOME:-~/.local/share}/pi/typesafe/telemetry.sqlite
```

Puede cambiarse mediante `PI_TYPESAFE_TELEMETRY_DB_PATH`.

Se almacenan, después de sanitización:

- identificador y timestamp;
- sesión y origen;
- prompt o estado enviado;
- preguntas tipadas;
- respuesta completa de Jev;
- modelo;
- probabilidades y confianza;
- tokens de entrada y salida;
- latencia;
- errores;
- ruta oficial;
- ruta predicha;
- acuerdo o discrepancia;
- metadatos adicionales.

Los registros de más de 90 días se eliminan automáticamente. No existe un límite de filas que pueda eliminar registros más recientes.

## Seguridad y autoridad

TypeSafe es evidencia semántica, no autoridad ejecutiva.

Nunca puede autorizar ni decidir por sí mismo:

- modificaciones de archivos;
- cambios de configuración;
- expansión de alcance;
- `commit` o `push`;
- aprobación de una verificación;
- archivado de cambios;
- omisión de un circuit breaker.

La extensión sanitiza antes de transmitir y antes de persistir:

- `TYPESAFE_API_KEY`;
- tokens Bearer;
- claves privadas;
- patrones comunes de API keys;
- passwords;
- asignaciones tipo `.env`.

Si TypeSafe falla, expira o no está disponible, el workflow normal de Pi continúa sin depender de la API.

## Renderer actual

TypeSafe tiene un renderer completamente propio:

- tarjetas huecas con bordes redondeados;
- color principal Electric Solar Yellow `#ffe600`;
- éxito en verde lima;
- discrepancias en ámbar;
- errores en rojo;
- estados pending, partial, success y error;
- vistas collapsed y expanded;
- ancho seguro para ANSI, emoji y CJK;
- `renderShell: "self"`;
- expansión y contracción mediante `Ctrl+O`.

El estilo toma como referencia visual `j0k3r-theme`, pero no importa código, paquetes, rutas ni dependencias de esa extensión.

## Evidencia de validación

### Integración funcional

- API key heredada correctamente por Pi.
- Llamadas autenticadas a System One exitosas.
- `jev-latest` resuelto como `jev-1.13.0`.
- Escritura y lectura SQLite comprobadas en runtime real.
- Retención de 90 días comprobada con registros antiguos y recientes.
- Permisos, WAL, migraciones y paginación comprobados.
- Sanitización anterior a red y almacenamiento comprobada.

### Shadow triage

La inferencia automática basada en hooks genéricos se descartó porque producía rutas falsas en conversaciones de varios turnos. La solución vigente registra explícitamente la petición original después de que el orquestador elige la ruta.

Primera observación de este informe:

| Campo | Valor |
|---|---|
| Telemetry ID | `shadow-33dddf03-b15e-4695-821f-505dcebb62d2` |
| Ruta oficial | `direct_orchestrator` |
| Ruta predicha | `direct_orchestrator` |
| Acuerdo | Sí |
| Autoridad de Jev | Ninguna |

### Renderer

- Suite completa: 25/25 tests.
- TypeScript: cero diagnósticos.
- Verificación independiente: PASS.
- Tarjeta real con Choice, Noul y Score aprobada visualmente por el usuario.

## Artefactos y código relevantes

| Propósito | Ruta |
|---|---|
| Extensión | `extensions/typesafe/` |
| Renderer | `extensions/typesafe/src/render/` |
| Cliente Jev | `extensions/typesafe/src/providers/typesafe-client.ts` |
| SQLite | `extensions/typesafe/src/storage/telemetry-db.ts` |
| Tools | `extensions/typesafe/src/tools/` |
| Shadow triage | `extensions/typesafe/src/shadow/triage-shadow.ts` |
| Política de routing | `skills/workflow-triage/SKILL.md` |
| Cambio principal archivado | `openspec/archive/2026-09-19/typesafe-workflow-telemetry/` |
| Cambio visual activo | `openspec/changes/typesafe-j0k3r-render/` |

## Limitaciones actuales

- Jev todavía no influye en la ruta; solo la compara.
- Los subagentes no tienen acceso a las tools de TypeSafe.
- Solo existen tres rutas canónicas en el benchmark actual.
- La calidad de la integración no debe juzgarse con pocos registros.
- Coste, latencia y precisión necesitan una muestra representativa de uso real.
- Las discrepancias no implican automáticamente que Jev o el orquestador estén equivocados; requieren revisión contextual.

## Plan de observación

Durante el uso normal, conviene revisar periódicamente:

1. porcentaje de acuerdo total;
2. acuerdo por ruta;
3. discrepancias con confianza alta;
4. latencia media y percentiles;
5. tokens y consumo por evaluación;
6. errores, timeouts y rate limits;
7. falsos positivos de complejidad o investigación;
8. solicitudes ambiguas que no encajan bien en las tres rutas.

No debe promoverse TypeSafe fuera de shadow mode hasta disponer de una muestra suficiente y revisada manualmente.

## Criterios para una futura segunda etapa

Antes de permitir que Jev influya consultivamente en el triaje, deberían cumplirse como mínimo:

- volumen de datos representativo;
- discrepancias revisadas y clasificadas;
- preguntas y criterios calibrados;
- umbrales definidos por ruta y riesgo;
- latencia y coste aceptables;
- fallback comprobado;
- ninguna regresión de autoridad o seguridad.

Incluso en esa etapa, `AGENTS.md`, Configuration Lock, autorización humana, Git Policy y circuit breakers seguirán teniendo prioridad absoluta.

## Próxima revisión sugerida

Revisar este documento y la telemetría cuando exista una muestra suficiente de decisiones reales. Como punto inicial, una revisión después de 25–50 decisiones de triaje ofrecerá más valor que analizar cada registro de forma aislada.
