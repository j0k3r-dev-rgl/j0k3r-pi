# Pi Subagents Extension (`pi-subagents-j0k3r`)

Extensión de Pi para delegar tareas a subagentes definidos en Markdown con sesiones anidadas independientes, ejecución en segundo plano y **asignación dinámica de modelos mediante el pool de CPAMC**.

---

## Cómo Trabaja Realmente el Sistema

### 1. Asignación Dinámica de Modelos (CPAMC Pool + Fallback)
El modelo y el esfuerzo de razonamiento **no se configuran manualmente en el Markdown ni en perfiles fijos**:
* **En cada lanzamiento nuevo (`subagent_run`):** `SubagentManager` emite el hook `subagents:task:allocate`. El pool de CPAMC (`extensions/cpamc-subagent-pool`) reclama la tarea y le asigna dinámicamente el mejor modelo disponible (ej. Gemini 3.8 Flash High).
* **En cada continuación (`subagent_continue`):** Al continuar una tarea previa, se incrementa el intento (`attempt`) y **se vuelve a disparar `subagents:task:allocate`**. Esto garantiza que la continuación no se quede trabada en un modelo sin cuota, reasignando un modelo fresco del pool automáticamente.
* **Fallback al orquestador:** Si CPAMC no está disponible, no tiene cuota o da error, el subagente utiliza automáticamente el modelo y nivel de thinking activos en la sesión del orquestador (`ctx.model` y `ctx.thinkingLevel`).

### 2. Continuación de Subagentes (`subagent_continue`)
Permite reanudar una tarea terminal (completada, fallida o cancelada) en su **misma sesión de Pi anidada (`.jsonl`)**:
* **Activación:** Se habilita configurando `"enable_continue": true` en `subagents.json` (global o por proyecto) y recargando con `/reload`.
* **Preservación de contexto:** El subagente conserva toda su conversación y herramientas previas, recibiendo las nuevas instrucciones sin tener que reiniciar de cero.
* **Parámetros:**
  ```json
  {
    "task_id": "subtask_analyst_...",
    "prompt": "Instrucciones adicionales para continuar la tarea",
    "mode": "background" // opcional: "task" o "background"
  }
  ```

### 3. Modos de Ejecución
* **`background` (por defecto en la configuración global):**
  - Devuelve el `task_id` inmediatamente al orquestador y libera el chat.
  - Al finalizar o fallar, Pi notifica automáticamente a la sesión principal con el resultado. No hace falta hacer polling para esperar.
* **`task` (primer plano):**
  - Espera sincrónicamente mostrando el progreso en vivo en el dock.
  - Puede enviarse a segundo plano en caliente con `ctrl+h`.
  - Doble Escape cancela la tarea en ejecución.

### 4. Control en Vivo (`subagent_send_message`)
Permite al orquestador padre inyectar mensajes de dirección en caliente a un subagente en segundo plano que esté corriendo, utilizando el puente de steering del runtime de Pi:
```json
{
  "task_id": "subtask_reviewer_...",
  "message": "Ten en cuenta también el archivo auth.ts en tu análisis"
}
```

---

## Herramientas Expuestas al Orquestador

| Herramienta | Propósito |
|---|---|
| `subagent_run` | Lanza una tarea asignada a un subagente (`agent`, `task`, `context`, `mode`). |
| `subagent_continue` | *(Con `enable_continue: true`)* Reanuda una tarea previa en su misma sesión anidada. |
| `subagent_status` | Consulta el estado y actividad actual de una tarea delegada. |
| `subagent_result` | Lee el resultado almacenado de una tarea terminada. |
| `subagent_list_agents` | Lista los subagentes disponibles cargados desde Markdown. |
| `subagent_list_tasks` | Lista las tareas delegadas activas e históricas del proyecto actual. |
| `subagent_cancel` | Cancela una tarea de subagente que esté encolada o ejecutándose. |
| `subagent_send_message` | Envía una directriz en vivo a un subagente activo en background. |

*(Nota: Los subagentes tienen prohibido llamarse entre sí; las herramientas `subagent_*` están bloqueadas dentro de sus sesiones anidadas).*

---

## Definición de Subagentes (`subagents/*.md`)

Los subagentes son archivos Markdown ubicados en:
1. Globales: `~/.pi/agent/subagents/*.md`
2. Por proyecto: `<proyecto>/.pi/subagents/*.md`

### Formato

```markdown
---
name: discovery
description: Investiga código, documentación y dependencias de forma aislada
tools:
  - read
  - bash
  - context7_search_library
subagent_mode: background
---

# Discovery Subagent

Eres un investigador acotado. Lee el código asignado...
```

* **`tools`:** Lista permitida de herramientas (soporta comodines como `tool_*`).
* **`subagent_mode`:** Modo preferido para este agente (`task` o `background`).
* **Aislamiento `lean`:** Las sesiones anidadas corren en modo lean (cargan herramientas de extensiones pero no inyectan prompts globales ni sobrecargan el contexto).

---

## Configuración (`subagents.json`)

Se configura de forma global en `~/.pi/agent/subagents.json` o por proyecto en `.pi/subagents.json`:

```json
{
  "default_mode": "background",
  "enable_continue": true,
  "timeout_ms": 3600000,
  "stall_timeout_ms": 300000,
  "max_concurrency": 5,
  "debug": false,
  "session_resources": "lean",
  "background_handoff_shortcut": "ctrl+h",
  "history_panel_shortcut": "ctrl+,",
  "detail_cancel_shortcut": "x"
}
```

### Campos Clave

| Campo | Valor por defecto | Descripción |
|---|---|---|
| `default_mode` | `"task"` | Modo de ejecución por defecto si la llamada o el agente no especifican uno (`"task"` o `"background"`). |
| `enable_continue` | `false` | Habilita el registro de la tool `subagent_continue` y la reanudación de sesiones previas. |
| `timeout_ms` | `1200000` (20m) | Límite máximo de ejecución por tarea de subagente. |
| `stall_timeout_ms` | `240000` (4m) | Tiempo de inactividad antes de considerar estancada la sesión. |
| `max_concurrency` | `5` | Tareas simultáneas máximas permitidas por proyecto. |
| `session_resources` | `"lean"` | Aislamiento de recursos de Pi (omite skills/temas globales para mantener ligero el contexto). |

---

## Integración con `orchestrator-supervisor`

El supervisor del orquestador (`orchestrator-supervisor`) vigila activamente las herramientas de subagentes:
* **Invariante de espera:** El supervisor detecta cualquier worker activo en segundo plano y **bloquea rotaciones de sesión o recargas** hasta que todos los subagentes hayan finalizado y entregado sus resultados.
* Al continuar un subagente con `subagent_continue`, el supervisor vuelve a registrar la tarea como activa en su valla de seguridad.

---

## Atajos de Teclado en el TUI

* `/subagents` o `ctrl+,` — Abre el panel interactivo con el historial y detalle de subagentes.
* `x` — Cancela la tarea seleccionada en el panel de historial.
* `ctrl+h` — Pasa la tarea activa en primer plano al segundo plano.
* `ctrl+o` — Expande/colapsa las salidas de herramientas y respuestas del subagente.
* `ctrl+t` — Muestra/oculta los bloques de pensamiento (thinking) del modelo.
