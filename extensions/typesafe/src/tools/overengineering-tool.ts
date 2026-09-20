import { Type } from 'typebox';
import crypto from 'node:crypto';
import type { TelemetryDb } from '../storage/telemetry-db.ts';
import type { evaluateSystemOne as defaultEvaluateSystemOne } from '../providers/typesafe-client.ts';
import type { QuestionDefinition, SystemOneRequest } from '../types.ts';
import { sanitizeState } from '../security.ts';

export const OverengineeringToolSchema = Type.Object({
  proposed_solution: Type.String({
    minLength: 1,
    description: 'The proposed plan, architectural design, or code modification to evaluate against KISS and YAGNI.',
  }),
  context: Type.Optional(
    Type.String({
      description: 'Optional problem statement, original prompt, or repository background.',
    })
  ),
});

export interface OverengineeringClientAdapter {
  evaluateSystemOne: typeof defaultEvaluateSystemOne;
}

function buildOverengineeringQuestions(): Record<string, QuestionDefinition> {
  return {
    is_overengineering: {
      type: 'noul',
      instructions:
        'Does the proposed solution introduce unnecessary abstractions, premature generalizations, unrequested architectural layers, speculative extensibility, or unneeded dependencies (violating KISS and YAGNI)?',
      criteria: {
        true: 'Overengineered, speculative, or introduces unnecessary abstractions/layers when a simpler solution exists.',
        false: 'Simplest sufficient solution, proportional, and directly solves the task without waste.',
      },
    },
    simplicity_verdict: {
      type: 'choice',
      instructions: 'Classify the complexity level of the proposed solution:',
      criteria: {
        simplest_sufficient: 'Direct, focused, minimal, and easiest to maintain and revert (KISS/YAGNI compliant).',
        moderate: 'Reasonable complexity with minor abstractions, acceptable if justified by existing contracts.',
        overengineered: 'Unnecessary new patterns, premature abstractions, speculative config, or excess layers.',
      },
    },
  };
}

export function createOverengineeringTool(client: OverengineeringClientAdapter, db?: TelemetryDb) {
  return {
    name: 'typesafe_check_overengineering',
    label: 'TypeSafe Check Overengineering',
    description:
      'Evaluate a proposed design, architecture, or plan against KISS, YAGNI, and anti-overengineering principles using TypeSafe System One (Jev).',
    promptSnippet: 'Check whether a proposed solution or design violates KISS/YAGNI or introduces overengineering',
    promptGuidelines: [
      'Use typesafe_check_overengineering during planning or before applying architectural changes.',
      'If overengineering is detected (is_overengineering >= 0.70 or verdict: overengineered), simplify to the smallest direct change.',
    ],
    parameters: OverengineeringToolSchema,
    execute: async (_toolCallId: string, args: any, context?: any) => {
      const solution = args.proposed_solution;
      if (!solution || typeof solution !== 'string' || !solution.trim()) {
        throw new Error('Missing required parameter: proposed_solution');
      }

      const telemetryId = `oe-${crypto.randomUUID()}`;
      const sessionId = context?.sessionManager?.getSessionId?.() ?? context?.sessionId;
      const state = args.context
        ? { proposed_solution: solution, problem_context: args.context }
        : { proposed_solution: solution };

      const questions = buildOverengineeringQuestions();
      const request: SystemOneRequest = {
        state: sanitizeState(state),
        questions,
        model: 'jev-latest',
      };

      const start = Date.now();
      try {
        const response = await client.evaluateSystemOne(request, {
          signal: context?.signal,
          timeout: 4000,
        });
        const latencyMs = Date.now() - start;

        const answers = response.answers as Record<string, any> | undefined;
        const oeScore = answers?.is_overengineering?.noul ?? 0;
        const verdict = answers?.simplicity_verdict?.choice ?? 'simplest_sufficient';
        const isExcessive = oeScore >= 0.70 || verdict === 'overengineered';

        if (db) {
          try {
            db.recordEvaluation({
              id: telemetryId,
              source: 'overengineering-tool',
              session_id: sessionId,
              created_at: new Date().toISOString(),
              model: response.model || 'jev-latest',
              latency_ms: latencyMs,
              input_tokens: (response as any).tokens?.input_tokens ?? 0,
              output_tokens: (response as any).tokens?.output_tokens ?? 0,
              state_json: JSON.stringify(state),
              questions_json: JSON.stringify(questions),
              response_json: JSON.stringify(response.answers),
            });
          } catch {}
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  overengineered: isExcessive,
                  overengineering_score: oeScore,
                  verdict,
                  recommendation: isExcessive
                    ? 'REJECT SPECULATIVE COMPLEXITY: Strip unnecessary layers or abstractions; adopt the simplest direct solution that satisfies the contract.'
                    : 'APPROVED: Proportional, minimal, and adheres to simplest-sufficient principles.',
                },
                null,
                2
              ),
            },
          ],
          details: {
            telemetry_id: telemetryId,
            overengineered: isExcessive,
            score: oeScore,
            verdict,
            latency_ms: latencyMs,
          },
        };
      } catch (err: any) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                overengineered: false,
                error: err?.message || String(err),
                fallback: 'Safe fallback: review design manually against anti-overengineering skill.',
              }),
            },
          ],
          details: {
            telemetry_id: telemetryId,
            overengineered: false,
            score: 0,
            verdict: 'simplest_sufficient',
            latency_ms: Date.now() - start,
          },
        };
      }
    },
  };
}
