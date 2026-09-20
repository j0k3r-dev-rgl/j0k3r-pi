import {
  RESET,
  YELLOW,
  RED,
  LIME,
  AMBER,
  DIM,
  electric,
  stripAnsi,
  charWidth,
  visibleWidth,
  wrapLine,
  truncateToWidth,
  fit,
  pad,
  toolHint,
  boxLine,
  cardTopBorder,
  cardBottomBorder,
  frameContent,
} from './borders.ts';

import type { TypesafeCardState } from './components.ts';
import {
  TypesafeCardCallComponent,
  TypesafeCardResultComponent,
  getTypesafeBorderColor,
} from './components.ts';

export type { TypesafeCardState };
export {
  RESET,
  YELLOW,
  RED,
  LIME,
  AMBER,
  DIM,
  electric,
  stripAnsi,
  charWidth,
  visibleWidth,
  wrapLine,
  truncateToWidth,
  fit,
  pad,
  toolHint,
  boxLine,
  cardTopBorder,
  cardBottomBorder,
  frameContent,
  TypesafeCardCallComponent,
  TypesafeCardResultComponent,
  getTypesafeBorderColor,
};

export class SimpleTextComponent {
  readonly text: string;
  readonly paddingX: number;
  readonly paddingY: number;

  constructor(text: string, paddingX = 0, paddingY = 0) {
    this.text = text;
    this.paddingX = paddingX;
    this.paddingY = paddingY;
  }

  render(width: number): string[] {
    if (width <= 0) return [''];
    const availableWidth = Math.max(1, width - 2 * this.paddingX);
    const rawLines = this.text.split('\n');
    const wrappedLines: string[] = [];

    for (const rawLine of rawLines) {
      const wrapped = wrapLine(rawLine, availableWidth);
      for (const line of wrapped) {
        const pad = ' '.repeat(this.paddingX);
        wrappedLines.push(`${pad}${line}${pad}`);
      }
    }

    const padYLines = Array(this.paddingY).fill(' '.repeat(Math.min(width, 2 * this.paddingX)));
    return [...padYLines, ...wrappedLines, ...padYLines];
  }

  invalidate(): void {}
}

function inferToolCallInfo(args: any): { toolName: string; action: string; pendingStatus: string } {
  if (args?.route !== undefined || args?.original_prompt !== undefined) {
    const route = args.route ? String(args.route) : 'triage';
    return {
      toolName: 'typesafe_shadow',
      action: route,
      pendingStatus: `${electric(YELLOW, '●')} ${electric(DIM, 'Evaluating shadow triage comparison...')}`,
    };
  }
  if (args?.discrepancies_only !== undefined || args?.limit !== undefined || args?.offset !== undefined) {
    const action = args.discrepancies_only
      ? 'discrepancies'
      : `${args.limit ?? 10} records`;
    return {
      toolName: 'typesafe_telemetry',
      action,
      pendingStatus: `${electric(YELLOW, '●')} ${electric(DIM, 'Querying telemetry records...')}`,
    };
  }
  const model = args?.model ? String(args.model) : 'jev-1.13.0';
  return {
    toolName: 'typesafe_evaluate',
    action: model,
    pendingStatus: `${electric(YELLOW, '●')} ${electric(DIM, 'Evaluating with TypeSafe System One...')}`,
  };
}

export function renderTypesafeCall(args: any, _theme: any, context?: any) {
  const state: TypesafeCardState = context?.state ?? {};
  if (context?.isError) {
    state.isError = true;
  }
  const { toolName, action, pendingStatus } = inferToolCallInfo(args);

  return new TypesafeCardCallComponent(
    toolName,
    () => action,
    () => pendingStatus,
    getTypesafeBorderColor,
    state
  );
}

function extractText(result: any): string {
  if (!result?.content || !Array.isArray(result.content)) return '';
  return result.content
    .filter((c: any) => c.type === 'text' && typeof c.text === 'string')
    .map((c: any) => c.text)
    .join('\n');
}

export function renderTypesafeResult(
  result: any,
  options: { expanded: boolean; isPartial?: boolean },
  _theme: any,
  context?: any
) {
  const state: TypesafeCardState = context?.state ?? {};
  const { expanded, isPartial } = options;
  state.isPartial = isPartial ?? false;
  state.expanded = expanded ?? false;

  const isError = Boolean(context?.isError || result?.details?.error);
  if (isError) {
    state.isError = true;
  }

  const customKey =
    context?.keybindings?.get?.('app.tools.expand') ||
    (typeof context?.keyHint === 'function' ? context.keyHint('app.tools.expand') : undefined);
  const hint = (action: string) => toolHint(action, customKey);

  // 1. Partial streaming state
  if (isPartial) {
    return new TypesafeCardResultComponent(
      () => [
        `${electric(YELLOW, '●')} ${electric(DIM, 'Evaluating with TypeSafe System One...')}`,
      ],
      getTypesafeBorderColor,
      state,
      true
    );
  }

  // 2. Error state
  if (isError) {
    const errorMsg = result?.details?.error || extractText(result) || 'An unknown error occurred';
    return new TypesafeCardResultComponent(
      () => {
        if (!expanded) {
          return [
            `${electric(RED, '✗')} ${electric(RED, `TypeSafe Error: ${errorMsg}`)} · ${hint('to expand')}`,
          ];
        }
        return [
          `${electric(RED, '✗')} ${electric(RED, `TypeSafe Error: ${errorMsg}`)}`,
          '',
          hint('to collapse'),
        ];
      },
      getTypesafeBorderColor,
      state,
      true
    );
  }

  const details = result?.details || {};
  const latencyMs = details.latency_ms !== undefined ? `${details.latency_ms}ms` : '';
  const tokens =
    details.input_tokens !== undefined
      ? `${details.input_tokens}in/${details.output_tokens ?? 0}out`
      : '';
  const model = details.model || 'jev-1.13.0';

  // 3. Shadow Triage result
  if (details.shadow_agreement !== undefined || details.actual_route !== undefined) {
    const isMatch = details.shadow_agreement === 1;
    return new TypesafeCardResultComponent(
      () => {
        if (!expanded) {
          if (isMatch) {
            const line = `${electric(LIME, '✓')} ${electric(YELLOW, '[typesafe:shadow]')} actual=${details.actual_route} = predicted=${details.predicted_route} (Match) · ${hint('to expand')}`;
            return [line];
          }
          const badge = electric(AMBER, `DISCREPANCY: actual=${details.actual_route} ≠ predicted=${details.predicted_route}`);
          const line = `${electric(AMBER, '▲')} ${electric(YELLOW, '[typesafe:shadow]')} ${badge} · ${hint('to expand')}`;
          return [line];
        }

        const lines: string[] = [];
        lines.push(`TypeSafe Shadow Triage Comparison (Consultative)`);
        if (details.telemetry_id) {
          lines.push(electric(DIM, `Telemetry ID: ${details.telemetry_id}`));
        }
        if (latencyMs || tokens) {
          lines.push(electric(DIM, `Latency: ${latencyMs} | Token Usage: ${tokens}`));
        }
        lines.push('');
        lines.push('Comparison Breakdown:');
        lines.push(`  • Selected Route: ${details.actual_route}`);
        lines.push(`  • Predicted Route: ${details.predicted_route}`);
        if (isMatch) {
          lines.push(`  • Agreement: 1 (Match)`);
        } else {
          lines.push(`  • Agreement: ${electric(AMBER, '0 (Discrepancy)')}`);
        }
        lines.push('  • LLM triage route selection remains 100% authoritative.');

        if (details.answers && typeof details.answers === 'object') {
          lines.push('');
          lines.push('Questions & Judgments:');
          for (const [qid, ans] of Object.entries(details.answers as Record<string, any>)) {
            if (ans.type === 'choice') {
              const conf = Math.round((ans.confidence || 0) * 100);
              lines.push(`  • ${qid} [Choice]: ${ans.choice} (Confidence: ${conf}%)`);
            } else if (ans.type === 'noul') {
              const pct = Math.round((ans.noul || 0) * 100);
              lines.push(`  • ${qid} [Noul]: ${pct}% probability of true`);
            }
          }
        }
        lines.push('');
        lines.push(hint('to collapse'));
        return lines;
      },
      getTypesafeBorderColor,
      state,
      true
    );
  }

  // 4. Telemetry Query result
  if (details.records !== undefined || details.records_count !== undefined) {
    const count = details.records_count ?? (Array.isArray(details.records) ? details.records.length : 0);
    const total = details.total ?? count;
    const offset = details.offset ?? 0;

    return new TypesafeCardResultComponent(
      () => {
        if (!expanded) {
          const line = `${electric(LIME, '✓')} ${electric(YELLOW, '[typesafe:telemetry]')} ${count} records (total ${total}) · offset ${offset}-${offset + count} · ${hint('to expand')}`;
          return [line];
        }

        const lines: string[] = [];
        lines.push(`TypeSafe Telemetry Records`);
        lines.push(electric(DIM, `Showing ${count} records (total ${total}, offset ${offset})`));
        lines.push('');

        if (Array.isArray(details.records) && details.records.length > 0) {
          lines.push('Records:');
          for (const r of details.records) {
            lines.push(`  • [${r.source}] ${r.id} (${r.created_at || 'recent'}, ${r.latency_ms ?? 0}ms)`);
            if (r.shadow_actual_route) {
              lines.push(`    Route: actual=${r.shadow_actual_route}, predicted=${r.shadow_predicted_route}, agreement=${r.shadow_agreement}`);
            }
          }
        } else {
          lines.push('No telemetry records found.');
        }

        if (details.has_more) {
          lines.push('');
          lines.push(`Continuation: Pass offset=${details.continuation_offset ?? offset + count} to query next page.`);
        }
        lines.push('');
        lines.push(hint('to collapse'));
        return lines;
      },
      getTypesafeBorderColor,
      state,
      true
    );
  }

  // 5. Evaluate result (standard System One evaluation)
  let summary = '';
  if (details.answers && typeof details.answers === 'object') {
    const entries = Object.entries(details.answers);
    if (entries.length > 0) {
      const [firstKey, firstAnswer]: [string, any] = entries[0];
      if (firstAnswer.choice) {
        summary = `${firstKey}=${firstAnswer.choice} (${Math.round((firstAnswer.confidence || 0) * 100)}%)`;
      } else if (firstAnswer.noul !== undefined) {
        summary = `${firstKey}=${Math.round(firstAnswer.noul * 100)}%`;
      } else if (firstAnswer.score !== undefined) {
        summary = `${firstKey}=${firstAnswer.score}`;
      }
    }
  }

  return new TypesafeCardResultComponent(
    () => {
      if (!expanded) {
        const statsStr = `${model} ${latencyMs} ${tokens}`.trim();
        const statsDim = statsStr ? electric(DIM, statsStr) : '';
        const summaryText = summary ? ` → ${summary}` : '';
        const line = `${electric(LIME, '✓')} ${electric(YELLOW, '[typesafe]')} ${statsDim}${summaryText} · ${hint('to expand')}`;
        return [line];
      }

      const lines: string[] = [];
      lines.push(`TypeSafe System One Evaluation (${model})`);
      if (details.telemetry_id) {
        lines.push(electric(DIM, `Telemetry ID: ${details.telemetry_id}`));
      }
      lines.push(electric(DIM, `Latency: ${latencyMs} | Token Usage: ${tokens}`));

      if (details.answers && typeof details.answers === 'object') {
        lines.push('');
        lines.push('Questions & Judgments:');
        for (const [qid, ans] of Object.entries(details.answers as Record<string, any>)) {
          if (ans.type === 'choice') {
            const confPercent = Math.round((ans.confidence || 0) * 100);
            lines.push(`  • ${qid} [Choice]: ${ans.choice} (Confidence: ${confPercent}%)`);
            if (ans.probabilities) {
              const probStr = Object.entries(ans.probabilities)
                .map(([opt, p]) => `${opt}: ${Math.round(Number(p) * 100)}%`)
                .join(', ');
              lines.push(`    Probabilities: { ${probStr} }`);
            }
          } else if (ans.type === 'noul') {
            const pct = Math.round((ans.noul || 0) * 100);
            lines.push(`  • ${qid} [Noul]: ${pct}% probability of true`);
          } else if (ans.type === 'score') {
            lines.push(`  • ${qid} [Score]: ${ans.score}`);
            if (ans.probabilities) {
              const probStr = Object.entries(ans.probabilities)
                .map(([lvl, p]) => `Lvl ${lvl}: ${Math.round(Number(p) * 100)}%`)
                .join(', ');
              lines.push(`    Probabilities: { ${probStr} }`);
            }
          } else {
            lines.push(`  • ${qid}: ${JSON.stringify(ans)}`);
          }
        }
      }

      lines.push('');
      lines.push(hint('to collapse'));
      return lines;
    },
    getTypesafeBorderColor,
    state,
    true
  );
}
