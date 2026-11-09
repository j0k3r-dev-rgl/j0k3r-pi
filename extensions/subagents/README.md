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
- **`background`:** devuelve inmediatamente `task_id` y libera el chat. El acuse incluye intento, modelo/esfuerzo conocidos y sesión ejecutora cuando ya existe; los valores pendientes se muestran como `unresolved`, no como una selección confirmada. Al finalizar, fallar o cancelarse, la sesión principal recibe una notificación automática con el resultado completo. No hay que dormir ni sondear para esperar.

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
- Si falla el primer intento y la continuación está habilitada y es segura, el mensaje indica al orquestador reintentar una sola vez con `action: "continue"` y el mismo `task_id`, sin preguntar. Si falla el segundo intento o uno posterior, debe detenerse e informar al usuario; otro reintento requiere aprobación explícita. No debe iniciar otra tarea para reiniciar este límite. Es una instrucción al orquestador, no un bucle automático del runner.
- Las tareas canceladas, interrumpidas o en proceso de detenerse no se reanudan automáticamente. Modelo y esfuerzo se resuelven de nuevo en cada intento según el asignador o el fallback al orquestador, con prioridad del esfuerzo definido en el Markdown; no se ofrecen elecciones manuales ni se admiten overrides en la llamada.

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

### Reportes informativos sin detener el trabajo

Para pedir progreso a un subagente en background, el padre usa el canal existente, sin otra tool pública:

```json
{
  "action": "message",
  "task_id": "subtask_analyst_...",
  "task": "Send a concise progress report with report_orchestrator, then continue the assigned work without waiting for a reply."
}
```

El acuse `queued` sigue indicando solo aceptación, no que el hijo ya haya leído la petición. Al consumirla, el hijo puede llamar a la tool interna `report_orchestrator({ report: "..." })`: recibe un acuse de envío y continúa en el mismo intento, sin esperar respuesta del padre. La notificación `subagent-report` llega al contexto del orquestador y a la TUI con identidad/intento, vista compacta y expansión nativa; no es un resultado final, aceptación, permiso ni una pregunta pendiente. No requiere contestar ni autoriza avanzar fases. El padre puede informar al usuario y esperar la notificación final sin sondear ni reenviar peticiones periódicamente.

El runner inyecta la tool solo cuando hay transporte al padre para una tarea iniciada en background y una identidad padre disponible; no hace falta añadirla al Markdown. No está disponible en ejecuciones iniciadas en modo `task` (incluido un traspaso posterior a background). No se cambia de modo para habilitarla. El callback queda vinculado al intento y sesión padre: al terminar/cancelarse, cambiar de sesión o reanudarse otro intento, el callback anterior ya no puede entregar reportes. No depende de `enable_continue`. Cada reporte admite hasta 16 KiB UTF-8; se rechazan vacíos/excesos sin truncar, y el transporte aplica la sanitización existente. No incluyas secretos, transcripciones ni datos privados ajenos. El acuse confirma el envío al runtime padre, no que el modelo padre lo haya leído. Un fallo de envío se informa al hijo sin crear una espera de respuesta ni terminar automáticamente su trabajo.

`report_orchestrator` es para información solicitada, no para ocultar bloqueos: si falta una decisión necesaria, se mantiene el canal `ask_orchestrator` y sus límites. Ambas tools existen solo en la sesión hija; el orquestador conserva únicamente `subagent_run` como tool pública de esta extensión.

### Preguntas del hijo al orquestador

En tareas en background, cuando existe el manejador de preguntas del padre, el manager inyecta dinámicamente `ask_orchestrator` como herramienta local del hijo: no necesita aparecer en `tools:` del Markdown. El hijo espera la respuesta en la misma sesión; el padre contesta con `subagent_run action: message`, que devuelve `answered` en vez de encolar steering. La propiedad de la sesión padre sigue siendo obligatoria y cancelar la tarea rechaza la espera pendiente.

En modo `task` no se ofrece esta herramienta: el padre está esperando el resultado. Si falta una decisión material, el hijo devuelve `BLOCKED`; no debe suponerse que añadir el nombre a la allowlist habilita el canal ni cambiar de modo sin respetar la elección del usuario. Una aclaración factual no autoriza ampliar alcance o modificar configuración.

## Historial, resultados y render

La herramienta devuelve el resultado completo al orquestador, independientemente de la expansión visual. Las notificaciones finales de background incluyen también intento, modelo/esfuerzo conocidos y la identidad de sesión anidada cuando está disponible, para poder atribuir implementación y verificación sin recuperar el transcript. El historial SQLite conserva resultados y eventos por workspace (`cwd`); la sesión anidada conserva su conversación. El preview de actividad está acotado, no el resultado final.

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

La extensión funciona independientemente de otras extensiones. Cuando existe un asignador (como `orchestrator-supervisor`), el manager emite `subagents:task:allocate` tanto para tareas nuevas como para continuaciones; cada intento vuelve a solicitar asignación. Sin asignador o ante fallo de asignación, usa el modelo y esfuerzo del orquestador. Al terminar emite `subagents:task:terminal`.

El supervisor puede seguir observando `subagent_run`, los eventos y SQLite sin depender de las tools eliminadas. El historial, widget y controles manuales usan directamente el manager. Al cerrar la sesión se drenan tareas y recursos; las tareas huérfanas se reconcilian como interrumpidas sin volver a emitir resultados de background.

Después de actualizar el código, ejecuta **`/reload` o reinicia Pi** para retirar las tools viejas de la sesión y registrar el nuevo contrato. Cambiar `enable_continue` se aplica a la siguiente llamada; cambiar atajos requiere recargar.

## Validación del paquete

Desde el directorio de esta extensión, usando sus dependencias propias:

```bash
npm run check
```

Las pruebas cubren el contrato único, continuación, steering, límites/propiedad, cancelación, persistencia, notificaciones y render/replay. La comprobación visual final en la TUI requiere recargar la extensión.
