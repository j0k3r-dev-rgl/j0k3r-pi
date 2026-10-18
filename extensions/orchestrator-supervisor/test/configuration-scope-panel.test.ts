import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupervisorDashboard } from '../src/supervisor-dashboard.ts';
import { DEFAULT_SUPERVISOR_CONFIG } from '../src/supervisor-config.ts';
import { DEFAULT_SUBAGENT_CONFIG } from '../src/subagent-config.ts';
import { fakeLib, fakeKeybindings, identityTheme, mouseClick } from './fixtures/fake-tui.ts';

function harness(fail = false, error?: string) {
  const calls: string[] = [], errors: string[] = [];
  const control = (kind: string, defaults: any) => ({
    location: { scope: 'legacy', path: `/runtime/${kind}.json` },
    select: (scope: string) => {
      if (fail) throw new Error('destination is invalid');
      calls.push(`${kind}:${scope}`);
      return { config: { ...defaults, modelCount: scope === 'project' ? 2 : 3 }, location: { scope, path: `/${scope}/${kind}.json` } };
    },
  });
  const component = createSupervisorDashboard({
    orchestrator: {
      lib: fakeLib, tui: { requestRender() {} }, theme: identityTheme, keybindings: fakeKeybindings,
      config: DEFAULT_SUPERVISOR_CONFIG, state: () => ({ enabled: true, running: false, uncertain: 0 }),
      candidates: [], isBound: () => true, applyConfig: patch => ({ ...DEFAULT_SUPERVISOR_CONFIG, ...patch }),
      onEnabledChange() {}, onError: message => errors.push(message), done() {},
      scopeControl: control('supervisor', DEFAULT_SUPERVISOR_CONFIG), error,
    },
    subagents: { config: DEFAULT_SUBAGENT_CONFIG, candidates: [], error,
      applyConfig: patch => ({ ...DEFAULT_SUBAGENT_CONFIG, ...patch }), scopeControl: control('subagents', DEFAULT_SUBAGENT_CONFIG) },
  } as any);
  const text = () => component.render(180).join('\n');
  const selectScope = () => {
    for (let i = 0; i < 40; i++) component.handleInput('\x1b[A');
    for (let i = 0; i < 40 && component.selectedRowId !== 'scope'; i++) component.handleInput('\x1b[B');
    assert.equal(component.selectedRowId, 'scope');
  };
  return { component, calls, errors, text, selectScope };
}

test('both tabs expose independent keyboard and mouse scope selectors with effective paths', () => {
  const h = harness();
  assert.match(h.text(), /Configuration source.*Existing/);
  assert.deepEqual(h.calls, [], 'opening the panel must not write');
  h.selectScope(); h.component.handleInput('\r');
  assert.deepEqual(h.calls, ['supervisor:project']);
  assert.match(h.text(), /Configuration source.*Project/);
  assert.match(h.text(), /\/project\/supervisor.json/);
  assert.match(h.text(), /Model count\s+\[-\] 2/);
  h.component.handleInput('\t');
  assert.match(h.text(), /Configuration source.*Existing/);
  h.selectScope(); h.component.handleInput('\x1b[C');
  assert.deepEqual(h.calls, ['supervisor:project', 'subagents:global']);
  assert.match(h.text(), /\/global\/subagents.json/);
  const y = h.component.render(180).findIndex((line: string) => line.includes('Configuration source'));
  h.component.handleMouse(mouseClick(5, y));
  assert.deepEqual(h.calls, ['supervisor:project', 'subagents:global', 'subagents:project']);
  h.component.handleInput('\t');
  assert.match(h.text(), /\/project\/supervisor.json/);
  for (const width of [1, 20, 48]) assert.ok(h.component.render(width).every((line: string) => line.length <= width));
});

test('failed scope changes preserve visible origin and report the error', () => {
  const h = harness(true); h.selectScope(); h.component.handleInput('\r');
  assert.deepEqual(h.calls, []);
  assert.match(h.text(), /Configuration source.*Existing/);
  assert.equal(h.errors.length, 1);
});

test('an invalid tab remains read-only but can explicitly select a valid source', () => {
  const h = harness(false, 'invalid JSON');
  assert.match(h.text(), /invalid JSON/);
  h.selectScope(); h.component.handleInput('\r');
  assert.match(h.text(), /Configuration source.*Project/);
  assert.doesNotMatch(h.text(), /invalid JSON/);
  h.component.handleInput('\t'); h.selectScope(); h.component.handleInput('\r');
  assert.deepEqual(h.calls, ['supervisor:project', 'subagents:project']);
  assert.doesNotMatch(h.text(), /invalid JSON/);
});
