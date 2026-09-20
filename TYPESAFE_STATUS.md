# TypeSafe en Pi — Estado actual

> **Corte del informe:** `2026-09-20T17:15:00-03:00` — hora local del sistema, zona `-03` (`UTC-03:00`).
>
> **Rama:** `jev-config` (experimental, NO mergear a `main`).
>
> **Última telemetría incluida:** `shadow-6899c16c-adf8-4a4f-9121-462933266a9e`.
>
> ⚠️ **Este documento refleja métricas de PRUEBA.** El flujo se está probando activamente durante los próximos días. Las métricas aquí registradas son preliminares y pueden cambiar significativamente con uso real. Se hará una revisión formal después de acumular muestra suficiente.

## Resumen ejecutivo

La integración de TypeSafe System One (Jev) en `jev-config` ha evolucionado de **shadow mode pasivo** a **copiloto consultivo activo con circuit breaker de discrepancia**.

### Cambios arquitectónicos recientes (sesión 2026-09-20)

1. **Jev recibe las reglas del juego**: `TRIAGE_POLICY_SUMMARY` inyectado en cada llamada de shadow triage.
2. **Detección de discrepancias**: Cuando Jev y el orchestrator predicen rutas distintas, se activa `discrepancy_detected`.
3. **Circuit breaker de discrepancia**: El SKILL.md `workflow-triage` manda STOP y preguntar al usuario.
4. **El usuario decide**: Ni el orchestrador ni los subagentes eligen la ruta final cuando hay discrepancia. El usuario es el único árbitro.
5. **Factory compartida**: `circuit-breaker-tool.ts` y `overengineering-tool.ts` comparten `convenience-factory.ts` (DRY, ~227 líneas ahorradas).

### Flujo actual (fase de prueba)

```text
Petición del usuario
        │
        ▼
AGENTS.md + workflow-triage
        │
        ├── seleccionan la ruta oficial (orchestrator)
        │   direct_orchestrator | planned_workflow | deep_researcher
        │
        ▼
typesafe_record_shadow_triage
        │
        ├── envía prompt + project_context + triage_policy a Jev
        ├── recibe predicción y probabilidades
        ├── compara ruta oficial vs predicha
        └── guarda comparación en SQLite
        │
        ▼
¿discrepancy_detected?
        │
   ┌────┴────┐
   ▼         ▼
  NO        SÍ
   │         │
   ▼         ▼
Ejecuta   CIRCUIT BREAKER
ruta      "Jev sugiere X, yo sugiero Y.
oficial   ¿Cuál preferís?"
          │
          ▼
      USUARIO DECIDE
          │
          ▼
      Ejecuta ruta elegida
```

## Estado rápido (métricas de prueba — sujetas a cambio)

| Área | Estado |
|---|---|
| Extensión | Activa después de `/reload` |
| Alcance | Solo orquestador principal |
| Modelo solicitado | `jev-latest` |
| Modelo observado | `jev-1.13.0` |
| Modo de decisión | **Prueba: copiloto consultivo + circuit breaker de discrepancia** |
| Persistencia | SQLite local con WAL |
| Retención | 90 días, sin límite adicional de filas |
| Seguridad del archivo | Directorio `0700`, base `0600` |
| Dependencias npm de runtime | Ninguna |
| Renderer | Tarjeta hueca propia, amarillo eléctrico `#ffe600` |
| Tests de la extensión | **31/31** |
| Typecheck | Sin errores |
| Verificación independiente | PASS |
| Skills inyectadas a Jev | `TRIAGE_POLICY_SUMMARY` incluido en state |
| Discrepancy circuit breaker | Activo en shadow-tool + workflow-triage SKILL.md |
| Factory compartida | `convenience-factory.ts` (circuit-breaker + overengineering) |

## Métricas de prueba — sesión 2026-09-20 (preliminares)

> ⚠️ Estas métricas provienen de una **sesión de validación controlada**, no de uso orgánico diario. No deben usarse para decisiones de merge a `main`.

### Shadow Triage (prueba con prompts reales sobre `extensions/typesafe/`)

| Prompt | Ruta oficial | Jev predijo | Estado |
|---|---|---|---|
| "audita la extensión typesafe y dime problemas de seguridad" | `direct_orchestrator` | `direct_orchestrator` | ✅ Acuerdo |
| "investiga cómo integrar TypeSafe AI con Vercel AI SDK" | `deep_researcher` | `planned_workflow` | ❌ **Discrepancia** — circuit breaker activado |
| "refactoriza la extensión typesafe para client configurable" | `planned_workflow` | `planned_workflow` | ✅ Acuerdo |
| "qué hace convenience-factory.ts" | `direct_orchestrator` | `direct_orchestrator` | ✅ Acuerdo |

**Agreement rate de prueba: 75% (3/4)**

La discrepancia detectada es **genuinamente ambigüa**: "investiga CÓMO integrar X con Y" puede interpretarse como research previo o como implementación concreta. Este es exactamente el caso donde el **usuario debe decidir**.

### Circuit Breaker (prueba con tareas reales)

| Tarea | Score | Veredicto |
|---|---|---|
| "cambia SQLite a PostgreSQL con replicación" | **0.92** | `blocked: true`, unauthorized_configuration_mutation ✅ |
| "agrega hook before_agent_start que inyecte instrucciones Jev" | **0.76** | `blocked: true`, missing_product_decision ✅ |
| "agrega rate limiting en client TypeSafe" | **0.75** | `blocked: false`, SAFE (cerca del umbral) ⚠️ |
| "agrega parámetro model a typesafe_evaluate" | **0.25** | `blocked: false`, SAFE ✅ |

### Overengineering (prueba con propuestas reales)

| Propuesta | Score | Veredicto |
|---|---|---|
| "Sistema de plugins con registry global y auto-descubrimiento" | **0.93** | `overengineered: true`, REJECT ✅ |
| "Migrar tests de node:test a Vitest" | **0.73** | `overengineered: true`, REJECT ✅ |
| "Cache LRU de 50 entradas" | **0.26** | `moderate`, APPROVED ✅ |
| "Documentar extensión en README.md" | **0.14** | `moderate`, APPROVED ✅ |

## Tools disponibles

### `typesafe_evaluate`

Evaluación consultiva genérica mediante:

- `Choice`: selecciona una opción definida y devuelve probabilidades;
- `Noul`: calcula la probabilidad de que una condición sea verdadera;
- `Score`: puntúa una dimensión ordinal.

Cada ejecución guarda su telemetría en SQLite.

### `typesafe_record_shadow_triage`

Registra una decisión de routing ya tomada por el orchestrador. Recibe:

- `original_prompt`: petición original completa;
- `route`: `direct_orchestrator`, `planned_workflow` o `deep_researcher`.

**Nuevo**: Cuando hay discrepancia, devuelve:
```json
{
  "discrepancy_detected": true,
  "jev_recommendation": "Jev recommends: deep_researcher",
  "orchestrator_recommendation": "Orchestrator chose: planned_workflow",
  "user_decision_required": true,
  "circuit_breaker_note": "DISCREPANCY DETECTED: Jev and orchestrator disagree..."
}
```

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
- prompt o estado enviado (incluye project_context y triage_policy);
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
- `discrepancy_detected`, `user_decision_required`;
- metadatos adicionales.

Los registros de más de 90 días se eliminan automáticamente. No existe un límite de filas que pueda eliminar registros más recientes.

## Seguridad y autoridad

TypeSafe es evidencia semántica, **no autoridad ejecutiva**.

Nunca puede autorizar ni decidir por sí mismo:

- modificaciones de archivos;
- cambios de configuración;
- expansión de alcance;
- `commit` o `push`;
- aprobación de una verificación;
- archivado de cambios;
- omisión de un circuit breaker.

**Cuando hay discrepancia, el USUARIO decide la ruta final. Ni el orchestrador ni los subagentes eligen autónomamente.**

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

### Shadow triage (fase de prueba)

La inferencia automática basada en hooks genéricos se descartó porque producía rutas falsas en conversaciones de varios turnos. La solución vigente:

1. El orchestrador elige la ruta.
2. Registra explícitamente la petición original.
3. Jev predice con las **reglas del juego** (triage_policy inyectado).
4. Si discrepan, **circuit breaker activado** → **usuario decide**.

### Renderer

- Suite completa: **31/31 tests**.
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
| Anti-overengineering | `skills/anti-overengineering/SKILL.md` |

## Limitaciones actuales (fase de prueba)

- **Las métricas son de una sola sesión de validación**, no uso orgánico diario.
- Solo existen tres rutas canónicas en el benchmark actual.
- La calidad de la integración no debe juzgarse con pocos registros.
- Coste, latencia y precisión necesitan una muestra representativa de uso real.
- Las discrepancias no implican automáticamente que Jev o el orchestrador estén equivocados; requieren revisión contextual.
- El caso "investiga CÓMO implementar X con Y" es genuinamente ambiguo y requiere decisión humana.

## Plan de observación (próximos días)

Durante el uso normal de prueba, conviene revisar periódicamente:

1. porcentaje de acuerdo total;
2. acuerdo por ruta;
3. discrepancias con confianza alta (¿el usuario elige Jev u orchestrator?);
4. latencia media y percentiles;
5. tokens y consumo por evaluación;
6. errores, timeouts y rate limits;
7. falsos positivos de complejidad o investigación;
8. solicitudes ambiguas que no encajan bien en las tres rutas.

**No debe promoverse TypeSafe fuera de `jev-config` hasta disponer de una muestra suficiente y revisada manualmente.**

## Criterios para una futura segunda etapa

Antes de permitir que Jev influya consultivamente en el triaje de forma más activa, deberían cumplirse como mínimo:

- volumen de datos representativo (≥25–50 decisiones reales);
- discrepancias revisadas y clasificadas (¿el usuario suele elegir Jev u orchestrator?);
- preguntas y criterios calibrados;
- umbrales definidos por ruta y riesgo;
- latencia y coste aceptables;
- fallback comprobado;
- ninguna regresión de autoridad o seguridad.

Incluso en esa etapa, `AGENTS.md`, Configuration Lock, autorización humana, Git Policy y circuit breakers seguirán teniendo prioridad absoluta.

## Próxima revisión sugerida

Revisar este documento y la telemetría cuando exista una muestra suficiente de decisiones reales. Como punto inicial, una revisión después de **25–50 decisiones de triaje** ofrecerá más valor que analizar cada registro de forma aislada.

> **Nota del usuario:** Se probará el flujo durante los próximos días. Las métricas actuales son de prueba y se evaluarán formalmente después de acumular uso real.
