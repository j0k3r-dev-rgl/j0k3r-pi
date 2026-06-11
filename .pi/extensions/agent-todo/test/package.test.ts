import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = new URL('..', import.meta.url);

function readJson(path: string) {
  return JSON.parse(readFileSync(new URL(path, root), 'utf8')) as Record<string, any>;
}

describe('agent-todo package skeleton', () => {
  it('matches local extension conventions', () => {
    const pkg = readJson('package.json');
    const tsconfig = readJson('tsconfig.json');
    const vitestConfig = readFileSync(new URL('vitest.config.ts', root), 'utf8');

    expect(pkg.scripts?.test).toBe('vitest run');
    expect(pkg.scripts?.typecheck).toBe('tsc --noEmit');
    expect(tsconfig.compilerOptions?.module).toBe('NodeNext');
    expect(tsconfig.compilerOptions?.moduleResolution).toBe('NodeNext');
    expect(tsconfig.compilerOptions?.strict).toBe(true);
    expect(tsconfig.include).toEqual(['index.ts', 'src/**/*.ts', 'test/**/*.ts']);
    expect(vitestConfig).toContain("test/**/*.test.ts");
  });
});
