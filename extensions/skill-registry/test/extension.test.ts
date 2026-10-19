import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import skillRegistryExtension from '../index.js';

async function createSkill(filePath: string, name: string, description: string) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const body = [
    '---',
    `name: ${name}`,
    `description: ${JSON.stringify(description)}`,
    'metadata:',
    '  version: "1.0"',
    'registry:',
    '  category: workflow',
    '  domains: routing',
    '  paths: front/app/**/*.tsx',
    `  keywords: routing, ${name}`,
    '  phases: apply, verify',
    '  related: other',
    '  priority: 55',
    '---',
    '',
    `# ${name}`,
    '',
    '## Activation Contract',
    '',
    'Use when routing changes.',
    '',
  ].join('\n');
  await writeFile(filePath, body, 'utf8');
}

async function withTempCwd<T>(runner: (cwd: string) => Promise<T>, enabled = true): Promise<T> {
  const root = await mkdtemp(path.join(tmpdir(), 'skill-registry-extension-test-'));
  const cwd = path.join(root, 'project');
  await mkdir(cwd, { recursive: true });
  await mkdir(path.join(cwd, '.pi'), { recursive: true });
  if (enabled) {
    await writeFile(path.join(cwd, '.pi/skill-registry.config.json'), JSON.stringify({ enabled: true }), 'utf8');
  }
  const originalCwd = process.cwd();
  process.chdir(cwd);
  try {
    return await runner(cwd);
  } finally {
    process.chdir(originalCwd);
    await rm(root, { recursive: true, force: true });
  }
}

describe('skill registry extension', () => {
  it('registers command and llm-callable tools when enabled', () => {
    const tools: any[] = [];
    const commands: Record<string, any> = {};
    const pi = {
      registerTool: vi.fn((tool: any) => tools.push(tool)),
      registerCommand: vi.fn((name: string, command: any) => { commands[name] = command; }),
    };

    return withTempCwd(async () => {
      skillRegistryExtension(pi);

      expect(pi.registerTool).toHaveBeenCalledWith(expect.objectContaining({ name: 'skill_registry_generate' }));
      expect(pi.registerTool).toHaveBeenCalledWith(expect.objectContaining({ name: 'skill_registry_resolve' }));
      expect(pi.registerCommand).toHaveBeenCalledWith('skill-registry', expect.objectContaining({ description: expect.any(String), handler: expect.any(Function) }));
      expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(['skill_registry_generate', 'skill_registry_resolve']));
      expect(commands['skill-registry']).toBeTruthy();
      const generateTool = tools.find((tool) => tool.name === 'skill_registry_generate');
      expect(generateTool.promptSnippet).toMatch(/maintenance/i);
      expect(generateTool.promptGuidelines.join(' ')).toContain('skill_registry_resolve');
      expect(generateTool.promptGuidelines.join(' ')).toContain('explicit authorization');
      expect(generateTool.promptGuidelines.join(' ')).not.toContain('before formal workflow planning');
    });
  });

  it('registers resolver tool with read-before-acting guidance', async () => {
    const tools: any[] = [];
    const commands: Record<string, any> = {};
    const pi = {
      registerTool: vi.fn((tool: any) => tools.push(tool)),
      registerCommand: vi.fn((name: string, command: any) => { commands[name] = command; }),
    };

    await withTempCwd(async (cwd) => {
      const homeDir = path.join(path.dirname(cwd), 'home');
      await createSkill(path.join(cwd, '.pi/skills/basic/SKILL.md'), 'resolver-test', 'routing test skill');

      skillRegistryExtension(pi);

      const resolveTool = tools.find((tool) => tool.name === 'skill_registry_resolve');
      expect(resolveTool).toMatchObject({
        name: 'skill_registry_resolve',
        label: 'Skill Registry Resolve',
        description: expect.stringContaining('Resolve candidate'),
        parameters: expect.any(Object),
      });

      const promptGuidelines = resolveTool?.promptGuidelines?.join('\n') ?? '';
      expect(promptGuidelines).toContain('Read selected SKILL.md files before acting');
      expect(resolveTool?.promptSnippet).toMatch(/Read-only/i);
      expect(promptGuidelines).toContain('include_related:false');
      expect(promptGuidelines).not.toContain('Read the returned SKILL.md');

      const piDirectory = path.join(cwd, '.pi');
      const cachePath = path.join(piDirectory, 'skill-registry.json');
      const staleCache = JSON.stringify({ schema_version: 2, skills: [], skill_count: 0, content_hash: 'old-cache' });
      await writeFile(cachePath, staleCache, 'utf8');
      const beforeEntries = await readdir(piDirectory);
      const result = await resolveTool?.execute('id', { intent: 'resolver-test', include_related: false }, undefined, undefined, { cwd, homeDir });
      expect(result?.content?.[0]?.text).toContain('skill registry resolve');
      expect(Array.isArray(result?.details?.matches)).toBe(true);
      expect(result?.details?.matches?.[0]?.read_before_acting).toContain('Read .pi/skills/basic/SKILL.md before acting');
      expect(result?.details?.guidance?.join(' ')).toContain('Read selected SKILL.md');
      expect(result?.details?.guidance?.join(' ')).not.toContain('Read each returned');
      expect(result?.details?.warnings?.join(' ')).toContain('Routing uses live sources; no refresh is required');
      expect(result?.details?.query?.include_related).toBe(false);
      expect(result?.details?.related_matches).toEqual([]);
      expect(await readdir(piDirectory)).toEqual(beforeEntries);
      expect(await readFile(cachePath, 'utf8')).toBe(staleCache);
      expect(commands['skill-registry']).toBeTruthy();
    });
  });

  it('renders resolver results compactly until native tool expansion is enabled', async () => {
    const tools: any[] = [];
    const pi = {
      registerTool: vi.fn((tool: any) => tools.push(tool)),
      registerCommand: vi.fn(),
    };

    await withTempCwd(async (cwd) => {
      const homeDir = path.join(path.dirname(cwd), 'home');
      await createSkill(path.join(cwd, '.pi/skills/basic/SKILL.md'), 'resolver-test', 'routing test skill');

      skillRegistryExtension(pi);
      const resolveTool = tools.find((tool) => tool.name === 'skill_registry_resolve');
      const result = await resolveTool?.execute('id', { intent: 'resolver-test' }, undefined, undefined, { cwd, homeDir });

      const theme = {
        fg: (_name: string, text: string) => text,
        bold: (text: string) => text,
      };

      const collapsed = resolveTool.renderResult(result, { expanded: false, isPartial: false }, theme, {}).render(120).join('\n');
      expect(collapsed).toContain('skill registry');
      expect(collapsed).toContain('direct');
      expect(collapsed).toMatch(/Ctrl\+O|ctrl\+o/i);
      expect(collapsed.split('\n').length).toBeLessThan(5);
      expect(collapsed).not.toContain('.pi/skills/basic/SKILL.md');
      expect(collapsed).not.toContain('reasons:');

      const expanded = resolveTool.renderResult(result, { expanded: true, isPartial: false }, theme, {}).render(120).join('\n');
      expect(expanded).toContain('.pi/skills/basic/SKILL.md');
      expect(expanded).toContain('reasons:');
      expect(expanded).toContain('Read .pi/skills/basic/SKILL.md before acting');
    });
  });

  it('is disabled by default when config is missing', () => {
    const tools: any[] = [];
    const commands: Record<string, any> = {};
    const pi = {
      registerTool: vi.fn((tool: any) => tools.push(tool)),
      registerCommand: vi.fn((name: string, command: any) => { commands[name] = command; }),
    };

    return withTempCwd(async () => {
      skillRegistryExtension(pi);
      expect(tools).toHaveLength(0);
      expect(commands).toEqual({});
    }, false);
  });
});
