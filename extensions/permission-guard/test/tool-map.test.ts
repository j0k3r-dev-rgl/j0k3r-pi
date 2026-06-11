import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { builtInPermissionPolicy } from '../src/defaults.js';
import { mapBuiltinToolInput } from '../src/tool-map.js';

async function tempWorkspace(prefix: string) {
  const cwd = await mkdtemp(join(tmpdir(), prefix));
  await mkdir(join(cwd, 'src'), { recursive: true });
  return cwd;
}

describe('built-in tool permission mapping', () => {
  it.each([
    { tool: 'read' as const, input: { path: 'src/index.ts' }, action: 'read', target: 'src/index.ts' },
    { tool: 'read' as const, input: { file_path: 'src/file-path.ts' }, action: 'read', target: 'src/file-path.ts' },
    { tool: 'grep' as const, input: { pattern: 'needle', path: 'src' }, action: 'search', target: 'src' },
    { tool: 'grep' as const, input: { query: 'needle' }, action: 'search', target: '.' },
    { tool: 'find' as const, input: { path: 'src' }, action: 'list', target: 'src' },
    { tool: 'find' as const, input: {}, action: 'list', target: '.' },
    { tool: 'ls' as const, input: { path: 'src' }, action: 'list', target: 'src' },
    { tool: 'ls' as const, input: {}, action: 'list', target: '.' },
  ])('normalizes $tool input into an action and path target', async ({ tool, input, action, target }) => {
    const cwd = await tempWorkspace(`permission-guard-tool-${tool}-`);
    await writeFile(join(cwd, 'src', 'index.ts'), 'export {};', 'utf8');
    await writeFile(join(cwd, 'src', 'file-path.ts'), 'export {};', 'utf8');

    const request = await mapBuiltinToolInput({
      tool,
      input,
      cwd,
      config: builtInPermissionPolicy,
      mode: 'tui',
      hasUI: true,
      policyIdentity: 'test-policy',
      timestamp: '2026-06-09T00:00:00.000Z',
    });

    expect(request.tool).toBe(tool);
    expect(request.action).toBe(action);
    expect(request.target?.raw).toBe(target);
    expect(request.target?.workspaceRoot).toBe(cwd);
    expect(request.source).toBe('tool_call');
    expect(request.rawInputSummary).not.toContain('needle');
  });

  it('maps write as create for missing targets and omits content from summaries', async () => {
    const cwd = await tempWorkspace('permission-guard-tool-write-create-');
    const sentinel = 'SENTINEL_WRITE_CONTENT';

    const request = await mapBuiltinToolInput({
      tool: 'write',
      input: { path: 'src/new-file.ts', content: sentinel },
      cwd,
      config: builtInPermissionPolicy,
      mode: 'tui',
      hasUI: true,
      policyIdentity: 'test-policy',
      timestamp: '2026-06-09T00:00:00.000Z',
    });

    expect(request.action).toBe('create');
    expect(request.target?.exists).toBe(false);
    expect(request.rawInputSummary).toBe('write create src/new-file.ts');
    expect(JSON.stringify(request)).not.toContain(sentinel);
  });

  it('maps write as write for existing targets without previewing content', async () => {
    const cwd = await tempWorkspace('permission-guard-tool-write-existing-');
    await writeFile(join(cwd, 'src', 'existing.ts'), 'old', 'utf8');
    const sentinel = 'SENTINEL_REPLACEMENT_CONTENT';

    const request = await mapBuiltinToolInput({
      tool: 'write',
      input: { file_path: 'src/existing.ts', content: sentinel },
      cwd,
      config: builtInPermissionPolicy,
      mode: 'tui',
      hasUI: true,
      policyIdentity: 'test-policy',
      timestamp: '2026-06-09T00:00:00.000Z',
    });

    expect(request.action).toBe('write');
    expect(request.target?.exists).toBe(true);
    expect(request.rawInputSummary).toBe('write write src/existing.ts');
    expect(JSON.stringify(request)).not.toContain(sentinel);
  });

  it('maps edit targets without oldText, newText, or replacement previews', async () => {
    const cwd = await tempWorkspace('permission-guard-tool-edit-');
    await writeFile(join(cwd, 'src', 'edit.ts'), 'old secret text', 'utf8');

    const request = await mapBuiltinToolInput({
      tool: 'edit',
      input: {
        path: 'src/edit.ts',
        oldText: 'SENTINEL_OLD_TEXT',
        newText: 'SENTINEL_NEW_TEXT',
        replacement: 'SENTINEL_REPLACEMENT',
      },
      cwd,
      config: builtInPermissionPolicy,
      mode: 'tui',
      hasUI: true,
      policyIdentity: 'test-policy',
      timestamp: '2026-06-09T00:00:00.000Z',
    });

    expect(request.action).toBe('edit');
    expect(request.rawInputSummary).toBe('edit src/edit.ts');
    expect(JSON.stringify(request)).not.toContain('SENTINEL_OLD_TEXT');
    expect(JSON.stringify(request)).not.toContain('SENTINEL_NEW_TEXT');
    expect(JSON.stringify(request)).not.toContain('SENTINEL_REPLACEMENT');
  });

  it.each([
    { tool: 'bash' as const, source: 'tool_call' as const, input: { command: 'npm test -- --run' } },
    { tool: 'user_bash' as const, source: 'user_bash' as const, input: 'git status --short' },
    { tool: 'user_bash' as const, source: 'user_bash' as const, input: { command: 'git diff -- README.md' } },
  ])('normalizes $tool command input', async ({ tool, source, input }) => {
    const cwd = await tempWorkspace(`permission-guard-tool-${tool}-`);

    const request = await mapBuiltinToolInput({
      tool,
      input,
      cwd,
      config: builtInPermissionPolicy,
      mode: 'tui',
      hasUI: true,
      policyIdentity: 'test-policy',
      timestamp: '2026-06-09T00:00:00.000Z',
    });

    expect(request.tool).toBe(tool);
    expect(request.action).toBe('bash');
    expect(request.source).toBe(source);
    expect(request.command?.raw).toBe(typeof input === 'string' ? input : input.command);
    expect(request.command?.summary).toBe(request.command?.raw);
    expect(request.target).toBeUndefined();
  });
});
