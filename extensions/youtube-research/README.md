# YouTube Research Extension

[English](#english) | [Español](#español)

## English

A standalone Pi extension that adds five focused YouTube research tools.

### Required runtime dependency
- `yt-dlp` must be installed and available on `PATH` before using any tool.
- If missing, tools return a `yt_dlp_missing` error with installation guidance.

### Public tools (exactly five)
1. `youtube_search`
   - Search YouTube for videos, channels, and playlists.
   - Defaults to `type: mixed` when omitted.
   - Supports approved filters: `query`, `limit`, `type`, `channel`, `published_after`, `published_before`, `duration`, `sort`, `language`, `topic_tags`.
   - Supports optional enriched video metadata with `enrich`, `enrichLimit`, and `descriptionPreviewChars`.
   - Enrichment is opt-in and slower; it helps choose which video to inspect before fetching transcript by adding description previews, likes, comment counts, chapter counts, and compact tags when `yt-dlp` provides them.
2. `youtube_video_get`
   - Fetch a single video by URL or video ID.
   - Returns normalized metadata and a useful visible summary with title, URL, channel, duration, views, total comments when available, published date, description preview, and compact caption signals.
   - Supports `descriptionPreviewChars` to control the visible description preview.
   - Supports opt-in bounded comments with `includeComments`, `commentsLimit`, and `commentsOffset`; comments are disabled by default because they add latency and payload size.
3. `youtube_transcript_get`
   - Fetch transcript text for a video by URL or video ID.
   - `source_mode`: `manual | automatic | translated | any-caption | auto | best-effort`.
   - `best-effort` follows a fidelity-first fallback chain and reports whether fallback was used.
   - Transcript downloads use a temporary directory and deterministic subtitle filenames to avoid title/unicode path issues.
   - `cleanTranscript` defaults to `true` and returns text-only transcript; set `cleanTranscript: false` to preserve raw subtitle timing/metadata when timestamps are needed.
4. `youtube_channel_search`
   - Search channels by query or inspect a specific channel by channel ID, handle, or URL.
   - Returns channel metadata useful for treating channels as recurring research sources: channel ID, handle, description preview, subscribers, verified signal, and thumbnail when available.
   - Supports optional recent videos with `includeVideos`, `videosOffset`, `videosLimit`, and opt-in `enrichVideos` for per-video descriptions, views, likes, comments, and published dates.
   - Supports optional channel playlists with `includePlaylists`, `playlistsOffset`, and `playlistsLimit`.
   - Uses bounded pagination to avoid fetching entire large channels.
5. `youtube_playlist_get`
   - Fetch rich playlist metadata by URL or playlist ID, including description, total video count, channel/uploader, playlist views when available, and modified date when available.
   - Supports pagination with `entriesOffset` and `entriesLimit` so large playlists do not return every video at once; current `yt-dlp` extraction reliably exposes the first 100 playlist entries, so `entriesOffset` is bounded to `0..99`.
   - Returns pagination signals: `entries_offset`, `entries_limit`, `entries_returned`, `has_more_entries`, and `next_entries_offset`.
   - Returns compact entries by default (`id`, `title`, `url`, `duration`).
   - Supports opt-in enriched entries with `enrichEntries` and `descriptionPreviewChars`; enrichment adds per-video description previews, views, likes, comments, published date, chapters count, and compact tags when `yt-dlp` provides them.

### Input behavior
- Video/playlist inputs follow **exactly-one** rules for URL vs ID.
- Wrong-entity URLs are rejected (for example, channel URL for video tool).
- Errors are stable and structured (`code`, `message`, `recoverable`, optional `install_hint`).

### Non-goals
- No caching layer.
- No summarization of transcript/video content.
- No official YouTube API usage.

### Validation
Run from `extensions/youtube-research`:
- `npm test`
- `npm run typecheck`

## Español

Extensión standalone de Pi que agrega cinco herramientas enfocadas para investigación en YouTube.

### Dependencia runtime requerida

- `yt-dlp` debe estar instalado y disponible en `PATH` antes de usar cualquier herramienta.
- Si falta, las herramientas devuelven un error `yt_dlp_missing` con guía de instalación.

### Herramientas públicas (exactamente cinco)

1. `youtube_search`
   - Busca videos, canales y playlists en YouTube.
   - Usa `type: mixed` por defecto cuando se omite.
   - Soporta filtros aprobados: `query`, `limit`, `type`, `channel`, `published_after`, `published_before`, `duration`, `sort`, `language`, `topic_tags`.
   - Soporta metadata enriquecida opcional para videos con `enrich`, `enrichLimit` y `descriptionPreviewChars`.
   - El enriquecimiento es opt-in y más lento; ayuda a elegir qué video inspeccionar antes de pedir transcripción al agregar previews de descripción, likes, cantidad de comentarios, cantidad de capítulos y tags compactos cuando `yt-dlp` los provee.
2. `youtube_video_get`
   - Obtiene un video único por URL o ID de video.
   - Devuelve metadata normalizada y un resumen visible útil con título, URL, canal, duración, vistas, total de comentarios cuando está disponible, fecha de publicación, preview de descripción y señales compactas de captions.
   - Soporta `descriptionPreviewChars` para controlar el preview visible de descripción.
   - Soporta comentarios acotados opt-in con `includeComments`, `commentsLimit` y `commentsOffset`; los comentarios están deshabilitados por defecto porque agregan latencia y tamaño de payload.
3. `youtube_transcript_get`
   - Obtiene texto de transcripción para un video por URL o ID.
   - `source_mode`: `manual | automatic | translated | any-caption | auto | best-effort`.
   - `best-effort` sigue una cadena de fallback priorizando fidelidad e informa si se usó fallback.
   - Las descargas de transcripción usan un directorio temporal y nombres determinísticos para subtítulos, evitando problemas con títulos o rutas unicode.
   - `cleanTranscript` es `true` por defecto y devuelve transcripción solo-texto; usa `cleanTranscript: false` para preservar timing/metadata crudos cuando se necesitan timestamps.
4. `youtube_channel_search`
   - Busca canales por query o inspecciona un canal específico por channel ID, handle o URL.
   - Devuelve metadata útil para tratar canales como fuentes recurrentes: channel ID, handle, preview de descripción, suscriptores, señal de verificación y thumbnail cuando está disponible.
   - Soporta videos recientes opcionales con `includeVideos`, `videosOffset`, `videosLimit` y `enrichVideos` opt-in para descripciones, vistas, likes, comentarios y fechas por video.
   - Soporta playlists opcionales del canal con `includePlaylists`, `playlistsOffset` y `playlistsLimit`.
   - Usa paginación acotada para no descargar canales grandes completos.
5. `youtube_playlist_get`
   - Obtiene metadata rica de playlists por URL o playlist ID, incluyendo descripción, total de videos, canal/uploader, vistas de playlist cuando están disponibles y fecha de modificación cuando está disponible.
   - Soporta paginación con `entriesOffset` y `entriesLimit` para que playlists grandes no devuelvan todos los videos de una vez; la extracción actual con `yt-dlp` expone de forma confiable las primeras 100 entradas, por lo que `entriesOffset` está acotado a `0..99`.
   - Devuelve señales de paginación: `entries_offset`, `entries_limit`, `entries_returned`, `has_more_entries` y `next_entries_offset`.
   - Devuelve entradas compactas por defecto (`id`, `title`, `url`, `duration`).
   - Soporta entradas enriquecidas opt-in con `enrichEntries` y `descriptionPreviewChars`; el enriquecimiento agrega previews de descripción, vistas, likes, comentarios, fecha de publicación, cantidad de capítulos y tags compactos cuando `yt-dlp` los provee.

### Comportamiento de inputs

- Los inputs de video/playlist siguen reglas de **exactamente uno** para URL vs ID.
- URLs de entidad equivocada se rechazan (por ejemplo, URL de canal en la herramienta de video).
- Los errores son estables y estructurados (`code`, `message`, `recoverable`, `install_hint` opcional).

### No objetivos

- Sin capa de caché.
- Sin resumen automático de contenido de transcripciones/videos.
- Sin uso de la API oficial de YouTube.

### Validación

Ejecutar desde `extensions/youtube-research`:

- `npm test`
- `npm run typecheck`
