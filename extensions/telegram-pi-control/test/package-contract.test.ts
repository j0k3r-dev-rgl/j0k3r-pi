import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('telegram-pi-control package contract', () => {
  const packagePath = join(process.cwd(), 'package.json');
  const tsconfigPath = join(process.cwd(), 'tsconfig.json');
  const tsconfigBuildPath = join(process.cwd(), 'tsconfig.build.json');
  const vitestConfigPath = join(process.cwd(), 'vitest.config.ts');
  const envExamplePath = join(process.cwd(), 'telegram-pi-control.env.example');

  it('contains required scripts and dependency boundary', async () => {
    const pkgRaw = await readFile(packagePath, 'utf8');
    const pkg = JSON.parse(pkgRaw) as Record<string, unknown>;

    expect(pkg.name).toContain('telegram-pi-control');
    expect(pkg.private).toBe(true);
    expect(pkg.type).toBe('module');
    expect(pkg.scripts).toMatchObject({
      test: 'vitest run',
      typecheck: 'tsc --noEmit',
      build: 'tsc -p tsconfig.build.json',
      'gateway:start': 'npm run build && node dist/src/gateway-start.js',
    });
    expect(pkg.devDependencies).toBeDefined();
    expect(pkg.dependencies).toMatchObject({
      '@earendil-works/pi-coding-agent': expect.any(String),
    });
  });

  it('uses strict NodeNext TypeScript configuration', async () => {
    const tsconfigRaw = await readFile(tsconfigPath, 'utf8');
    const tsconfig = JSON.parse(tsconfigRaw) as { compilerOptions: Record<string, unknown>; include?: string[] };

    expect(tsconfig.compilerOptions).toMatchObject({
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
    });
    expect(tsconfig.include ?? []).toEqual(expect.arrayContaining(['index.ts', 'src/**/*.ts', 'test/**/*.ts']));
  });

  it('offers optional build tsconfig and node test environment', async () => {
    expect(existsSync(vitestConfigPath)).toBe(true);
    expect(existsSync(tsconfigBuildPath)).toBe(true);

    const vitestConfigRaw = await readFile(vitestConfigPath, 'utf8');
    expect(vitestConfigRaw).toContain("environment: 'node'");
    expect(vitestConfigRaw).toContain('defineConfig');
  });

  it('has extension layout and README', () => {
    expect(existsSync(join(process.cwd(), 'src'))).toBe(true);
    expect(existsSync(join(process.cwd(), 'test'))).toBe(true);
    expect(existsSync(join(process.cwd(), 'README.md'))).toBe(true);
    expect(existsSync(envExamplePath)).toBe(true);
  });
});
