# Audio manual con Gemini TTS para Pi

Cada respuesta final del **orquestador interactivo** ofrece **Generar y escuchar** para reproducir mientras Google genera el audio en streaming. Por defecto no hay generación automática; puedes activar **Activar lectura automática** en `/tts config` para leer cada respuesta final elegible.

## Uso rápido

1. Ejecuta `/reload` después de actualizar la extensión y abre `/tts config`.
2. Opcionalmente activa **Activar lectura automática**; está desactivada por defecto. Selecciona **Guardar y cerrar** para aplicar los cambios o `Esc` para cancelarlos.
3. Con TTS activado (`/tts on`), termina una respuesta nueva. En modo manual, pulsa **Generar y escuchar** bajo la respuesta; con lectura automática, la síntesis y reproducción comienzan al finalizar. Ambos modos envían el texto limpio a Google Vertex AI y pueden consumir créditos.
4. Durante la reproducción aparecen **Pausar** y **Detener**; en pausa, **Continuar** y **Detener**. El audio completado se conserva para repetirlo sin otra síntesis.

En streaming, **Pausar** suspende el reproductor, no garantiza pausar la generación ni la facturación de Google; la presión de la tubería puede ralentizar la recepción. **Detener** cancela la operación de red y descarta el audio si aún no se completó; una petición enviada puede haber consumido créditos. Un nuevo prompt, desactivar TTS o cerrar la extensión también la cancelan.

**Pausar / Continuar** conserva la posición del reproductor. **Detener** vuelve al estado **Reproducir**: la siguiente reproducción empieza desde el principio, sin generar de nuevo.

El clic requiere el modo de pantalla completa de Pi. En el modo normal de terminal, o sin ratón, usa el comando numerado que aparece junto al control: `/tts stream 1`.

## Comandos

| Comando | Acción |
|---|---|
| `/tts` | Estado, modelo, voz, estilo y ayuda. |
| `/tts config` | Abre el panel flotante de configuración y salidas (`/tts settings` también funciona). |
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
| `/tts voice [nombre o ID]` | Consulta o cambia la voz; escribe el nombre o ID exacto. |
| `/tts style [estilo]` | Consulta o cambia la entonación. |

`/tts model flash` selecciona `gemini-3.8-flash-tts`; `/tts model lite` selecciona `gemini-3.8-flash-lite-tts` (predeterminado). Cambiar de modelo no genera audio, no activa TTS si está apagado y no elimina los audios existentes. Para comparar, selecciona el modelo antes de generar el audio de otra respuesta.

`/tts speak` no sintetiza ni reproduce frases: muestra una indicación para usar el control de streaming.

## Alcance y límites

- Solo funciona en la TUI del orquestador. No genera audio ni controles en subagentes SDK, RPC, JSON o modo print. No expone herramientas al modelo ni añade los controles a su contexto.
- Espera a que el agente quede asentado (`agent_settled`), sin continuaciones automáticas. Ignora mensajes de herramientas, respuestas abortadas, errores y texto vacío después de la limpieza.
- La activación conserva su valor inicial existente (`enabled: true`). `/tts off` impide nuevas síntesis y reproducciones; `/tts on` no genera nada por sí solo. La lectura automática está desactivada inicialmente y solo actúa cuando TTS está activado.
- Conserva la limpieza Markdown/código y el límite inicial de 3000 caracteres, configurable desde el panel. No resume la respuesta con otro modelo.
- El audio se mantiene en memoria por mensaje. Un nuevo prompt detiene la reproducción, sin eliminar el audio ya generado. Al cerrar o recargar la extensión se libera; los controles guardados en la sesión vuelven a ofrecer **Generar y escuchar** al reabrirla.
- Los controles siguen la rama activa de la conversación. En lectura automática también permiten pausar, detener y repetir. Los ajustes de modelo/voz/estilo se aplican a las siguientes generaciones; la velocidad y la salida se aplican a la siguiente reproducción.
- Desactivar o cerrar la extensión descarta resultados de síntesis pendientes. Una petición ya enviada puede haber consumido créditos.

## Panel, persistencia y dispositivos

En `/tts config`, usa **↑/↓** y **Enter** para cambiar TTS, lectura automática, modelo, voz, estilo, velocidad, ubicación y límite de caracteres. En **Salida** puedes añadir un dispositivo con un nombre y el **puerto remoto del servidor** (1–65535); entra en él para seleccionarlo, cambiar nombre/puerto o eliminarlo. **Entorno predeterminado** no impone ninguna salida y conserva el entorno heredado de Pi. Los cambios se aplican al elegir **Guardar y cerrar**; `Esc` cancela el panel o vuelve al menú anterior.

En **Voz**, el panel consulta en vivo el catálogo de Google para el proyecto de las credenciales y muestra únicamente las voces que los metadatos identifican como español argentino. Para evitar recorrer páginas de otros idiomas, pide a Google los resultados que contienen `Argentin` en el nombre o la descripción y verifica sus metadatos localmente. Por ejemplo, Google identifica las voces observadas como idioma `es-419`, región `419` y acento `Argentina Spanish`: `es-419` por sí solo no significa argentino. El filtro también admite `es-AR` o región `AR`, y oculta datos insuficientes o contradictorios. Si Google cambia sus etiquetas o descripciones, algunas voces argentinas podrían quedar fuera; el acento efectivo solo puede comprobarse escuchándolas.

Usa **Buscar** para filtrar por nombre o descripción dentro de los resultados argentinos, y **Siguiente página** / **Página anterior** si Google devuelve varias páginas. Una página filtrada puede quedar vacía aunque existan coincidencias en páginas posteriores: sigue con **Siguiente página**. Seleccionar una voz usa su ID; después selecciona **Guardar y cerrar**. También puedes introducir un nombre o ID manualmente, incluso si la consulta falla; esa entrada no se filtra ni se verifica. La voz guardada no cambia hasta que selecciones otra y guardes. El catálogo solo se consulta al abrir Voz o pedir otra búsqueda o página; no sintetiza ni reproduce audio. La consulta requiere conexión y acceso a Voices API (`v1beta1`, ubicación `global`); un error no modifica la voz guardada. Google indica que listar voces no se factura, pero generar audio sí puede consumir créditos.

Las preferencias de la extensión se guardan, sin credenciales, en `<directorio-global-de-Pi>/google-tts/settings.json`, normalmente `~/.pi/agent/google-tts/settings.json`; se respeta `PI_CODING_AGENT_DIR`. Se comparten entre proyectos y sobreviven a `/reload` y nuevas sesiones. Los comandos `/tts on`, `off`, `model`, `voice`, `speed` y `style` también se guardan. La extensión escribe el archivo con permisos `600`; si no puede leerlo o está mal formado, avisa y no lo sobrescribe. Los cambios de otra instancia de Pi se cargan al recargar; no hay sincronización simultánea entre instancias.

Al seleccionar un dispositivo, únicamente el `ffplay` de esa reproducción recibe `PULSE_SERVER=tcp:127.0.0.1:<puerto>` y `SDL_AUDIODRIVER=pulseaudio`. No modifica el entorno de Pi, no detecta dispositivos ni crea túneles o receptores. Cambiar la salida no mueve una reproducción que ya comenzó.

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

La reproducción usa `ffplay`, que debe estar disponible y tener acceso a una salida de audio. La pausa usa las señales `SIGSTOP`/`SIGCONT` de Linux/macOS sobre el mismo proceso, sin reiniciar el audio; no está disponible en Windows nativo. Puede oírse una pequeña cola ya almacenada en los búferes de audio, especialmente por SSH. Con la salida predeterminada, SSH depende del entorno; para una salida seleccionada, el túnel y el receptor deben estar preparados por el usuario. La extensión no crea túneles ni sockets. `/tts stop`, un nuevo prompt y el cierre de sesión detienen su propio reproductor aunque esté pausado.

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

Comprueba también que el servidor TCP acepta conexiones, no solo que el puerto escucha:

```bash
LC_ALL=C PULSE_SERVER=tcp:127.0.0.1:4713 pactl info
```

Debe mostrar la información del servidor de audio, no `Connection refused`. El audio local puede funcionar aunque el receptor TCP no esté habilitado.

**Seguridad:** mantén `listen=127.0.0.1`; no lo cambies por `0.0.0.0` ni abras el puerto en el router o firewall. El receptor local permite acceso al audio a procesos locales y a quienes puedan utilizar el túnel. `auth-ip-acl` es una opción de PulseAudio; no se debe asumir que PipeWire aplique esa lista: la restricción de red de este ejemplo es `listen=127.0.0.1`.

**Duración:** `pactl load-module` modifica solo el proceso actual; se pierde al reiniciar el servidor de audio o el PC. Comprueba si el módulo ya está cargado antes de repetirlo.

#### Hacer persistente el receptor en PipeWire

Si `pactl info` muestra `PulseAudio (on PipeWire ...)`, puedes pedir que `pipewire-pulse` cargue el módulo al arrancar. Hazlo una vez **en cada PC receptor**, en la cuenta que reproduce el audio. Crea el directorio:

```bash
mkdir -p ~/.config/pipewire/pipewire-pulse.conf.d
```

Crea `~/.config/pipewire/pipewire-pulse.conf.d/50-google-tts.conf` con este contenido:

```ini
pulse.cmd = [
    {
        cmd = "load-module"
        args = "module-native-protocol-tcp listen=127.0.0.1 port=4713"
    }
]
```

El módulo cargado manualmente sigue funcionando durante la sesión actual; no hace falta reiniciar ahora. Tras el próximo reinicio del PC o de `pipewire-pulse`, repite `ss -ltn | grep ':4713'` y el `pactl info` con `PULSE_SERVER` indicado arriba. El receptor solo estará disponible mientras PipeWire y la sesión del usuario estén funcionando. Si hay otro proceso ocupando `4713`, resuelve ese conflicto antes de continuar. Esta receta sigue la [documentación de PipeWire](https://docs.pipewire.org/1.6/page_man_pipewire-pulse_conf_5.html); su persistencia tras reiniciar aún no se ha validado en la instalación de ejemplo.

Para **PulseAudio sin PipeWire**, la configuración persistente es distinta; esta receta no se aplica. Consulta la documentación de tu distribución.

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

Para usar **Entorno predeterminado** en el **servidor**, el proceso de Pi / `ffplay` puede heredar:

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

Repite los pasos 1 y 2 en cada PC Linux desde el que quieras recibir audio: cada PC necesita su propio receptor TCP y su configuración de SSH. Si usa PipeWire, puedes aplicar allí también la receta persistente anterior. No hace falta volver a configurar Google en cada PC.

Para mantener varias conexiones simultáneas, asigna un puerto **remoto distinto en el servidor** a cada una. El puerto local `4713` puede repetirse porque pertenece a PCs diferentes. Por ejemplo:

| Dispositivo | Puerto remoto en el servidor | Receptor local |
|---|---:|---:|
| Casa | `14714` | `127.0.0.1:4713` en la PC de casa |
| Trabajo | `14715` | `127.0.0.1:4713` en la PC del trabajo |
| Otra PC | `14716` | `127.0.0.1:4713` en esa PC |

Para casa, por ejemplo, la regla SSH sería `RemoteForward 127.0.0.1:14714 127.0.0.1:4713`; en trabajo sustituye `14714` por `14715`. Registra esos mismos puertos remotos en `/tts config` → **Salida** y selecciona manualmente el dispositivo antes de reproducir. El túnel de la PC seleccionada debe estar activo. Estos números son ejemplos: usa los que correspondan a tus conexiones.

La salida sigue al **túnel**, no a la pantalla desde la que te conectas. **Un puerto remoto no puede pertenecer a dos túneles simultáneos**: si compartes `14713`, el anterior debe liberarlo antes de conectar el siguiente; de lo contrario, el reenvío puede fallar o el audio seguir llegando al otro dispositivo. La extensión no detecta ni cambia dispositivos automáticamente.

En Termius, la equivalencia es un **Remote port forwarding**: origen remoto `127.0.0.1:14713` y destino hacia el receptor PulseAudio del celular. Usa la dirección y el puerto del receptor que tengas configurado allí; Termius por sí solo no es ese receptor. La aplicación receptora y su instalación en el celular no se documentaron ni validaron en esta configuración.

### Diagnóstico rápido

| Síntoma | Qué comprobar |
|---|---|
| `Could not connect to PulseAudio` | Receptor del PC activo, túnel SSH operativo y `PULSE_SERVER` del proceso de Pi apuntando al mismo puerto. |
| `remote port forwarding failed` | Puerto remoto ocupado por otra conexión, reglas SSH o reenvío no permitido. |
| El sonido sale en otro dispositivo | Qué cliente mantiene el túnel de `14713`; abrir Herdr desde el celular no redirige un túnel del PC. |
| Cambiar `.zshrc` no afecta a Pi | El proceso persistente conserva el entorno con el que arrancó; `/reload` no lo sustituye. |
| Funciona hasta reiniciar el PC | La carga con `pactl load-module` era temporal. En PipeWire, configura la carga persistente descrita arriba y comprueba el receptor tras reiniciar; en PulseAudio, consulta su configuración específica. |

## Pruebas locales

Desde `extensions/google-tts/`, con Node 24:

```bash
node --test test/*.test.ts
```

Las pruebas sustituyen la síntesis y usan reproductores simulados o procesos Node aislados para comprobar tuberías, señales y cierre seguro: no leen credenciales, no llaman a Google y no emiten sonido. Las pruebas del panel usan los componentes TUI de la instalación anfitriona de Pi; si está en una ubicación no estándar, indica su directorio mediante `PI_PACKAGE_DIR`. La comprobación visual y el audio real se prueban manualmente en Pi después de `/reload`.
