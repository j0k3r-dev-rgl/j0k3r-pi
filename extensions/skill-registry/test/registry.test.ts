import { mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { generateSkillRegistry, writeSkillRegistry } from '../src/registry.js';

async function makeSkill(filePath: string, input: { name: string; description: string; contract?: Record<string, unknown> }) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const contract = input.contract ?? {};
  const triggerRecord = contract.triggers && typeof contract.triggers === 'object' && !Array.isArray(contract.triggers)
    ? contract.triggers as { paths?: string[]; keywords?: string[] }
    : {};
  const body = [
    '---',
    `name: ${input.name}`,
    `description: ${JSON.stringify(input.description)}`,
    'metadata:',
    '  version: "1.0"',
  ];
  if (input.contract) {
    body.push(
      'registry:',
      `  category: ${String(contract.category ?? '')}`,
      `  domains: ${Array.isArray(contract.domains) ? contract.domains.join(', ') : ''}`,
      `  paths: ${Array.isArray(triggerRecord.paths) ? triggerRecord.paths.join(', ') : ''}`,
      `  keywords: ${Array.isArray(triggerRecord.keywords) ? triggerRecord.keywords.join(', ') : ''}`,
      `  phases: ${Array.isArray(contract.sdd_phases) ? contract.sdd_phases.join(', ') : ''}`,
      `  related: ${Array.isArray(contract.related_skills) ? contract.related_skills.join(', ') : ''}`,
      `  priority: ${String(contract.priority ?? '')}`,
    );
  }
  body.push('---', '', `# ${input.name}`, '', '## Activation Contract', '', 'Use this skill when relevant.', '');
  await writeFile(filePath, body.join('\n'), 'utf8');
}

describe('skill registry core', () => {
  it('generates a deterministic registry from project and global skills', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skill-registry-'));
    const cwd = path.join(root, 'project');
    const homeDir = path.join(root, 'home');

    await makeSkill(path.join(cwd, '.agents/skills/base/forms/SKILL.md'), {
      name: 'project-forms',
      description: 'changes in forms and fetcher flows.',
      contract: {
        category: 'base',
        domains: ['frontend', 'forms'],
        triggers: { paths: ['front/app/routes/**/*.tsx'], keywords: ['useFetcher', 'fetcher.Form'] },
        sdd_phases: ['explore', 'design', 'apply', 'verify'],
        related_skills: ['project-testing'],
        priority: 70,
      },
    });
    await makeSkill(path.join(homeDir, '.pi/agent/skills/global-testing/SKILL.md'), {
      name: 'global-testing',
      description: 'changes in tests or validation strategy.',
      contract: {
        category: 'quality',
        domains: ['testing'],
        triggers: { paths: ['**/*.test.*'], keywords: ['test', 'validation'] },
        sdd_phases: ['task', 'verify'],
        related_skills: [],
        priority: 40,
      },
    });

    const registry = await generateSkillRegistry({ cwd, homeDir });

    expect(registry.schema_version).toBe(1);
    expect(registry.skills.map((skill) => skill.name)).toEqual(['project-forms', 'global-testing']);
    expect(registry.skills[0]).toMatchObject({
      scope: 'project',
      path: '.agents/skills/base/forms/SKILL.md',
      registry_contract: {
        category: 'base',
        domains: ['frontend', 'forms'],
        triggers: { paths: ['front/app/routes/**/*.tsx'], keywords: ['useFetcher', 'fetcher.Form'] },
        sdd_phases: ['explore', 'design', 'apply', 'verify'],
        related_skills: ['project-testing'],
        priority: 70,
      },
      routing: {
        category: 'base',
        domains: ['frontend', 'forms'],
        triggers: { paths: ['front/app/routes/**/*.tsx'], keywords: ['useFetcher', 'fetcher.Form'] },
        sdd_phases: ['explore', 'design', 'apply', 'verify'],
        related_skills: ['project-testing'],
        priority: 70,
      },
    });
    expect(registry.skills[1].path).toMatch(/^~\//);
    expect(registry.warnings).toEqual([]);
    expect(registry.content_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('follows pi discovery rules for root markdown files', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skill-registry-'));
    const cwd = path.join(root, 'project');
    const homeDir = path.join(root, 'home');

    await mkdir(path.join(cwd, '.agents/skills'), { recursive: true });
    await writeFile(path.join(cwd, '.agents/skills/README.md'), '# ignored readme\n', 'utf8');
    await makeSkill(path.join(cwd, '.pi/skills/root-skill.md'), {
      name: 'root-pi-skill',
      description: 'direct root markdown under .pi skills is a pi skill.',
      contract: {
        category: 'workflow',
        domains: ['root'],
        triggers: { paths: [], keywords: ['root'] },
        sdd_phases: ['explore'],
        related_skills: [],
        priority: 10,
      },
    });

    const registry = await generateSkillRegistry({ cwd, homeDir });

    expect(registry.skills.map((skill) => skill.name)).toEqual(['root-pi-skill']);
  });

  it('ignores skills without registry metadata without warnings', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skill-registry-'));
    const cwd = path.join(root, 'project');
    const homeDir = path.join(root, 'home');

    await makeSkill(path.join(cwd, '.pi/skills/basic/SKILL.md'), {
      name: 'basic-skill',
      description: 'basic project skill without registry metadata.',
    });

    const registry = await generateSkillRegistry({ cwd, homeDir });

    expect(registry.skills).toEqual([]);
    expect(registry.warnings).toEqual([]);
  });

  it('writes json and markdown only when generated content changes', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skill-registry-'));
    const cwd = path.join(root, 'project');
    const homeDir = path.join(root, 'home');

    await makeSkill(path.join(cwd, '.pi/skills/testing/SKILL.md'), {
      name: 'project-testing',
      description: 'changes in tests.',
      contract: {
        category: 'quality',
        domains: ['testing'],
        triggers: { paths: ['**/*.test.*'], keywords: ['test'] },
        sdd_phases: ['task', 'verify'],
        related_skills: [],
        priority: 50,
      },
    });

    const registry = await generateSkillRegistry({ cwd, homeDir });
    const first = await writeSkillRegistry({ cwd, registry });
    const second = await writeSkillRegistry({ cwd, registry });

    expect(first).toEqual({ json_changed: true, markdown_changed: true, gitignore_changed: false });
    expect(second).toEqual({ json_changed: false, markdown_changed: false, gitignore_changed: false });

    const json = JSON.parse(await readFile(path.join(cwd, '.pi/skill-registry.json'), 'utf8'));
    const markdown = await readFile(path.join(cwd, '.pi/skill-registry.md'), 'utf8');
    const jsonStat = await stat(path.join(cwd, '.pi/skill-registry.json'));

    expect(json.skills[0].name).toBe('project-testing');
    expect(markdown).toContain('# Skill Registry');
    expect(jsonStat.size).toBeGreaterThan(0);
  });

  it('adds generated registry files to an existing gitignore without duplicating entries', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skill-registry-'));
    const cwd = path.join(root, 'project');
    const homeDir = path.join(root, 'home');
    await mkdir(cwd, { recursive: true });
    await writeFile(path.join(cwd, '.gitignore'), 'node_modules/\n', 'utf8');
    const registry = await generateSkillRegistry({ cwd, homeDir });

    const first = await writeSkillRegistry({ cwd, registry });
    const second = await writeSkillRegistry({ cwd, registry });
    const gitignore = await readFile(path.join(cwd, '.gitignore'), 'utf8');

    expect(first.gitignore_changed).toBe(true);
    expect(second.gitignore_changed).toBe(false);
    expect(gitignore.match(/^\.pi\/skill-registry\.json$/gm)).toHaveLength(1);
    expect(gitignore.match(/^\.pi\/skill-registry\.md$/gm)).toHaveLength(1);
  });

  it('does not create gitignore when the project has none', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skill-registry-'));
    const cwd = path.join(root, 'project');
    const homeDir = path.join(root, 'home');
    await mkdir(cwd, { recursive: true });
    const registry = await generateSkillRegistry({ cwd, homeDir });

    const result = await writeSkillRegistry({ cwd, registry });

    expect(result.gitignore_changed).toBe(false);
    expect(existsSync(path.join(cwd, '.gitignore'))).toBe(false);
  });
});
