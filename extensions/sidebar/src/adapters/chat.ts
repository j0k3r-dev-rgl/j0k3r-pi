import type { ChatHeaderModel, SidebarAdapterContext } from '../model.js';

export type ChatAdapter = {
  load(context: SidebarAdapterContext): Promise<ChatHeaderModel>;
};

export function resolveChatHeader(context: SidebarAdapterContext): ChatHeaderModel {
  const runtimeTitle = firstText(
    context.ctx?.currentChat?.title,
    context.ctx?.chat?.title,
    context.ctx?.session?.title,
    context.ctx?.title,
  );
  if (runtimeTitle) return { title: runtimeTitle, source: 'runtime' };

  const sessionTitle = firstText(
    context.ctx?.sessionManager?.getSessionName?.(),
    context.pi?.getSessionName?.(),
    context.ctx?.sessionName,
  );
  if (sessionTitle) return { title: sessionTitle, source: 'session' };

  return { title: 'Current Chat', source: 'fallback' };
}

export function createChatAdapter(): ChatAdapter {
  return {
    async load(context) {
      return resolveChatHeader(context);
    },
  };
}

function firstText(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
  }
  return undefined;
}
