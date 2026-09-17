import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { registerUtilsTools } from './src/tools.js';

export { registerUtilsTools } from './src/tools.js';
export * from './src/markdown-to-audio.js';
export * from './src/screenshot.js';

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

export default function utilsExtension(pi: any): void {
  if (!isExtensionEnabled('utils')) return;
  registerUtilsTools(pi);
}
