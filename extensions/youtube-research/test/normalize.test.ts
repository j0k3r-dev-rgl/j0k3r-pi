import { describe, expect, it } from 'vitest';
import { normalizeSearchResult, normalizeVideoDetails, normalizeChannelResult, normalizePlaylistDetails } from '../src/normalize.js';

describe('youtube-research normalization layer', () => {
  it('normalizes mixed search results into stable required fields', () => {
    const raw = {
      _type: 'video',
      title: 'Episode One',
      webpage_url: 'https://youtube.com/watch?v=abc',
      id: 'abc',
      channel_id: 'chan123',
      uploader: 'Jane',
      view_count: 10,
      thumbnails: [{ url: 'https://img/1.png' }],
    };

    const normalized = normalizeSearchResult(raw);
    expect(normalized.result_type).toBe('video');
    expect(normalized.title).toBe('Episode One');
    expect(normalized.url).toBe('https://youtube.com/watch?v=abc');
    expect(normalized.video_id).toBe('abc');
    expect(normalized.channel_id).toBe('chan123');
  });

  it('classifies live yt-dlp flat search video rows as videos', () => {
    const raw = {
      _type: 'url',
      ie_key: 'Youtube',
      title: 'PYTHON course from ZERO (Complete)',
      webpage_url: 'https://www.youtube.com/watch?v=nKPbfIU442g',
      id: 'nKPbfIU442g',
      channel_id: 'UCtoo4_P6ilCj7jwa4FmA5lQ',
      channel: 'Soy Dalto',
      uploader: 'Soy Dalto',
    };

    const normalized = normalizeSearchResult(raw);
    expect(normalized.result_type).toBe('video');
    expect(normalized.video_id).toBe('nKPbfIU442g');
    expect(normalized.channel_name).toBe('Soy Dalto');
  });

  it('classifies live yt-dlp search-url rows for channels and playlists', () => {
    const rawChannel = {
      _type: 'url',
      ie_key: 'YoutubeTab',
      title: 'Computerphile',
      webpage_url: 'https://www.youtube.com/channel/UC9-y-6csu5WGm29I7JiwpnA',
      id: 'UC9-y-6csu5WGm29I7JiwpnA',
      channel: 'Computerphile',
      channel_id: 'UC9-y-6csu5WGm29I7JiwpnA',
    };

    const rawPlaylist = {
      _type: 'url',
      ie_key: 'YoutubeTab',
      title: 'Python Tutorials',
      webpage_url: 'https://www.youtube.com/playlist?list=PL-osiE80TeTt2d9bfVyTiXJA-UTHn6WwU',
      id: 'PL-osiE80TeTt2d9bfVyTiXJA-UTHn6WwU',
    };

    const channel = normalizeSearchResult(rawChannel);
    const playlist = normalizeSearchResult(rawPlaylist);

    expect(channel.result_type).toBe('channel');
    expect(channel.channel_id).toBe('UC9-y-6csu5WGm29I7JiwpnA');
    expect(playlist.result_type).toBe('playlist');
    expect(playlist.playlist_id).toBe('PL-osiE80TeTt2d9bfVyTiXJA-UTHn6WwU');
  });

  it('normalizes video detail fields as required', () => {
    const raw = {
      id: 'abc',
      title: 'Deep Talk',
      webpage_url: 'https://youtube.com/watch?v=abc',
      duration: 1234,
      view_count: 99,
      uploader: 'Creator',
      uploader_id: '@creator-handle',
      channel_id: 'UCcreator123',
      thumbnail: 'https://thumb.jpg',
      subtitles: {
        en: ['a'],
      },
      automatic_captions: {
        en: ['b'],
      },
      comments: [{
        id: 'c1',
        author: '@viewer',
        text: 'Useful intro and explanation',
        like_count: 3,
        timestamp: 1710000000,
        parent: 'root',
      }],
    };

    const normalized = normalizeVideoDetails(raw);
    expect(normalized.video_id).toBe('abc');
    expect(normalized.url).toBe('https://youtube.com/watch?v=abc');
    expect(normalized.title).toBe('Deep Talk');
    expect(normalized.channel_id).toBe('UCcreator123');
    expect(normalized.description_preview).toBeUndefined();
    expect(normalized.caption_available).toBe(true);
    expect(normalized.caption_languages).toContain('en');
    expect(normalized.comments).toEqual([{ id: 'c1', author: '@viewer', text: 'Useful intro and explanation', like_count: 3, timestamp: 1710000000, parent: 'root' }]);
  });

  it('normalizes channel search details and keeps optional fields explicit', () => {
    const raw = {
      channel: 'dev-channel',
      id: 'chan123',
      title: 'Dev Channel',
      description: 'notes',
      channel_follower_count: 120,
      channel_video_count: 9,
      webpage_url: 'https://youtube.com/@dev-channel',
    };

    const normalized = normalizeChannelResult(raw);
    expect(normalized.channel_name).toBe('Dev Channel');
    expect(normalized.channel_id).toBe('chan123');
    expect(normalized.subscriber_count).toBe(120);
    expect(normalized.url).toBe('https://youtube.com/@dev-channel');
  });

  it('normalizes playlist details with rich playlist metadata, pagination, and compact entries', () => {
    const raw = {
      title: 'Playlist',
      id: 'PL1',
      webpage_url: 'https://youtube.com/playlist?list=PL1',
      channel: 'host',
      channel_id: 'chan123',
      uploader: 'Host Uploads',
      uploader_id: '@host',
      description: 'list '.repeat(100),
      entries: [{ title: 'ep1', id: 'v1', duration: 10, url: 'https://youtube.com/watch?v=v1' }],
      playlist_count: 12,
      view_count: 345,
      modified_date: '20260430',
    };

    const normalized = normalizePlaylistDetails(raw, { entriesOffset: 5, entriesLimit: 1, descriptionPreviewChars: 40 });
    expect(normalized.playlist_id).toBe('PL1');
    expect(normalized.playlist_title).toBe('Playlist');
    expect(normalized.description_preview).toMatch(/list/);
    expect(normalized.video_count).toBe(12);
    expect(normalized.channel_name).toBe('host');
    expect(normalized.channel_id).toBe('chan123');
    expect(normalized.uploader_id).toBe('@host');
    expect(normalized.view_count).toBe(345);
    expect(normalized.modified_date).toBe('2026-04-30');
    expect(normalized.entries_offset).toBe(5);
    expect(normalized.entries_limit).toBe(1);
    expect(normalized.entries_returned).toBe(1);
    expect(normalized.has_more_entries).toBe(true);
    expect(normalized.next_entries_offset).toBe(6);
    expect(normalized.entries?.[0].video_id).toBe('v1');
    expect(normalized.entries?.[0].url).toBe('https://youtube.com/watch?v=v1');
  });

  it('does not advertise playlist pagination past the yt-dlp accessible first 100 entries', () => {
    const raw = {
      title: 'Large Playlist',
      id: 'PLlarge',
      webpage_url: 'https://youtube.com/playlist?list=PLlarge',
      playlist_count: 158,
      entries: [{ title: 'entry 100', id: 'v100', duration: 10 }],
    };

    const normalized = normalizePlaylistDetails(raw, { entriesOffset: 99, entriesLimit: 5 });
    expect(normalized.entries_returned).toBe(1);
    expect(normalized.has_more_entries).toBe(false);
    expect(normalized.next_entries_offset).toBeNull();
  });

  it('is stable about missing optional fields', () => {
    const raw: Record<string, unknown> = { _type: 'video', title: 'Only title' };
    const normalized = normalizeSearchResult(raw);
    expect(normalized.description_snippet === null || normalized.description_snippet === undefined).toBe(true);
  });
});
