import { describe, expect, it } from 'vitest';

import { createChatAdapter, resolveChatHeader } from '../src/adapters/chat.js';

describe('resolveChatHeader', () => {
  it('prefers runtime title fields when available', () => {
    expect(resolveChatHeader({
      cwd: '/workspace/pi',
      ctx: { currentChat: { title: 'Runtime Title' } },
      pi: {},
      now: () => new Date(),
    })).toEqual({ title: 'Runtime Title', source: 'runtime' });
  });

  it('falls back to session title discovery before using Current Chat', async () => {
    const adapter = createChatAdapter();

    await expect(adapter.load({
      cwd: '/workspace/pi',
      ctx: { sessionManager: { getSessionName: () => 'Session Title' } },
      pi: {},
      now: () => new Date(),
    })).resolves.toEqual({ title: 'Session Title', source: 'session' });

    await expect(adapter.load({
      cwd: '/workspace/pi',
      ctx: { sessionManager: {} },
      pi: {},
      now: () => new Date(),
    })).resolves.toEqual({ title: 'Current Chat', source: 'fallback' });
  });
});
