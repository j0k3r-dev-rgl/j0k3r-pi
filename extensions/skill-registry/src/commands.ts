import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { generateSkillRegistry, writeSkillRegistry, type SkillRegistry } from './registry.js';

function compactSkillList(registry: SkillRegistry, limit = 30): string {
  const lines = registry.skills.slice(0, limit).map((skill) => {
    const category = skill.routing.category ?? 'n/a';
    const domains = skill.routing.domains.length ? skill.routing.domains.join(',') : 'n/a';
    return `- ${skill.name} · ${skill.scope} · p${skill.routing.priority} · ${category} · ${domains}`;
  });
  if (registry.skills.length > limit) lines.push(`- ... ${registry.skills.length - limit} more`);
  return lines.join('\n') || 'No skills found.';
}

function resultSummary(registry: SkillRegistry, writeResult?: { json_changed: boolean; markdown_changed: boolean; gitignore_changed?: boolean }): string {
  return [
    `skill registry: ${registry.skill_count} skill(s), ${registry.warnings.length} warning(s)`,
    writeResult ? `json ${writeResult.json_changed ? 'updated' : 'unchanged'}, markdown ${writeResult.markdown_changed ? 'updated' : 'unchanged'}, gitignore ${writeResult.gitignore_changed ? 'updated' : 'unchanged'}` : undefined,
    registry.warnings.length ? `warnings:\n${registry.warnings.slice(0, 20).map((warning) => `- ${warning}`).join('\n')}` : undefined,
  ].filter(Boolean).join('\n');
}

async function readExistingRegistry(cwd: string): Promise<SkillRegistry | undefined> {
  try {
    return JSON.parse(await readFile(path.join(cwd, '.pi', 'skill-registry.json'), 'utf8')) as SkillRegistry;
  } catch {
    return undefined;
  }
}

export function registerSkillRegistryCommands(pi: any): void {
  pi.registerCommand?.('skill-registry', {
    description: 'Generate, status, or list the project skill registry',
    handler: async (args: string, ctx: any) => {
      const cwd = ctx?.cwd ?? process.cwd();
      const [action = 'generate'] = (args ?? '').trim().split(/\s+/).filter(Boolean);
      try {
        if (action === 'generate' || action === 'refresh' || action === 'write') {
          const registry = await generateSkillRegistry({ cwd });
          const writeResult = await writeSkillRegistry({ cwd, registry });
          ctx.ui?.notify?.(resultSummary(registry, writeResult), registry.warnings.length ? 'warning' : 'info');
          return;
        }
        if (action === 'status') {
          const existing = await readExistingRegistry(cwd);
          if (!existing) {
            ctx.ui?.notify?.('No .pi/skill-registry.json found. Run /skill-registry generate.', 'warning');
            return;
          }
          ctx.ui?.notify?.(`skill registry: ${existing.skill_count} skill(s), ${existing.warnings.length} warning(s)\nhash: ${existing.content_hash}`, existing.warnings.length ? 'warning' : 'info');
          return;
        }
        if (action === 'list') {
          const registry = await readExistingRegistry(cwd) ?? await generateSkillRegistry({ cwd });
          ctx.ui?.notify?.(compactSkillList(registry), 'info');
          return;
        }
        ctx.ui?.notify?.('Usage: /skill-registry [generate|status|list]', 'warning');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui?.notify?.(`skill-registry failed: ${message}`, 'error');
      }
    },
  });
}
