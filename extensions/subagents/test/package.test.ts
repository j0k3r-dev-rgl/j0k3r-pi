import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as Record<string, any>;

describe('pi package manifest', () => {
  it('is a public pi package named after the project directory', () => {
    expect(packageJson.name).toBe(path.basename(process.cwd()));
    expect(packageJson.private).not.toBe(true);
    expect(packageJson.license).toBe('MIT');
    expect(packageJson.keywords).toEqual(expect.arrayContaining(['pi-package', 'pi-extension', 'subagents']));
  });

  it('declares pi resources for install and gallery discovery', () => {
    expect(packageJson.pi).toMatchObject({
      extensions: ['./index.ts'],
      skills: ['./skills'],
    });
    expect(packageJson.description).toMatch(/subagents/i);
  });

  it('does not bundle pi core runtime packages', () => {
    expect(packageJson.peerDependencies).toMatchObject({
      '@earendil-works/pi-coding-agent': '*',
      typebox: '*',
    });
    expect(packageJson.peerDependenciesMeta).toMatchObject({
      '@earendil-works/pi-coding-agent': { optional: true },
      typebox: { optional: true },
    });
    expect(packageJson.dependencies?.typebox).toBeUndefined();
  });

  it('limits the npm package to runtime resources and docs', () => {
    expect(packageJson.files).toEqual(expect.arrayContaining([
      'index.ts',
      'src',
      'skills',
      'scripts/verify-package-files.mjs',
      '.releaserc.json',
      'README.md',
      'LICENSE',
    ]));
    expect(packageJson.files).not.toContain('node_modules');
    expect(packageJson.files).not.toContain('test');
  });
});
