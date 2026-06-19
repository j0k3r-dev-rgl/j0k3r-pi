# YouTube Research Extension

A standalone Pi extension that adds five focused YouTube research tools.

## Required runtime dependency
- `yt-dlp` must be installed and available on `PATH` before using any tool.
- If missing, tools return a `yt_dlp_missing` error with installation guidance.

## Public tools (exactly five)
1. `youtube_search`
   - Search YouTube for videos, channels, and playlists.
   - Defaults to `type: mixed` when omitted.
   - Supports approved filters: `query`, `limit`, `type`, `channel`, `published_after`, `published_before`, `duration`, `sort`, `language`, `topic_tags`.
   - Supports optional enriched video metadata with `enrich`, `enrichLimit`, and `descriptionPreviewChars`.
   - Enrichment is opt-in and slower; it helps choose which video to inspect before fetching transcript by adding description previews, likes, comment counts, chapter counts, and compact tags when `yt-dlp` provides them.
2. `youtube_video_get`
   - Fetch a single video by URL or video ID.
   - Returns normalized metadata and a useful visible summary with title, URL, channel, duration, views, published date, description preview, and compact caption signals.
   - Supports `descriptionPreviewChars` to control the visible description preview.
   - Supports opt-in bounded comments with `includeComments` and `commentsLimit`; comments are disabled by default because they add latency and payload size.
3. `youtube_transcript_get`
   - Fetch transcript text for a video by URL or video ID.
   - `source_mode`: `manual | automatic | translated | any-caption | auto | best-effort`.
   - `best-effort` follows strict fallback chain and reports whether fallback was used.
4. `youtube_channel_search`
   - Search channels by query, channel ID, handle, or URL and return metadata-rich channel entries.
5. `youtube_playlist_get`
   - Fetch rich playlist metadata by URL or playlist ID, including description, total video count, channel/uploader, playlist views when available, and modified date when available.
   - Supports pagination with `entriesOffset` and `entriesLimit` so large playlists do not return every video at once; current `yt-dlp` extraction reliably exposes the first 100 playlist entries, so `entriesOffset` is bounded to `0..99`.
   - Returns pagination signals: `entries_offset`, `entries_limit`, `entries_returned`, `has_more_entries`, and `next_entries_offset`.
   - Returns compact entries by default (`id`, `title`, `url`, `duration`).
   - Supports opt-in enriched entries with `enrichEntries` and `descriptionPreviewChars`; enrichment adds per-video description previews, views, likes, comments, published date, chapters count, and compact tags when `yt-dlp` provides them.

## Input behavior
- Video/playlist inputs follow **exactly-one** rules for URL vs ID.
- Wrong-entity URLs are rejected (for example, channel URL for video tool).
- Errors are stable and structured (`code`, `message`, `recoverable`, optional `install_hint`).

## Non-goals
- No caching layer.
- No summarization of transcript/video content.
- No official YouTube API usage.

## Validation
Run from `extensions/youtube-research`:
- `npm test`
- `npm run typecheck`
