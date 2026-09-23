import crypto from 'node:crypto';
import { Type } from 'typebox';
import type { TelemetryDb } from '../storage/telemetry-db.ts';
import type { evaluateSystemOne as EvaluateSystemOneFn } from '../providers/typesafe-client.ts';
import type { SystemOneRequest } from '../types.ts';
import { sanitizeState } from '../security.ts';

export const EvaluateToolSchema = Type.Object({
  state: Type.Union(
    [Type.String(), Type.Record(Type.String(), Type.Unknown()), Type.Array(Type.Unknown())],
    {
      description: 'The content, prompt, or application state to evaluate with TypeSafe System One.',
    }
  ),
  questions: Type.Record(
    Type.String(),
    Type.Object({
      type: Type.String({ description: 'Primitive type: Choice, Noul, or Score' }),
      instructions: Type.Union([
        Type.String(),
        Type.Record(Type.String(), Type.Unknown()),
        Type.Array(Type.Unknown()),
      ]),
      criteria: Type.Optional(
        Type.Union([
          Type.Record(Type.String(), Type.Union([Type.String(), Type.Null()])),
          Type.Array(Type.Unknown()),
          Type.Object({
            true: Type.Optional(Type.String()),
            false: Type.Optional(Type.String()),
          }),
        ])
      ),
    }),
    {
      description: 'Map of question definitions keyed by unique question IDs.',
    }
  ),
  model: Type.Optional(
    Type.String({
      description: 'Model name defaulting to jev-latest.',
    })
  ),
});

export interface EvaluateClientAdapter {
  evaluateSystemOne: typeof EvaluateSystemOneFn;
}

export function createEvaluateTool(client: EvaluateClientAdapter, db: TelemetryDb) {
  return {
    name: 'typesafe_evaluate',
    label: 'TypeSafe Evaluate',
    description:
      'Evaluate state against typed semantic questions (Choice, Noul, Score) using TypeSafe System One (Jev). Consultative semantic judgment only; never overrides governance policies.',
    promptGuidelines: [
      'Use typesafe_evaluate to evaluate state against typed semantic questions (Choice, Noul, Score). Consultative semantic judgment only; never overrides governance policies.',
    ],
    parameters: EvaluateToolSchema,
    execute: async (_toolCallId: string, args: any, context?: any) => {
      const telemetryId = `eval-${crypto.randomUUID()}`;
      const sessionId = context?.sessionManager?.getSessionId?.() ?? context?.sessionId;
      const model = args.model || 'jev-latest';

      const request: SystemOneRequest = {
        state: args.state,
        questions: args.questions,
        model,
      };

      try {
        const result = await client.evaluateSystemOne(request, {
          signal: context?.signal,
        });

        // Persist full telemetry to SQLite
        db.recordEvaluation({
          id: telemetryId,
          session_id: sessionId,
          source: 'evaluate-tool',
          created_at: new Date().toISOString(),
          latency_ms: result.latency_ms,
          model: result.model,
          state_json: JSON.stringify(sanitizeState(args.state)),
          questions_json: JSON.stringify(args.questions),
          response_json: JSON.stringify(result.answers),
          input_tokens: result.usage.input_tokens,
          output_tokens: result.usage.output_tokens,
        });

        const formattedOutput = {
          telemetry_id: telemetryId,
          model: result.model,
          latency_ms: result.latency_ms,
          tokens: result.usage,
          answers: result.answers,
        };

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(formattedOutput, null, 2),
            },
          ],
          details: {
            telemetry_id: telemetryId,
            model: result.model,
            latency_ms: result.latency_ms,
            input_tokens: result.usage.input_tokens,
            output_tokens: result.usage.output_tokens,
            answers: result.answers,
          },
        };
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        db.recordEvaluation({
          id: telemetryId,
          session_id: sessionId,
          source: 'evaluate-tool',
          created_at: new Date().toISOString(),
          latency_ms: 0,
          model,
          state_json: JSON.stringify(sanitizeState(args.state)),
          questions_json: JSON.stringify(args.questions),
          error: errorMsg,
        });

        throw err;
      }
    },
  };
}
