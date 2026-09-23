import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { runGitSyncInspection } from './src/inspector.js';
import { createGitSyncMessageRenderer } from './src/render.js';
import type { GitSyncDiagnostic } from './src/types.js';

export * from './src/types.js';
export * from './src/inspector.js';
export * from './src/render.js';

export interface BeforeAgentStartEventCustom {
  inspectorOverride?: () => Promise<GitSyncDiagnostic | null>;
}

export default function gitSyncAwarenessExtension(
  pi: ExtensionAPI,
  context?: ExtensionContext
) {
  let hasReported = false;

  pi.registerMessageRenderer?.('git-sync-awareness', (message: any, options: { expanded?: boolean } = {}) => {
    return createGitSyncMessageRenderer(message, options);
  });

  pi.on('session_start', async () => {
    hasReported = false;
  });

  pi.on('before_agent_start', async (event: any, testOptions?: BeforeAgentStartEventCustom) => {
    if (hasReported) {
      return undefined;
    }
    hasReported = true;

    try {
      const inspect = testOptions?.inspectorOverride || (event as any)?.inspectorOverride;
      const diagnostic = inspect
        ? await inspect()
        : await runGitSyncInspection({
            cwd: context?.cwd || process.cwd(),
          });

      if (!diagnostic) return undefined;

      return {
        message: {
          customType: 'git-sync-awareness',
          content: diagnostic.formattedReport,
          display: true,
          details: diagnostic,
        },
      };
    } catch (err: any) {
      return {
        message: {
          customType: 'git-sync-awareness',
          content: `⚠️ Git sync awareness failed to inspect repository: ${err?.message || String(err)}`,
          display: true,
        },
      };
    }
  });
}
