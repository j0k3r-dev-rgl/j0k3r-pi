import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import workflowGuardExtension from '../index.js';

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'workflow-guard-'));
  const dir = join(root, 'openspec', 'changes', 'x');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'mini-sdd.md'), '## Workflow Status\n- Status: READY\n- Blockers: None\n\n# MINI-001 X\n', 'utf8');
  return root;
}
function createPi() {
  const tools: any[] = [];
  const handlers: Record<string, any> = {};
  return {
    tools,
    handlers,
    registerTool(tool: any) { tools.push(tool); },
    on(name: string, handler: any) { handlers[name] = handler; },
  };
}

describe('workflow guard tools and hooks', () => {
  it('registers state/get validate tools and lifecycle hooks from thin entrypoint', () => {
    const pi = createPi();
    workflowGuardExtension(pi as any);
    expect(pi.tools.map((tool) => tool.name)).toEqual(['workflow_state_get', 'workflow_validate']);
    expect(Object.keys(pi.handlers).sort()).toEqual(['agent_settled', 'session_start', 'tool_result']);
  });

  it('returns slug and workspace summary views', async () => {
    const cwd = await setup();
    const pi = createPi();
    workflowGuardExtension(pi as any);
    const get = pi.tools.find((tool) => tool.name === 'workflow_state_get');
    const single = await get.execute('1', { slug: 'x', includeArtifacts: true }, undefined, undefined, { cwd });
    expect(single.details.state.slug).toBe('x');
    expect(single.content[0].text).toContain('x: mini-sdd ready-for-apply READY');
    const summary = await get.execute('2', {}, undefined, undefined, { cwd });
    expect(summary.details.index.active.x.workflow).toBe('mini-sdd');
  });

  it('validates and repairs only derived json', async () => {
    const cwd = await setup();
    const pi = createPi();
    workflowGuardExtension(pi as any);
    const validate = pi.tools.find((tool) => tool.name === 'workflow_validate');
    const dry = await validate.execute('1', { slug: 'x', repairDerivedJson: false }, undefined, undefined, { cwd });
    expect(dry.details.regenerated_files).toEqual([]);
    const repaired = await validate.execute('2', { slug: 'x', repairDerivedJson: true }, undefined, undefined, { cwd });
    expect(repaired.details.regenerated_files).toContain('openspec/changes/x/workflow.json');
    expect(await readFile(join(cwd, 'openspec', 'changes', 'x', 'mini-sdd.md'), 'utf8')).toContain('MINI-001');
  });

  it('syncs on session start, relevant tool result, and agent settled only', async () => {
    const cwd = await setup();
    const pi = createPi();
    workflowGuardExtension(pi as any);
    const ctx = { cwd, ui: { notify: vi.fn() } };
    await pi.handlers.session_start({}, ctx);
    expect(JSON.parse(await readFile(join(cwd, 'openspec', 'workflows.json'), 'utf8')).active.x).toBeTruthy();
    await writeFile(join(cwd, 'openspec', 'workflows.json'), '{}', 'utf8');
    await pi.handlers.tool_result({ content: [{ type: 'text', text: 'no openspec changes' }], details: {} }, ctx);
    expect(await readFile(join(cwd, 'openspec', 'workflows.json'), 'utf8')).toBe('{}');
    await pi.handlers.tool_result({ content: [{ type: 'text', text: 'updated openspec/changes/x/mini-sdd.md' }], details: {} }, ctx);
    expect(JSON.parse(await readFile(join(cwd, 'openspec', 'workflows.json'), 'utf8')).active.x).toBeTruthy();
    await pi.handlers.agent_settled({}, ctx);
  });
});
