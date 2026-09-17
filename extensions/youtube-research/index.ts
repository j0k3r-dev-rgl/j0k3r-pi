import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { registerYoutubeResearchTools } from './src/tools.js';

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

export default function youtubeResearchExtension(pi: any): void {
  if (!isExtensionEnabled('youtube-research')) return;
  registerYoutubeResearchTools(pi);
}
