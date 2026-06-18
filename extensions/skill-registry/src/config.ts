import fs from 'node:fs';
import path from 'node:path';

export interface SkillRegistryConfig {
  enabled: boolean;
  warnings: string[];
  path?: string;
}

export function findSkillRegistryConfigPath(cwd: string): string | undefined {
  let current = path.resolve(cwd);
  while (true) {
    const candidate = path.join(current, '.pi', 'skill-registry.config.json');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

export function readSkillRegistryConfig(cwd: string): SkillRegistryConfig {
  const warnings: string[] = [];
  const configPath = findSkillRegistryConfigPath(cwd);
  if (!configPath) return { enabled: false, warnings };

  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    const rawEnabled = raw.enabled;
    if (rawEnabled === undefined) return { enabled: false, warnings, path: configPath };
    if (rawEnabled !== true && rawEnabled !== false) {
      warnings.push('Ignoring invalid enabled flag in .pi/skill-registry.config.json; expected true or false.');
      return { enabled: false, warnings, path: configPath };
    }
    return { enabled: rawEnabled, warnings, path: configPath };
  } catch (error) {
    warnings.push(`Invalid .pi/skill-registry.config.json: ${error instanceof Error ? error.message : String(error)}`);
    return { enabled: false, warnings, path: configPath };
  }
}
