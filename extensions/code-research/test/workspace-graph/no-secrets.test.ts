import { describe, expect, it } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildWorkspaceGraph } from '../../src/core/workspace-graph.js';
import { resolveFindSymbol } from '../../src/core/find-symbol-resolver.js';

describe('workspace graph privacy', () => {
  it('does not persist source literals that look like secrets or declaration bodies in graph artifacts and diagnostics', async () => {
    const rootDir = join(tmpdir(), `pi-graph-secret-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(join(rootDir, 'src'), { recursive: true });
    await writeFile(
      join(rootDir, 'src/app.ts'),
      `export function login() {\n  const token = "SECRET_TOKEN_123";\n  const body = "PRIVATE_BODY_SENTINEL";\n  helper();\n}\nfunction helper() {}\n`,
      'utf8'
    );

    const result = await buildWorkspaceGraph(rootDir);
    expect(result.state.status === 'fresh' || result.state.status === 'partial').toBe(true);

    const stateRaw = await readFile(join(rootDir, '.pi/workspace-code-graph/workspace-state.json'), 'utf8');
    const manifestRaw = await readFile(join(rootDir, '.pi/workspace-code-graph/graph-manifest.json'), 'utf8');
    const shardPath = join(rootDir, '.pi/workspace-code-graph', result.state.subprojects[0].shardPath);
    const shardRaw = await readFile(shardPath, 'utf8');

    expect(stateRaw).not.toContain('SECRET_TOKEN_123');
    expect(manifestRaw).not.toContain('SECRET_TOKEN_123');
    expect(shardRaw).not.toContain('SECRET_TOKEN_123');
    expect(shardRaw).not.toContain('PRIVATE_BODY_SENTINEL');
    expect(shardRaw).not.toContain('const token =');

    const resolution = await resolveFindSymbol(rootDir, { path: 'src/app.ts', symbol: 'missing', language: 'ts' });
    expect(JSON.stringify(resolution.diagnostics)).not.toContain('SECRET_TOKEN_123');
    expect(JSON.stringify(resolution.diagnostics)).not.toContain('PRIVATE_BODY_SENTINEL');
  });

  it('keeps java shard metadata free of secrets, initializers, annotation arguments, and method bodies', async () => {
    const rootDir = join(tmpdir(), `pi-java-graph-secret-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(join(rootDir, 'src', 'main', 'java', 'app'), { recursive: true });
    await writeFile(
      join(rootDir, 'src', 'main', 'java', 'app', 'SecretService.java'),
      `package app;\n\n@SuppressWarnings("JAVA_ANNOTATION_SECRET")\npublic class SecretService {\n  private static final String token = "JAVA_SECRET_TOKEN_123";\n\n  public String load() {\n    return "JAVA_PRIVATE_BODY_SENTINEL" + token;\n  }\n}\n`,
      'utf8'
    );

    const result = await buildWorkspaceGraph(rootDir);
    expect(result.state.status === 'fresh' || result.state.status === 'partial').toBe(true);

    const stateRaw = await readFile(join(rootDir, '.pi/workspace-code-graph/workspace-state.json'), 'utf8');
    const manifestRaw = await readFile(join(rootDir, '.pi/workspace-code-graph/graph-manifest.json'), 'utf8');
    const shardPath = join(rootDir, '.pi/workspace-code-graph', result.state.subprojects[0].shardPath);
    const shardRaw = await readFile(shardPath, 'utf8');

    expect(stateRaw).not.toContain('JAVA_SECRET_TOKEN_123');
    expect(manifestRaw).not.toContain('JAVA_SECRET_TOKEN_123');
    expect(shardRaw).not.toContain('JAVA_SECRET_TOKEN_123');
    expect(shardRaw).not.toContain('JAVA_PRIVATE_BODY_SENTINEL');
    expect(shardRaw).not.toContain('JAVA_ANNOTATION_SECRET');
    expect(shardRaw).not.toContain('private static final String token =');
    expect(shardRaw).not.toContain('return "JAVA_PRIVATE_BODY_SENTINEL"');

    const resolution = await resolveFindSymbol(rootDir, { path: 'src/main/java/app/SecretService.java', symbol: 'missing', language: 'java' });
    const diagnostics = JSON.stringify(resolution.diagnostics);
    expect(diagnostics).not.toContain('JAVA_SECRET_TOKEN_123');
    expect(diagnostics).not.toContain('JAVA_PRIVATE_BODY_SENTINEL');
    expect(diagnostics).not.toContain('JAVA_ANNOTATION_SECRET');
  });
});
