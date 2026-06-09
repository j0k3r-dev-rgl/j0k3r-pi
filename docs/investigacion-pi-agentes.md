# Investigación: Pi como base para sistema de agentes y memoria

## 1. Conclusión inicial

Pi es una buena base para nuestro sistema porque está diseñado como un harness minimalista y extensible. No trae subagentes, plan mode ni memoria avanzada integrados por defecto, pero precisamente expone los puntos de extensión necesarios para construirlos mediante TypeScript extensions, skills, prompt templates, comandos, herramientas custom y SDK/RPC.

La ruta más recomendable para nuestro caso es comenzar con una extensión de Pi que registre herramientas y comandos para:

- Memoria persistente del proyecto y del usuario.
- Delegación a subagentes especializados.
- Clasificación de tareas por flujo: inline, delegado o SDD/TDD.
- Gating de permisos para cambios de alto impacto.

## 2. Capacidades relevantes de Pi

### 2.1 Extensions

Las extensiones son módulos TypeScript que Pi carga desde:

- `~/.pi/agent/extensions/` para uso global.
- `.pi/extensions/` para uso del proyecto.

Permiten:

- Registrar herramientas custom con `pi.registerTool()`.
- Registrar comandos slash con `pi.registerCommand()`.
- Interceptar input del usuario.
- Modificar el system prompt antes de cada turno.
- Observar o bloquear tool calls.
- Modificar resultados de herramientas.
- Crear UI, confirmaciones y notificaciones.
- Persistir estado en la sesión con `pi.appendEntry()`.
- Enviar mensajes al agente con `pi.sendUserMessage()`.

Esto es suficiente para crear un orquestador integrado dentro de Pi.

### 2.2 Skills

Las skills son paquetes de instrucciones markdown siguiendo el estándar Agent Skills.

Ubicaciones principales:

- `~/.pi/agent/skills/`
- `.pi/skills/`
- `.agents/skills/`

Funcionan como capacidades bajo demanda. Pi solo carga en contexto el nombre y descripción; el contenido completo se lee cuando el agente decide usar la skill o cuando se invoca con `/skill:name`.

Uso recomendado para nuestro sistema:

- Definir skills para flujos SDD/TDD.
- Definir skills de revisión de código.
- Definir skills de diseño técnico.
- Definir skills de investigación de codebase.

### 2.3 Prompt templates

Los prompt templates son comandos reutilizables en markdown. Se pueden invocar como `/nombre`.

Uso recomendado:

- `/inline`
- `/delegar`
- `/sdd`
- `/tdd`
- `/review`
- `/plan`

Aunque el orquestador pueda elegir flujos automáticamente, los templates sirven para forzar un flujo manualmente.

### 2.4 AGENTS.md y SYSTEM.md

Pi carga archivos de contexto:

- `~/.pi/agent/AGENTS.md`
- `AGENTS.md` en el proyecto y sus padres
- `.pi/SYSTEM.md` para reemplazar el system prompt del proyecto
- `APPEND_SYSTEM.md` para añadir instrucciones

Uso recomendado:

- `AGENTS.md`: convenciones del proyecto.
- `.pi/SYSTEM.md` o extensión: instrucciones del orquestador.
- `APPEND_SYSTEM.md`: reglas adicionales del equipo.

### 2.5 SDK

El SDK permite crear sesiones programáticamente desde Node/TypeScript.

Permite:

- Crear sesiones de agente.
- Elegir modelo y herramientas.
- Cargar extensiones y skills.
- Crear herramientas custom.
- Controlar eventos.
- Gestionar sesiones.

Uso posible a futuro:

- Crear una app externa o CLI propia que use Pi como motor.
- Crear pruebas automatizadas del comportamiento del orquestador.
- Crear workflows multiagente más controlados.

Para el MVP, una extensión dentro de Pi parece más directa que construir una app SDK separada.

### 2.6 RPC mode

Pi puede ejecutarse en modo RPC con JSONL sobre stdin/stdout.

Uso posible:

- Integración desde otros lenguajes.
- Ejecutar Pi como proceso hijo.
- Crear un runtime externo que coordine Pi.

No parece necesario para el MVP. La memoria será una extensión nativa de Pi escrita en TypeScript, usando custom tools y comandos registrados directamente en Pi.

## 3. Subagentes en Pi

Pi no trae subagentes integrados por defecto, pero incluye un ejemplo oficial de extensión `subagent`.

El enfoque del ejemplo es:

- Registrar una tool llamada `subagent`.
- Descubrir definiciones de agentes markdown.
- Lanzar procesos `pi` separados con `--mode json -p --no-session`.
- Pasar system prompt, modelo y herramientas específicas por agente.
- Soportar tres modos:
  - single
  - parallel
  - chain
- Capturar eventos JSON de los subagentes.
- Devolver el resultado al agente padre.

### 3.1 Formato de agente del ejemplo

```md
---
name: scout
description: Fast codebase recon
tools: read, grep, find, ls, bash
model: claude-haiku-4-5
---

System prompt del agente.
```

Ubicaciones:

- `~/.pi/agent/agents/*.md`
- `.pi/agents/*.md`

### 3.2 Relevancia para nuestro sistema

Este ejemplo es muy cercano a lo que necesitamos. Podemos usarlo como base conceptual para nuestro sistema de agentes:

- Agente scout/analista.
- Agente planner/arquitecto.
- Agente worker/implementador.
- Agente reviewer/tester.
- Orquestador que decide si usar subagentes.

La diferencia principal es que nuestro orquestador también deberá consultar memoria y elegir el flujo automáticamente.

## 4. Diseño recomendado para nuestro sistema sobre Pi

## 4.1 Capa 1: Memoria

Crear una extensión Pi en TypeScript con SQLite local.

La extensión registrará custom tools directamente en Pi:

- `memory_context`
- `memory_start_chat`
- `memory_search`
- `memory_get`
- `memory_add`
- `memory_list`
- `memory_update`
- `memory_archive`
- `memory_session_start`
- `memory_session_prompt_add`
- `memory_session_finish`
- `memory_recall`

También podrá registrar comandos humanos como `/memory-status`, `/memory-context`, `/memory-search` y `/memory-doctor`.

## 4.2 Capa 2: Agentes especializados

Definir agentes markdown en `.pi/agents/` o `~/.pi/agent/agents/`:

- `analyst.md`
- `architect.md`
- `implementer.md`
- `tester.md`
- `reviewer.md`
- `memory.md`

Cada agente tendrá:

- Nombre.
- Descripción.
- Modelo opcional.
- Herramientas permitidas.
- Prompt especializado.

## 4.3 Capa 3: Orquestador

Implementar una extensión `orchestrator` que pueda:

- Interceptar input con evento `input` o `before_agent_start`.
- Consultar memoria relevante antes de tareas medianas/grandes.
- Inyectar contexto en el system prompt.
- Registrar una tool `delegate` o reutilizar `subagent`.
- Aplicar reglas de clasificación:
  - inline
  - delegado
  - SDD/TDD
- Pedir confirmación para tareas grandes.

## 4.4 Capa 4: Flujos

### Inline

El orquestador resuelve directamente con las herramientas normales de Pi.

### Delegado

El orquestador usa subagentes en modo single, parallel o chain.

Ejemplo:

- analyst inspecciona.
- architect propone plan.
- implementer aplica cambios.
- reviewer revisa.

### SDD/TDD

El orquestador sigue un flujo más estricto:

1. Descubrir contexto.
2. Crear especificación.
3. Crear diseño técnico.
4. Definir criterios de aceptación.
5. Escribir tests primero.
6. Implementar.
7. Ejecutar tests.
8. Revisar.
9. Guardar decisiones en memoria.

## 5. Estructura de archivos propuesta

```txt
.pi/
  extensions/
    orchestrator/
      index.ts
      memory-tools.ts
      subagent-tool.ts
      classifier.ts
      prompts.ts
  agents/
    analyst.md
    architect.md
    implementer.md
    tester.md
    reviewer.md
    memory.md
  skills/
    sdd-tdd/
      SKILL.md
    code-review/
      SKILL.md
  prompts/
    inline.md
    delegate.md
    sdd.md
    review.md
  settings.json
```

## 6. Decisión recomendada para el MVP

Para el MVP, no deberíamos construir todo el sistema multiagente desde cero. La opción más eficiente es:

1. Crear primero la extensión Pi `memory` en TypeScript.
2. Implementar SQLite local, migraciones y custom tools de memoria.
3. Crear agentes markdown básicos.
4. Adaptar el patrón del ejemplo `subagent` para delegación.
5. Crear un orquestador simple por prompt/system instructions.
6. Luego convertir reglas repetidas en código TypeScript dentro de la extensión.

## 7. Riesgos técnicos

- Subagentes como procesos separados consumen más tokens y coste.
- El paso de contexto entre agente padre e hijos debe limitarse.
- El orquestador puede sobreactuar si no tiene reglas claras.
- Los agentes de proyecto `.pi/agents` son repo-controlled y deben considerarse no confiables por defecto.
- Hay que evitar guardar secretos en memoria.
- Si cada agente puede editar código, se deben evitar conflictos de cambios.

## 8. Preguntas pendientes

- ¿Los agentes vivirán globalmente o por proyecto?
- ¿Queremos permitir agentes definidos por cada repo?
- ¿Qué agentes pueden modificar archivos?
- ¿Qué agentes serán solo lectura?
- ¿El orquestador será una extensión TypeScript o una combinación de system prompt + tool subagent?
- ¿La memoria debe ser consultada automáticamente en cada input o solo en tareas medianas/grandes?
- ¿El flujo SDD/TDD escribirá documentos en `.pi/specs/`, `docs/specs/` o ambos?
