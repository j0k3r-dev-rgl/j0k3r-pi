# Utils Extension

[English](#english) | [Español](#español)

## English

General-purpose Pi utility tools.

### Tools

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

Extensión de utilidades generales para Pi.

### Resumen

Utils contiene herramientas prácticas no ligadas a un proveedor externo. Actualmente su herramienta principal convierte Markdown local a audio usando motores TTS locales.

### Herramientas y capacidades

- `markdown_to_audio`: convierte `.md`, `.markdown` o `.mdown` a WAV o MP3.
- Usa Piper como motor principal cuando hay voces `.onnx` disponibles.
- Usa eSpeak NG como fallback.
- Soporta bitrate MP3, velocidad, pausas de oración, parámetros Piper y calidad de voz.
- Muestra progreso compacto en status bar durante conversiones largas.

### Requisitos

Para mejor calidad instala `piper-tts` y una voz Piper `.onnx`. Para MP3 hace falta `ffmpeg`. Para fallback instala `espeak-ng`.

### Ver más

La sección en inglés contiene parámetros, defaults de narración, troubleshooting de audio, reload y validación.
