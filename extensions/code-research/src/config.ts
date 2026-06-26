import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, parse, resolve } from 'node:path';

export interface CodeResearchProjectConfig {
  configPath?: string;
  warnings: string[];
  graph: {
    enable: boolean;
    addGitignore: boolean;
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export async function findCodeResearchConfigPath(cwd: string): Promise<string | undefined> {
  let current = resolve(cwd);
  while (true) {
    const candidate = join(current, '.pi', 'code-research.json');
    if (await exists(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current || current === parse(current).root) return undefined;
    current = parent;
  }
}

export async function loadCodeResearchConfig(cwd: string): Promise<CodeResearchProjectConfig> {
  const warnings: string[] = [];
  const configPath = await findCodeResearchConfigPath(cwd);
  const defaults: CodeResearchProjectConfig = {
    configPath,
    warnings,
    graph: {
      enable: false,
      addGitignore: true,
    },
  };

  if (!configPath) return defaults;

  try {
    const raw = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>;
    const graphRaw = raw.graph && typeof raw.graph === 'object' && !Array.isArray(raw.graph)
      ? raw.graph as Record<string, unknown>
      : {};

    if (raw.graph !== undefined && (typeof raw.graph !== 'object' || raw.graph === null || Array.isArray(raw.graph))) {
      warnings.push('Ignoring invalid graph config in .pi/code-research.json; expected object.');
    }

    let enable = false;
    if (graphRaw.enable === true) enable = true;
    else if (graphRaw.enable !== undefined && typeof graphRaw.enable !== 'boolean') {
      warnings.push('Ignoring invalid graph.enable in .pi/code-research.json; expected true or false.');
    }

    let addGitignore = true;
    if (graphRaw.addGitignore === false) addGitignore = false;
    else if (graphRaw.addGitignore !== undefined && typeof graphRaw.addGitignore !== 'boolean') {
      warnings.push('Ignoring invalid graph.addGitignore in .pi/code-research.json; expected true or false.');
    }

    return {
      configPath,
      warnings,
      graph: {
        enable,
        addGitignore,
      },
    };
  } catch (error) {
    warnings.push(`Invalid .pi/code-research.json: ${error instanceof Error ? error.message : String(error)}`);
    return defaults;
  }
}
