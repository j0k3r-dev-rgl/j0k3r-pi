# Auditoría del orquestador, subagentes y skills

## Resumen ejecutivo

La arquitectura contractual es sólida en sus fundamentos: existen exactamente tres workflows, las responsabilidades principales están separadas, Formal SDD mantiene trazabilidad completa, la verificación es independiente y el archivo aplica controles defensivos fuertes.

La auditoría no encontró defectos críticos. Sí encontró **5 defectos de prioridad alta**, **8 riesgos medios** y varias oportunidades menores. El mayor grupo de problemas está en Mini-SDD, seguido por la validación de los prompts delegados y algunos huecos de continuidad entre verificación y archivo.

Esta auditoría fue estática y de contratos. No modificó comportamiento ni ejecutó workflows destructivos.

## Estado de remediación

- `AUD-H01`: aplicado directamente.
- `AUD-H02`: aplicado directamente.
- `AUD-H03`: aplicado directamente.
- `AUD-H04`: aplicado directamente.
- `AUD-H05`: excluido por decisión del usuario; la skill configura una tool y no forma parte del flujo operativo auditado.

Las correcciones se realizaron sin SDD ni TDD, según instrucción explícita del usuario, con validación estructural de Markdown, contratos y routing.

Decisiones posteriores sobre riesgos medios:

- `AUD-M01`, `AUD-M02`, `AUD-M04`, `AUD-M05` y `AUD-M06`: aceptados sin cambio por el usuario.
- `AUD-M03`: corregido mediante snapshot SHA-256 obligatorio después de verify y recomputación antes de archive/delivery.
- `AUD-M07`: corregido reduciendo matches directos de documentación/ADR y expansión automática de skills relacionadas.
- `AUD-M08`: corregido asignando la auditoría del registry generado a `skill-authoring`, manteniendo `SKILL.md` como fuente canónica y prohibiendo editar el cache directamente.
- Observaciones menores 1–6: corregidas con reglas explícitas para research autorizado, onboarding sin reconfirmación, activación documental sin fases SDD, persistencia terminal de archive, ownership de intentos de planificación y evidencia TDD verificable.

## Segunda auditoría completa

Los cinco carriles independientes finalizaron `READY` y sin blockers después de las remediaciones.

### Resultado

- Defectos críticos: **0**.
- Defectos altos: **0**.
- Defectos medios del flujo operativo: **0**.
- Regresiones de Mini-SDD, Formal SDD, TDD, continuidad o archive: **0**.
- Registry/source drift: **0**; 24 skills, 0 warnings.

Pasaron routing y consentimiento, onboarding, los 12 subagentes, contratos de siete campos y seis campos, trazabilidad Mini/Formal, independencia apply/verify, evidencia TDD, SHA-256 post-verify, archive normal/defensivo, evidencia terminal y owner selection por paths mixtos.

### Observaciones residuales no bloqueantes

1. **Routing semántico de noticias — medio/bajo:** una consulta ADR solo por intención puede devolver `tech-intel-briefing` como match secundario. `technical-decisions` conserva la mayor prioridad y el ownership correcto; el riesgo es carga contextual y posible confusión, no desplazamiento del owner.
2. **Routing semántico de documentación — medio/bajo:** una búsqueda web de documentación puede activar `cognitive-doc-design`, confundiendo recuperación de información con creación/revisión documental.
3. **Routing semántico de configuración API — bajo:** `pi-extension-authoring` puede aparecer como match secundario para `.pi/api.json`; `api-tools-configuration` permanece primero y su contrato excluye implementación.
4. **Direct Orchestrator — bajo:** `workflow-triage` nombra explícitamente `tdd` para cambios directos de código, pero no repite con la misma claridad la carga de `anti-overengineering`, aunque la skill transversal y WF-02 ya la requieren.
5. **Matriz verify bloqueada — editorial:** las filas usan `PASS | ISSUES_FOUND` mientras el artifact completo puede ser `BLOCKED`; el stop global es determinista, pero podría aclararse que una fila no evaluable se documenta fuera de la matriz y bloquea el artifact.
6. **Redacción de autorización — editorial:** puede aclararse que los artefactos documentales no autorizan por sí solos implementación y que research “no autorizado” significa fuera del paquete ya aprobado.

### Hallazgos descartados en la segunda auditoría

- `tool-smoke` no necesita convertirse automáticamente al contrato workflow-relevant: es un helper manual y puede usar su respuesta especializada bajo la exención canónica.
- El allowlist amplio de `tool-smoke` es intencional para probar herramientas; requiere delegaciones explícitas y acotadas.
- `mem_update` en `sdd-apply` se conserva por decisión del usuario para información importante en Engram.
- `bash` en `discovery` se conserva por decisión del usuario bajo su contrato read-only.
- `architecture-definition` como match adyacente de una consulta ADR no desplaza a `technical-decisions` y no constituye co-ownership.
- Las coincidencias directas de `workflow-triage`, `sdd-workflow` y `anti-overengineering` durante una fase SDD son guardrails intencionales.

### Conclusión de la segunda auditoría

El flujo operativo está estable, modular y determinista a nivel contractual. No existe un blocker para uso. Las observaciones restantes son de precisión semántica o claridad editorial y pueden abordarse como una optimización separada sin reabrir la arquitectura del workflow.

## Alcance y método

Se revisaron:

- `AGENTS.md` como autoridad canónica.
- Las 24 skills registradas bajo `skills/*/SKILL.md`.
- La skill externa `subagents-configuration`.
- Las 12 definiciones activas bajo `subagents/*.md`.
- `subagents.json` y la configuración de Skill Registry.
- `skills/workflow-triage/SKILL.md` y `skills/sdd-workflow/SKILL.md`.
- `docs/pi-workflow-regression-scenarios.md`.
- Los contratos de PRD, discovery, apply, verify y archive.

La investigación se dividió en cinco carriles independientes:

1. autoridad, routing, consentimiento y alcance;
2. configuración y contratos de subagentes;
3. ciclo Mini-SDD y Formal SDD;
4. skills y Skill Registry;
5. trazas adversariales extremo a extremo.

## Resultado global

| Área | Resultado |
|---|---|
| Modelo de tres workflows | Sólido |
| Consentimiento y separación advice/execution | Sólido con ambigüedades menores |
| Formal SDD | Sólido |
| Mini-SDD | Necesita correcciones prioritarias |
| Handoffs y prompts delegados | Parcialmente consistente |
| Independencia apply/verify | Sólida |
| Identidad y continuidad del candidato | Correcta cuando se activa; hueco posterior a verify |
| Archivo | Fuerte, con dos ambigüedades |
| Tool allowlists | Generalmente correctos; revisar memoria y shell |
| Skills/registry mecánico | Consistente, 24 skills y cero warnings |
| Routing semántico de skills | Funcional, con huecos y fan-out excesivo |

## Defectos confirmados de prioridad alta

### AUD-H01 — Mini-SDD no tiene un contrato normativo suficiente

**Evidencia:** `skills/sdd-workflow/SKILL.md` define que el orquestador mantiene `mini-sdd.md`, pero no establece una estructura mínima equivalente a los contratos de las fases Formal SDD. `subagents/sdd-apply.md` lo consume como contrato de implementación.

**Riesgo:** un archivo puede marcarse `READY` sin alcance exacto, aceptación, checklist, validación o paths autorizados suficientes.

**Recomendación mínima:** definir en `sdd-workflow` un contrato compacto para `mini-sdd.md` con:

- `Workflow Status`;
- objetivo, alcance y exclusiones;
- ítems de contrato o checklist con IDs locales;
- aceptación y validación por ítem;
- paths autorizados;
- blockers y siguiente acción;
- forecast solo cuando aplique.

### AUD-H02 — La verificación de Mini-SDD exige IDs que Mini-SDD no produce

**Evidencia:** `subagents/sdd-verify.md` exige una fila por `REQ-###`; Mini-SDD no exige `REQ-###`.

**Riesgo:** el verificador no puede cumplir su contrato sin inventar requisitos o dejar una matriz vacía.

**Recomendación mínima:** elegir una sola solución:

1. usar IDs locales en `mini-sdd.md` y verificarlos; o
2. definir una matriz específica de ítems/checklist para Mini-SDD.

No conviene imponer toda la cadena Formal SDD a Mini-SDD.

### AUD-H03 — Los agentes de fase no validan uniformemente los siete campos delegados

**Evidencia:** `discovery.md` bloquea de forma explícita un prompt materialmente incompleto. La mayoría de agentes PRD/SDD dicen que reciben siete campos, pero no enumeran la validación ni obligan a devolver `BLOCKED` cuando falta autoridad material.

**Riesgo:** una fase puede inferir alcance, exclusiones o siguiente acción bajo lean mode, donde no recibe `AGENTS.md`.

**Recomendación mínima:** añadir a todos los agentes workflow-relevant un contrato compacto compartido: validar los siete campos y devolver `BLOCKED` si falta autoridad, scope, exclusiones, contrato rector, output o siguiente acción material.

### AUD-H04 — `news-researcher` no devuelve el handoff canónico

**Evidencia:** `subagents/news-researcher.md` pide una nota de finalización, no el sobre de seis campos.

**Riesgo:** el workflow `tech-intel-briefing` pierde estado estructurado, blockers y evidencia, especialmente en background/history.

**Recomendación mínima:** incorporar el handoff canónico y conservar los detalles editoriales dentro de `Evidence` o después del sobre.

### AUD-H05 — La skill de configuración de subagentes no participa en el Skill Registry activo

**Evidencia:** `/home/j0k3r/pi-subagents-j0k3r/skills/subagents-configuration/SKILL.md` tiene contrato válido, pero sus paths no están dentro de las raíces del registry activo. Una resolución para `subagents.json` no encontró la skill, aunque aparece en la lista de skills inyectada por el entorno.

**Riesgo:** el routing dinámico puede no seleccionar la guía correcta para cambios en `subagents.json` o definiciones de subagentes.

**Recomendación mínima:** instalar/copiar la skill en una raíz registrada o añadir un mecanismo aprobado para registrar esa fuente externa. No duplicar dos copias sin definir cuál es canónica.

## Riesgos medios

### AUD-M01 — Implementation Readiness depende demasiado del orquestador

`skills/sdd-workflow/SKILL.md` exige el packet antes de apply, pero `subagents/sdd-apply.md` no lo valida como precondición propia.

**Recomendación:** pasar una declaración explícita de aplicabilidad y evidencia equivalente en el prompt de apply, y hacer que apply bloquee si falta.

### AUD-M02 — Los triggers de candidato o entrega pueden quedar solo en el handoff

En Mini-SDD se permite registrar un trigger en el handoff o artifact; verify comienza leyendo `apply.md`.

**Recomendación:** todo trigger que afecte verify/archive debe persistirse en `apply.md` antes de verificación final.

### AUD-M03 — No hay prueba obligatoria de continuidad si aparece drift después de verify

La identidad estable es correctamente trigger-based, pero un cambio real posterior a verify invalida la verificación incluso si no existía trigger al congelar.

**Recomendación:** antes de archive/delivery, exigir una comprobación limitada de que los deliverables verificados no cambiaron; si aparece drift, capturar nueva identidad cuando corresponda y volver a verificar.

### AUD-M04 — Detección ambigua del workflow durante archive

`sdd-archive` detecta Mini/Formal por presencia de `mini-sdd.md` o `tasks.md`, pero no define qué hacer si ambos existen o contradicen la identidad suministrada.

**Recomendación:** bloquear ante múltiples firmas de workflow, ausencia de firma o conflicto con la identidad delegada.

### AUD-M05 — `sdd-apply` puede actualizar memoria sin delimitar el target

Tiene `mem_update`, pero su contrato solo regula el idioma, no qué observaciones puede modificar.

**Recomendación:** retirar `mem_update` o limitarlo a IDs del flujo activo explícitamente suministrados en el prompt.

### AUD-M06 — `discovery` es read-only por contrato, pero dispone de `bash`

El prompt prohíbe mutaciones, pero la herramienta puede realizarlas técnicamente.

**Recomendación:** conservarla solo si es necesaria y enumerar comandos permitidos de lectura, prohibiendo redirecciones, chmod, borrado, instalación, red y escritura. Idealmente, aplicar enforcement en el runtime.

### AUD-M07 — Routing documental con fan-out excesivo

ADR y paths amplios de `docs/**/*.md` activan simultáneamente `technical-decisions`, `startup-documentation` y `cognitive-doc-design`, con muchas skills relacionadas.

**Recomendación:** mantener al owner canónico como match directo y convertir `cognitive-doc-design` en apoyo secundario para ADRs. El router ya debe usar `include_related:false` para elegir owner.

### AUD-M08 — No existe una ruta clara para auditar el registry generado

`.pi/skill-registry.json` no activa una skill. Sin embargo, no debe convertirse en fuente editable ni asignarse automáticamente a `skill-registry-configuration`.

**Recomendación:** añadir una intención estrecha de “registry validation/audit” a `skill-authoring` o crear una guía específica de validación; preservar que el source of truth son los `SKILL.md`.

## Observaciones menores

- `workflow-triage` puede interpretarse como que siempre debe preguntar profundidad y executor cuando hay research. Debe decir explícitamente “solo si no están ya autorizados o son materialmente ambiguos”.
- `existing-project-onboarding` debería aclarar que una petición que ya contiene root, depth, scope, exclusiones y límites constituye aprobación, sin segunda confirmación.
- `startup-documentation` habla de la utilidad de `sdd_phases`, aunque su registro está intencionalmente vacío.
- La evidencia terminal del archivo vive en el handoff/transcript. Conviene documentar que esto es intencional o definir un destino durable sin reintroducir estado frágil.
- `sdd-task` debería aclarar que solo registra agotamiento de intentos de planificación, no intentos de implementación.
- Cuando se asigne `tdd`, apply/verify deberían evidenciar también ownership del test existente, framework y calidad de assertions, no solo etiquetas RED/GREEN/REFACTOR.

## Hallazgos descartados o rebajados

### Falta de parada tras verificación fallida en `workflow-triage`

No se considera defecto alto. `sdd-verify` convierte `ISSUES_FOUND` en artifact/handoff `BLOCKED`, y el gate general ya detiene cualquier artifact bloqueado. Puede añadirse una referencia explícita por claridad, pero la semántica está cubierta.

### Falta de handoff en la respuesta normal de `workflow-triage`

No es defecto. El sobre canónico aplica a resultados delegados workflow-relevant; una respuesta no delegada del orquestador puede usar formato ordinario.

### Allowlist amplio de `tool-smoke`

No se considera automáticamente defecto: su función expresa es probar disponibilidad de herramientas y requiere un allowlist amplio. Sí existe riesgo operativo. Debe mantenerse como agente manual, explícito y acotado; el handoff canónico solo es obligatorio cuando la prueba transfiera un resultado workflow-relevant, pues los helpers triviales están exentos.

### Triggers amplios de TDD y anti-overengineering

Son en gran medida intencionales: ambas skills funcionan como guardrails. El problema sería de ranking o carga innecesaria, no de ownership, siempre que no desplacen al workflow o owner canónico.

### Registry/source mismatch

No existe. Los 24 registros coinciden con sus fuentes y el hash está fresco.

## Controles que funcionan bien

- Solo existen Direct Orchestrator, Mini-SDD y Formal SDD.
- Advice-only no autoriza inspección ni ejecución.
- Una petición concreta comienza sin una segunda ceremonia de consentimiento.
- El scope expansion no autorizado se detiene.
- Formal SDD mantiene la cadena `DELTA → REQ/SCENARIO → DES → TASK → VERIFY`.
- Artifacts `BLOCKED`, handoffs `BLOCKED/FAILED` y mismatches detienen el avance.
- `sdd-verify` no puede editar implementación ni tests.
- Una verificación no aprobada no inicia reparación ni rerun automáticamente.
- Archive exige PASS, destination-only proof y cero retries destructivos automáticos.
- Los 12 perfiles de modelo coinciden con las 12 definiciones activas.
- Ningún subagente tiene herramientas `subagent_*`.
- El registry está habilitado, fresco y sin warnings.

## Orden recomendado de corrección

1. Definir el contrato completo de `mini-sdd.md`.
2. Corregir la matriz de verificación Mini-SDD.
3. Uniformar validación de los siete campos en todos los agentes workflow-relevant.
4. Persistir readiness y triggers en `apply.md`.
5. Añadir handoff a `news-researcher`.
6. Integrar `subagents-configuration` en una raíz registrada.
7. Cerrar continuidad post-verify y conflictos de identidad en archive.
8. Restringir memoria de apply y shell de discovery.
9. Reducir fan-out semántico de skills y añadir routing de auditoría del registry.

## Validación de esta auditoría

- Las cinco investigaciones devolvieron `READY` y `Blockers: None`.
- Los hallazgos se contrastaron con el contrato canónico para eliminar duplicados y falsos positivos.
- No se editaron `AGENTS.md`, skills, subagentes ni configuración.
- No se hicieron commits, pushes, migraciones ni operaciones destructivas.

## Limitaciones

- Auditoría estática de Markdown/JSON y contratos, no de la implementación interna de las extensiones.
- No se ejecutaron escenarios reales de Mini-SDD/Formal SDD ni pruebas de aislamiento del runtime.
- No se inspeccionó historial de tareas, base de datos de subagentes ni hooks efectivos de seguridad.
- Una segunda fase debería incluir smoke tests no destructivos y casos de regresión representativos antes de aplicar correcciones.
