# Utils Extension

General-purpose Pi utility tools.

## Tools

### `markdown_to_audio`

Converts a local Markdown file into an audio file so the user can listen to it.

The tool:

- reads a Markdown file from the current workspace or an absolute path;
- converts common Markdown syntax into readable plain text;
- uses local text-to-speech engines only;
- prefers Piper for better voice quality;
- falls back to eSpeak NG when Piper is unavailable;
- writes `.wav` by default and can write `.mp3` when `ffmpeg` is installed.

Parameters:

- `path` — local Markdown path (`.md`, `.markdown`, or `.mdown`), relative to the current workspace or absolute.
- `outputPath` — optional output audio path. Defaults to a `.wav` file next to the Markdown file. Supports `.wav` and `.mp3`.
- `engine` — optional TTS engine: `auto`, `piper`, or `espeak-ng`. Defaults to `auto`.
- `language` — optional language/voice code, such as `es`, `es_ES`, `es_MX`, or `en_US`. Defaults to `es`.
- `voiceModel` — optional Piper `.onnx` model path. If omitted, the tool searches `/usr/share/piper-voices`.
- `speed` — optional speech speed. Values from `0.25` to `4` are relative multipliers where `1` is normal. For `espeak-ng`, values above `4` are treated as words per minute. For Piper, this maps to Piper `--length-scale` as `1 / speed`.

## Arch Linux dependencies

Recommended install for Arch Linux x86_64:

```bash
yay -S piper-tts piper-voices-es-es
sudo pacman -S espeak-ng ffmpeg
```

Verify that Piper has a usable voice model:

```bash
command -v piper-tts
find /usr/share/piper-voices -type f -name '*.onnx' | head
```

If the `find` command returns nothing, only the common Piper files are installed; install a voice package such as `piper-voices-es-es` or pass `voiceModel` explicitly.

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

## Validation

Run from `extensions/utils`:

```bash
npm test
npm run typecheck
```
