import { Type } from 'typebox';
import type { TelemetryDb } from '../storage/telemetry-db.ts';

export const TelemetryToolSchema = Type.Object({
  limit: Type.Optional(
    Type.Number({
      minimum: 1,
      maximum: 50,
      description: 'Maximum number of telemetry records to retrieve (1 to 50, default 10).',
    })
  ),
  offset: Type.Optional(
    Type.Number({
      minimum: 0,
      description: 'Pagination offset for retrieving subsequent records (default 0).',
    })
  ),
  source: Type.Optional(
    Type.String({
      description: 'Filter telemetry by source (e.g. "shadow-triage", "evaluate-tool", "benchmark").',
    })
  ),
  discrepancies_only: Type.Optional(
    Type.Boolean({
      description: 'Filter to records where shadow triage disagreed with the actual route chosen.',
    })
  ),
});

export function createTelemetryTool(db: TelemetryDb) {
  return {
    name: 'typesafe_telemetry',
    label: 'TypeSafe Telemetry',
    description:
      'Query local SQLite telemetry for TypeSafe System One evaluations, shadow triage benchmarks, latencies, and routing discrepancies.',
    parameters: TelemetryToolSchema,
    execute: async (_toolCallId: string, args: any) => {
      const limit = Math.max(1, Math.min(args.limit ?? 10, 50));
      const offset = Math.max(0, args.offset ?? 0);
      const source = args.source;
      const discrepanciesOnly = Boolean(args.discrepancies_only);

      const queryResult = db.queryTelemetry({
        limit,
        offset,
        source,
        discrepancies_only: discrepanciesOnly,
      });

      const lines: string[] = [];
      lines.push(
        `TypeSafe Telemetry Query Results (Showing ${queryResult.records.length} of ${queryResult.total} records, offset ${offset}, limit ${limit}):`
      );

      if (queryResult.records.length === 0) {
        lines.push('No matching telemetry records found.');
      } else {
        for (const record of queryResult.records) {
          const discrepancyTag =
            record.shadow_agreement === 0
              ? ` [DISCREPANCY: predicted=${record.shadow_predicted_route}, actual=${record.shadow_actual_route}]`
              : record.shadow_agreement === 1
              ? ' [AGREEMENT]'
              : '';

          lines.push(
            `- ID: ${record.id} | Source: ${record.source} | Date: ${record.created_at} | Latency: ${record.latency_ms ?? '?'}ms | Tokens: in=${record.input_tokens ?? '?'}, out=${record.output_tokens ?? '?'}${discrepancyTag}`
          );
        }
      }

      if (queryResult.has_more) {
        lines.push(
          `\nContinuation available: has_more: true. To view the next page, query with offset: ${queryResult.continuation_offset}, limit: ${limit}.`
        );
      } else {
        lines.push('\nEnd of results (has_more: false).');
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: lines.join('\n'),
          },
        ],
        details: {
          total: queryResult.total,
          offset,
          limit,
          records_count: queryResult.records.length,
          has_more: queryResult.has_more,
          continuation_offset: queryResult.continuation_offset,
          records: queryResult.records,
        },
      };
    },
  };
}
