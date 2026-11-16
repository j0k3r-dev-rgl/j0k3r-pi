import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * `utils/index.ts` reads `.pi/extensions.json` from the process cwd. Package tests
 * run inside the extension directory, so registration assertions execute in an
 * isolated fixture project instead of changing production enabling behavior.
 */
export async function withEnabledUtilsExtension<T>(runner: () => T | Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'utils-enabled-'));
  const previous = process.cwd();
  try {
    await mkdir(join(root, '.pi'), { recursive: true });
    await writeFile(join(root, '.pi', 'extensions.json'), JSON.stringify({ utils: true }), 'utf8');
    process.chdir(root);
    return await runner();
  } finally {
    process.chdir(previous);
    await rm(root, { recursive: true, force: true });
  }
}

/** Register the extension's tools without depending on cwd-based enabling. */
export async function registerUtilsTools(): Promise<any[]> {
  const tools: any[] = [];
  const { registerUtilsTools: register } = await import('../src/tools.js');
  register({ registerTool: (tool: any) => tools.push(tool) } as any);
  return tools;
}
