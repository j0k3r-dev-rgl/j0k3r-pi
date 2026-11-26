# pihud — extensión de Pi

Controla el HUD de j0k3r (`j0k3r-pi-hud`) desde Pi, sin compilar herdr.

## Comandos

| Comando | Efecto |
| --- | --- |
| `/hud open` | Divide el panel de Pi a la derecha (~20 %) sin robar foco y arranca el HUD. Idempotente. |
| `/hud close` | Cierra solo el panel del HUD y recuerda que quedó cerrado. |

Al iniciar con `j0k3r-pi` dentro de herdr el HUD se abre solo
(`PIHUD_AUTO=1`), incluso si quedó cerrado en una ejecución anterior.
Con `pi` normal no se abre automáticamente; `/hud open` sigue disponible.
Al salir de Pi
(`quit`) el HUD se cierra; en `/reload`, `/new` y `/resume` se mantiene.

## Foco

Al abrir el HUD, la extensión usa `--no-focus` para que el foco inicial
permanezca en Pi, y ya no escucha `pane.focused` ni emite `pane.focus`. Al
hacer clic o usar la rueda sobre el HUD se acepta el foco nativo de herdr, sin
ningún retorno automático por ratón ni por inactividad.

Si el HUD tiene el foco y recibe entrada de teclado (cualquier tecla que no sea
un evento de ratón), el binario Go del HUD reenvía los bytes de forma literal a
Pi mediante `pane.send_text` seguido de `pane.focus` en orden estricto FIFO
sobre `HERDR_SOCKET_PATH`. La entrada de teclado nunca cierra el HUD (`/hud
close` o salir de Pi siguen siendo el único cierre de ciclo de vida). Este
reenvío requiere un panel objetivo de Pi y un socket de herdr válidos (`--pane`
y `HERDR_SOCKET_PATH`).

## Estado

Un archivo por panel de Pi en `~/.cache/j0k3r-pihud/<sha256>.json`:

```json
{"piPane":"w1:p1","hudPane":"w1:p2","terminalId":"term_…","visible":true}
```

El archivo `<sha256>.live.json` publica la sesión activa, cwd, modelo,
esfuerzo, contexto, paneles opcionales y último evento de Pi. Se actualiza desde
`session_start`, cambios de modelo/esfuerzo y eventos del agente, herramientas y
diálogos, pero de forma deduplicada: antes de escribir compara de manera
determinista el estado significativo (excluyendo `seq` y `at`) y omite
completamente la escritura si nada ha cambiado, evitando reescrituras y churn
en reposo. El estado de deduplicación se reinicia en `session_start` y
`session_shutdown` para que cada nueva sesión o recarga publique siempre su
snapshot inicial.
El HUD usa esa vinculación antes que la detección de herdr. Contexto, límite
efectivo y porcentaje salen de `ctx.getContextUsage()`; los tokens in/out,
caché y coste se suman desde los asistentes de la rama activa, igual que el
pie de Pi. El JSONL queda como respaldo si faltan esos datos. Tras compactar,
el contexto desconocido se muestra como `?`, no como un valor anterior.

Opcionalmente escucha `j0k3r-theme:token-speed` en `pi.events`: el tema publica
el texto TPS que ya muestra su footer. El HUD extrae solo el número `tok/s`,
lo muestra como `tps Pi` y elimina la suscripción al cerrar el runtime. No
importa módulos ni dependencias de otras extensiones. Sin esa emisión muestra
`tps resp`: tokens de salida / duración total de respuesta, una métrica distinta.
Las publicaciones durante streaming se agrupan cada 100 ms, conservando una
actualización final aunque no lleguen más eventos. Al cerrar el runtime se
cancela el temporizador y se vacía esa publicación pendiente. En Linux, el HUD
escucha cambios del archivo y agrupa su lectura cada 100 ms, sin esperar al
refresco periódico de subagentes. La latencia habitual combinada ronda
100–200 ms más procesamiento y render; fuera de Linux o sin escucha se mantiene
el refresco periódico de respaldo. El consumo exacto depende de cuándo lo
informe Pi/proveedor; no se inventan tokens por cada fragmento de texto.
El transporte conserva el último evento (etiqueta hasta 60 caracteres y detalle
hasta 160, sin controles de terminal), pero main no muestra actividad ni archivos de Git.

### Paneles opcionales, solo para el usuario

`src/panels.ts` consulta los canales `pihud:main:read:v1`, `pihud:quota:read:v1`,
`pihud:mem:read:v1`, `pihud:sup:read:v1` y `pihud:todo:read:v1` cada 700 ms desde la sesión TUI
confiable para propagar actualizaciones en segundo plano (como cachés de cuota/E5
o cambios de TODO) incluso con Pi en reposo; gracias a la deduplicación, solo
reescribe `.live.json` cuando cambia algún dato real del estado o de los paneles,
con cero escrituras en reposo cuando no hay cambios. Incluye cwd e ID de sesión;
sin extensión proveedora muestra un aviso.
No hay imports entre extensiones ni resultados enviados al modelo. Los datos se
incluyen en el archivo privado `.live.json` para la TUI y se excluyen de la salida
`--once --json` del binario. No compartas la caché: puede contener cuentas y memorias.

Quota usa la caché de `/usage`, precargada al iniciar la sesión y renovada cada
30 segundos sin solapar peticiones. Transporta cuentas estructuradas con IDs estables:
una fila por cuenta prioriza 5 h (mínimo explícito si hay varios pools); clic abre
su detalle y cierra el anterior. Barras cortas y tiempo `HH:mm` / `NdHHh`, sin texto de reset.
DeepSeek muestra saldo sin reset; DeepRelay agrupa tokens consumidos/límite por
mes/semana, con reloj solo cuando la API da una fecha. Las familias Gemini/Claude/GPT
se separan de las ventanas para no mezclar medidores. Los valores nunca se truncan:
si no caben, barra y reloj pasan a otra fila. No se repiten plan, notas ni proveedor.
Main reutiliza directorio/repo/rama y la cuota exacta del modelo activo del tema.
`pihud:presence:v1` y su consulta `pihud:presence:read:v1` sincronizan el footer:
se oculta con el HUD abierto sin detener TPS y se restaura al cerrar. La presencia
se comprueba cada 2 s contra los paneles reales, conservándose si falla el transporte.
Mem lee solo IDs y títulos de memorias activas de su proyecto (sin cuerpos ni tipos), sin
crear/activar almacenamiento; su cabecera fija resume indexación y salud de E5
(consulta asíncrona cada 30 s). Sup reutiliza estado/configuración originales,
sin permitir escrituras. Los temporizadores se cancelan al cerrar el runtime.
La rueda desplaza el contenido de las cinco pestañas; marca, pestañas y resumen
de mem permanecen fijos. Sup separa `orquestador`/`subagentes`, con scroll independiente.
Los títulos de todas las tarjetas van en el borde superior. Main muestra el proyecto
publicado por Memory y una tarjeta condicional solo para subagentes `running` de la
sesión actual. TODO muestra únicamente título, progreso y pasos del todo activo de
la rama actual, nunca su cuerpo. Sin todo/proveedor no aparece tarjeta. Clic en las
tarjetas TODO y Subagentes de Main alterna detalle; flecha indica su estado, con
plegado independiente. TODO conserva título/progreso al plegarse. La presencia
oculta el widget `agent-todo` de Pi mientras el HUD está abierto y lo restaura al
cerrar (también al cerrar externamente), conservando su plegado original. Sin HUD
el widget y `ctrl+space` funcionan normalmente; con HUD el atajo no cambia ese estado.
El puente valida modo TUI, confianza, cwd y sesión, y acepta solo respuestas síncronas.
Subs omite estados duplicados y conserva el motivo de los fallos.

Ambos archivos se escriben de forma atómica y con permisos `0600`. `visible: false` evita que
el HUD reaparezca solo tras un `/reload` o un cambio de sesión. Al iniciar
un nuevo proceso iniciado con `j0k3r-pi` vuelve a abrirse (`PIHUD_AUTO=1`). Antes de
cerrar, la extensión verifica que el panel siga siendo el suyo (mismo
`terminal_id`); nunca cierra el panel de Pi. En cualquier cierre del runtime
se detiene el monitor de presencia y se esperan las escrituras pendientes; solo
`quit` cierra también el HUD.

Los comandos automáticos llevan un espacio inicial para respetar
`HIST_IGNORE_SPACE` de zsh o `HISTCONTROL=ignorespace` / `ignoreboth` de bash.
No se alteran ajustes ni se eliminan entradas anteriores del historial.

## Variables

| Variable | Uso |
| --- | --- |
| `HERDR_ENV`, `HERDR_PANE_ID`, `HERDR_SOCKET_PATH` | Los inyecta herdr. Sin ellos la extensión no hace nada. |
| `PIHUD_AUTO` | Solo `1` activa la apertura automática. Lo define `j0k3r-pi`; sin la variable, Pi no abre el HUD solo. |
| `PIHUD_BIN` | Binario del HUD. Por defecto `~/.local/bin/j0k3r-pi-hud`. |
| `PIHUD_RATIO` | Proporción del panel de Pi. Por defecto `0.80`. |

## Archivos

```text
index.ts              registro de /hud, monitor de presencia y eventos de sesión
src/controller.ts     abrir/cerrar, estado y verificación del panel
src/herdr.ts          socket: líneas JSON y envío puntual
src/events.ts         eventos de Pi y publicación deduplicada del snapshot activo
src/live.ts           escritura atómica y clave determinista del último evento
src/metrics.ts        métricas de rama activa y lectura del TPS opcional
src/panels.ts         puentes opcionales de solo lectura para main/quota/mem/sup/todo
controller.test.ts    ciclo de vida y protección del panel de Pi
index.test.ts         presencia, ciclo de vida y ausencia de guardia de foco
live.test.ts          publicación de estado, deduplicación en reposo y reemplazo de sesión
```

## Validar

```sh
node --test extension/*.test.ts
```
