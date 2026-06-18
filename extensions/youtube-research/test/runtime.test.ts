import { describe, expect, it } from 'vitest';
import { checkYtDlpRuntime, ytDlpMissingError, YT_DLP_INSTALL_HINT } from '../src/runtime.js';

describe('youtube-research runtime dependency checks', () => {
  it('reports yt_dlp_missing when command is not on PATH', async () => {
    const missing = new Error('not found') as NodeJS.ErrnoException;
    missing.code = 'ENOENT';

    const result = await checkYtDlpRuntime({
      binary: 'yt-dlp',
      probe: async () => {
        throw missing;
      },
    });

    expect(result.error).toMatchObject({
      code: 'yt_dlp_missing',
      recoverable: true,
    });
    expect(result.error?.message).toContain('yt-dlp');
    expect(result.error?.install_hint).toBe(YT_DLP_INSTALL_HINT);
  });

  it('treats non-executable binaries as missing dependency with recovery guidance', async () => {
    const denied = new Error('permission denied') as NodeJS.ErrnoException;
    denied.code = 'EACCES';

    const result = await checkYtDlpRuntime({
      binary: '/usr/bin/yt-dlp',
      probe: async () => {
        throw denied;
      },
    });

    expect(result.error).toMatchObject({
      code: 'yt_dlp_missing',
      recoverable: true,
    });
    expect(result.error?.install_hint).toBe(YT_DLP_INSTALL_HINT);
  });

  it('returns runtime metadata when the binary responds with a version', async () => {
    const result = await checkYtDlpRuntime({
      binary: 'yt-dlp',
      probe: async () => '2024.01.17',
    });

    expect(result.error).toBeUndefined();
    expect(result.runtime).toEqual({
      binary: 'yt-dlp',
      version: '2024.01.17',
    });
  });

  it('surfaces a stable helper error payload for quick use in tool layer', () => {
    const error = ytDlpMissingError('yt-dlp');

    expect(error).toMatchObject({
      code: 'yt_dlp_missing',
      recoverable: true,
      message: expect.stringContaining('yt-dlp'),
    });
    expect(error.details?.binary).toBe('yt-dlp');
  });
});
