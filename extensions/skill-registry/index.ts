import { readSkillRegistryConfig } from './src/config.js';
import { registerSkillRegistryCommands } from './src/commands.js';
import { registerSkillRegistryTools } from './src/tools.js';

export default function skillRegistryExtension(pi: any): void {
  const config = readSkillRegistryConfig(process.cwd());
  if (!config.enabled) return;

  registerSkillRegistryTools(pi);
  registerSkillRegistryCommands(pi);
}
