import { mkdtemp, readFile, writeFile, mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { syncActiveWorkflows } from '../src/core/state.js';

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'workflow-guard-'));
  await mkdir(join(root, 'openspec', 'changes'), { recursive: true });
  return root;
}
async function change(root: string, slug: string, files: Record<string, string>) {
  const dir = join(root, 'openspec', 'changes', slug);
  await mkdir(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) await writeFile(join(dir, name), body, 'utf8');
}

const ready = '## Workflow Status\n- Status: READY\n- Blockers: None\n\n';
const blocked = '## Workflow Status\n- Status: BLOCKED\n- Blockers: needs decision\n\n';
const scope = (root: string, bash = '  - npm test') => `## Execution Scope\n- Root: ${root}\n- Allowed Paths:\n  - openspec/changes/**\n  - extensions/workflow-guard/**\n- Writable Paths:\n  - openspec/changes/**\n  - extensions/workflow-guard/**\n- Allowed Bash:\n${bash}\n- Notes: test scope; /tmp/** is implicitly allowed.\n\n`;

describe('workflow state derivation', () => {
  it('detects mini-sdd and writes per-change and global json', async () => {
    const root = await workspace();
    await change(root, 'mini', { 'mini-sdd.md': ready + scope(root) + '# Contract\n# MINI-001 Work\n' });
    const result = await syncActiveWorkflows(root);
    expect(result.index.active.mini.workflow).toBe('mini-sdd');
    expect(result.states[0].phase).toBe('ready-for-apply');
    const workflow = JSON.parse(await readFile(join(root, 'openspec', 'changes', 'mini', 'workflow.json'), 'utf8'));
    expect(workflow.artifacts['mini-sdd.md'].ids).toEqual(['MINI-001']);
    const index = JSON.parse(await readFile(join(root, 'openspec', 'workflows.json'), 'utf8'));
    expect(index.active.mini.path).toBe('openspec/changes/mini/workflow.json');
  });

  it('detects formal-sdd phase from tasks readiness', async () => {
    const root = await workspace();
    await change(root, 'formal', { 'proposal.md': ready, 'spec.md': ready, 'design.md': ready, 'tasks.md': ready + scope(root) + '# TASK-001 Build\n' });
    const result = await syncActiveWorkflows(root);
    expect(result.states[0]).toMatchObject({ workflow: 'formal-sdd', phase: 'ready-for-apply', status: 'READY' });
  });

  it('blocks mixed mini and formal signatures', async () => {
    const root = await workspace();
    await change(root, 'mixed', { 'mini-sdd.md': ready, 'tasks.md': ready });
    const result = await syncActiveWorkflows(root);
    expect(result.states[0]).toMatchObject({ status: 'BLOCKED', freshness: 'CONFLICT', phase: 'workflow-conflict' });
    expect(result.states[0].next_allowed).toEqual(['notify-user', 'ask-user-decision']);
  });

  it('reports missing or blocked workflow status', async () => {
    const root = await workspace();
    await change(root, 'blocked', { 'mini-sdd.md': blocked });
    await change(root, 'missing-status', { 'mini-sdd.md': '# Contract only\n' });
    const result = await syncActiveWorkflows(root);
    const bySlug = Object.fromEntries(result.states.map((state) => [state.slug, state]));
    expect(bySlug.blocked.phase).toBe('contract-blocked');
    expect(bySlug.blocked.blockers[0]).toContain('needs decision');
    expect(bySlug['missing-status'].status).toBe('BLOCKED');
    expect(bySlug['missing-status'].warnings[0]).toContain('Workflow Status');
  });

  it('serializes concurrent syncs so derived json writes do not race on temp renames', async () => {
    const root = await workspace();
    await change(root, 'mini', { 'mini-sdd.md': ready + scope(root) + '# Contract\n# MINI-001 Work\n' });
    const now = vi.spyOn(Date, 'now').mockReturnValue(12345);
    try {
      await expect(Promise.all(Array.from({ length: 8 }, () => syncActiveWorkflows(root)))).resolves.toHaveLength(8);
    } finally {
      now.mockRestore();
    }
    expect(JSON.parse(await readFile(join(root, 'openspec', 'workflows.json'), 'utf8')).active.mini).toBeTruthy();
  });

  it('derives normalized execution scope for mini-sdd and writes it to workflow json', async () => {
    const root = await workspace();
    await change(root, 'mini', { 'mini-sdd.md': ready + scope(root) + '# MINI-001 Work\n' });
    const result = await syncActiveWorkflows(root);
    expect(result.states[0].execution_scope).toMatchObject({ authority_artifact: 'openspec/changes/mini/mini-sdd.md', status: 'READY', tmp_always_allowed: true });
    expect(result.states[0].execution_scope?.allowed_paths).toContain(`${root}/extensions/workflow-guard/**`);
    const workflow = JSON.parse(await readFile(join(root, 'openspec', 'changes', 'mini', 'workflow.json'), 'utf8'));
    expect(workflow.execution_scope.writable_paths).toContain(`${root}/openspec/changes/**`);
  });

  it('derives normalized execution scope from formal tasks.md', async () => {
    const root = await workspace();
    await change(root, 'formal', { 'proposal.md': ready, 'spec.md': ready, 'design.md': ready, 'tasks.md': ready + scope(root) + '# TASK-001 Build\n' });
    const result = await syncActiveWorkflows(root);
    expect(result.states[0].execution_scope).toMatchObject({ authority_artifact: 'openspec/changes/formal/tasks.md', status: 'READY' });
  });

  it('blocks missing, invalid, conflict, and unknown execution scopes', async () => {
    const root = await workspace();
    await change(root, 'missing-scope', { 'mini-sdd.md': ready + '# MINI-001 Work\n' });
    await change(root, 'bad-scope', { 'mini-sdd.md': ready + `## Execution Scope\n- Root: ${root}\n- Allowed Paths:\n  - openspec/changes/**\n- Writable Paths:\n  - extensions/workflow-guard/**\n- Allowed Bash:\n  - npm test\n- Notes: bad\n\n` });
    await change(root, 'empty-bash-scope', { 'mini-sdd.md': ready + `## Execution Scope\n- Root: ${root}\n- Allowed Paths:\n  - openspec/changes/**\n- Writable Paths:\n  - openspec/changes/**\n- Allowed Bash:\n  - None\n- Notes: bad\n\n` });
    await change(root, 'backtick-scope', { 'mini-sdd.md': ready + `## Execution Scope\n- Root: ${root}\n- Allowed Paths:\n  - \`openspec/changes/**\`\n- Writable Paths:\n  - openspec/changes/**\n- Allowed Bash:\n  - npm test\n- Notes: bad\n\n` });
    await change(root, 'duplicate-label-scope', { 'mini-sdd.md': ready + `## Execution Scope\n- Root: ${root}\n- Root: ${root}\n- Allowed Paths:\n  - openspec/changes/**\n- Writable Paths:\n  - openspec/changes/**\n- Allowed Bash:\n  - npm test\n- Notes: bad\n\n` });
    await change(root, 'mixed-scope', { 'mini-sdd.md': ready, 'tasks.md': ready });
    await change(root, 'unknown-scope', { 'apply.md': ready });
    const result = await syncActiveWorkflows(root);
    const bySlug = Object.fromEntries(result.states.map((state) => [state.slug, state]));
    expect(bySlug['missing-scope'].execution_scope?.blockers[0]).toContain('Missing Execution Scope');
    expect(bySlug['bad-scope'].execution_scope?.blockers[0]).toContain('Writable path is outside Allowed Paths');
    expect(bySlug['empty-bash-scope'].execution_scope?.blockers[0]).toContain('Allowed Bash must contain at least one concrete command');
    expect(bySlug['backtick-scope'].execution_scope?.blockers[0]).toContain('Allowed Paths must contain only concrete plain-text paths');
    expect(bySlug['duplicate-label-scope'].execution_scope?.blockers[0]).toContain('Duplicate Execution Scope label: Root');
    expect(bySlug['mixed-scope'].execution_scope?.blockers[0]).toContain('conflict');
    expect(bySlug['unknown-scope'].execution_scope?.blockers[0]).toContain('unknown');
  });

  it('does not follow OpenSpec artifact symlinks outside the workspace', async () => {
    const root = await workspace();
    const outside = await mkdtemp(join(tmpdir(), 'workflow-guard-outside-'));
    await writeFile(join(outside, 'mini-sdd.md'), ready + '# MINI-999 Escaped\n', 'utf8');
    await mkdir(join(root, 'openspec', 'changes', 'escaped'), { recursive: true });
    await symlink(join(outside, 'mini-sdd.md'), join(root, 'openspec', 'changes', 'escaped', 'mini-sdd.md'));

    const result = await syncActiveWorkflows(root);
    const escaped = result.states.find((state) => state.slug === 'escaped');
    expect(escaped?.workflow).not.toBe('mini-sdd');
    expect(escaped?.artifacts['mini-sdd.md']).toMatchObject({ exists: false, status: 'UNKNOWN' });
    expect(escaped?.artifacts['mini-sdd.md'].blockers[0]).toContain('Refusing to follow symlink');
  });
});
