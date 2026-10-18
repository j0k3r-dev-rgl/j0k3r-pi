import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import * as supervisor from '../src/supervisor-config.ts';
import * as subagents from '../src/subagent-config.ts';
import { computeFlowIdentity, resolveSupervisorDir } from '../src/config.ts';

function fixture(run: (f: { root: string; a: string; b: string; global: string }) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'supervisor-scopes-'));
  const previous = {
    runtime: process.env.PI_SUPERVISOR_RUNTIME_DIR,
    agent: process.env.PI_CODING_AGENT_DIR,
  };
  const f = { root, a: join(root, 'a'), b: join(root, 'b'), global: join(root, 'active-pi') };
  process.env.PI_SUPERVISOR_RUNTIME_DIR = join(root, 'runtime');
  process.env.PI_CODING_AGENT_DIR = f.global;
  mkdirSync(f.a); mkdirSync(f.b);
  try { run(f); } finally {
    if (previous.runtime !== undefined) process.env.PI_SUPERVISOR_RUNTIME_DIR = previous.runtime;
    else delete process.env.PI_SUPERVISOR_RUNTIME_DIR;
    if (previous.agent !== undefined) process.env.PI_CODING_AGENT_DIR = previous.agent;
    else delete process.env.PI_CODING_AGENT_DIR;
    rmSync(root, { recursive: true, force: true });
  }
}
const selectMain = (cwd: string, scope: string) => {
  assert.equal(typeof (supervisor as any).selectSupervisorConfigScope, 'function', 'scope selection must be public');
  return (supervisor as any).selectSupervisorConfigScope(cwd, scope);
};
const selectChildren = (cwd: string, scope: string) => {
  assert.equal(typeof (subagents as any).selectSubagentConfigScope, 'function', 'subagent scope selection must be public');
  return (subagents as any).selectSubagentConfigScope(cwd, scope);
};

test('legacy preferences and runtime identity remain unchanged until explicit selection', () => fixture(f => {
  supervisor.updateSupervisorConfig(f.a, { enabled: false, modelCount: 2, priorityCandidateIds: ['test/a', 'test/b', 'test/hidden'] });
  const legacy = supervisor.resolveSupervisorConfigPath(f.a);
  const before = readFileSync(legacy, 'utf8');
  const identity = computeFlowIdentity(f.a, 'session');
  selectMain(f.a, 'project');
  assert.equal(supervisor.resolveSupervisorConfigPath(f.a), join(f.a, '.pi', 'orchestrator-supervisor', 'supervisor.json'));
  assert.equal(supervisor.loadSupervisorConfig(f.a).config.modelCount, 5, 'a new destination uses its own defaults');
  assert.equal(readFileSync(legacy, 'utf8'), before);
  assert.equal(computeFlowIdentity(f.a, 'session'), identity);
  assert.equal(resolveSupervisorDir(identity), join(f.root, 'runtime', identity));
  assert.equal(existsSync(supervisor.resolveSupervisorConfigPath(f.a)), false, 'selecting does not create or copy preferences');
}));

test('global uses active Pi directory, is shared only when selected, and follows overrides', () => fixture(f => {
  selectMain(f.a, 'global');
  supervisor.updateSupervisorConfig(f.a, { modelCount: 3, priorityCandidateIds: ['test/a', 'test/b', 'test/c', 'test/hidden'] });
  const first = supervisor.resolveSupervisorConfigPath(f.a);
  assert.equal(first, join(f.global, 'orchestrator-supervisor', 'supervisor.json'));
  assert.equal(supervisor.loadSupervisorConfig(f.b).config.modelCount, 5);
  selectMain(f.b, 'global');
  assert.equal(supervisor.loadSupervisorConfig(f.b).config.modelCount, 3);
  const bytes = readFileSync(first, 'utf8');
  process.env.PI_CODING_AGENT_DIR = join(f.root, 'different-pi');
  assert.equal(supervisor.resolveSupervisorConfigPath(f.a), join(f.root, 'different-pi', 'orchestrator-supervisor', 'supervisor.json'));
  assert.equal(supervisor.loadSupervisorConfig(f.a).source, 'default');
  assert.equal(readFileSync(first, 'utf8'), bytes);
}));

test('Project and Global are independent per tab and switching restores complete lists', () => fixture(f => {
  selectMain(f.a, 'global');
  supervisor.updateSupervisorConfig(f.a, { enabled: false, modelCount: 2, priorityCandidateIds: ['test/a', 'test/b', 'test/hidden'] });
  selectChildren(f.a, 'project');
  subagents.updateSubagentConfig(f.a, { enabled: true, modelCount: 2, priorityCandidateIds: ['test/child', '', 'test/hidden'] });
  const main = readFileSync(supervisor.resolveSupervisorConfigPath(f.a), 'utf8');
  const child = readFileSync(subagents.resolveSubagentConfigPath(f.a), 'utf8');
  selectChildren(f.a, 'global');
  assert.equal(subagents.loadSubagentConfig(f.a).config.enabled, false);
  assert.equal(readFileSync(supervisor.resolveSupervisorConfigPath(f.a), 'utf8'), main);
  selectChildren(f.a, 'project');
  assert.equal(readFileSync(subagents.resolveSubagentConfigPath(f.a), 'utf8'), child);
  assert.deepEqual(subagents.loadSubagentConfig(f.a).config.priorityCandidateIds, ['test/child', '', 'test/hidden']);
  assert.deepEqual(supervisor.loadSupervisorConfig(f.a).config.priorityCandidateIds, ['test/a', 'test/b', 'test/hidden']);
}));

test('nested directories resolve worktree roots without changing runtime identities', () => fixture(f => {
  writeFileSync(join(f.a, '.git'), 'gitdir: /unused/worktree-marker');
  const nested = join(f.a, 'packages', 'child'); mkdirSync(nested, { recursive: true });
  selectMain(nested, 'project');
  supervisor.updateSupervisorConfig(nested, { modelCount: 4 });
  assert.equal(supervisor.resolveSupervisorConfigPath(nested), supervisor.resolveSupervisorConfigPath(f.a));
  assert.equal(supervisor.loadSupervisorConfig(f.a).config.modelCount, 4);
  assert.notEqual(computeFlowIdentity(nested), computeFlowIdentity(f.a));
  mkdirSync(join(f.b, '.git'));
  selectMain(f.b, 'project');
  assert.notEqual(supervisor.resolveSupervisorConfigPath(f.b), supervisor.resolveSupervisorConfigPath(f.a));
}));

test('invalid destinations refuse selection without changing either config or current source', () => fixture(f => {
  selectMain(f.a, 'project'); supervisor.updateSupervisorConfig(f.a, { enabled: false });
  const selected = supervisor.resolveSupervisorConfigPath(f.a);
  const before = readFileSync(selected, 'utf8');
  const target = join(f.global, 'orchestrator-supervisor', 'supervisor.json');
  mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, '{broken');
  assert.throws(() => selectMain(f.a, 'global'), /invalid JSON/);
  assert.equal(supervisor.resolveSupervisorConfigPath(f.a), selected);
  assert.equal(readFileSync(selected, 'utf8'), before);
  assert.equal(readFileSync(target, 'utf8'), '{broken');
  writeFileSync(selected, '{broken-project');
  assert.equal(supervisor.loadSupervisorConfig(f.a).source, 'invalid');
  assert.equal(supervisor.loadSupervisorConfig(f.a).config.enabled, false);
  assert.throws(() => supervisor.updateSupervisorConfig(f.a, { enabled: true }), /invalid JSON/);
  assert.equal(readFileSync(selected, 'utf8'), '{broken-project');
  assert.throws(() => selectMain(f.a, 'elsewhere'), /scope/i);
}));

test('malformed scope metadata fails closed for only its tab and cannot be overwritten', () => fixture(f => {
  selectMain(f.a, 'project'); selectChildren(f.a, 'global');
  const selection = join(resolveSupervisorDir(computeFlowIdentity(f.a)), 'supervisor-scope.json');
  writeFileSync(selection, '{broken-scope');
  assert.equal(supervisor.loadSupervisorConfig(f.a).source, 'invalid');
  assert.equal(supervisor.loadSupervisorConfig(f.a).config.enabled, false);
  assert.equal(subagents.loadSubagentConfig(f.a).source, 'default');
  assert.throws(() => selectMain(f.a, 'global'), /scope/i);
  assert.equal(readFileSync(selection, 'utf8'), '{broken-scope');
}));

test('per-model efforts round-trip independently with each complete source in both tabs', () => fixture(f => {
  for (const api of [supervisor, subagents]) {
    const main = api === supervisor;
    const select = main ? selectMain : selectChildren;
    const update = main ? supervisor.updateSupervisorConfig : subagents.updateSubagentConfig;
    const load = main ? supervisor.loadSupervisorConfig : subagents.loadSubagentConfig;
    const path = main ? supervisor.resolveSupervisorConfigPath : subagents.resolveSubagentConfigPath;
    select(f.a, 'global');
    update(f.a, { modelCount: 2, priorityCandidateIds: ['test/a', 'test/b', 'test/hidden'], modelEfforts: { 'test/a': 'low', 'test/hidden': 'max' } });
    const globalPath = path(f.a), globalBytes = readFileSync(globalPath, 'utf8');
    select(f.a, 'project');
    update(f.a, { modelCount: 2, priorityCandidateIds: ['test/a', 'test/b'], modelEfforts: { 'test/a': 'high' } });
    const projectPath = path(f.a), projectBytes = readFileSync(projectPath, 'utf8');
    select(f.a, 'global');
    assert.deepEqual(load(f.a).config.modelEfforts, { 'test/a': 'low', 'test/hidden': 'max' });
    assert.equal(readFileSync(projectPath, 'utf8'), projectBytes);
    select(f.a, 'project');
    assert.deepEqual(load(f.a).config.modelEfforts, { 'test/a': 'high' });
    assert.equal(readFileSync(globalPath, 'utf8'), globalBytes);
  }
}));
