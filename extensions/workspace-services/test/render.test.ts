import { describe, expect, it } from 'vitest';
import {
  renderWorkspaceServiceCall,
  renderWorkspaceServiceResult,
  extractWorkspaceServiceAction,
  stripAnsi,
  LIME,
  RED,
  CYAN,
} from '../src/render/index.js';

const theme = { fg: (_name: string, text: string) => text, bold: (text: string) => text };

const ANSI_RE = /\u001b\][^\u001b\u0007]*(?:\u001b\\|\u0007)|\u001b\[[0-?]*[ -/]*[@-~]/g;
const CJK_RE = /[\u1100-\u115f\u231a-\u231b\u2329-\u232a\u23e9-\u23ec\u23f0\u23f3\u25fd-\u25fe\u2614-\u2615\u2648-\u2653\u267f\u2693\u26a1\u26aa-\u26ab\u26bd-\u26be\u26c4-\u26c5\u26ce\u26d4\u26ea\u26f2-\u26f3\u26f5\u26fa\u26fd\u2705\u270a-\u270b\u2728\u274c\u274e\u2753-\u2755\u2757\u2795-\u2797\u27b0\u27bf\u2b1b-\u2b1c\u2b50\u2b55\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/u;
function visibleTestWidth(text: string): number { let width = 0; for (const char of text.replace(ANSI_RE, '')) width += CJK_RE.test(char) ? 2 : 1; return width; }

describe('workspace service rendering', () => {
  it('renders compact and expanded states with hollow card borders', () => {
    const result = {
      details: {
        ok: false,
        status: 'recovery_required',
        summary: 'Needs reconciliation.',
        nextAction: 'Restart after manual review.',
        data: { service: 'svc', text: '秘密 [REDACTED] value' },
        truncation: { returned: 1, total: 3, hasMore: true, continuation: 'Call again' },
      },
    };
    const compactLines = renderWorkspaceServiceResult(result, { expanded: false, isPartial: false }, theme).render(80);
    const compact = compactLines.join('\n');
    expect(compact).toContain('╰');
    expect(compact).toContain('│');
    expect(compact).toContain('expand');
    expect(compact).toContain('Needs reconciliation.');

    const expandedLines = renderWorkspaceServiceResult(result, { expanded: true, isPartial: false }, theme).render(80);
    const expanded = expandedLines.join('\n');
    expect(expanded).toContain('╰');
    expect(expanded).toContain('│');
    expect(expanded).toContain('Restart after manual review.');
    expect(expanded).toContain('[REDACTED]');
    expect(expanded).toContain('Call again');
  });

  it('keeps rendered lines within a bounded visible width for wide characters', () => {
    const result = { details: { ok: true, status: 'running', summary: '日本語の非常に長い要約 '.repeat(10), data: { service: 'svc', text: '詳細 '.repeat(20) } } };
    const lines = renderWorkspaceServiceResult(result, { expanded: true, isPartial: false }, theme).render(80);
    for (const line of lines) expect(visibleTestWidth(line)).toBeLessThanOrEqual(80);
  });

  it('renders pending card during call phase and extracts action badge', () => {
    const context: any = { state: {} };
    const callComponent = renderWorkspaceServiceCall('workspace_service_start', { service: 'web-api' }, theme, context);
    const lines = callComponent.render(80);

    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('╭');
    expect(lines[0]).toContain('workspace_service_start [web-api]');
    expect(lines[0]).toContain('╮');
    expect(lines[1]).toContain('│');
    expect(lines[1]).toContain('Pending: web-api');
    expect(lines[2]).toContain('╰');
    expect(lines[2]).toContain('╯');
  });

  it('coordinates two-phase slot assembly via context.state', () => {
    const context: any = { state: {} };

    // Initial call render before result
    const callComponent = renderWorkspaceServiceCall('workspace_service_stop', { service: 'indexer' }, theme, context);
    const initialCallLines = callComponent.render(80);
    expect(initialCallLines).toHaveLength(3);

    // Result arrives and marks state
    const resultComponent = renderWorkspaceServiceResult(
      'workspace_service_stop',
      { details: { ok: true, status: 'stopped', summary: 'Stopped indexer successfully.', data: { service: 'indexer' } } },
      { expanded: false },
      theme,
      context,
    );
    expect(context.state.hasResult).toBe(true);
    expect(context.state.borderColor).toBe(LIME);

    // Result component renders framed body and bottom border
    const resultLines = resultComponent.render(80);
    expect(resultLines[0]).toContain('│');
    expect(resultLines[resultLines.length - 1]).toContain('╰');
    expect(resultLines[resultLines.length - 1]).toContain(LIME);

    // Re-rendering call now collapses to only the top border in LIME
    const afterCallLines = callComponent.render(80);
    expect(afterCallLines).toHaveLength(1);
    expect(afterCallLines[0]).toContain('╭');
    expect(afterCallLines[0]).toContain(LIME);
  });

  it('sets RED border on error result', () => {
    const context: any = { state: {} };
    const resultComponent = renderWorkspaceServiceResult(
      'workspace_service_start',
      { details: { ok: false, status: 'error', summary: 'Process failed to launch.' }, isError: true },
      { expanded: false },
      theme,
      context,
    );
    expect(context.state.hasResult).toBe(true);
    expect(context.state.borderColor).toBe(RED);

    const resultLines = resultComponent.render(80);
    expect(resultLines[resultLines.length - 1]).toContain(RED);
  });

  it('falls back to single fit line when width < 24', () => {
    const callComponent = renderWorkspaceServiceCall('workspace_service_start', { service: 'api' }, theme, {});
    const lines = callComponent.render(20);
    expect(lines).toHaveLength(1);
    expect(visibleTestWidth(lines[0])).toBeLessThanOrEqual(20);
  });

  it('extracts workspace service action properly', () => {
    expect(extractWorkspaceServiceAction('workspace_services_list', {})).toBeUndefined();
    expect(extractWorkspaceServiceAction('workspace_service_start', { service: 'frontend' })).toBe('frontend');
    expect(extractWorkspaceServiceAction('workspace_service_restart', { service: 'worker' })).toBe('worker');
  });
});
