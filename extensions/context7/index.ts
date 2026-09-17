import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { registerContext7Tools } from './src/tools.js';

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

export default function context7Extension(pi: any): void {
  if (!isExtensionEnabled('context7')) return;
  registerContext7Tools(pi);
}
