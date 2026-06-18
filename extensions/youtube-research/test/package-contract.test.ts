import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('youtube-research package contract', () => {
  const packagePath = join(process.cwd(), 'package.json');
  const tsconfigPath = join(process.cwd(), 'tsconfig.json');
  const vitestConfigPath = join(process.cwd(), 'vitest.config.ts');

  it('contains required package metadata and scripts', () => {
    const pkg = JSON.parse(readFileSync(packagePath, 'utf8')) as Record<string, unknown>;

    expect(pkg.name).toBe('pi-youtube-research-extension');
    expect(pkg.private).toBe(true);
    expect(pkg.type).toBe('module');
    expect(pkg.scripts).toMatchObject({
      test: 'vitest run',
      typecheck: 'tsc --noEmit',
    });
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
    expect(existsSync(join(process.cwd(), 'src'))).toBe(true);
    expect(existsSync(join(process.cwd(), 'test'))).toBe(true);
    expect(existsSync(join(process.cwd(), 'README.md'))).toBe(true);
  });
});
