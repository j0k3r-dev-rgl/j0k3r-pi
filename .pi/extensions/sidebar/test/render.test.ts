import { describe, expect, it } from 'vitest';

import type { SidebarModel } from '../src/model.js';
import { renderSidebar } from '../src/render.js';
import { visibleWidth } from '../src/text.js';

function ready<T>(data: T) {
  return { kind: 'ready' as const, data, refreshedAt: '2026-06-10T00:00:00.000Z' };
}

function baseModel(): SidebarModel {
  return {
    chat: { title: '', source: 'fallback' },
    subagents: ready({
      windowMinutes: 20,
      source: 'provider',
      activities: [
        {
          id: '2',
          agent: 'writer',
          status: 'running',
          summary: 'implement renderer logic',
          lastActivityAt: '2026-06-10T00:00:00.000Z',
          elapsedSeconds: 125,
        },
        {
          id: '3',
          agent: 'reviewer',
          status: 'running',
          summary: '',
          lastActivityAt: '2026-06-10T00:01:00.000Z',
          elapsedSeconds: 5,
        },
        {
          id: '1',
          agent: 'planner',
          status: 'completed',
          summary: 'done',
          lastActivityAt: '2026-06-10T00:02:00.000Z',
        },
      ],
    }),
    git: ready({
      root: '/repo',
      repositoryLabel: 'j0k3r-pi',
      branchLabel: 'main',
      files: [
        { path: 'src/components/VeryLongComponentName.tsx', basename: 'VeryLongComponentName.tsx', state: 'edited', added: 12, deleted: 3 },
        { path: 'README.md', basename: 'README.md', state: 'created', added: 4, deleted: 0 },
      ],
    }),
    refreshedAt: '2026-06-10T00:00:00.000Z',
  };
}

describe('renderSidebar', () => {
  it('renders chat title fallback and truncates long titles', () => {
    const fallbackLines = renderSidebar(baseModel(), 28);
    expect(fallbackLines[1]).toContain('Pi Sidebar');
    expect(fallbackLines[3]).toContain('Current Chat');

    const model = baseModel();
    model.chat = { title: 'A very long conversation title for the sidebar', source: 'runtime' };
    const lines = renderSidebar(model, 24);
    expect(lines[3]).toContain('A very long conversa…');
  });

  it('renders a pi-hud-like boxed panel instead of a left-rail list', () => {
    const lines = renderSidebar(baseModel(), 36);

    expect(lines[0]).toBe('╭──────────────────────────────────╮');
    expect(lines[1]).toContain('Pi Sidebar');
    expect(lines[2]).toBe('├──────────────────────────────────┤');
    expect(lines.at(-1)).toBe('╰──────────────────────────────────╯');
    expect(lines.every((line) => line.startsWith('│') || line.startsWith('╭') || line.startsWith('├') || line.startsWith('╰'))).toBe(true);
    expect(lines.join('\n')).toContain('Subagents');
    expect(lines.join('\n')).toContain('Git');
  });

  it('renders section labels and unavailable/empty states', () => {
    const model = baseModel();
    model.subagents = { kind: 'unavailable', message: 'subagents unavailable' };
    model.git = { kind: 'empty', message: 'no changes' };

    const lines = renderSidebar(model, 30).join('\n');
    expect(lines).toContain('Subagents');
    expect(lines).toContain('subagents unavailable');
    expect(lines).toContain('Git');
    expect(lines).toContain('no changes');
  });

  it('renders a compact todo section only when active todo data is ready', () => {
    const model = baseModel();
    model.todo = ready({
      id: 'todo-1',
      title: 'Ship feature',
      completedSteps: 1,
      totalSteps: 2,
      progressLabel: '1/2',
      steps: [
        { id: '1', text: 'Write tests', status: 'completed' },
        { id: '2', text: 'Implement', status: 'open' },
      ],
      updatedAt: '2026-06-10T00:00:00.000Z',
    });

    const lines = renderSidebar(model, 32).join('\n');
    expect(lines).toContain('Todo');
    expect(lines).toContain('Ship feature');
    expect(lines).toContain('1/2');
    expect(lines).toContain('[x] 1. Write tests');
    expect(lines).toContain('[ ] 2. Implement');

    delete model.todo;
    const withoutTodo = renderSidebar(model, 32).join('\n');
    expect(withoutTodo).not.toContain('Todo');
  });

  it('renders git rows with names on the left and added/deleted counts at the right edge', () => {
    const lines = renderSidebar(baseModel(), 32);
    const gitRow = lines.find((line) => line.includes('VeryLong'));
    expect(gitRow).toBeDefined();
    expect(gitRow).toContain('VeryLong');
    expect(gitRow).toContain('+12 -3');
    expect(gitRow).not.toContain('src/components');
    expect(gitRow).toMatch(/VeryLong.*\s\+12 -3│$/);
  });

  it('limits git file rows to 15 and renders an informative more row', () => {
    const model = baseModel();
    if (model.git.kind !== 'ready') throw new Error('expected ready git fixture');
    model.git.data.files = Array.from({ length: 18 }, (_, index) => ({
      path: `src/file-${index + 1}.ts`,
      basename: `file-${index + 1}.ts`,
      state: 'created' as const,
      added: index + 1,
      deleted: 0,
    }));

    const lines = renderSidebar(model, 34).join('\n');
    expect(lines).toContain('file-1.ts');
    expect(lines).toContain('+1 -0');
    expect(lines).toContain('file-15.ts');
    expect(lines).toContain('+15 -0');
    expect(lines).not.toContain('file-16.ts');
    expect(lines).toContain('+3 more files');
  });

  it('renders subagents with the pi-hud status line and active item list', () => {
    const lines = renderSidebar(baseModel(), 36).join('\n');
    expect(lines).toContain('2 run · 1 done · 0 err');
    expect(lines).toContain('[·] 2 running');
    expect(lines).toContain('• reviewer · ◷ 5s');
    expect(lines).toContain('• writer · ◷ 2m5s');
    expect(lines).not.toContain('• planner');
    expect(lines).not.toContain('running writer 2m5s');
    expect(lines.indexOf('reviewer')).toBeLessThan(lines.indexOf('writer'));
  });

  it('renders recent completed subagents only when no subagent is running', () => {
    const model = baseModel();
    if (model.subagents.kind !== 'ready') throw new Error('expected ready subagents fixture');
    model.subagents.data = {
      windowMinutes: 20,
      source: 'provider',
      activities: [
        { id: 'recent-done', agent: 'discovery', status: 'completed', summary: 'Waited about 60 seconds and finished successfully.', lastActivityAt: '2026-06-10T00:03:00.000Z', elapsedSeconds: 60 },
        { id: 'recent-failed', agent: 'verify', status: 'failed', summary: 'validation failed', lastActivityAt: '2026-06-10T00:02:00.000Z', elapsedSeconds: 15 },
      ],
    };

    const lines = renderSidebar(model, 42).join('\n');
    expect(lines).toContain('0 run · 1 done · 1 err');
    expect(lines).not.toContain('[·]');
    expect(lines).toContain('✓ discovery · ◷ 1m0s');
    expect(lines).toContain('✗ verify · ◷ 15s');
  });

  it('omits and truncates deterministically at narrow widths', () => {
    const lines = renderSidebar(baseModel(), 14).join('\n');
    expect(lines).not.toContain('+12 -3');
    expect(lines).toContain('Subagents');
  });

  it('keeps every rendered line within the supplied visible width', () => {
    const lines = renderSidebar(baseModel(), 22, {
      fg: (_token, text) => `\u001b[36m${text}\u001b[0m`,
      bold: (text) => `**${text}**`,
    });

    for (const line of lines) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(22);
    }
  });
});
