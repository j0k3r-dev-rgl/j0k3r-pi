import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { registerApiTools, type RegisterApiToolsOptions } from './src/tools.js';
import { registerToolRenderers } from './src/render.js';

export { registerToolRenderers } from './src/render.js';

export { registerApiTools, type RegisterApiToolsOptions } from './src/tools.js';
export * from './src/types.js';

function isExtensionEnabled(name: string, cwd = process.cwd()): boolean {
  try {
    const configPath = join(cwd, '.pi', 'extensions.json');
    if (!existsSync(configPath)) return false;
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    return Boolean(config && typeof config === 'object' && config[name] === true);
  } catch {
    return false;
  }
}

export default function apiToolsExtension(pi: any, options: RegisterApiToolsOptions = {}): Promise<void> | void {
  registerToolRenderers(pi);
  const cwd = options.cwd ?? process.cwd();
  if (!isExtensionEnabled('api-tools', cwd)) return;
  return registerApiTools(pi, options);
}
