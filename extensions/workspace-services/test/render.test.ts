import { describe, expect, it } from 'vitest';
import { renderWorkspaceServiceResult } from '../src/render/index.js';

const theme = { fg: (_name: string, text: string) => text, bold: (text: string) => text };

const ANSI_RE = /\u001b\][^\u001b\u0007]*(?:\u001b\\|\u0007)|\u001b\[[0-?]*[ -/]*[@-~]/g;
const CJK_RE = /[\u1100-\u115f\u231a-\u231b\u2329-\u232a\u23e9-\u23ec\u23f0\u23f3\u25fd-\u25fe\u2614-\u2615\u2648-\u2653\u267f\u2693\u26a1\u26aa-\u26ab\u26bd-\u26be\u26c4-\u26c5\u26ce\u26d4\u26ea\u26f2-\u26f3\u26f5\u26fa\u26fd\u2705\u270a-\u270b\u2728\u274c\u274e\u2753-\u2755\u2757\u2795-\u2797\u27b0\u27bf\u2b1b-\u2b1c\u2b50\u2b55\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/u;
function visibleTestWidth(text: string): number { let width = 0; for (const char of text.replace(ANSI_RE, '')) width += CJK_RE.test(char) ? 2 : 1; return width; }

describe('workspace service rendering', () => {
  it('renders compact and expanded states without dropping redaction or continuation metadata', () => {
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
    const compact = renderWorkspaceServiceResult(result, { expanded: false, isPartial: false }, theme).render(80).join('\n');
    const expanded = renderWorkspaceServiceResult(result, { expanded: true, isPartial: false }, theme).render(80).join('\n');
    expect(compact).toContain('expand');
    expect(expanded).toContain('Restart after manual review.');
    expect(expanded).toContain('[REDACTED]');
    expect(expanded).toContain('Call again');
  });

  it('keeps rendered lines within a bounded visible width for wide characters', () => {
    const result = { details: { ok: true, status: 'running', summary: '日本語の非常に長い要約 '.repeat(10), data: { service: 'svc', text: '詳細 '.repeat(20) } } };
    const lines = renderWorkspaceServiceResult(result, { expanded: true, isPartial: false }, theme).render(80);
    for (const line of lines) expect(visibleTestWidth(line)).toBeLessThanOrEqual(80);
  });
});
