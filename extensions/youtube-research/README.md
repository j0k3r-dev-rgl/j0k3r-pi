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
2. `youtube_video_get`
   - Fetch a single video by URL or video ID.
   - Returns normalized metadata; no summary generation.
3. `youtube_transcript_get`
   - Fetch transcript text for a video by URL or video ID.
   - `source_mode`: `manual | automatic | translated | any-caption | auto | best-effort`.
   - `best-effort` follows strict fallback chain and reports whether fallback was used.
4. `youtube_channel_search`
   - Search channels and return metadata-rich channel entries.
5. `youtube_playlist_get`
   - Fetch playlist metadata and compact entries by URL or playlist ID.

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
