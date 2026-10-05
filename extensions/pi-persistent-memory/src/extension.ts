import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { MemoryLifecycle } from './lifecycle.ts';
import { DEFAULT_DB_PATH } from './config.ts';

export function createMemoryExtension(dbPath: string = DEFAULT_DB_PATH) {
  return (pi: ExtensionAPI) => {
    const lifecycle = new MemoryLifecycle(dbPath);
    lifecycle.registerPublicEvents(pi);
  };
}

export default createMemoryExtension();
