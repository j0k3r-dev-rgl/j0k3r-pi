import { registerSkillRegistryCommands } from './src/commands.js';
import { registerSkillRegistryTools } from './src/tools.js';

export default function skillRegistryExtension(pi: any): void {
  registerSkillRegistryTools(pi);
  registerSkillRegistryCommands(pi);
}
