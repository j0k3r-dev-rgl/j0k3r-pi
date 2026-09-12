import { Type } from 'typebox';
import { generateSkillRegistry, writeSkillRegistry } from './registry.js';
import { renderSkillRegistryCall, renderSkillRegistryResult } from './render.js';
import { resolveSkillRegistry, type ResolveMatchReason, type ResolveSkillRegistryResult } from './resolve.js';

function formatResultLines(result: ResolveSkillRegistryResult): string[] {
  const lines = [
    `skill registry resolve: source ${result.registry_status.source}, cache ${result.registry_status.cache}`,
    `live hash: ${result.registry_status.live_hash.slice(0, 10)}...`,
    `paths: ${result.query.paths.join(', ') || 'none'}`,
    '',
  ];

  if (result.matches.length) {
    lines.push('direct matches:');
    for (const [index, match] of result.matches.entries()) {
      const role = index === 0 ? 'primary' : index <= 2 ? 'secondary' : 'direct';
      lines.push(
        `${match.score.toString().padStart(3, ' ')} · ${match.priority.toString().padStart(2, ' ')} · ${match.name} · ${match.path} · ${role}`,
      );
      const topReasons = match.reasons.slice(0, 3).map((reason: ResolveMatchReason) => reason.detail);
      lines.push(`  - reasons: ${topReasons.join(', ')}`);
      if (match.read_before_acting) lines.push(`  - ${match.read_before_acting}`);
    }
  }

  if (result.related_matches.length) {
    lines.push('', 'related matches:');
    for (const match of result.related_matches) {
      lines.push(`  - ${match.name} · ${match.path}`);
      lines.push(`    - related from: ${match.related_from.join(', ')}`);
      lines.push(`    - reasons: ${match.relation_reasons.join(', ')}`);
      lines.push(`    - ${match.read_before_acting}`);
    }
  }

  if (!result.guidance.length) return lines;
  lines.push('', 'guidance:');
  for (const item of result.guidance.slice(0, 4)) {
    lines.push(`- ${item}`);
  }

  if (result.warnings.length) {
    lines.push('', 'warnings:');
    const cappedWarnings = result.warnings.slice(0, 20);
    for (const warning of cappedWarnings) lines.push(`- ${warning}`);
    if (result.warnings.length > cappedWarnings.length) lines.push(`- ... and ${result.warnings.length - cappedWarnings.length} more warnings`);
  }

  return lines;
}

function ok(text: string, details: Record<string, unknown> = {}) {
  return { content: [{ type: 'text', text }], details };
}

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: 'text', text: message }], details: { error: message }, isError: true };
}

function resultFromDetails(details: unknown): ResolveSkillRegistryResult | undefined {
  if (!details || typeof details !== 'object') return undefined;
  const record = details as Partial<ResolveSkillRegistryResult>;
  if (!record.query || !record.registry_status || !Array.isArray(record.matches) || !Array.isArray(record.related_matches)) return undefined;
  return {
    query: record.query,
    registry_status: record.registry_status,
    matches: record.matches,
    related_matches: record.related_matches,
    warnings: Array.isArray(record.warnings) ? record.warnings : [],
    guidance: Array.isArray(record.guidance) ? record.guidance : [],
  } as ResolveSkillRegistryResult;
}

function summaryText(registry: Awaited<ReturnType<typeof generateSkillRegistry>>, writeResult?: { json_changed: boolean; markdown_changed: boolean; gitignore_changed?: boolean }) {
  const lines = [`skill registry: ${registry.skill_count} skill(s), ${registry.warnings.length} warning(s)`];
  if (writeResult) lines.push(`json ${writeResult.json_changed ? 'updated' : 'unchanged'}, markdown ${writeResult.markdown_changed ? 'updated' : 'unchanged'}, gitignore ${writeResult.gitignore_changed ? 'updated' : 'unchanged'}`);
  if (registry.warnings.length) lines.push('', 'warnings:', ...registry.warnings.slice(0, 20).map((warning) => `- ${warning}`));
  return lines.join('\n');
}

const SDD_PHASES = [
  'explore',
  'proposal',
  'spec',
  'design',
  'task',
  'apply',
  'verify',
  'archive',
] as const;

const sddPhaseSchema = Type.Union(SDD_PHASES.map((phase) => Type.Literal(phase)) as any);

export function registerSkillRegistryTools(pi: any): void {
  pi.registerTool({
    name: 'skill_registry_generate',
    label: 'Skill Registry Generate',
    description: 'Generate the project skill registry from global and project Pi/Agent skills. Stack-agnostic and dependency-free at runtime except this extension.',
    promptSnippet: 'Generate the skill registry before SDD planning/delegation when skills may affect routing.',
    promptGuidelines: [
      'Use skill_registry_generate before formal SDD planning or SDD subagent delegation when the active workflow requires fresh skill routing context.',
      'After skill_registry_generate, read selected SKILL.md files before relying on their detailed instructions.',
    ],
    parameters: Type.Object({
      write: Type.Optional(Type.Boolean({ description: 'Whether to write .pi/skill-registry.json and .pi/skill-registry.md. Defaults to true.' })),
    }),
    renderShell: 'self',
    renderCall(args: any, theme: any, context: any) {
      return renderSkillRegistryCall('skill_registry_generate', args, theme, context);
    },
    renderResult(result: any, options: any, theme: any, context: any) {
      return renderSkillRegistryResult('skill_registry_generate', result, options, theme, context);
    },
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

  pi.registerTool({
    name: 'skill_registry_resolve',
    label: 'Skill Registry Resolve',
    description: 'Resolve candidate skills from the live registry for intent/paths/sdd phase with read-only cache-awareness.',
    promptSnippet: 'Read-only skill routing helper for matching intent, touched paths, and SDD phase. The output is a routing candidate index, not a playbook.',
    promptGuidelines: [
      'Use skill_registry_resolve when you need candidate skills before taking routing decisions.',
      'Read the returned SKILL.md files before acting.',
      'Read selected SKILL.md files before acting on any skill guidance.',
    ],
    parameters: Type.Object({
      intent: Type.Optional(Type.String({ description: 'Natural-language routing intent.' })),
      paths: Type.Optional(Type.Array(Type.String(), { description: 'Project paths to match against skill path triggers.' })),
      sdd_phase: Type.Optional(sddPhaseSchema),
      include_related: Type.Optional(Type.Boolean({ description: 'Include one-hop related skills. Defaults to true.' })),
      stale_check: Type.Optional(Type.Boolean({ description: 'Compare live registry hash with cached .pi/skill-registry.json. Defaults to true.' })),
      max_results: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, description: 'Maximum number of direct matches. Defaults to 10.' })),
    }),
    renderShell: 'self',
    renderCall(args: any, theme: any, context: any) {
      return renderSkillRegistryCall('skill_registry_resolve', args, theme, context);
    },
    renderResult(result: any, options: any, theme: any, context: any) {
      return renderSkillRegistryResult('skill_registry_resolve', result, options, theme, context);
    },
    async execute(_id: string, params: { intent?: string; paths?: string[]; sdd_phase?: typeof SDD_PHASES[number]; include_related?: boolean; stale_check?: boolean; max_results?: number } | undefined, _signal: unknown, _onUpdate: unknown, ctx: any) {
      try {
        const cwd = ctx?.cwd ?? process.cwd();
        const homeDir = ctx?.homeDir;
        const result = await resolveSkillRegistry({ cwd, homeDir, query: params });
        const text = formatResultLines(result).join('\n');
        return ok(text, { query: result.query, matches: result.matches, related_matches: result.related_matches, registry_status: result.registry_status, warnings: result.warnings, guidance: result.guidance });
      } catch (error) {
        return fail(error);
      }
    },
  });
}
