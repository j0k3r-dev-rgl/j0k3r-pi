# Audio manual con Gemini TTS para Pi

Cada respuesta final del **orquestador interactivo** ofrece **Generar y escuchar** para empezar a reproducir mientras Google genera el audio en streaming. No hay generación ni reproducción automática al terminar la respuesta.

## Uso rápido

1. Ejecuta `/reload` después de actualizar la extensión.
2. Con TTS activado (`/tts on`), termina una respuesta nueva.
3. Pulsa **Generar y escuchar** bajo la respuesta. Solo entonces se envía el texto limpio a Google Vertex AI y se consumen los créditos correspondientes; la reproducción comienza progresivamente.
4. Durante la reproducción aparecen **Pausar** y **Detener**; en pausa, **Continuar** y **Detener**. El audio completado se conserva para repetirlo sin otra síntesis.

En streaming, **Pausar** suspende el reproductor, no garantiza pausar la generación ni la facturación de Google; la presión de la tubería puede ralentizar la recepción. **Detener** cancela la operación de red y descarta el audio si aún no se completó; una petición enviada puede haber consumido créditos. Un nuevo prompt, desactivar TTS o cerrar la extensión también la cancelan.

**Pausar / Continuar** conserva la posición del reproductor. **Detener** vuelve al estado **Reproducir**: la siguiente reproducción empieza desde el principio, sin generar de nuevo.

El clic requiere el modo de pantalla completa de Pi. En el modo normal de terminal, o sin ratón, usa el comando numerado que aparece junto al control: `/tts stream 1`.

## Comandos

| Comando | Acción |
|---|---|
| `/tts` | Estado, modelo, voz, estilo y ayuda. |
| `/tts on` | Activa los controles manuales para nuevas respuestas finales. |
| `/tts off` | Oculta/deshabilita los controles y detiene la reproducción. |
| `/tts stream <n>` | Genera y reproduce progresivamente el audio de la respuesta indicada. |
| `/tts play <n>` | Reproduce el audio generado; si está pausado, continúa. |
| `/tts pause [n]` | Pausa la reproducción sin perder la posición. |
| `/tts resume [n]` | Continúa la reproducción pausada. |
| `/tts stop [n]` | Detiene el audio; la próxima reproducción empieza desde el inicio. |

En `pause`, `resume` y `stop`, el número es opcional: sin él se controla el audio activo; con él solo se actúa si esa respuesta es la activa.

| Ajuste | Acción |
|---|---|
| `/tts model [flash\|lite]` | Consulta el modelo activo o selecciona Flash / Flash-Lite para nuevas generaciones. |
| `/tts speed [multiplicador]` | Consulta o cambia la velocidad entre 0.5x y 3x. |
| `/tts voice [nombre]` | Consulta o cambia la voz: Kore, Fenrir, Puck, Charon o Aoede. |
| `/tts style [estilo]` | Consulta o cambia la entonación. |

`/tts model flash` selecciona `gemini-3.8-flash-tts`; `/tts model lite` selecciona `gemini-3.8-flash-lite-tts` (predeterminado). Cambiar de modelo no genera audio, no activa TTS si está apagado y no elimina los audios existentes. El cambio dura hasta recargar o cerrar la extensión. Para comparar, selecciona el modelo antes de generar el audio de otra respuesta.

`/tts speak` no sintetiza ni reproduce frases: muestra una indicación para usar el control de streaming.

## Alcance y límites

- Solo funciona en la TUI del orquestador. No genera audio ni controles en subagentes SDK, RPC, JSON o modo print. No expone herramientas al modelo ni añade los controles a su contexto.
- Espera a que el agente quede asentado (`agent_settled`), sin continuaciones automáticas. Ignora mensajes de herramientas, respuestas abortadas, errores y texto vacío después de la limpieza.
- La activación conserva su valor inicial existente (`enabled: true`). `/tts off` impide nuevas síntesis y reproducciones; `/tts on` no genera nada por sí solo. Los cambios de los comandos solo duran durante la sesión de la extensión.
- Conserva la limpieza Markdown/código y el límite existente de 3000 caracteres. No resume la respuesta con otro modelo.
- El audio se mantiene en memoria por mensaje. Un nuevo prompt detiene la reproducción, sin eliminar el audio ya generado. Al cerrar o recargar la extensión se libera; los controles guardados en la sesión vuelven a ofrecer **Generar y escuchar** al reabrirla.
- Los controles siguen la rama activa de la conversación. Los ajustes de modelo/voz/estilo se aplican a las siguientes generaciones; la velocidad se aplica al reproducir.
- Desactivar o cerrar la extensión descarta resultados de síntesis pendientes. Una petición ya enviada puede haber consumido créditos.

## Credenciales de Gemini TTS: archivo obligatorio y protegido

Para generar audio con Gemini TTS necesitas un **archivo JSON de credenciales de una cuenta de servicio de Google Cloud** con acceso al proyecto y permisos para utilizar los modelos de Vertex AI. No basta con instalar la extensión o ejecutar `/tts on`: ese comando habilita los controles, pero la generación requiere credenciales válidas y el servicio disponible en el proyecto.

La ruta y el nombre reales se configuran de forma privada, en un archivo **`.env` dentro de `extensions/google-tts/`**, en el equipo **donde corre Pi**. No se incluyen en el código ni en la documentación pública.

Desde el directorio de la extensión:

```bash
cp .env.example .env
chmod 600 .env
```

Edita `.env` y sustituye el ejemplo por la ruta absoluta de tu JSON privado:

```dotenv
GOOGLE_TTS_CREDENTIALS_PATH="/absolute/private/path/service-account.json"
```

La ruta anterior es ficticia. Utiliza la ubicación real solo en tu `.env` local: no cambies `.env.example` para incluirla. Se admiten espacios con comillas; no se expanden `~`, `$HOME` u otras variables. También puedes proporcionar `GOOGLE_TTS_CREDENTIALS_PATH` en el entorno del proceso de Pi; tiene prioridad sobre `.env`.

La extensión lee únicamente su propio `.env`, no el de los proyectos desde los que se usa Pi, y no modifica el entorno global. Tanto `.env` como sus variantes están ignorados por Git; `.env.example` sí se publica. La ruta se resuelve al solicitar una síntesis. Si cambias la cuenta o el proyecto, ejecuta `/reload` para descartar el token de autenticación almacenado en memoria.

La extensión acepta un JSON con `client_email`, `private_key` y `project_id`, o esos datos dentro de un objeto `service_account`. Debes proporcionar el proyecto: no hay un identificador personal de respaldo. Esta implementación no utiliza automáticamente una API key ni las credenciales de `gcloud`.

**Este archivo contiene una clave privada: trátalo como una contraseña.**

- Guárdalo fuera del repositorio y de carpetas compartidas o públicas. Nunca lo añadas a Git, al README, a capturas, registros o mensajes.
- Restringe su lectura al usuario que ejecuta Pi: permisos `600` para el archivo y, cuando la carpeta sea exclusiva de credenciales, `700` para la carpeta. Evita dar acceso a otros usuarios.
- No copies las credenciales al PC receptor de audio ni al celular si Pi corre en el servidor: esos dispositivos solo necesitan el túnel de audio.
- No incluyas un JSON real en el repositorio al distribuir la extensión. Cada instalación debe aprovisionar sus credenciales de forma segura y con los permisos mínimos necesarios.
- Si una clave se publica o se filtra, revócala y reemplázala en Google Cloud; borrar el archivo del último commit no elimina la exposición ni el historial.

La extensión lee el archivo al solicitar una síntesis, no al activar los controles. Si falta `.env` y tampoco se ha proporcionado la variable de entorno, o el JSON no es válido, la generación falla sin mostrar la ruta privada. Instalar o actualizar la extensión no crea ni distribuye tus credenciales. Protege también `.env` con permisos `600`, ya que contiene su ubicación privada.

## Proveedor y reproducción

El proveedor es Google Cloud Vertex AI, con `gemini-3.8-flash-lite-tts` como modelo inicial, ubicación `global`, voz inicial `Kore` y velocidad inicial 1.18x. Las credenciales locales existentes se leen únicamente al solicitar una síntesis; esta modificación no cambia ni copia credenciales ni añade configuración de proyecto.

La reproducción usa `ffplay`, que debe estar disponible y tener acceso a una salida de audio. La pausa usa las señales `SIGSTOP`/`SIGCONT` de Linux/macOS sobre el mismo proceso, sin reiniciar el audio; no está disponible en Windows nativo. Puede oírse una pequeña cola ya almacenada en los búferes de audio, especialmente por SSH. En SSH depende de la configuración de audio del entorno; la extensión no crea túneles ni sockets. `/tts stop`, un nuevo prompt y el cierre de sesión detienen el proceso aunque esté pausado.

La extensión usa módulos nativos de Node y los tipos del host Pi, sin dependencias de otras extensiones. El renderizado propio es necesario porque Pi no ofrece un botón reactivo nativo dentro de entradas del historial; no sustituye el editor ni captura sus atajos.

## Audio remoto: PC Linux → SSH / Herdr → servidor

Esta es la configuración TCP que se probó y funcionó. El **servidor ejecuta Pi y `ffplay`**; el **PC reproduce el sonido** mediante PulseAudio o la compatibilidad PulseAudio de PipeWire. Herdr y SSH transportan la conexión, no reproducen el audio por sí solos.

```text
Servidor: Pi / ffplay
    PULSE_SERVER=tcp:127.0.0.1:14713
              ↓ reenvío remoto SSH
PC: 127.0.0.1:4713 → PulseAudio / PipeWire → auriculares o altavoces
```

### 1. Preparar cada PC receptor

En una terminal del **PC, fuera de SSH y de los paneles remotos**, comprueba el servidor de audio:

```bash
LC_ALL=C pactl info
```

Debe conectar con PulseAudio; `PulseAudio (on PipeWire ...)` también es válido. Si `pactl` no existe, instala las herramientas de cliente de PulseAudio apropiadas para tu distribución. No necesitas sustituir PipeWire por PulseAudio.

Habilita el receptor TCP únicamente en la interfaz local del PC:

```bash
pactl load-module module-native-protocol-tcp \
  listen=127.0.0.1 \
  port=4713 \
  auth-ip-acl=127.0.0.1
```

El comando devuelve el identificador del módulo cargado. Para comprobarlo:

```bash
pactl list short modules | grep native-protocol-tcp
ss -ltn | grep ':4713'
```

**Seguridad:** mantén `listen=127.0.0.1`; no lo cambies por `0.0.0.0` ni abras el puerto en el router o firewall. La regla permite a los procesos locales acceder al audio, incluido el cliente SSH que termina el túnel.

**Duración:** esta carga es temporal y se pierde al reiniciar el servidor de audio o el PC. Comprueba si el módulo ya está cargado antes de repetirla. La configuración persistente depende de si el PC usa PulseAudio o PipeWire; no se configuró ni validó una receta de persistencia durante esta instalación.

### 2. Configurar el túnel en cada PC

En `~/.ssh/config` del **PC**, añade el reenvío al bloque del servidor, conservando sus demás opciones. Este es el ejemplo utilizado; adapta usuario e IP a tu instalación:

```sshconfig
Host 192.168.0.100
    User j0k3r
    RemoteForward 127.0.0.1:14713 127.0.0.1:4713
```

- La primera dirección es el puerto que escucha en el **servidor**.
- La segunda es el receptor de audio en el **PC que inicia SSH**.
- Sustituye el antiguo reenvío de `/run/user/1000/pulse/native` si lo tenías: esta receta usa TCP, no el socket Unix.
- `StreamLocalBindUnlink` solo afecta a sockets Unix; no es necesario para este reenvío TCP.

Comprueba la configuración efectiva desde el PC:

```bash
ssh -G j0k3r@192.168.0.100 | grep -E '^(remoteforward|streamlocalbindunlink) '
```

Conecta como siempre:

```bash
herdr --remote j0k3r@192.168.0.100
```

Herdr utiliza la configuración SSH del PC. Si acabas de editarla, desconecta y reconecta **el cliente Herdr** para establecer el túnel nuevo. No ejecutes `herdr server stop`: detendría el servidor y sus paneles. Si aparece un aviso de reenvío fallido, resuélvelo antes de probar TTS.

### 3. Seleccionar la salida donde corre Pi

En el **servidor**, el proceso de Pi / `ffplay` debe heredar:

```zsh
export PULSE_SERVER=tcp:127.0.0.1:14713
export SDL_AUDIODRIVER=pulseaudio
```

En la instalación utilizada, esas dos líneas están en `~/.zshrc` del servidor, dentro del bloque que inicia Herdr automáticamente en sesiones SSH de login, **antes** de ejecutar `"$HOME/.local/bin/herdr"`. Conserva las condiciones de ese bloque: no hace falta añadir otro autoarranque de Herdr.

Para una instalación nueva, configura esas variables en el entorno desde el que se crean Herdr y sus paneles, antes de iniciar Pi. Como prueba puntual, también puedes iniciar un Pi con:

```bash
env PULSE_SERVER=tcp:127.0.0.1:14713 SDL_AUDIODRIVER=pulseaudio pi
```

**Procesos persistentes:** cambiar `.zshrc`, reconectar el cliente o ejecutar `/reload` no actualiza las variables de un Pi o panel ya abierto. La reconexión sí puede recuperar el túnel sin reiniciar Pi **si Pi ya tenía el destino correcto**. No reinicies el servidor Herdr para aplicar ajustes sin tener en cuenta que terminarías sus paneles.

En el servidor puedes comprobar destino y puerto, sin generar audio:

```bash
printf 'PULSE_SERVER=%s\n' "$PULSE_SERVER"
ss -ltn | grep ':14713'
```

Que el puerto escuche no demuestra que PulseAudio acepte la conexión ni identifica qué dispositivo recibe el sonido. La comprobación final es generar un audio corto y reproducirlo en Pi; esta generación sí utiliza el proveedor y sus créditos.

### Otros PC, celular y Termius

Repite los pasos 1 y 2 en cada PC Linux desde el que quieras recibir audio. **Un puerto remoto no puede pertenecer a dos túneles simultáneos**: si el PC anterior sigue conectado, otro dispositivo puede fallar al intentar reservar `14713` o el audio puede seguir llegando al PC anterior.

En Termius, la equivalencia es un **Remote port forwarding**: origen remoto `127.0.0.1:14713` y destino hacia el receptor PulseAudio del celular. Usa la dirección y el puerto del receptor que tengas configurado allí; Termius por sí solo no es ese receptor. La aplicación receptora y su instalación en el celular no se documentaron ni validaron en esta configuración.

La salida sigue al **túnel**, no a la pantalla desde la que te conectas. Para usar el mismo `14713` desde otro dispositivo, el túnel anterior debe liberar ese puerto. Si necesitas ambos túneles a la vez, requieren puertos remotos distintos y el reproductor debe apuntar al elegido; la extensión no incluye selección automática de dispositivo ni un comando `/tts output`.

### Diagnóstico rápido

| Síntoma | Qué comprobar |
|---|---|
| `Could not connect to PulseAudio` | Receptor del PC activo, túnel SSH operativo y `PULSE_SERVER` del proceso de Pi apuntando al mismo puerto. |
| `remote port forwarding failed` | Puerto remoto ocupado por otra conexión, reglas SSH o reenvío no permitido. |
| El sonido sale en otro dispositivo | Qué cliente mantiene el túnel de `14713`; abrir Herdr desde el celular no redirige un túnel del PC. |
| Cambiar `.zshrc` no afecta a Pi | El proceso persistente conserva el entorno con el que arrancó; `/reload` no lo sustituye. |
| Funciona hasta reiniciar el PC | La carga con `pactl load-module` era temporal; verifica y vuelve a habilitar el receptor local. |

## Pruebas locales

Desde `extensions/google-tts/`, con Node 24:

```bash
node --test test/*.test.ts
```

Las pruebas sustituyen la síntesis y usan reproductores simulados o procesos Node aislados para comprobar tuberías, señales y cierre seguro: no leen credenciales, no llaman a Google y no emiten sonido. La comprobación visual y el audio real se prueban manualmente en Pi después de `/reload`.
