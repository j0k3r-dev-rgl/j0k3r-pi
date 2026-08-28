import { quietSync } from './syncCommon.js';

export async function syncOnSessionStart(_event: unknown, ctx: { cwd: string; ui?: { notify?: (message: string, level?: string) => void } }): Promise<void> {
  await quietSync(ctx);
}
