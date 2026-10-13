# Orchestrator Supervisor (`orchestrator-supervisor`)

## Visión General y Filosofía de Diseño

`orchestrator-supervisor` es una extensión en proceso (*in-process*) exclusiva para el orquestador principal de Pi. Su misión es garantizar **continuidad, resiliencia y automatización desatendida** sin intervención humana continua, gestionando cuotas de modelos, rotación de sesiones al alcanzar el límite de contexto, recuperación de errores de streaming y durabilidad de operaciones en disco.

Se administra por proyecto a través de `extensions/tools-manager` (`/extension`, `Alt+E` o `/tools-manager`), persistiendo en `<proyecto>/.pi/extensions.json`. Se inicializa automáticamente en `session_start` (`startup`, `reload`, `new`) antes de procesar el primer mensaje del usuario o del modelo. Las sesiones hijas de subagentes (`ctx.mode !== "tui"` o distinto `sessionId`) quedan estrictamente aisladas y no ejecutan esta extensión.

---

## Por qué está diseñada así (El contexto de la configuración)

Esta extensión está optimizada para la configuración específica y avanzada del entorno de Pi del usuario:

1. **Autocompactación desactivada (`compaction.enabled = false`):**
   - Pi no corta ni resume la sesión de forma imprevista a mitad de la conversación. La sesión retiene el historial completo hasta que se decida rotar.
2. **Capacidad de contexto extendida (soporte de hasta 400%):**
   - El entorno y los proxies soportan ventanas de contexto muy superiores al límite nominal del proveedor sin romperse de inmediato.
   - **Por qué NO se usa prevención especulativa:** Inicialmente se inflaban los tokens proyectados sumando presupuestos estimados por cada tool. Esto provocaba falsos positivos (frenando herramientas al 81% de contexto real) e interrupciones innecesarias. Se eliminó la inflación especulativa: **las herramientas corren libremente y el límite del 90% se evalúa de forma estricta sobre el consumo real reportado**.
3. **Automatización real (Cero preguntas al usuario):**
   - La extensión está diseñada para trabajar sin supervisión constante. **El agente nunca debe preguntar "¿Autorizas guardar resumen y rotar?"**.
   - Al asentarse el turno en $\ge 90\%$, el supervisor toma el control, guarda el resumen de memoria por código o mediante la tool, ejecuta `/supervisor-rotate` y levanta la nueva sesión limpia automáticamente.
4. **Respeto a tareas delegadas (Espera estricta a subagentes):**
   - Si el orquestador delegó una tarea pesada a un subagente en segundo plano, el supervisor **tiene prohibido rotar o recargar** la sesión hasta que el subagente termine su ciclo (`queued`, `running`, `stopping` y entregas de completitud).
5. **Memoria en texto plano / Markdown (Sin JSONs rígidos):**
   - La memoria persistente (`memory_save` con `session_summary`) es para que el orquestador guíe a la nueva sesión en lenguaje natural.
   - Se eliminaron los JSONs calculados con diffs y hashes que rompían la rotación con `SyntaxError`. El orquestador redacta un resumen estructurado y conciso de 150-250 palabras enfocado en **punteros a archivos** (ej. `plan.md`, `apply.md`) en vez de volcar transcripciones gigantescas.

---

## Capacidades Principales

### 1. Jerarquía de Modelos y Failover de Cuotas (`QuotaManager`)
- **Cadena de candidatos:**
  1. *Primario:* `cliproxyapi/main/gpt-6.1-sol` (effort: `"high"`, context cap: 272k)
  2. *Secundario:* `cliproxyapi/second/gpt-6.1-sol` (effort: `"high"`, context cap: 272k)
  3. *Terciario:* `cliproxyapi/j0k3r/gemini-3.8-flash-high` (effort: `"high"`, context cap: 370k)
- **Umbral de cuota del 95% en OpenAI Codex (Wham):**
  Consulta la API de Wham en doble ventana temporal: ventana primaria de 5h (`18000s`) y secundaria de 7 días (`604800s`). Si en cualquiera `used_percent >= 95.0`, conmuta de inmediato al siguiente modelo.
- **Seguimiento de Gemini:** Monitorea que `remainingFraction > 0.0`.
- **Retorno automático al modelo principal:** Al expirar el `reset_at` de la ventana temporal del modelo primario (`main`), el supervisor regresa automáticamente a él.
- **Agotamiento total:** Si los 3 candidatos están agotados o en cooldown, entra en estado `idle` con backoff progresivo (60s a 300s) y cero despacho de prompts.

### 2. Recuperación Automática de Errores y Cortes de Red
- **Cortes de streaming (`stream closed before response.completed`):**
  Ante desconexiones abruptas de socket o microcortes del proveedor, el supervisor no se queda congelado esperando que el usuario escriba. Aplica una pausa breve de estabilización (1s) y **despacha automáticamente `continua`**.
- **Regla de 3 intentos para errores transitorios:**
  Permite hasta 3 reintentos automáticos para errores de red o 5xx. Si persisten 3 errores consecutivos, aplica un cooldown de 15 minutos al modelo y conmuta al siguiente candidato.
- **Failover en caliente dentro de la sesión:**
  Si ocurre un fallo de cuota o de proveedor con contexto $< 90\%$, cambia el modelo directamente en la sesión actual (`pi.setModel()`) y envía `continua`, **sin abrir una sesión nueva innecesariamente**.
- **429 / Cuota agotada:** Aborta inmediatamente la espera de reintentos del harness (`ctx.abort()`) y realiza failover instantáneo.
- **Aislamiento de errores:** Errores de comandos bash, salidas de herramientas o fallos de subagentes jamás incrementan el contador de errores del proveedor.

### 3. Límite del 90% de Contexto y Rotación Limpia
- **Evaluación real sin interferencias:** Las herramientas se ejecutan sin bloqueos preventivos prematuros.
- **Bypass vital de memoria:** Las herramientas `memory_*` y `supervisor_rotate` **nunca se bloquean**, asegurando que siempre se pueda guardar el progreso.
- **Rotación desatendida:** Al asentarse el turno en $\ge 90\%$, el supervisor guarda el checkpoint, prepara la nueva sesión limpia mediante `/supervisor-rotate` (cero llamadas a LLM) y transfiere el control.

### 4. Estructura Obligatoria del Resumen de Continuidad
Para evitar ahogar el contexto de la nueva sesión con duplicaciones masivas (como ocurrió en historiales de más de 6.000 caracteres), la memoria debe estructurarse en **150-250 palabras** con estas 5 viñetas:
1. **Objetivo activo y límites del usuario:** Qué se está haciendo y dónde detenerse.
2. **Progreso exacto:** Qué se completó y qué falta exactamente.
3. **Punteros a archivos de la verdad:** Rutas de archivos a leer con `read` (ej. `plan.md`, `apply.md`) — **NUNCA copiar su contenido en la memoria**.
4. **Estado del entorno:** Puertos, servicios levantados o base de datos si aplica.
5. **Próxima acción inmediata a ejecutar.**

Al iniciar la nueva sesión, el supervisor inyecta automáticamente este resumen en el primer turno para que el nuevo modelo continúe de inmediato.

### 5. Durabilidad WAL (Write-Ahead Log) y Fsync
- Herramientas mutantes (`write`, `edit`, `bash` distinguiendo `git commit` de `git push`) se registran con estado `pending` en `tool-journal.json` y se aseguran en disco mediante `fsync` antes de invocar `tool.execute()`.
- Garantía atómica en disco: archivo temporal $\to$ `fsync` $\to$ renombre atómico $\to$ `fsync` del directorio padre.
- Recuperación ante cortes o crashes: Si un comando mutante quedó interrumpido, al reiniciar se marca como `uncertain` y bloquea nuevas mutaciones hasta que el usuario confirme (`/supervisor resume`).

### 6. Telemetría en Vivo vía ntfy
Notificaciones en tiempo real al dispositivo móvil a través del endpoint configurado en `.env` local (`PI_NTFY_URL`), sin filtrar credenciales en Git:
- **🔄 Inicio de nueva sesión (`recycle,robot`):** Avisa cuando la rotación limpia se completó y con qué modelo y memoria reanudó.
- **🔀 Cambio de modelo (`shuffle,arrows_counterclockwise`):** Avisa de failovers por cuota del 95% o errores de proveedor.
- **🚨 Errores críticos (`warning,skull`, prioridad `urgent`):** Alerta inmediata si falla el guardado de checkpoint o la verificación de sesión.

---

## Controles de Usuario y Comandos

Aunque el supervisor opera de manera autónoma, ofrece comandos manuales de control:

- `/supervisor status` — Consulta estado operativo, modelo activo, generación actual y si está pausado.
- `/supervisor pause` — Pausa manualmente las operaciones automáticas.
- `/supervisor resume` — Reanuda la supervisión y despeja mutaciones inciertas de sesiones anteriores.
- `/supervisor cancel` — Cancela la supervisión para la sesión activa.
- `/supervisor rotate` — Solicita una rotación inmediata y limpia a una sesión nueva al asentarse el turno.
- **Herramienta `supervisor_rotate`** — Herramienta a disposición del orquestador para rotar con un `memory_id` y `next_step`.
