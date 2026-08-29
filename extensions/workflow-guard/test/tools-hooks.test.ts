import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import workflowGuardExtension from '../index.js';

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'workflow-guard-'));
  const dir = join(root, 'openspec', 'changes', 'x');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'mini-sdd.md'), `## Workflow Status\n- Status: READY\n- Blockers: None\n\n## Execution Scope\n- Root: ${root}\n- Allowed Paths:\n  - openspec/changes/**\n  - extensions/workflow-guard/**\n- Writable Paths:\n  - openspec/changes/**\n  - extensions/workflow-guard/**\n- Allowed Bash:\n  - npm test\n  - python scripts/allowed.py\n- Notes: test scope; /tmp/** is implicitly allowed.\n\n# MINI-001 X\n`, 'utf8');
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
    expect(pi.tools.map((tool) => tool.name)).toEqual(['workflow_state_get', 'workflow_validate', 'workflow_scope_get', 'workflow_scope_check']);
    expect(Object.keys(pi.handlers).sort()).toEqual(['agent_settled', 'session_start', 'tool_call', 'tool_result']);
  });

  it('returns compact state text by default and verbose state JSON on opt-in', async () => {
    const cwd = await setup();
    const pi = createPi();
    workflowGuardExtension(pi as any);
    const get = pi.tools.find((tool) => tool.name === 'workflow_state_get');
    const single = await get.execute('1', { slug: 'x', includeArtifacts: true }, undefined, undefined, { cwd });
    expect(single.details.state.slug).toBe('x');
    expect(single.content[0].text).toBe('x: mini-sdd ready-for-apply READY');
    expect(single.content[0].text).not.toContain('"artifacts"');
    expect(single.content[0].text).not.toContain('"execution_scope"');
    const singleVerbose = await get.execute('2', { slug: 'x', includeArtifacts: true, verbose: true }, undefined, undefined, { cwd });
    expect(singleVerbose.content[0].text).toContain('x: mini-sdd ready-for-apply READY');
    expect(singleVerbose.content[0].text).toContain('"artifacts"');
    expect(singleVerbose.content[0].text).toContain('"execution_scope"');
    const summary = await get.execute('3', {}, undefined, undefined, { cwd });
    expect(summary.details.index.active.x.workflow).toBe('mini-sdd');
    expect(summary.content[0].text).toContain('Active OpenSpec changes: 1');
    expect(summary.content[0].text).toContain('x: mini-sdd ready-for-apply READY');
    expect(summary.content[0].text).not.toContain('"active"');
    const summaryVerbose = await get.execute('4', { verbose: true }, undefined, undefined, { cwd });
    expect(summaryVerbose.content[0].text).toContain('Active OpenSpec changes: 1');
    expect(summaryVerbose.content[0].text).toContain('"active"');
  });

  it('validates with compact text by default and verbose validation JSON on opt-in', async () => {
    const cwd = await setup();
    const pi = createPi();
    workflowGuardExtension(pi as any);
    const validate = pi.tools.find((tool) => tool.name === 'workflow_validate');
    const dry = await validate.execute('1', { slug: 'x', repairDerivedJson: false }, undefined, undefined, { cwd });
    expect(dry.details.regenerated_files).toEqual([]);
    expect(dry.content[0].text).toBe('workflow validation passed\nDerived JSON regenerated: 0');
    expect(dry.content[0].text).not.toContain('"states"');
    const dryVerbose = await validate.execute('2', { slug: 'x', repairDerivedJson: false, verbose: true }, undefined, undefined, { cwd });
    expect(dryVerbose.content[0].text).toContain('workflow validation passed\nDerived JSON regenerated: 0');
    expect(dryVerbose.content[0].text).toContain('"states"');
    const repaired = await validate.execute('3', { slug: 'x', repairDerivedJson: true }, undefined, undefined, { cwd });
    expect(repaired.details.regenerated_files).toContain('openspec/changes/x/workflow.json');
    expect(repaired.content[0].text).toContain('Derived JSON regenerated: 2');
    expect(repaired.content[0].text).not.toContain('"states"');
    expect(await readFile(join(cwd, 'openspec', 'changes', 'x', 'mini-sdd.md'), 'utf8')).toContain('MINI-001');
  });

  it('returns scope lookup and preflight checks', async () => {
    const cwd = await setup();
    const pi = createPi();
    workflowGuardExtension(pi as any);
    const get = pi.tools.find((tool) => tool.name === 'workflow_scope_get');
    const scope = await get.execute('1', { slug: 'x' }, undefined, undefined, { cwd });
    expect(scope.details.execution_scope.status).toBe('READY');
    const check = pi.tools.find((tool) => tool.name === 'workflow_scope_check');
    const allowed = await check.execute('2', { slug: 'x', action: 'write', paths: ['extensions/workflow-guard/src/file.ts'] }, undefined, undefined, { cwd });
    expect(allowed.details.allowed).toBe(true);
    const blocked = await check.execute('3', { slug: 'x', action: 'read', paths: ['/etc/passwd'] }, undefined, undefined, { cwd });
    expect(blocked.details.allowed).toBe(false);
    expect(blocked.content[0].text).toContain('workflow-guard blocked this action.');
  });

  it('enforces scope in read write edit and bash tool_call hooks', async () => {
    const cwd = await setup();
    const pi = createPi();
    workflowGuardExtension(pi as any);
    const ctx = { cwd, agent: { type: 'subagent' }, ui: { notify: vi.fn() } };
    await expect(pi.handlers.tool_call({ toolName: 'read', input: { path: 'extensions/workflow-guard/README.md' } }, ctx)).resolves.toBeUndefined();
    await expect(pi.handlers.tool_call({ toolName: 'write', input: { path: '/tmp/scratch.txt' } }, ctx)).resolves.toBeUndefined();
    const blockedJson = await pi.handlers.tool_call({ toolName: 'write', input: { path: 'openspec/workflows.json' } }, ctx);
    expect(blockedJson.reason).toContain('derived workflow JSON may only be regenerated');
    await expect(pi.handlers.tool_call({ toolName: 'read', input: { path: '/home/j0k3r/.pi/agent/AGENTS.md' } }, ctx)).resolves.toBeUndefined();
    await expect(pi.handlers.tool_call({ toolName: 'read', input: { path: '/home/j0k3r/.pi/agent/skills/tdd/SKILL.md' } }, ctx)).resolves.toBeUndefined();
    const blockedRead = await pi.handlers.tool_call({ toolName: 'read', input: { path: '/etc/passwd' } }, ctx);
    expect(blockedRead.reason).toContain('read path is outside Allowed Paths');
    const blockedGuidanceWrite = await pi.handlers.tool_call({ toolName: 'write', input: { path: '/home/j0k3r/.pi/agent/AGENTS.md' } }, ctx);
    expect(blockedGuidanceWrite.reason).toContain('write path is outside Writable Paths');
    const blockedGuidanceEdit = await pi.handlers.tool_call({ toolName: 'edit', input: { path: '/home/j0k3r/.pi/agent/skills/tdd/SKILL.md' } }, ctx);
    expect(blockedGuidanceEdit.reason).toContain('edit path is outside Writable Paths');
    const blockedEdit = await pi.handlers.tool_call({ toolName: 'edit', input: { path: '/etc/passwd' } }, ctx);
    expect(blockedEdit.reason).toContain('edit path is outside Writable Paths');
    const blockedPython = await pi.handlers.tool_call({ toolName: 'bash', input: { command: 'python -m pytest' } }, ctx);
    expect(blockedPython.reason).toContain('risky Python-related bash command');
    await expect(pi.handlers.tool_call({ toolName: 'bash', input: { command: 'python scripts/allowed.py' } }, ctx)).resolves.toBeUndefined();
  });

  it('does not enforce execution scope for the main orchestrator tool_call hook', async () => {
    const cwd = await setup();
    const pi = createPi();
    workflowGuardExtension(pi as any);
    const ctx = { cwd, ui: { notify: vi.fn() } };
    await expect(pi.handlers.tool_call({ toolName: 'read', input: { path: '/etc/passwd' } }, ctx)).resolves.toBeUndefined();
    await expect(pi.handlers.tool_call({ toolName: 'bash', input: { command: 'python -m pytest' } }, ctx)).resolves.toBeUndefined();
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
