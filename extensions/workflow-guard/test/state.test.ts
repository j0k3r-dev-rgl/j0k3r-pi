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

describe('workflow state derivation', () => {
  it('detects mini-sdd and writes per-change and global json', async () => {
    const root = await workspace();
    await change(root, 'mini', { 'mini-sdd.md': ready + '# Contract\n# MINI-001 Work\n' });
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
    await change(root, 'formal', { 'proposal.md': ready, 'spec.md': ready, 'design.md': ready, 'tasks.md': ready + '# TASK-001 Build\n' });
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
    await change(root, 'mini', { 'mini-sdd.md': ready + '# Contract\n# MINI-001 Work\n' });
    const now = vi.spyOn(Date, 'now').mockReturnValue(12345);
    try {
      await expect(Promise.all(Array.from({ length: 8 }, () => syncActiveWorkflows(root)))).resolves.toHaveLength(8);
    } finally {
      now.mockRestore();
    }
    expect(JSON.parse(await readFile(join(root, 'openspec', 'workflows.json'), 'utf8')).active.mini).toBeTruthy();
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
