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
| Alcance | Orquestador principal y subagentes (`00-discovery`, `01-planning`, `02-apply`, `03-verify`, `deep-researcher`) |
| Modelo solicitado | `jev-latest` |
| Modelo observado | `jev-1.13.0` |
| Modo de decisión | **Copiloto consultivo + circuit breaker de discrepancia + inyección dinámica por código** |
| Inyección de directrices | **Dinámica por código** (`before_agent_start` en orquestador, `promptGuidelines` en subagentes) |
| Desacoplamiento Markdown | Completo: subagentes y skills 100% limpios de instrucciones hardcodeadas |
| Persistencia | SQLite local con WAL |
| Retención | 90 días, sin límite adicional de filas |
| Seguridad del archivo | Directorio `0700`, base `0600` |
| Dependencias npm de runtime | Ninguna |
| Renderer | Tarjeta hueca propia, amarillo eléctrico `#ffe600` |
| Tests de la extensión | **33/33** pasando |
| Typecheck | Sin errores |
| Verificación independiente | PASS (validado en orquestador y subagentes) |
| Gestión en UI | Soportado en `tools-manager` (`/tools`) y `.pi/extensions.json` |
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

## Hallazgos del deep-researcher (sesión 2026-09-20)

Investigación completa: `investigaciones/2026-09-20-1424-typesafe-subagent-integration/report.md`

### Arquitectura de uso por subagente

| Subagente | Herramientas permitidas | Patrón principal | Invocaciones máximas |
|---|---|---|---|
| **Orchestrator** | `record_shadow_triage`, `circuit_breaker`, `evaluate` | Macro triaje, ambigüedad de prompt, discrepancia | 1–2 |
| **00-discovery** | `circuit_breaker` | Claridad de delegación, verificación de límites | 0–1 |
| **01-planning** | `check_overengineering`, `circuit_breaker` | **Gate de KISS/YAGNI** antes de finalizar plan.md | 1–2 |
| **02-apply** | `check_overengineering`, `circuit_breaker` | Sensor de drift arquitectónico (excepcional) | 0–1 |
| **03-verify** | `evaluate`, `check_overengineering` | Verificación cualitativa de contrato, diff audit | 1–2 |
| **deep-researcher** | `circuit_breaker`, `evaluate` | Ambigüedad de tema, detección de contradicciones | 1–2 |

### Reglas de oro

1. **Regla de Determinismo**: Nunca reemplazar `bash`, `read`, `tsc`, `node --test` con Jev.
2. **Regla de No-Duplicación**: Si el orchestrator ya validó con `circuit_breaker`, el subagente acepta la tarea como clara.
3. **Regla de Invocaciones Acotadas**: **Máximo 2 llamadas Jev por subagente**. Una 3ª indica confusión algorítmica → `BLOCKED`.
4. **Separación de Telemetría**: `typesafe_record_shadow_triage` es **exclusivo del orchestrator**. Los subagentes graban telemetría estándar.

### Bugs encontrados y corregidos

| Bug | Ubicación | Impacto | Estado |
|---|---|---|---|
| Token usage registrado como 0/0 | `convenience-factory.ts` leía `response.tokens` en lugar de `response.usage` | Cost tracking incorrecto | ✅ Corregido en `01af57a` |
| Sin `caller_agent` en telemetría | No se sabía qué subagente hizo la llamada | Dificultaba calibración por agente | ✅ Corregido en `01af57a` |

### Budget de costo/latencia

| Tipo de workflow | Llamadas | Input tokens | Output tokens | Latencia total | Costo diario |
|---|---|---|---|---|---|
| Direct Orchestrator | 1 | ~1,160 | ~100 | ~0.9s | ~$0.0013 |
| Planned Workflow | 3–4 | ~3,500 | ~350 | ~2.7–3.6s | ~$0.0039 |
| Deep Researcher | 2 | ~2,000 | ~200 | ~1.8s | ~$0.0022 |

**Presupuesto diario (15–20 workflows)**: ~$0.03–$0.09/día, <40s latencia total.

### Anti-patrones identificados

1. **Reemplazo determinista**: Preguntarle a Jev "¿pasó el test?" → usar `bash`/`node --test`
2. **Tight loops**: Llamar Jev después de cada edición → fase-boundary gate only
3. **Meta-evaluaciones recursivas**: Preguntarle a Jev si su propio veredicto fue correcto
4. **Shadow triage en subagentes**: Corrompe la base de datos de triaje
5. **State dumping**: Volcar 2,000 líneas de código en `state` → diluye atención
6. **Delegación de autoridad**: Usar score favorable de Jev para saltar Configuration Lock

### Criterios de calibración antes de confiar en subagentes

- **25–50 workflows reales** registrados en `telemetry.sqlite`
- Durante calibración, subagentes tratan Jev como **warning en notas**, no como aborto duro, salvo score > 0.85
- Threshold actual: 0.70 (bifurca claramente soluciones limpias de complejidad especulativa)

## Próxima revisión sugerida

Revisar este documento y la telemetría cuando exista una muestra suficiente de decisiones reales. Como punto inicial, una revisión después de **25–50 decisiones de triaje** ofrecerá más valor que analizar cada registro de forma aislada.

> **Nota del usuario:** Se probará el flujo durante los próximos días. Las métricas actuales son de prueba y se evaluarán formalmente después de acumular uso real.
