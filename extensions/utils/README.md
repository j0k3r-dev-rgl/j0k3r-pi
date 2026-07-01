# Utils Extension

[English](#english) | [Español](#español)

## English

General-purpose Pi utility tools.

### Tools

#### `screenshot`

Captures the current Linux desktop, saves it as a PNG, and returns the image inline in the same tool result so the agent can inspect it immediately without asking the user to attach or read the file manually.

The tool:

- supports Linux only;
- requires an active graphical session (`DISPLAY` for X11 or `WAYLAND_DISPLAY` for Wayland);
- refuses pure shell, TTY, SSH, container, or headless sessions that do not expose a graphical display;
- prefers screenshot utilities appropriate for the active session: `grim` for Wayland/wlroots, `gnome-screenshot`, `spectacle`, `maim`, `scrot`, or ImageMagick `import`;
- writes `.png` output to a temporary file by default or to `outputPath` when provided;
- attaches the PNG inline when the active model supports image input and the file is below `maxInlineBytes`;
- returns actionable install guidance when no supported screenshot utility is installed, including hints for common distro families.

Parameters:

- `outputPath` — optional PNG output path, relative to the workspace or absolute. Defaults to a temporary `.png` file.
- `maxInlineBytes` — optional maximum PNG size to attach inline. Defaults to 5 MiB.

Runtime requirements:

- Linux desktop session with `DISPLAY` or `WAYLAND_DISPLAY` set.
- One supported local screenshot utility installed.
- A vision-capable active model if the agent must inspect the image inline. If the active model does not accept images, the tool still saves the PNG and reports the path.

Install examples:

```bash
# Arch / Manjaro / EndeavourOS
sudo pacman -S grim gnome-screenshot spectacle maim scrot imagemagick

# Debian / Ubuntu / Mint / Pop!_OS
sudo apt update && sudo apt install grim gnome-screenshot spectacle maim scrot imagemagick

# Fedora / RHEL family
sudo dnf install grim gnome-screenshot spectacle maim scrot ImageMagick

# openSUSE
sudo zypper install grim gnome-screenshot spectacle maim scrot ImageMagick
```

Notes:

- On Wayland, compositor security rules can block screenshots unless the utility matches the compositor/desktop portal support.
- In headless shells there is no desktop surface to capture; start Pi from the graphical session or expose a display first.
- For quick inspections, omit `outputPath` so screenshots go to the system temporary directory. Pass `outputPath` only when keeping a workspace artifact is intentional.
- The image is returned inline in the same tool call, so a follow-up `read` call is not needed for normal use.

#### `markdown_to_audio`

Converts a local Markdown file into an audio file so the user can listen to it.

The tool:

- reads a Markdown file from the current workspace or an absolute path;
- converts common Markdown syntax into narration-friendly plain text without modifying the source Markdown;
- uses local text-to-speech engines only;
- prefers Piper for better voice quality;
- falls back to eSpeak NG when Piper is unavailable;
- writes `.wav` by default next to the Markdown file and can write `.mp3` when `ffmpeg` is installed;
- emits concise progress updates with elapsed time, selected TTS program, and whether the engine is primary, fallback, or explicitly requested while synthesis or MP3 conversion is running.

Parameters:

- `path` — local Markdown path (`.md`, `.markdown`, or `.mdown`), relative to the current workspace or absolute.
- `outputPath` — optional output audio path. Defaults to a `.wav` file next to the Markdown file. Supports `.wav` and `.mp3`.
- `engine` — optional TTS engine: `auto`, `piper`, or `espeak-ng`. Defaults to `auto`.
- `language` — optional language/voice code, such as `es`, `es_ES`, `es_MX`, or `en_US`. Defaults to `es`.
- `voiceModel` — optional Piper `.onnx` model path. If omitted, the tool searches `/usr/share/piper-voices`.
- `voiceQuality` — optional Piper voice quality preference: `auto`, `high`, `medium`, or `low`. `auto` prefers `medium`, then `low`, then `high` to balance quality and generation time.
- `speed` — optional speech speed. Values from `0.25` to `4` are relative multipliers where `1` is normal. For `espeak-ng`, values above `4` are treated as words per minute. For Piper, this maps to Piper `--length-scale` as `1 / speed`.
- `sentenceSilence` — Piper-only seconds of silence after each sentence. Useful for more natural narration pacing.
- `noiseScale` — Piper-only generator noise scale. Piper default is usually `0.667`.
- `noiseW` — Piper-only phoneme-width variation. Piper default is usually `0.8`.
- `mp3BitrateKbps` — optional MP3 bitrate in kbps when `outputPath` ends in `.mp3`. Defaults to `64`, which is compact and usually enough for spoken-word audio.

### Runtime requirements

Minimum requirements:

- Node.js runtime through Pi.
- A local TTS engine:
  - preferred: Piper (`piper-tts` or `piper`) plus at least one `.onnx` voice model;
  - fallback: `espeak-ng`.
- `ffmpeg` only when writing `.mp3` output.
- A working system audio route only for playback. Audio generation can succeed even if the OS output device is misconfigured.

### Arch Linux dependencies

Recommended install for Arch Linux x86_64:

```bash
sudo pacman -S git-lfs espeak-ng ffmpeg
yay -S piper-tts piper-voices-es-ar
```

Other Spanish voice packages may be available:

```bash
yay -Ss piper-voices-es
```

Examples include `piper-voices-es-ar`, `piper-voices-es-es`, and `piper-voices-es-mx`. If an AUR voice package fails during Git LFS setup, run:

```bash
unset GIT_CONFIG_GLOBAL
git lfs install --force
```

Verify that Piper and a usable voice model are installed:

```bash
command -v piper-tts
find /usr/share/piper-voices -type f -name '*.onnx' | sort | head
```

If the `find` command returns nothing, only the common Piper files are installed; install a voice package such as `piper-voices-es-ar`, `piper-voices-es-es`, or `piper-voices-es-mx`, or pass `voiceModel` explicitly.

Notes:

- Piper gives the best MVP quality for local/offline Markdown narration.
- eSpeak NG is useful as a reliable fallback, but it sounds more robotic.
- `ffmpeg` is required only for `.mp3` output.
- If `engine` is `auto`, the tool tries `piper-tts`, then `piper`, then `espeak-ng`.
- If Piper is installed but no voice model is found, pass `voiceModel` explicitly, for example:

```json
{
  "path": "notes/brief.md",
  "outputPath": "notes/brief.wav",
  "engine": "piper",
  "language": "es_ES",
  "voiceModel": "/usr/share/piper-voices/es/es_ES/sharvard/medium/es_ES-sharvard-medium.onnx"
}
```

### Recommended narration defaults

For news or long-form narration, start with normal speed and tune only after listening:

```json
{
  "engine": "piper",
  "language": "es_AR",
  "speed": 1,
  "sentenceSilence": 0.3,
  "noiseScale": 0.667,
  "noiseW": 0.8,
  "voiceQuality": "auto",
  "mp3BitrateKbps": 64
}
```

If only a high-quality Piper voice is installed, `voiceQuality: "auto"` will still use that high-quality voice. Install a `medium` or `low` voice if faster generation is more important than maximum quality.

For smaller files, set `outputPath` to `.mp3`. The default MP3 bitrate is `64k`, which is intended for narration. Use `48` for smaller voice files, `96` for higher quality, or `128` for broad compatibility.

### Progress updates

During long conversions, the live Pi tool emits short status updates instead of verbose logs. When the TUI context is available, it also sets a compact footer/status-bar entry and clears it when the tool finishes or fails.

Updates are intentionally compact and truthful about what is known. Piper does not expose a reliable percentage, so progress is shown as `progress n/a` instead of inventing a percentage.

Examples:

```text
markdown_to_audio: piper synthesis · primary · program piper-tts · speed 1x · 16.8k chars · progress n/a · 0:30 elapsed
markdown_to_audio: mp3 conversion · 64k · progress n/a · 0:02 elapsed
```

The default pulse interval is 1 second, so long reports show that work is still progressing without flooding the chat or TUI with full logs. The final result also reports the effective engine and TTS program so users can tell whether Piper was used as the primary engine or eSpeak NG was used as fallback.

### Playback troubleshooting

The tool creates an audio file; it does not choose your desktop audio output. If the generated file exists but you cannot hear it, verify the OS audio sink.

With PipeWire/WirePlumber:

```bash
wpctl status
wpctl get-volume @DEFAULT_AUDIO_SINK@
```

Set a specific sink as default when needed:

```bash
wpctl set-default <sink-id>
wpctl set-volume @DEFAULT_AUDIO_SINK@ 1.0
wpctl set-mute @DEFAULT_AUDIO_SINK@ 0
```

Play a generated file directly:

```bash
pw-play path/to/file.wav
mpv path/to/file.mp3
```

### Reloading Pi

After changing this extension code or tool schema, reload or restart Pi before expecting the live `markdown_to_audio` tool to expose new parameters:

```text
/reload
```

### Validation

Run from `extensions/utils`:

```bash
npm test
npm run typecheck
```

## Español

Herramientas utilitarias generales para Pi.

### Herramientas

#### `screenshot`

Captura el escritorio Linux actual, guarda la imagen como PNG y devuelve la imagen inline en el mismo resultado de la tool para que el agente pueda inspeccionarla inmediatamente sin pedirle al usuario que la adjunte o la lea manualmente.

La herramienta:

- soporta solo Linux;
- requiere una sesión gráfica activa (`DISPLAY` para X11 o `WAYLAND_DISPLAY` para Wayland);
- rechaza sesiones de shell puro, TTY, SSH, contenedor o headless que no exponen un display gráfico;
- prefiere utilidades adecuadas para la sesión activa: `grim` para Wayland/wlroots, `gnome-screenshot`, `spectacle`, `maim`, `scrot` o `import` de ImageMagick;
- escribe salida `.png` en un archivo temporal por defecto o en `outputPath` si se pasa;
- adjunta el PNG inline cuando el modelo activo soporta imágenes y el archivo está debajo de `maxInlineBytes`;
- devuelve guía accionable de instalación cuando no hay una utilidad de screenshot soportada, incluyendo hints para familias de distribuciones comunes.

Parámetros:

- `outputPath` — ruta opcional de salida PNG, relativa al workspace o absoluta. Por defecto usa un `.png` temporal.
- `maxInlineBytes` — tamaño máximo opcional del PNG para adjuntar inline. Por defecto 5 MiB.

Requisitos runtime:

- Sesión de escritorio Linux con `DISPLAY` o `WAYLAND_DISPLAY` seteado.
- Una utilidad local de screenshot soportada instalada.
- Un modelo activo con soporte de visión si el agente debe inspeccionar la imagen inline. Si el modelo activo no acepta imágenes, la tool igual guarda el PNG y reporta la ruta.

Ejemplos de instalación:

```bash
# Arch / Manjaro / EndeavourOS
sudo pacman -S grim gnome-screenshot spectacle maim scrot imagemagick

# Debian / Ubuntu / Mint / Pop!_OS
sudo apt update && sudo apt install grim gnome-screenshot spectacle maim scrot imagemagick

# Fedora / familia RHEL
sudo dnf install grim gnome-screenshot spectacle maim scrot ImageMagick

# openSUSE
sudo zypper install grim gnome-screenshot spectacle maim scrot ImageMagick
```

Notas:

- En Wayland, las reglas de seguridad del compositor pueden bloquear screenshots si la utilidad no coincide con el compositor o soporte de portales del desktop.
- En shells headless no hay superficie de escritorio para capturar; inicia Pi desde la sesión gráfica o expón un display primero.
- Para inspecciones rápidas, omitir `outputPath` para que las capturas vayan al directorio temporal del sistema. Pasar `outputPath` solo cuando conservar un artefacto en el workspace sea intencional.
- La imagen vuelve inline en el mismo tool call, así que normalmente no hace falta un `read` posterior.

#### `markdown_to_audio`

Convierte un archivo Markdown local en un archivo de audio para que el usuario pueda escucharlo.

La herramienta:

- lee un archivo Markdown desde el workspace actual o una ruta absoluta;
- convierte sintaxis Markdown común en texto plano amigable para narración sin modificar el Markdown fuente;
- usa solo motores locales de text-to-speech;
- prefiere Piper por mejor calidad de voz;
- usa eSpeak NG como fallback cuando Piper no está disponible;
- escribe `.wav` por defecto junto al archivo Markdown y puede escribir `.mp3` cuando `ffmpeg` está instalado;
- emite actualizaciones de progreso concisas con tiempo transcurrido, programa TTS seleccionado y si el motor es primario, fallback o solicitado explícitamente mientras corre la síntesis o conversión MP3.

Parámetros:

- `path` — ruta local Markdown (`.md`, `.markdown` o `.mdown`), relativa al workspace actual o absoluta.
- `outputPath` — ruta opcional de salida de audio. Por defecto genera un `.wav` junto al archivo Markdown. Soporta `.wav` y `.mp3`.
- `engine` — motor TTS opcional: `auto`, `piper` o `espeak-ng`. Por defecto `auto`.
- `language` — código opcional de idioma/voz, como `es`, `es_ES`, `es_MX` o `en_US`. Por defecto `es`.
- `voiceModel` — ruta opcional a modelo Piper `.onnx`. Si se omite, la herramienta busca en `/usr/share/piper-voices`.
- `voiceQuality` — preferencia opcional de calidad de voz Piper: `auto`, `high`, `medium` o `low`. `auto` prefiere `medium`, luego `low`, luego `high` para balancear calidad y tiempo de generación.
- `speed` — velocidad opcional de habla. Valores de `0.25` a `4` son multiplicadores relativos donde `1` es normal. Para `espeak-ng`, valores mayores a `4` se tratan como palabras por minuto. Para Piper, esto mapea a `--length-scale` como `1 / speed`.
- `sentenceSilence` — segundos de silencio después de cada oración, solo Piper. Útil para pacing de narración más natural.
- `noiseScale` — escala de ruido del generador, solo Piper. El default de Piper suele ser `0.667`.
- `noiseW` — variación de ancho de fonemas, solo Piper. El default de Piper suele ser `0.8`.
- `mp3BitrateKbps` — bitrate MP3 opcional en kbps cuando `outputPath` termina en `.mp3`. Por defecto `64`, compacto y normalmente suficiente para audio hablado.

### Requisitos runtime

Requisitos mínimos:

- Runtime Node.js a través de Pi.
- Un motor TTS local:
  - preferido: Piper (`piper-tts` o `piper`) más al menos un modelo de voz `.onnx`;
  - fallback: `espeak-ng`.
- `ffmpeg` solo cuando se escribe salida `.mp3`.
- Una ruta de audio del sistema funcionando solo para reproducción. La generación de audio puede tener éxito incluso si el dispositivo de salida del OS está mal configurado.

### Dependencias Arch Linux

Instalación recomendada para Arch Linux x86_64:

```bash
sudo pacman -S git-lfs espeak-ng ffmpeg
yay -S piper-tts piper-voices-es-ar
```

Puede haber otros paquetes de voces en español:

```bash
yay -Ss piper-voices-es
```

Ejemplos incluyen `piper-voices-es-ar`, `piper-voices-es-es` y `piper-voices-es-mx`. Si un paquete AUR de voz falla durante setup de Git LFS, ejecutar:

```bash
unset GIT_CONFIG_GLOBAL
git lfs install --force
```

Verificar que Piper y un modelo de voz usable estén instalados:

```bash
command -v piper-tts
find /usr/share/piper-voices -type f -name '*.onnx' | sort | head
```

Si `find` no devuelve nada, solo están instalados los archivos comunes de Piper; instala un paquete de voz como `piper-voices-es-ar`, `piper-voices-es-es` o `piper-voices-es-mx`, o pasa `voiceModel` explícitamente.

Notas:

- Piper da la mejor calidad MVP para narración Markdown local/offline.
- eSpeak NG sirve como fallback confiable, pero suena más robótico.
- `ffmpeg` se requiere solo para salida `.mp3`.
- Si `engine` es `auto`, la herramienta intenta `piper-tts`, luego `piper`, luego `espeak-ng`.
- Si Piper está instalado pero no se encuentra modelo de voz, pasa `voiceModel` explícitamente, por ejemplo:

```json
{
  "path": "notes/brief.md",
  "outputPath": "notes/brief.wav",
  "engine": "piper",
  "language": "es_ES",
  "voiceModel": "/usr/share/piper-voices/es/es_ES/sharvard/medium/es_ES-sharvard-medium.onnx"
}
```

### Defaults recomendados de narración

Para noticias o narración larga, empezar con velocidad normal y ajustar solo después de escuchar:

```json
{
  "engine": "piper",
  "language": "es_AR",
  "speed": 1,
  "sentenceSilence": 0.3,
  "noiseScale": 0.667,
  "noiseW": 0.8,
  "voiceQuality": "auto",
  "mp3BitrateKbps": 64
}
```

Si solo hay instalada una voz Piper high-quality, `voiceQuality: "auto"` igual usará esa voz high-quality. Instala una voz `medium` o `low` si es más importante generar rápido que máxima calidad.

Para archivos más pequeños, define `outputPath` con `.mp3`. El bitrate MP3 por defecto es `64k`, pensado para narración. Usa `48` para archivos de voz más chicos, `96` para más calidad o `128` para compatibilidad amplia.

### Actualizaciones de progreso

Durante conversiones largas, la tool live de Pi emite actualizaciones cortas de estado en vez de logs verbosos. Cuando hay contexto TUI disponible, también setea una entrada compacta en footer/status-bar y la limpia cuando la tool termina o falla.

Las actualizaciones son intencionalmente compactas y honestas sobre lo que se sabe. Piper no expone un porcentaje confiable, así que el progreso se muestra como `progress n/a` en vez de inventar un porcentaje.

Ejemplos:

```text
markdown_to_audio: piper synthesis · primary · program piper-tts · speed 1x · 16.8k chars · progress n/a · 0:30 elapsed
markdown_to_audio: mp3 conversion · 64k · progress n/a · 0:02 elapsed
```

El intervalo de pulso por defecto es 1 segundo, así que los reportes largos muestran que el trabajo sigue avanzando sin inundar el chat o la TUI con logs completos. El resultado final también reporta el motor efectivo y el programa TTS para que los usuarios puedan saber si se usó Piper como motor principal o eSpeak NG como fallback.

### Troubleshooting de reproducción

La herramienta crea un archivo de audio; no elige la salida de audio de tu escritorio. Si el archivo generado existe pero no se escucha, verificar el sink de audio del OS.

Con PipeWire/WirePlumber:

```bash
wpctl status
wpctl get-volume @DEFAULT_AUDIO_SINK@
```

Definir un sink específico como default cuando haga falta:

```bash
wpctl set-default <sink-id>
wpctl set-volume @DEFAULT_AUDIO_SINK@ 1.0
wpctl set-mute @DEFAULT_AUDIO_SINK@ 0
```

Reproducir directamente un archivo generado:

```bash
pw-play path/to/file.wav
mpv path/to/file.mp3
```

### Recargar Pi

Después de cambiar código de esta extensión o schema de tool, recargar o reiniciar Pi antes de esperar que la tool live `markdown_to_audio` exponga parámetros nuevos:

```text
/reload
```

### Validación

Ejecutar desde `extensions/utils`:

```bash
npm test
npm run typecheck
```
