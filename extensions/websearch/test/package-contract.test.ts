import { readdirSync, readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('websearch package contract', () => {
  const packagePath = join(process.cwd(), 'package.json');
  const tsconfigPath = join(process.cwd(), 'tsconfig.json');
  const vitestConfigPath = join(process.cwd(), 'vitest.config.ts');

  it('contains required package metadata and scripts', () => {
    const pkg = JSON.parse(readFileSync(packagePath, 'utf8')) as Record<string, unknown>;

    expect(pkg.name).toBe('pi-websearch-extension');
    expect(pkg.private).toBe(true);
    expect(pkg.type).toBe('module');
    expect(pkg.scripts).toMatchObject({
      test: 'vitest run',
      typecheck: 'tsc --noEmit',
    });
  });

  it('allows only the approved runtime dependencies for community-platform support', () => {
    const pkg = JSON.parse(readFileSync(packagePath, 'utf8')) as {
      dependencies?: Record<string, string>;
    };

    expect(pkg.dependencies).toEqual({
      typebox: expect.any(String),
      octokit: expect.any(String),
    });
    const disallowedRuntimeDependencies = [
      '@octokit/rest',
      'devto',
      'forem',
      'hacker-news-api',
      'hn-api',
      `red${'dit'}`,
      `snoo${'wrap'}`,
    ];
    expect(Object.keys(pkg.dependencies ?? {})).not.toEqual(expect.arrayContaining(disallowedRuntimeDependencies));
  });

  it('uses strict NodeNext TypeScript configuration', () => {
    const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf8')) as { compilerOptions: Record<string, unknown> };

    expect(tsconfig.compilerOptions).toMatchObject({
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
    });
    expect(tsconfig.compilerOptions.types).toEqual(expect.arrayContaining(['node', 'vitest']));
  });

  it('contains expected test/loader layout and package artifacts', () => {
    const vitestConfig = readFileSync(vitestConfigPath, 'utf8');
    expect(vitestConfig).toContain("include: ['test/**/*.test.ts']");
    expect(existsSync(join(process.cwd(), 'index.ts'))).toBe(true);
    expect(existsSync(join(process.cwd(), 'src'))).toBe(true);
    expect(existsSync(join(process.cwd(), 'test'))).toBe(true);
    expect(existsSync(join(process.cwd(), 'README.md'))).toBe(true);
  });

  it('keeps source-family modules isolated behind common/discussions/research folders', () => {
    const src = join(process.cwd(), 'src');
    for (const familyRoot of ['providers', 'schemas', 'summaries', 'tools', 'types']) {
      expect(existsSync(join(src, familyRoot, 'common'))).toBe(true);
      expect(existsSync(join(src, familyRoot, 'discussions'))).toBe(true);
      expect(existsSync(join(src, familyRoot, 'research'))).toBe(true);
    }
    expect(existsSync(join(src, 'types', 'shared.ts'))).toBe(false);
    expect(readdirSync(join(src, 'tools')).filter((file) => file.endsWith('.ts')).sort()).toEqual(['index.ts']);
  });
});
