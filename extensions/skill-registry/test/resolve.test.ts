import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  getRegistryStatus,
  matchPathGlob,
  readCachedSkillRegistry,
  resolveSkillRegistry,
  type ResolveMatchReason,
  type ResolveSkillMatch,
} from '../src/resolve.js';
import { generateSkillRegistry, writeSkillRegistry } from '../src/registry.js';

type Contract = Record<string, unknown>;

async function makeSkill(filePath: string, input: { name: string; description: string; contract?: Contract }) {
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

async function createProject() {
  const root = await mkdtemp(path.join(tmpdir(), 'skill-registry-resolve-'));
  return { cwd: path.join(root, 'project'), homeDir: path.join(root, 'home') };
}

function pickFirstReason(match: ResolveSkillMatch, signal: string): ResolveMatchReason | undefined {
  return match.reasons.find((reason) => reason.signal === signal);
}

describe('matchPathGlob', () => {
  it('supports single-segment wildcards', () => {
    expect(matchPathGlob('front/app/routes/*.tsx', 'front/app/routes/index.tsx')).toBe(true);
    expect(matchPathGlob('front/app/routes/*.tsx', 'front/app/routes/admin/index.tsx')).toBe(false);
  });

  it('supports multi-segment wildcards', () => {
    expect(matchPathGlob('front/app/routes/**/*.tsx', 'front/app/routes/index.tsx')).toBe(true);
    expect(matchPathGlob('front/app/routes/**/*.tsx', 'front/app/routes/admin/index.tsx')).toBe(true);
    expect(matchPathGlob('front/app/routes/**/*.tsx', 'front/app/other/index.tsx')).toBe(false);
  });

  it('supports **/*.test.* and backslash-normalized candidates', () => {
    expect(matchPathGlob('**/*.test.*', 'test/registry.test.ts')).toBe(true);
    expect(matchPathGlob('**/*.test.*', 'registry.test.ts')).toBe(true);
    expect(matchPathGlob('**/*.test.*', 'test\\registry\\registry.test.ts')).toBe(true);
    expect(matchPathGlob('front/app/routes/index.tsx', 'front\\app\\routes\\index.tsx')).toBe(true);
  });
});

describe('resolveSkillRegistry', () => {
  it('scores direct path-trigger matches above fallback-only matches', async () => {
    const { cwd, homeDir } = await createProject();

    await makeSkill(path.join(cwd, '.pi/skills/route-handler/SKILL.md'), {
      name: 'route-handler',
      description: 'core orchestration',
      contract: {
        category: 'workflow',
        domains: ['routing'],
        triggers: {
          paths: ['front/app/routes/**/*.tsx'],
          keywords: ['unused'],
        },
        sdd_phases: [],
        related_skills: [],
        priority: 20,
      },
    });
    await makeSkill(path.join(cwd, '.pi/skills/fallback-only/SKILL.md'), {
      name: 'fallback-only',
      description: 'routing utility for front app',
      contract: {
        category: 'workflow',
        domains: ['routing'],
        triggers: {
          paths: ['docs/**/*.md'],
          keywords: ['other'],
        },
        sdd_phases: [],
        related_skills: [],
        priority: 100,
      },
    });

    const liveRegistry = await generateSkillRegistry({ cwd, homeDir });
    expect(liveRegistry.skill_count).toBe(2);

    const result = await resolveSkillRegistry({
      cwd,
      homeDir,
      query: {
        paths: ['front\\app\\routes\\index.tsx'],
        stale_check: false,
        include_related: false,
      },
    });

    expect(result.matches.map((match) => match.name)).toEqual(['route-handler']);
    expect(result.matches[0].score).toBeGreaterThan(0);
    expect(pickFirstReason(result.matches[0], 'path')).toBeDefined();
  });

  it('excludes fallback-only skills when a direct intent match exists', async () => {
    const { cwd, homeDir } = await createProject();

    await makeSkill(path.join(cwd, '.pi/skills/direct/SKILL.md'), {
      name: 'direct',
      description: 'specific configuration',
      contract: {
        category: 'runtime',
        domains: ['configuration'],
        triggers: {
          paths: ['direct/**'],
          keywords: ['specific configuration'],
        },
        sdd_phases: [],
        related_skills: [],
        priority: 20,
      },
    });
    await makeSkill(path.join(cwd, '.pi/skills/fallback/SKILL.md'), {
      name: 'fallback',
      description: 'runtime configuration helper',
      contract: {
        category: 'runtime',
        domains: ['configuration'],
        triggers: {
          paths: ['other/**'],
          keywords: ['unrelated'],
        },
        sdd_phases: [],
        related_skills: [],
        priority: 100,
      },
    });

    const result = await resolveSkillRegistry({
      cwd,
      homeDir,
      query: {
        intent: 'specific configuration',
        stale_check: false,
        include_related: false,
      },
    });

    expect(result.matches.map((match) => match.name)).toEqual(['direct']);
    expect(result.matches[0].reasons.some((reason) => reason.signal === 'keyword')).toBe(true);
  });

  it('applies deterministic ordering by score, priority, then name', async () => {
    const { cwd, homeDir } = await createProject();

    await makeSkill(path.join(cwd, '.pi/skills/zzz-skill/SKILL.md'), {
      name: 'zzz-skill',
      description: 'shared resolve intent',
      contract: {
        category: 'quality',
        domains: ['routing'],
        triggers: {
          keywords: ['resolve'],
        },
        sdd_phases: [],
        related_skills: [],
        priority: 10,
      },
    });

    await makeSkill(path.join(cwd, '.pi/skills/aaa-skill/SKILL.md'), {
      name: 'aaa-skill',
      description: 'shared resolve intent',
      contract: {
        category: 'quality',
        domains: ['routing'],
        triggers: {
          keywords: ['resolve'],
        },
        sdd_phases: [],
        related_skills: [],
        priority: 10,
      },
    });

    await makeSkill(path.join(cwd, '.pi/skills/zzz2/SKILL.md'), {
      name: 'zzz2',
      description: 'shared resolve intent',
      contract: {
        category: 'quality',
        domains: ['routing'],
        triggers: {
          keywords: ['resolve'],
        },
        sdd_phases: [],
        related_skills: [],
        priority: 30,
      },
    });

    const result = await resolveSkillRegistry({
      cwd,
      homeDir,
      query: {
        intent: 'resolve',
        stale_check: false,
        include_related: false,
      },
    });

    expect(result.matches.map((match) => match.name)).toEqual(['zzz2', 'aaa-skill', 'zzz-skill']);
    expect(result.matches.every((match) => match.reasons.some((reason) => reason.signal === 'keyword'))).toBe(true);
  });

  it('supports sparse query (intent only) with defaulted include_related/stale_check/max_results', async () => {
    const { cwd, homeDir } = await createProject();

    await makeSkill(path.join(cwd, '.pi/skills/basic/SKILL.md'), {
      name: 'basic',
      description: 'utility skill',
      contract: {
        category: 'utility',
        domains: ['utility'],
        triggers: {
          keywords: ['utility'],
        },
        sdd_phases: ['apply'],
        related_skills: [],
        priority: 30,
      },
    });

    const result = await resolveSkillRegistry({
      cwd,
      homeDir,
      query: {
        intent: 'utility',
      },
    });

    expect(result.query.include_related).toBe(true);
    expect(result.query.stale_check).toBe(true);
    expect(result.query.max_results).toBe(10);
    expect(result.matches[0]).toMatchObject({
      name: 'basic',
      path: '.pi/skills/basic/SKILL.md',
      scope: 'project',
      priority: 30,
      score: expect.any(Number),
      reasons: expect.any(Array),
      routing: {
        category: 'utility',
        domains: ['utility'],
        triggers: { keywords: ['utility'] },
        sdd_phases: ['apply'],
        related_skills: [],
      },
      read_before_acting: expect.stringContaining('Read .pi/skills/basic/SKILL.md before acting'),
    } as ResolveSkillMatch);
    expect(result.guidance.some((line) => line.includes('SKILL.md'))).toBe(true);
  });

  it('returns highest-priority defaults when no query signals are supplied', async () => {
    const { cwd, homeDir } = await createProject();

    for (let index = 0; index < 12; index += 1) {
      await makeSkill(path.join(cwd, `.pi/skills/skill-${index}/SKILL.md`), {
        name: `skill-${index}`,
        description: `utility skill ${index}`,
        contract: {
          category: 'utility',
          domains: ['routing'],
          triggers: {
            keywords: [`keyword-${index}`],
          },
          sdd_phases: [],
          related_skills: [],
          priority: index,
        },
      });
    }

    const result = await resolveSkillRegistry({
      cwd,
      homeDir,
      query: {
        stale_check: false,
        include_related: false,
        max_results: 5,
      },
    });

    expect(result.matches.length).toBe(5);
    expect(result.matches.every((match) => match.score === 0)).toBe(true);
    expect(result.matches[0].reasons).toEqual([{ signal: 'default', detail: 'No query signals supplied; returning highest-priority skills.', weight: 0 }]);
    expect(result.matches.map((match) => match.name)).toEqual(['skill-11', 'skill-10', 'skill-9', 'skill-8', 'skill-7']);
  });

  it('limits direct matches by max_results and keeps deterministic tiebreakers by priority and name', async () => {
    const { cwd, homeDir } = await createProject();

    await makeSkill(path.join(cwd, '.pi/skills/beta/SKILL.md'), {
      name: 'beta',
      description: 'intent keyword',
      contract: {
        category: 'quality',
        domains: ['routing'],
        triggers: { keywords: ['intent'] },
        sdd_phases: [],
        related_skills: [],
        priority: 10,
      },
    });

    await makeSkill(path.join(cwd, '.pi/skills/alpha/SKILL.md'), {
      name: 'alpha',
      description: 'intent keyword',
      contract: {
        category: 'quality',
        domains: ['routing'],
        triggers: { keywords: ['intent'] },
        sdd_phases: [],
        related_skills: [],
        priority: 10,
      },
    });

    const result = await resolveSkillRegistry({
      cwd,
      homeDir,
      query: {
        intent: 'intent',
        stale_check: false,
        include_related: false,
        max_results: 1,
      },
    });

    expect(result.matches.length).toBe(1);
    expect(result.matches[0].name).toBe('alpha');
  });

  it('adds one-hop related matches, dedupes direct duplicates, and reports unresolved relation warnings', async () => {
    const { cwd, homeDir } = await createProject();

    await makeSkill(path.join(cwd, '.pi/skills/primary/SKILL.md'), {
      name: 'primary',
      description: 'primary candidate',
      contract: {
        category: 'workflow',
        domains: ['routing'],
        triggers: { keywords: ['primary'] },
        sdd_phases: [],
        related_skills: ['helper', 'missing-helper'],
        priority: 80,
      },
    });

    await makeSkill(path.join(cwd, '.pi/skills/helper/SKILL.md'), {
      name: 'helper',
      description: 'supporting helper',
      contract: {
        category: 'workflow',
        domains: ['routing'],
        triggers: { keywords: ['helper'] },
        sdd_phases: [],
        related_skills: ['support'],
        priority: 70,
      },
    });

    await makeSkill(path.join(cwd, '.pi/skills/support/SKILL.md'), {
      name: 'support',
      description: 'deep helper',
      contract: {
        category: 'workflow',
        domains: ['routing'],
        triggers: { keywords: ['support'] },
        sdd_phases: [],
        related_skills: [],
        priority: 60,
      },
    });

    await makeSkill(path.join(cwd, '.pi/skills/other/SKILL.md'), {
      name: 'other',
      description: 'other direct helper query candidate',
      contract: {
        category: 'workflow',
        domains: ['routing'],
        triggers: { keywords: ['helper'] },
        sdd_phases: [],
        related_skills: ['helper'],
        priority: 90,
      },
    });

    const withRelated = await resolveSkillRegistry({
      cwd,
      homeDir,
      query: {
        intent: 'primary',
        stale_check: false,
      },
    });

    const relatedNames = withRelated.related_matches.map((match) => match.name);
    expect(withRelated.matches.map((match) => match.name)).toEqual(['primary']);
    expect(relatedNames).toEqual(['helper']);
    expect(withRelated.related_matches[0]).toMatchObject({
      name: 'helper',
      related_from: ['primary'],
      relation_reasons: ['related_skills reference'],
    } as Pick<ResolveSkillMatch, 'name'> & { related_from: string[]; relation_reasons: string[] });
    expect(withRelated.warnings).toContain('Related skill not found: missing-helper');

    const disabledRelated = await resolveSkillRegistry({
      cwd,
      homeDir,
      query: {
        intent: 'primary',
        stale_check: false,
        include_related: false,
      },
    });

    expect(disabledRelated.related_matches).toEqual([]);

    const dedupeExpected = await resolveSkillRegistry({
      cwd,
      homeDir,
      query: {
        intent: 'helper',
        stale_check: false,
        include_related: true,
      },
    });

    expect(dedupeExpected.matches.map((match) => match.name)).toEqual(['helper', 'other']);
    expect(dedupeExpected.related_matches.map((match) => match.name)).toEqual(['support']);
  });

  it('reports cache status for missing, stale, fresh, invalid, and not_checked without writing files', async () => {
    const { cwd, homeDir } = await createProject();
    const cachePath = path.join(cwd, '.pi', 'skill-registry.json');

    await makeSkill(path.join(cwd, '.pi/skills/testing/SKILL.md'), {
      name: 'testing',
      description: 'testing skill',
      contract: {
        category: 'quality',
        domains: ['testing'],
        triggers: { keywords: ['test'] },
        sdd_phases: ['verify'],
        related_skills: [],
        priority: 20,
      },
    });

    const missing = await resolveSkillRegistry({
      cwd,
      homeDir,
      query: {
        intent: 'test',
        include_related: false,
        stale_check: true,
      },
    });

    expect(missing.registry_status.cache).toBe('missing');
    expect(missing.warnings.join(' ')).toContain('Missing ');
    expect(existsSync(cachePath)).toBe(false);

    const liveRegistry = await generateSkillRegistry({ cwd, homeDir });
    await writeSkillRegistry({ cwd, registry: liveRegistry });
    const cacheBeforeResolve = await readFile(cachePath, 'utf8');

    const fresh = await resolveSkillRegistry({
      cwd,
      homeDir,
      query: {
        intent: 'test',
        include_related: false,
        stale_check: true,
      },
    });
    expect(fresh.registry_status.cache).toBe('fresh');
    expect(fresh.registry_status.cached_hash).toBe(fresh.registry_status.live_hash);
    expect(await readFile(cachePath, 'utf8')).toBe(cacheBeforeResolve);

    const cached = JSON.parse(cacheBeforeResolve) as { content_hash: string };
    cached.content_hash = 'deadbeef';
    await writeFile(cachePath, `${JSON.stringify(cached, null, 2)}\n`, 'utf8');

    const stale = await resolveSkillRegistry({
      cwd,
      homeDir,
      query: {
        intent: 'test',
        include_related: false,
        stale_check: true,
      },
    });
    expect(stale.registry_status.cache).toBe('stale');
    expect(stale.warnings.join(' ')).toContain('cached skill-registry.json does not match live content');

    await writeFile(path.join(cwd, '.pi', 'skill-registry.json'), '{ invalid json', 'utf8');

    const invalid = await resolveSkillRegistry({
      cwd,
      homeDir,
      query: {
        intent: 'test',
        include_related: false,
        stale_check: true,
      },
    });
    expect(invalid.registry_status.cache).toBe('invalid');
    expect(invalid.warnings.join(' ')).toContain('Cannot parse cached skill-registry.json');

    const notChecked = await resolveSkillRegistry({
      cwd,
      homeDir,
      query: {
        intent: 'test',
        include_related: false,
        stale_check: false,
      },
    });
    expect(notChecked.registry_status.cache).toBe('not_checked');
    expect(notChecked.warnings.every((warning) => !warning.includes('cache'))).toBe(true);

    const cachedInvalid = await readCachedSkillRegistry({ cwd });
    expect(cachedInvalid.status).toBe('invalid');
    expect(stale.registry_status.cache_path).toBe(cachePath);
  });

  it('returns cache status helpers without resolving live cache state', async () => {
    const { cwd, homeDir } = await createProject();

    const live = await generateSkillRegistry({ cwd, homeDir });
    const missing = await readCachedSkillRegistry({ cwd });
    expect(missing.status).toBe('missing');

    const resolvedMissing = getRegistryStatus({ liveRegistry: live, stale_check: true, cached: missing, cache_path: path.join(cwd, '.pi', 'skill-registry.json') });
    expect(resolvedMissing.status.cache).toBe('missing');

    const invalid = getRegistryStatus({
      liveRegistry: live,
      stale_check: true,
      cached: { status: 'invalid', path: path.join(cwd, '.pi', 'skill-registry.json'), error: 'boom' },
      cache_path: path.join(cwd, '.pi', 'skill-registry.json'),
    });
    expect(invalid.status.cache).toBe('invalid');

    const notChecked = getRegistryStatus({
      liveRegistry: live,
      stale_check: false,
      cached: missing,
      cache_path: path.join(cwd, '.pi', 'skill-registry.json'),
    });
    expect(notChecked.status.cache).toBe('not_checked');
    expect(notChecked.warnings).toEqual([]);
  });
});


describe('readCachedSkillRegistry', () => {
  it('parses cached json and reports invalid files', async () => {
    const { cwd } = await createProject();

    await mkdir(path.join(cwd, '.pi'), { recursive: true });
    await writeFile(path.join(cwd, '.pi', 'skill-registry.json'), '{ invalid json', 'utf8');

    const parsed = await readCachedSkillRegistry({ cwd });
    expect(parsed.status).toBe('invalid');
    expect(parsed.path).toContain('skill-registry.json');

    const missing = await readCachedSkillRegistry({ cwd: path.join(cwd, 'other', 'empty') });
    expect(missing.status).toBe('missing');
  });
});
