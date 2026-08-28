# Workflow Guard nativo para Pi

Documento de diseño para construir una extensión nativa de Pi que refuerce los workflows ya existentes del agente usando hooks automáticos, JSON derivado y validación mecánica de OpenSpec.

## Decisión principal

No se va a instalar DAW ni copiar su workflow.

El workflow actual de Pi se mantiene intacto:

1. Direct Orchestrator
2. Mini-SDD
3. Formal SDD

La extensión propuesta toma de DAW solo las ideas útiles para hardening:

- validación mecánica;
- estado legible por máquina;
- hooks automáticos;
- detección de drift;
- gates explicables;
- una sola lógica central de validación.

## Objetivo

Construir una herramienta para agentes, no una interfaz de comandos para el usuario.

El usuario no debería tener que ejecutar comandos como `/workflow-status` o `/workflow-sync`. Si quiere saber el estado, pregunta al agente en lenguaje natural:

- “¿en qué estado está este change?”
- “¿puedo aplicar ya?”
- “¿qué falta para verificar?”
- “¿este OpenSpec está listo?”
- “¿hay algo bloqueado?”

El agente responderá usando herramientas nativas registradas por la extensión.

## Principio clave

Los Markdown siguen siendo la fuente de verdad semántica.

Los JSON son derivados mecánicos.

| Capa | Rol |
|---|---|
| Markdown OpenSpec | Contrato humano/canónico: decisiones, alcance, aceptación, blockers, evidencia. |
| JSON por change | Estado mecánico derivado: fase, readiness, hashes, IDs, next allowed, drift. |
| JSON global | Índice rápido de changes activos/archivados. |
| Hooks Pi | Sincronización automática y bloqueo de violaciones claras. |
| Tools Pi | Forma natural para que el agente consulte/valide estado sin comandos de usuario. |

Si Markdown y JSON contradicen:

- el Markdown manda para significado;
- el JSON se marca `STALE`, `CONFLICT` o se regenera;
- una acción peligrosa debe bloquearse hasta recuperar consistencia.

## Alcance

### Incluido

- Detectar changes bajo `openspec/changes/<slug>/`.
- Detectar archives bajo `openspec/archive/YYYY-MM-DD/<slug>/`.
- Generar o actualizar `workflow.json` por cada change.
- Generar o actualizar `openspec/workflows.json` global.
- Leer `Workflow Status` desde los artefactos Markdown.
- Calcular hashes de artefactos relevantes.
- Detectar si un change es Mini-SDD o Formal SDD.
- Detectar mezcla inválida Mini-SDD/Formal SDD en el mismo slug.
- Determinar fase actual y siguiente acción permitida.
- Detectar drift entre contrato, apply, verify y archive.
- Bloquear acciones claramente ilegales desde hooks.
- Exponer herramientas para que el agente consulte y valide el estado.

### Excluido

- Cambiar los workflows existentes.
- Crear un cuarto workflow.
- Reemplazar `AGENTS.md`, `workflow-triage` o `sdd-workflow`.
- Reemplazar los subagentes SDD.
- Instalar DAW.
- Copiar `.daw-state.json`.
- Crear adaptadores multi-tool estilo DAW.
- Hacer commits, branches, tags o releases.
- Convertir el JSON en fuente semántica de producto.

## Ubicación propuesta

Extensión global del agente:

```text
~/.pi/agent/extensions/workflow-guard/
├── index.ts
├── README.md
├── package.json
└── src/
    ├── core/
    │   ├── artifacts.ts
    │   ├── hashes.ts
    │   ├── parseMarkdown.ts
    │   ├── state.ts
    │   ├── validate.ts
    │   └── workflowRules.ts
    ├── tools/
    │   ├── index.ts
    │   ├── getWorkflowState.ts
    │   ├── validateWorkflow.ts
    │   └── explainNextAction.ts
    ├── hooks/
    │   ├── syncOnToolResult.ts
    │   ├── guardToolCall.ts
    │   ├── syncOnSessionStart.ts
    │   └── syncOnAgentSettled.ts
    ├── render/
    │   └── index.ts
    └── types.ts
```

La estructura puede simplificarse al inicio, pero la extensión tiene varias responsabilidades reales: hooks, tools, parsing, validación, escritura de JSON y rendering. Por eso conviene estructura modular y no un archivo único gigante.

## Archivos generados

### JSON por change

Ruta:

```text
openspec/changes/<slug>/workflow.json
```

Para archived changes:

```text
openspec/archive/YYYY-MM-DD/<slug>/workflow.json
```

Ejemplo conceptual:

```json
{
  "schema_version": 1,
  "kind": "change-workflow-state",
  "slug": "add-login-flow",
  "location": "active",
  "workflow": "mini-sdd",
  "phase": "verify",
  "status": "BLOCKED",
  "freshness": "CURRENT",
  "artifacts": {
    "mini-sdd.md": {
      "exists": true,
      "status": "READY",
      "sha256": "...",
      "ids": ["MINI-001", "MINI-002"],
      "updated_at": "2026-08-28T00:00:00Z"
    },
    "apply.md": {
      "exists": true,
      "status": "READY",
      "sha256": "...",
      "updated_at": "2026-08-28T00:00:00Z"
    },
    "verify.md": {
      "exists": true,
      "status": "BLOCKED",
      "verification_result": "ISSUES_FOUND",
      "sha256": "...",
      "updated_at": "2026-08-28T00:00:00Z"
    }
  },
  "next_allowed": ["notify-user", "return-to-apply-after-user-decision"],
  "blockers": [
    "verify.md is BLOCKED: verification result is not PASS"
  ],
  "warnings": [],
  "derived_from": {
    "source": "markdown-artifacts",
    "generated_at": "2026-08-28T00:00:00Z"
  }
}
```

### JSON global

Ruta:

```text
openspec/workflows.json
```

Ejemplo conceptual:

```json
{
  "schema_version": 1,
  "kind": "workflow-index",
  "generated_at": "2026-08-28T00:00:00Z",
  "active": {
    "add-login-flow": {
      "workflow": "mini-sdd",
      "phase": "verify",
      "status": "BLOCKED",
      "freshness": "CURRENT",
      "path": "openspec/changes/add-login-flow/workflow.json"
    }
  },
  "archived": {
    "2026-08-28/add-login-flow": {
      "workflow": "mini-sdd",
      "status": "READY",
      "path": "openspec/archive/2026-08-28/add-login-flow/workflow.json"
    }
  },
  "warnings": []
}
```

## Cómo detectar el tipo de workflow

### Mini-SDD

Un change es Mini-SDD cuando existe:

```text
mini-sdd.md
```

y no existe una firma Formal incompatible como:

```text
tasks.md
spec.md
design.md
proposal.md
```

Mini-SDD esperado:

```text
mini-sdd.md → apply.md → verify.md → archive
```

IDs esperados:

```text
MINI-###
```

### Formal SDD

Un change es Formal SDD cuando existe al menos una de las firmas formales:

```text
proposal.md
spec.md
design.md
tasks.md
```

Formal SDD esperado:

```text
optional prd.md
optional explore.md
proposal.md
→ spec.md
→ design.md
→ tasks.md
→ apply.md
→ verify.md
→ archive
```

IDs esperados:

```text
DELTA-###
REQ-###
SCENARIO-###
DES-###
TASK-###
```

### Conflicto

Si un mismo slug tiene señales fuertes de Mini-SDD y Formal SDD, el estado debe ser:

```text
status: BLOCKED
freshness: CONFLICT
```

Y el siguiente paso permitido debe ser solo notificar o pedir decisión, no aplicar ni verificar.

## Estados posibles

### `READY`

El artifact o workflow puede avanzar sin adivinar.

### `BLOCKED`

Falta una decisión, autorización, artifact, evidencia o consistencia.

### `FAILED`

Un proceso terminó mal y no es simplemente falta de información.

### `STALE`

El JSON existe, pero los hashes o timestamps muestran que ya no representa fielmente los Markdown.

### `CONFLICT`

Hay contradicción entre artifacts o entre workflow detectado y estado previo.

### `UNKNOWN`

La extensión no puede determinar algo con evidencia suficiente.

No debe inventar.

## Fases derivadas

La fase no se guarda como autoridad absoluta; se deriva de los artifacts.

### Mini-SDD

| Evidencia | Fase derivada |
|---|---|
| no existe `mini-sdd.md` | `contract-missing` |
| `mini-sdd.md` existe y está `BLOCKED` | `contract-blocked` |
| `mini-sdd.md` está `READY` y no existe `apply.md` | `ready-for-apply` |
| `apply.md` está `BLOCKED` | `apply-blocked` |
| `apply.md` está `READY` y no existe `verify.md` | `ready-for-verify` |
| `verify.md` está `BLOCKED` o no PASS | `verify-blocked` |
| `verify.md` PASS | `ready-for-archive` |
| está en archive con proof válido | `archived` |

### Formal SDD

| Evidencia | Fase derivada |
|---|---|
| no existe `proposal.md` | `proposal-missing` |
| `proposal.md` BLOCKED | `proposal-blocked` |
| `proposal.md` READY y no existe `spec.md` | `ready-for-spec` |
| `spec.md` BLOCKED | `spec-blocked` |
| `spec.md` READY y no existe `design.md` | `ready-for-design` |
| `design.md` BLOCKED | `design-blocked` |
| `design.md` READY y no existe `tasks.md` | `ready-for-tasks` |
| `tasks.md` BLOCKED | `tasks-blocked` |
| `tasks.md` READY y no existe `apply.md` | `ready-for-apply` |
| `apply.md` BLOCKED | `apply-blocked` |
| `apply.md` READY y no existe `verify.md` | `ready-for-verify` |
| `verify.md` BLOCKED o no PASS | `verify-blocked` |
| `verify.md` PASS | `ready-for-archive` |
| está en archive con proof válido | `archived` |

## Hooks automáticos

### `session_start`

Al iniciar sesión:

- escanear `openspec/changes/` si existe;
- escanear `openspec/archive/` si existe;
- reconstruir `workflow.json` faltantes;
- actualizar `openspec/workflows.json`;
- detectar JSON stale;
- notificar solo si hay blockers o conflictos importantes.

### `tool_call`

Antes de ejecutar una herramienta:

- inspeccionar `write`, `edit`, `bash` y cualquier tool que pueda mutar archivos;
- si apunta a `openspec/`, validar si la mutación es permitida;
- si apunta a implementación mientras el contexto indica verify/archive, bloquear cuando sea claro;
- si intenta archive sin `verify.md` PASS, bloquear;
- si intenta apply sin contrato READY, bloquear;
- si intenta verify sin `apply.md` READY, bloquear;
- si intenta modificar `workflow.json` manualmente, bloquear salvo que sea la extensión generándolo.

El bloqueo debe ser claro y accionable:

```text
Blocked by workflow-guard: cannot verify `add-login-flow` because `apply.md` is missing or not READY.
Next permitted action: complete apply through sdd-apply or ask the user for the missing decision.
```

### `tool_result`

Después de una herramienta:

- detectar si cambió algo bajo `openspec/`;
- recalcular JSON del slug afectado;
- actualizar índice global;
- si aparecen inconsistencias, devolver información visible al agente;
- no spamear si no hubo cambios relevantes.

### `agent_settled`

Cuando el agente termina:

- sync final de OpenSpec;
- marcar drift;
- persistir JSON actualizado;
- opcionalmente añadir un resumen TUI-only si hubo cambios de workflow.

### `session_before_compact` / `session_compact`

Cuando hay compaction:

- asegurar que el estado OpenSpec derivado ya está actualizado;
- inyectar o preservar resumen compacto de cambios activos si hace falta;
- evitar que el agente pierda contexto sobre qué fase sigue.

## Tools para agentes

No deben ser comandos de usuario. Deben ser herramientas que el agente use cuando el usuario pregunte en lenguaje natural.

### `workflow_state_get`

Devuelve estado de un change o del workspace.

Inputs conceptuales:

```json
{
  "slug": "add-login-flow",
  "includeArtifacts": true,
  "includeNextAction": true
}
```

Respuesta:

- workflow detectado;
- fase derivada;
- status;
- blockers;
- artifacts;
- next allowed;
- freshness;
- warnings.

### `workflow_validate`

Valida un change sin modificar contenido semántico.

Inputs conceptuales:

```json
{
  "slug": "add-login-flow",
  "repairDerivedJson": true
}
```

Respuesta:

- pass/fail;
- violations;
- regenerated files;
- stale files;
- conflicts;
- next permitted action.

### `workflow_next_action_explain`

Explica al agente qué puede hacer ahora.

Respuesta centrada en:

- siguiente fase permitida;
- si requiere autorización explícita del usuario;
- subagente esperado;
- artifact que debe existir;
- blocker si no puede avanzar.

## Reglas de bloqueo iniciales

### Contrato antes de apply

Bloquear apply si:

- Mini-SDD: `mini-sdd.md` no existe o no está READY.
- Formal SDD: `tasks.md` no existe o no está READY.

### Apply antes de verify

Bloquear verify si:

- `apply.md` no existe;
- `apply.md` está BLOCKED;
- falta evidencia mínima de implementación;
- el contrato cambió después de apply y no se revalidó.

### Verify antes de archive

Bloquear archive si:

- `verify.md` no existe;
- `verify.md` está BLOCKED;
- `Verification Result` no es PASS;
- hay drift posterior a verify;
- el destino archive ya existe y no hay proof seguro.

### No mezclar workflows

Bloquear si un slug tiene:

- `mini-sdd.md` y `tasks.md` al mismo tiempo;
- IDs `MINI-###` mezclados con cadena Formal `REQ-###`/`TASK-###` como contrato principal;
- artifacts Formal parciales usados para saltar Mini-SDD.

### Proteger JSON derivado

Bloquear edición manual de:

```text
openspec/workflows.json
openspec/changes/<slug>/workflow.json
openspec/archive/YYYY-MM-DD/<slug>/workflow.json
```

excepto cuando la modificación la realice la extensión.

El agente no debe “arreglar” esos JSON a mano; debe pedir a la tool que resincronice.

## Detección de drift

Calcular SHA-256 de artifacts Markdown relevantes.

Ejemplos:

- si `mini-sdd.md` cambia después de `apply.md`, marcar apply como potencialmente stale;
- si `tasks.md` cambia después de `apply.md`, marcar apply como stale;
- si `apply.md` cambia después de `verify.md`, marcar verify como stale;
- si cualquier artifact verificado cambia antes de archive, bloquear archive;
- si archive mueve archivos y los hashes no coinciden, marcar archive FAILED/BLOCKED.

## Modelo de freshness

| Freshness | Significado |
|---|---|
| `CURRENT` | JSON coincide con los artifacts actuales. |
| `STALE` | JSON fue generado desde una versión anterior. |
| `CONFLICT` | Hay contradicción semántica o estructural. |
| `UNVERIFIABLE` | No se pudo leer o hashear algo necesario. |
| `UNKNOWN` | No hay suficiente evidencia para decidir. |

## Relación con `AGENTS.md`

La extensión no reemplaza `AGENTS.md`.

Debe reforzar estas reglas ya existentes:

- solo hay tres workflows;
- discovery no es workflow;
- Mini/Formal requieren delegación por fase;
- BLOCKED detiene avance;
- apply requiere autorización explícita;
- verify debe ser independiente;
- archive requiere verificación passing y autorización explícita;
- no se debe avanzar sin leer artifact anterior;
- no se debe implementar o archivar por inferencia.

## Relación con subagentes

La extensión no crea nuevos subagentes obligatorios.

Debe reconocer los actuales:

- `mini-sdd`
- `prd-review`
- `sdd-explore`
- `sdd-proposal`
- `sdd-spec`
- `sdd-design`
- `sdd-task`
- `sdd-apply`
- `sdd-verify`
- `sdd-archive`
- `discovery`

La extensión puede ayudar al orquestador a saber cuál corresponde, pero no debe sustituir la delegación.

## Relación con Skill Registry

La extensión puede leer el registry para reportar warnings, pero no debe depender totalmente de él para validar OpenSpec.

Motivo: el estado del workflow vive en los artifacts, no en el registry.

Validaciones útiles:

- `workflow-triage` aparece registrado;
- `sdd-workflow` aparece registrado;
- `tdd` aparece registrado;
- subagentes requeridos existen;
- si hay drift entre filesystem y registry, reportarlo como warning, no bloquear workflows no relacionados.

## Relación con memoria

Engram puede guardar decisiones o descubrimientos importantes, pero no debe ser fuente de verdad del workflow.

Fuente de verdad:

1. Markdown OpenSpec;
2. JSON derivado fresco;
3. transcript/handoff;
4. memoria como apoyo, no como autoridad.

## UX esperada

El usuario no usa comandos.

Ejemplo:

Usuario:

```text
¿Podemos aplicar este change?
```

Agente:

1. llama `workflow_state_get`;
2. si hace falta llama `workflow_validate`;
3. responde:

```text
No todavía. El change `add-login-flow` está en Mini-SDD, pero `mini-sdd.md` está BLOCKED.
Falta resolver: definición de aceptación para MINI-002.
Siguiente acción permitida: pedirte esa decisión o devolver el artifact a mini-sdd.
```

Otro ejemplo:

Usuario:

```text
¿qué falta para archive?
```

Agente:

1. consulta estado;
2. valida hashes;
3. responde:

```text
Falta verificación passing. `apply.md` está READY, pero `verify.md` no existe.
Siguiente acción permitida: delegar `sdd-verify`. Archive todavía no está permitido.
```

## Errores y mensajes

Los errores deben ser cortos, accionables y basados en evidencia.

Formato recomendado:

```text
workflow-guard blocked this action.
Reason: <specific violated rule>.
Evidence: <artifact/path/status>.
Next permitted action: <one action>.
```

No usar mensajes ambiguos como:

```text
Invalid workflow.
```

Preferir:

```text
Cannot archive `add-login-flow`: verify.md exists but `Verification Result` is not PASS.
```

## Seguridad

La extensión toca archivos dentro de `openspec/`.

Debe evitar:

- seguir symlinks fuera del repo;
- escribir fuera de `openspec/`;
- sobrescribir archivos no derivados;
- persistir secretos;
- exponer paths sensibles innecesarios;
- interpretar `.env` o credenciales;
- ejecutar comandos externos para validar si no es estrictamente necesario.

## Escritura segura

Los JSON derivados deben escribirse de forma atómica:

1. generar contenido en memoria;
2. escribir archivo temporal en el mismo directorio;
3. renombrar al destino final;
4. no dejar archivos parciales;
5. si falla, marcar `UNVERIFIABLE` o reportar warning.

## Qué debería bloquear y qué solo advertir

### Bloquear

- apply sin contrato READY;
- verify sin apply READY;
- archive sin verify PASS;
- edición manual del JSON derivado;
- mezcla Mini/Formal en el mismo slug;
- archive con destino existente no verificable;
- intento de verify modificando implementación cuando sea claramente detectable.

### Advertir

- registry posiblemente stale;
- artifacts opcionales ausentes;
- falta de `prd.md` si no es obligatorio;
- JSON global ausente pero regenerable;
- hash faltante por primera generación;
- múltiples changes activos sin contexto claro.

## MVP recomendado

### MVP 1: JSON derivado automático

- generar `workflow.json` por change;
- generar `openspec/workflows.json`;
- sync en `session_start`, `tool_result` y `agent_settled`;
- tool `workflow_state_get`;
- tool `workflow_validate`.

### MVP 2: gates preventivos

- hook `tool_call` para `write`, `edit`, `bash`;
- bloquear edición manual del JSON;
- bloquear apply/verify/archive ilegales;
- mensajes de error accionables.

### MVP 3: drift y continuidad

- hashes por artifact;
- drift `contract → apply`;
- drift `apply → verify`;
- drift `verify → archive`;
- bloquear archive si cambia algo después de verify.

### MVP 4: reporting para agente

- respuestas compactas para el modelo;
- rendering colapsado/expandido en TUI;
- warnings claros sin ruido.

## Criterios de aceptación

- La extensión no cambia los tres workflows existentes.
- Los Markdown OpenSpec siguen siendo fuente de verdad semántica.
- Los JSON se regeneran automáticamente cuando cambian artifacts relevantes.
- El agente puede consultar estado sin comandos de usuario.
- `openspec/workflows.json` refleja todos los changes activos detectados.
- Cada change activo tiene `workflow.json` fresco o una razón clara de `STALE/CONFLICT/UNVERIFIABLE`.
- Apply se bloquea si falta contrato READY.
- Verify se bloquea si falta apply READY.
- Archive se bloquea si falta verify PASS.
- La edición manual de JSON derivado se bloquea o se revierte por sync controlado.
- Los mensajes de bloqueo indican path, razón y siguiente acción permitida.
- No se escriben archivos fuera de `openspec/`.
- No se persisten secretos.

## Preguntas de diseño pendientes

1. ¿Debe existir un concepto de “change activo” único o permitir múltiples activos?
2. Si hay múltiples changes activos, ¿cómo decide la tool cuál reportar cuando el usuario pregunta sin slug?
3. ¿Dónde se registra la autorización explícita de apply/archive: solo transcript, `apply.md`, `workflow.json` o todos?
4. ¿La extensión debe generar JSON para archived changes siempre o solo al archivar?
5. ¿Qué nivel de parsing Markdown es suficiente para la primera versión?
6. ¿Debe bloquear `bash` agresivamente o solo cuando detecte mutaciones obvias bajo `openspec/`?
7. ¿Debe la extensión validar subagentes/skills o dejar eso para otra tool de config lint?

## Recomendación actual

Empezar pequeño:

1. construir parser de artifacts OpenSpec;
2. generar JSON derivado;
3. registrar tools para agentes;
4. sync automático por hooks;
5. recién después añadir bloqueos fuertes.

No empezar por un guard agresivo de `bash`. Primero necesitamos que el estado derivado sea confiable.

## Resumen final

La idea viable es crear un Workflow Guard nativo de Pi que use hooks para mantener JSON derivado desde OpenSpec y exponer tools para que los agentes consulten/validen el estado.

No es un port de DAW.

Es una adaptación de sus mejores ideas al workflow Pi existente:

- DAW aporta el enfoque de gates mecánicos y estado verificable.
- Pi mantiene su modelo Direct/Mini-SDD/Formal SDD.
- OpenSpec sigue siendo la fuente de verdad.
- La extensión automatiza sincronización, validación y bloqueo de acciones claramente ilegales.
