# Pi Subagents Extension (`pi-subagents-j0k3r`)

Extensión de Pi para delegar tareas a subagentes definidos en Markdown, con sesiones anidadas independientes, historial y ejecución en primer o segundo plano. Expone **una sola herramienta: `subagent_run`**. El panel `/subagents`, el widget y los controles manuales permanecen disponibles.

## Una herramienta, tres operaciones

El campo `task` contiene las instrucciones en las tres operaciones. `action` es opcional y, si se omite, equivale a `run`; las llamadas existentes con `agent` y `task` siguen funcionando.

| `action` | Parámetros específicos | Comportamiento |
|---|---|---|
| `run` | `agent` obligatorio; `name`, `display_name`, `context`, `mode` opcionales | Inicia exactamente una tarea nueva. |
| `continue` | `task_id` obligatorio; `mode` opcional | Reanuda una tarea terminada en su misma sesión anidada. Requiere `enable_continue: true`. |
| `message` | `task_id` obligatorio | Encola instrucciones para una tarea en background activa, propiedad de esta sesión padre. No depende de `enable_continue`. |

No se infiere la operación del estado de la tarea. Un mensaje tardío se rechaza; **nunca se convierte automáticamente en una continuación**. `task_id` no se acepta en `run`; `agent`, `name`, `display_name` y `context` no se aceptan en `continue` ni `message`. `message` no acepta `mode`. Las instrucciones vacías y las combinaciones contradictorias devuelven errores explícitos.

### Iniciar una tarea

```json
{
  "agent": "analyst",
  "task": "Revisa el código y documenta los hallazgos",
  "display_name": "Revisión de seguridad"
}
```

El modo nuevo se resuelve como `input.mode ?? definition.subagent_mode ?? config.default_mode`, con fallback built-in `task`. El orquestador debe omitir `mode` salvo que el usuario pida explícitamente `task` o `background`.

- **`task`:** espera y devuelve la respuesta completa; muestra progreso en vivo. Se puede enviar a background con el atajo configurado (por defecto `ctrl+h`) o cancelar con doble Escape.
- **`background`:** devuelve inmediatamente `task_id` y libera el chat. Al finalizar, fallar o cancelarse, la sesión principal recibe una notificación automática con el resultado completo. No hay que dormir ni sondear para esperar.

Las definiciones se cargan al invocar la herramienta. Un agente desconocido produce un error que enumera los agentes actualmente disponibles, incluidas sus descripciones; no existe una herramienta separada para listarlos.

### Continuar una tarea terminada

```json
{
  "action": "continue",
  "task_id": "subtask_analyst_...",
  "task": "Continúa con la corrección aprobada"
}
```

- Conserva el ID, la sesión `.jsonl`, el contexto anterior y el nombre visible; incrementa `attempt`.
- Admite tareas `completed`, `failed`, `cancelled` e `interrupted`. Si está en `stopping`, espera la limpieza del intento anterior. Rechaza tareas `queued` o `running` y sesiones inexistentes.
- El modo se resuelve como `mode` explícito, `effective_mode` anterior, `mode` anterior, `default_mode` y finalmente `task`.
- `enable_continue` se lee de la configuración efectiva en cada llamada. Si está deshabilitado, devuelve un error explicativo sin ejecutar otro intento. La herramienta y su esquema permanecen registrados; los errores y notificaciones no recomiendan continuar cuando está deshabilitado.
- Los intentos fallidos conservan la indicación de pedir autorización antes de reanudarlos; no se admiten overrides de modelo o esfuerzo en la llamada.

### Enviar instrucciones en vivo

```json
{
  "action": "message",
  "task_id": "subtask_reviewer_...",
  "task": "Incluye también el análisis de auth.ts"
}
```

Solo la **sesión padre originaria exacta** puede enviar mensajes a su tarea en background mientras está `running`. Requiere steering soportado por Pi `>=0.82.1`. Puede aceptar mensajes antes de que el puente esté listo; el puente los procesa al inicializarse.

- `queued` confirma aceptación en la cola, **no consumo por el modelo**.
- `pending_message_count` indica mensajes pendientes; los no consumidos al terminar pasan a `undelivered_message_count`, sin reproducirse en otro intento.
- Límites: 16 mensajes pendientes, 16 KiB UTF-8 por mensaje y 64 KiB pendientes en total.
- Las negativas incluyen motivo estructurado, como `not_owner`, `not_running`, `unsupported_runtime` o `queue_count_limit`, y se marcan como error de herramienta.
- El texto de los mensajes permanece en el detalle de la tarea propietaria; los resúmenes y notificaciones no lo reproducen.

## Historial, resultados y render

La herramienta devuelve el resultado completo al orquestador, independientemente de la expansión visual. El historial SQLite conserva resultados y eventos por workspace (`cwd`); la sesión anidada conserva su conversación. El preview de actividad está acotado, no el resultado final.

El render usa tarjetas enmarcadas, sin filas duplicadas de llamada ni fondos propios: vista colapsada con identidad/estado e intento cuando es una continuación, vista expandida con respuesta o error, y progreso parcial. Los mensajes en vivo muestran su acuse, no una respuesta final de la tarea. La notificación de background conserva nombre e intento y usa el atajo real de `app.tools.expand`. El replay respeta el workspace y limpia las suscripciones al finalizar, abortar o cerrar la sesión.

El modelo no tiene tools separadas de consulta, resultados ni cancelación. El usuario conserva el historial y la cancelación en `/subagents`; los entregables persistidos pueden leerse con `read`. Tras compactar contexto, no se garantiza recuperación programática de resultados históricos arbitrarios sin un artefacto o una continuación habilitada; continuar ejecuta un nuevo intento y no equivale a leer un resultado almacenado.

## Definiciones de subagentes

Se cargan desde `agents/*.md` y `subagents/*.md` bajo el directorio global de Pi (`$PI_CODING_AGENT_DIR` o `~/.pi/agent`), y desde `.pi/agents/*.md` y `.pi/subagents/*.md` del proyecto. Las definiciones del proyecto tienen prioridad; dentro de un mismo ámbito, `subagents` tiene prioridad sobre `agents`.

```markdown
---
name: analyst
description: Revisa código y documenta hallazgos
tools:
  - read
  - bash
subagent_mode: background
---

# Analyst
Lee únicamente el alcance asignado y documenta la evidencia.
```

`tools` es una allowlist y acepta comodines sobre herramientas activas del padre. Las herramientas `subagent_*` están bloqueadas en las sesiones anidadas: los subagentes no pueden delegar entre sí. Las modificaciones Markdown se leen en la siguiente ejecución.

## Configuración

La configuración de `.pi/subagents.json` del proyecto sobrescribe los campos presentes en `$PI_CODING_AGENT_DIR/subagents.json` o `~/.pi/agent/subagents.json`. Los campos ausentes heredan el valor global y luego el default built-in. La extensión actual lee la configuración local sin una comprobación adicional de confianza; úsala solo en proyectos confiables.

| Campo | Default built-in | Propósito |
|---|---|---|
| `default_mode` | `"task"` | Modo cuando no lo especifican llamada o definición. |
| `enable_continue` | `false` | Habilita únicamente `action: "continue"`; no bloquea `message`. |
| `timeout_ms` | `1200000` | Tiempo máximo por tarea. |
| `stall_timeout_ms` | `240000` | Límite de inactividad. |
| `max_concurrency` | `5` | Ejecuciones simultáneas máximas. |
| `session_resources` | `"lean"` | Aislamiento del prompt de la sesión anidada. |
| `debug` | `false` | Logs en `.pi/subagents-debug.log` del workspace ejecutor. |
| `history_panel_shortcut` | `"ctrl+,"` | Abrir historial. |
| `detail_cancel_shortcut` | `"x"` | Cancelar la tarea seleccionada. |
| `background_handoff_shortcut` | `"ctrl+h"` | Enviar primer plano a background. |

El modo lean carga herramientas permitidas y hooks de seguridad, sin inyectar contexto o skills globales. No se necesitan credenciales adicionales para esta herramienta: se utilizan los proveedores del runtime padre. No publiques secretos en definiciones, instrucciones ni logs.

## Integraciones y ciclo de vida

La extensión funciona independientemente de otras extensiones. Cuando existe un asignador como CPAMC, el manager emite `subagents:task:allocate` tanto para tareas nuevas como para continuaciones; cada intento vuelve a solicitar asignación. Sin asignador o ante fallo de asignación, usa el modelo y esfuerzo del orquestador. Al terminar emite `subagents:task:terminal`.

El supervisor puede seguir observando `subagent_run`, los eventos y SQLite sin depender de las tools eliminadas. El historial, widget y controles manuales usan directamente el manager. Al cerrar la sesión se drenan tareas y recursos; las tareas huérfanas se reconcilian como interrumpidas sin volver a emitir resultados de background.

Después de actualizar el código, ejecuta **`/reload` o reinicia Pi** para retirar las tools viejas de la sesión y registrar el nuevo contrato. Cambiar `enable_continue` se aplica a la siguiente llamada; cambiar atajos requiere recargar.

## Validación del paquete

Desde el directorio de esta extensión, usando sus dependencias propias:

```bash
npm run check
```

Las pruebas cubren el contrato único, continuación, steering, límites/propiedad, cancelación, persistencia, notificaciones y render/replay. La comprobación visual final en la TUI requiere recargar la extensión.
