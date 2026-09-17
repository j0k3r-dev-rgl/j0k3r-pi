import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { registerBrowserScreenshotTools } from './src/tools.js';

export { registerBrowserScreenshotTools } from './src/tools.js';
export * from './src/cdp.js';
export * from './src/config.js';
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

export default function browserScreenshotExtension(pi: any): void {
  if (!isExtensionEnabled('browser-screenshot')) return;
  registerBrowserScreenshotTools(pi);
}
