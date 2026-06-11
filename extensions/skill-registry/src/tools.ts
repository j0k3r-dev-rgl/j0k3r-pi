import { Type } from 'typebox';
import { generateSkillRegistry, writeSkillRegistry } from './registry.js';

function ok(text: string, details: Record<string, unknown> = {}) {
  return { content: [{ type: 'text', text }], details };
}

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: 'text', text: message }], details: { error: message }, isError: true };
}

function summaryText(registry: Awaited<ReturnType<typeof generateSkillRegistry>>, writeResult?: { json_changed: boolean; markdown_changed: boolean }) {
  const lines = [`skill registry: ${registry.skill_count} skill(s), ${registry.warnings.length} warning(s)`];
  if (writeResult) lines.push(`json ${writeResult.json_changed ? 'updated' : 'unchanged'}, markdown ${writeResult.markdown_changed ? 'updated' : 'unchanged'}`);
  if (registry.warnings.length) lines.push('', 'warnings:', ...registry.warnings.slice(0, 20).map((warning) => `- ${warning}`));
  return lines.join('\n');
}

export function registerSkillRegistryTools(pi: any): void {
  pi.registerTool({
    name: 'skill_registry_generate',
    label: 'Skill Registry Generate',
    description: 'Generate the project skill registry from global and project Pi/Agent skills. Stack-agnostic and dependency-free at runtime except this extension.',
    promptSnippet: 'Generate or refresh the skill registry before SDD planning/delegation when skills may affect routing.',
    promptGuidelines: [
      'Use skill_registry_generate before formal SDD planning or SDD subagent delegation when the active workflow requires fresh skill routing context.',
      'After skill_registry_generate, read selected SKILL.md files before relying on their detailed instructions.',
    ],
    parameters: Type.Object({
      write: Type.Optional(Type.Boolean({ description: 'Whether to write .pi/skill-registry.json and .pi/skill-registry.md. Defaults to true.' })),
    }),
    async execute(_id: string, params: { write?: boolean } | undefined, _signal: unknown, _onUpdate: unknown, ctx: any) {
      try {
        const cwd = ctx?.cwd ?? process.cwd();
        const registry = await generateSkillRegistry({ cwd });
        const write = params?.write !== false;
        const result = write ? await writeSkillRegistry({ cwd, registry }) : undefined;
        return ok(summaryText(registry, result), { registry, write_result: result ?? null });
      } catch (error) {
        return fail(error);
      }
    },
  });
}
