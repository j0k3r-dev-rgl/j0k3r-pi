import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { MemoryLifecycle, type MemoryLifecycleOptions } from './lifecycle.ts';
import { createMemoryTools } from './tools/index.ts';
import { DEFAULT_DB_PATH } from './config.ts';

export function createMemoryExtension(
  dbPath: string = DEFAULT_DB_PATH,
  options?: MemoryLifecycleOptions,
) {
  return (pi: ExtensionAPI) => {
    const lifecycle = new MemoryLifecycle(dbPath, options);
    lifecycle.registerPublicEvents(pi);

    const tools = createMemoryTools(lifecycle);
    for (const tool of tools) {
      pi.registerTool(tool);
    }

    // Report registration only; loading never opens storage or checks the E5 service.
    pi.on('session_start', (_event, ctx) => {
      ctx.ui?.setStatus?.('pi-persistent-memory', `memory · ${tools.length} tools`);
    });
    pi.on('session_shutdown', (_event, ctx) => {
      ctx.ui?.setStatus?.('pi-persistent-memory', undefined);
    });
  };
}

export default createMemoryExtension();
