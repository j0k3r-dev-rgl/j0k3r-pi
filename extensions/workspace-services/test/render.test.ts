import { describe, expect, it } from 'vitest';
import {
  LIME,
  RED,
  extractWorkspaceServiceAction,
  renderWorkspaceServiceCall,
  renderWorkspaceServiceResult,
  stripAnsi,
  visibleWidth,
} from '../src/render/index.js';

const theme = { fg: (_name: string, text: string) => text, bold: (text: string) => text };

function assertUnboxedAndNoHints(lines: string[]): void {
  const joined = lines.join('\n');
  expect(joined).not.toMatch(/[╭╮╰╯│]/);
  expect(joined).not.toMatch(/\x1b\[(?:4[0-7]|48;|10[0-7]|7m)/);
  expect(stripAnsi(joined)).not.toMatch(/\b(to expand|to collapse|ctrl\+o|app\.tools\.expand)\b/i);
}

describe('workspace service compact rendering', () => {
  it('renders single inline collapsed and lossless unboxed expanded states without hints', () => {
    const result = {
      content: [{ type: 'text', text: 'returned content block' }],
      details: {
        ok: false,
        status: 'recovery_required',
        summary: 'Needs reconciliation.',
        nextAction: 'Restart after manual review.',
        data: { service: 'svc', text: '秘密 [REDACTED] value\nliteral ╭box╮ to expand' },
        truncation: { returned: 1, total: 3, hasMore: true, continuation: 'Call again' },
      },
    };
    const compactLines = renderWorkspaceServiceResult('workspace_service_logs', result, { expanded: false, isPartial: false }, theme, { args: { service: 'svc' }, state: {} }).render(80);
    expect(compactLines).toHaveLength(1);
    const compact = stripAnsi(compactLines[0]);
    expect(compact).toContain('workspace_service_logs');
    expect(compact).toContain('───');
    expect(compact).toContain('more available');
    expect(stripAnsi(renderWorkspaceServiceResult('workspace_service_logs', result, { expanded: false, isPartial: false }, theme, { args: { service: 'svc' }, state: {} }).render(100)[0])).toContain('Needs reconciliation.');
    assertUnboxedAndNoHints(compactLines);

    const expandedLines = renderWorkspaceServiceResult('workspace_service_logs', result, { expanded: true, isPartial: false }, theme, { args: { service: 'svc' }, state: {} }).render(80);
    const expanded = stripAnsi(expandedLines.join('\n'));
    expect(expanded).toContain('Restart after manual review.');
    expect(expanded).toContain('[REDACTED]');
    expect(expanded).toContain('Call again');
    expect(expanded).toContain('returned content block');
    expect(expanded).toContain('literal ╭box╮ to expand');
    expect(expanded).not.toMatch(/ctrl\+o/i);
  });

  it('keeps rendered lines within supplied width including 0, 1, 2, 10, 20, 24, 40, 80, 120 with wide chars and OSC 8', () => {
    const result = {
      content: [{ type: 'text', text: '漢字🚀 café\u0301 \x1b]8;;https://example.com\x07link\x1b]8;;\x07' }],
      details: { ok: true, status: 'running', summary: '日本語の非常に長い要約 '.repeat(10), data: { service: 'svc', text: '詳細 '.repeat(20) } },
    };
    const comp = renderWorkspaceServiceResult(result, { expanded: true, isPartial: false }, theme);
    expect(comp.render(0)).toEqual([]);
    for (const width of [1, 2, 10, 20, 24, 40, 80, 120]) {
      for (const line of comp.render(width)) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });

  it('renders single inline pending row during call phase and extracts action badge', () => {
    const context: any = { state: {} };
    const callComponent = renderWorkspaceServiceCall('workspace_service_start', { service: 'web-api' }, theme, context);
    const lines = callComponent.render(80);

    expect(lines).toHaveLength(1);
    const plain = stripAnsi(lines[0]);
    expect(plain).toContain('workspace_service_start [web-api]');
    expect(plain).toContain('───');
    expect(plain).toContain('Pending: web-api');
    assertUnboxedAndNoHints(lines);
  });

  it('coordinates call and result into one combined inline row via context.state', () => {
    const context: any = { state: {}, args: { service: 'indexer' } };
    const callComponent = renderWorkspaceServiceCall('workspace_service_stop', { service: 'indexer' }, theme, context);
    expect(callComponent.render(80)).toHaveLength(1);

    const resultComponent = renderWorkspaceServiceResult(
      'workspace_service_stop',
      { details: { ok: true, status: 'stopped', summary: 'Stopped indexer successfully.', data: { service: 'indexer' } } },
      { expanded: false },
      theme,
      context,
    );
    expect(context.state.hasResult).toBe(true);
    expect(context.state.borderColor).toBe(LIME);
    expect(callComponent.render(80)).toEqual([]);

    const resultLines = resultComponent.render(80);
    expect(resultLines).toHaveLength(1);
    expect(resultLines[0]).toContain(LIME);
    expect(stripAnsi(resultLines[0])).toContain('workspace_service_stop [indexer]');
    expect(stripAnsi(resultLines[0])).toContain('Stopped indexer successfully.');
    assertUnboxedAndNoHints(resultLines);
  });

  it('sets RED color on error result and handles partial state in one line', () => {
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
    expect(resultLines).toHaveLength(1);
    expect(resultLines[0]).toContain(RED);
    assertUnboxedAndNoHints(resultLines);

    const partialLines = renderWorkspaceServiceResult(
      'workspace_service_start',
      { content: [], details: undefined },
      { expanded: false, isPartial: true },
      theme,
      { args: { service: 'api' }, state: {} },
    ).render(80);
    expect(partialLines).toHaveLength(1);
    expect(stripAnsi(partialLines[0])).toContain('running…');
    assertUnboxedAndNoHints(partialLines);
  });

  it.each([false, true])('renders native errors as warnings with expanded=%s', (expanded) => {
    const message = 'No Docker Compose file found in workspace root.';
    for (const details of [{}, undefined]) {
      const result = {
        content: [{ type: 'text', text: message }],
        details,
        isError: true,
      };
      const component = renderWorkspaceServiceResult('workspace_service_start', result, { expanded }, theme);
      const rendered = component.render(100);
      const text = rendered.map(stripAnsi).join('\n');
      expect(text).toContain(`Warning: ${message}`);
      expect(text).not.toContain('undefined');
      assertUnboxedAndNoHints(rendered);
      for (const width of [1, 2, 20, 24, 40, 80, 100]) {
        for (const line of component.render(width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
      component.invalidate();
      expect(component.render(100).map(stripAnsi).join('\n')).toBe(text);
    }
  });

  it.each([false, true])('handles errors flagged by Pi render context with expanded=%s', (expanded) => {
    const result = { content: [{ type: 'text', text: 'Service start was cancelled.' }], details: {} };
    const context = { isError: true, state: {} };
    const text = renderWorkspaceServiceResult('workspace_service_start', result, { expanded }, theme, context)
      .render(80).map(stripAnsi).join('\n');
    expect(text).toContain('Warning: Service start was cancelled.');
    expect(text).not.toContain('undefined');
  });

  it.each([false, true])('warns about incomplete outcomes with expanded=%s', (expanded) => {
    for (const details of [{}, { ok: false }, { ok: true, summary: 42 }, undefined]) {
      const text = renderWorkspaceServiceResult({ details }, { expanded }, theme)
        .render(100).map(stripAnsi).join('\n');
      expect(text).toContain('Warning: workspace service result is missing details.');
      expect(text).not.toContain('undefined');
    }
  });

  it.each([false, true])('uses an error summary when no text content is available with expanded=%s', (expanded) => {
    const result = { details: { ok: false, status: 'error', summary: 'Process failed to launch.' }, isError: true };
    const text = renderWorkspaceServiceResult('workspace_service_start', result, { expanded }, theme)
      .render(80).map(stripAnsi).join('\n');
    expect(text).toContain('Warning: Process failed to launch.');
  });

  it('extracts workspace service action properly and never throws on malformed inputs', () => {
    expect(extractWorkspaceServiceAction('workspace_services_list', {})).toBeUndefined();
    expect(extractWorkspaceServiceAction('workspace_service_start', { service: 'frontend' })).toBe('frontend');
    expect(extractWorkspaceServiceAction('workspace_service_restart', { service: 'worker' })).toBe('worker');
    expect(() => renderWorkspaceServiceCall('workspace_service_start', null, undefined, undefined).render(80)).not.toThrow();
    expect(() => renderWorkspaceServiceResult('workspace_service_start', null as any, undefined, undefined, undefined).render(80)).not.toThrow();
  });

  it('renders partial observations as warning/partial rather than green success-complete', () => {
    const result = {
      content: [{ type: 'text', text: 'workspace_services_status: 1 service(s) checked (partial)\nwarning: Docker daemon unavailable' }],
      details: {
        ok: true,
        status: 'partial' as const,
        summary: '1 service(s) checked (partial)',
        warnings: ['Docker daemon unavailable'],
        nextAction: 'Start Docker and retry.',
        data: {},
      },
    };
    const compact = renderWorkspaceServiceResult('workspace_services_status', result, { expanded: false, isPartial: false }, theme, { state: {} }).render(80);
    expect(compact).toHaveLength(1);
    expect(compact[0]).not.toContain(LIME);
    expect(stripAnsi(compact[0])).toContain('partial');
    expect(stripAnsi(compact[0])).not.toContain('✓');
    assertUnboxedAndNoHints(compact);

    const expanded = renderWorkspaceServiceResult('workspace_services_status', result, { expanded: true, isPartial: false }, theme, { state: {} }).render(80);
    const expandedPlain = stripAnsi(expanded.join('\n'));
    expect(expandedPlain).toContain('Docker daemon unavailable');
    expect(expandedPlain).toContain('Start Docker and retry.');
    assertUnboxedAndNoHints(expanded);
  });

  it('does not duplicate summary, tool name, log payload, or nextAction in expanded view while preserving genuine duplicate log lines', () => {
    const logPayload = 'dup log line\ndup log line\nfinal log line';
    const nextAction = 'Call workspace_service_logs with service=svc, lines=100, and offset=100 for older logs.';
    const contentText = [
      'workspace_service_logs: Retrieved 3 log line(s) for svc.',
      'log_path=/tmp/svc.log returned_lines=3 offset=0 has_more=true',
      logPayload,
      `continuation: ${nextAction}`,
    ].join('\n');
    const result = {
      content: [{ type: 'text', text: contentText }],
      details: {
        ok: true,
        status: 'ok' as const,
        summary: 'Retrieved 3 log line(s) for svc.',
        nextAction,
        data: { service: 'svc', text: logPayload },
        truncation: { returned: 3, hasMore: true, continuation: nextAction },
      },
    };

    const expanded = renderWorkspaceServiceResult('workspace_service_logs', result, { expanded: true, isPartial: false }, theme, { args: { service: 'svc' }, state: {} }).render(120);
    const plain = stripAnsi(expanded.join('\n'));
    expect(plain.match(/workspace_service_logs \[/g)).toHaveLength(1);
    expect(plain).not.toContain('workspace_service_logs: Retrieved');
    expect(plain.match(/Retrieved 3 log line\(s\) for svc\./g)).toHaveLength(1);
    expect(plain.match(/dup log line/g)).toHaveLength(2);
    expect(plain.match(/final log line/g)).toHaveLength(1);
    expect(plain.match(/offset=100/g)).toHaveLength(1);
    assertUnboxedAndNoHints(expanded);
  });

  it('preserves 1-column left margin at normal widths and omits margin at width 2 only when needed for an intact wide grapheme', () => {
    const asciiResult = {
      content: [{ type: 'text', text: 'abcd' }],
      details: { ok: true, status: 'ok' as const, summary: 'abcd', data: {} },
    };
    const asciiW2 = renderWorkspaceServiceResult('workspace_services_list', asciiResult, { expanded: true }, theme).render(2);
    for (const line of asciiW2) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(2);
      if (stripAnsi(line).trim().length > 0) expect(stripAnsi(line).startsWith(' ')).toBe(true);
    }

    const wideResult = {
      content: [{ type: 'text', text: '漢\n🚀' }],
      details: { ok: true, status: 'ok' as const, summary: '漢', data: {} },
    };
    const wideW2 = renderWorkspaceServiceResult('workspace_services_list', wideResult, { expanded: true }, theme).render(2);
    const widePlain = wideW2.map(stripAnsi).join('\n');
    expect(widePlain).toContain('漢');
    expect(widePlain).toContain('🚀');
    for (const line of wideW2) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(2);
    }

    const wideW20 = renderWorkspaceServiceResult('workspace_services_list', wideResult, { expanded: true }, theme).render(20);
    for (const line of wideW20) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(20);
      expect(stripAnsi(line).startsWith(' ')).toBe(true);
    }
  });
});
