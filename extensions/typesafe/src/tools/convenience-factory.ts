import { Type } from 'typebox';
import crypto from 'node:crypto';
import type { TelemetryDb } from '../storage/telemetry-db.ts';
import type { evaluateSystemOne as defaultEvaluateSystemOne } from '../providers/typesafe-client.ts';
import type { QuestionDefinition, SystemOneRequest } from '../types.ts';
import { sanitizeState } from '../security.ts';

export const TaskSchema = Type.Object({
  task: Type.String({
    minLength: 1,
    description: 'The user prompt, subagent task, or proposed action to evaluate.',
  }),
  context: Type.Optional(Type.String({ description: 'Optional additional context or current progress.' })),
});

export const SolutionSchema = Type.Object({
  proposed_solution: Type.String({
    minLength: 1,
    description: 'The proposed plan, architectural design, or code modification to evaluate.',
  }),
  context: Type.Optional(Type.String({ description: 'Optional problem statement, original prompt, or repository background.' })),
});

export interface ConvenienceClientAdapter {
  evaluateSystemOne: typeof defaultEvaluateSystemOne;
}

export interface ScoreExtractor {
  (answers: Record<string, any> | undefined): {
    score: number;
    decision: string;
    isTriggered: boolean;
  };
}

export interface ResultFormatter {
  (score: number, decision: string, isTriggered: boolean): Record<string, any>;
}

export interface StateBuilder {
  (args: any): Record<string, any>;
}

export interface ConvenienceToolConfig {
  name: string;
  label: string;
  description: string;
  promptSnippet: string;
  promptGuidelines: string[];
  parameters: any;
  buildState: StateBuilder;
  buildQuestions: () => Record<string, QuestionDefinition>;
  extractScore: ScoreExtractor;
  formatResult: ResultFormatter;
  telemetrySource: string;
  telemetryPrefix: string;
  threshold: number;
}

export function createConvenienceTool(
  client: ConvenienceClientAdapter,
  config: ConvenienceToolConfig,
  db?: TelemetryDb
) {
  const {
    name,
    label,
    description,
    promptSnippet,
    promptGuidelines,
    parameters,
    buildState,
    buildQuestions,
    extractScore,
    formatResult,
    telemetrySource,
    telemetryPrefix,
    threshold,
  } = config;

  return {
    name,
    label,
    description,
    promptSnippet,
    promptGuidelines,
    parameters,
    execute: async (_toolCallId: string, args: any, context?: any) => {
      const telemetryId = `${telemetryPrefix}-${crypto.randomUUID()}`;
      const sessionId = context?.sessionManager?.getSessionId?.() ?? context?.sessionId;
      const state = buildState(args);
      const questions = buildQuestions();
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
        const { score, decision, isTriggered } = extractScore(answers);

        if (db) {
          try {
            db.recordEvaluation({
              id: telemetryId,
              source: telemetrySource,
              session_id: sessionId,
              created_at: new Date().toISOString(),
              model: response.model || 'jev-latest',
              latency_ms: latencyMs,
              input_tokens: (response as any).usage?.input_tokens ?? 0,
              output_tokens: (response as any).usage?.output_tokens ?? 0,
              state_json: JSON.stringify(state),
              questions_json: JSON.stringify(questions),
              response_json: JSON.stringify(response.answers),
              metadata_json: JSON.stringify({
                caller_agent: context?.caller_agent || context?.agent?.name || 'unknown',
              }),
            });
          } catch {}
        }

        const resultPayload = formatResult(score, decision, isTriggered);

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(resultPayload, null, 2) }],
          details: {
            telemetry_id: telemetryId,
            ...resultPayload,
            latency_ms: latencyMs,
          },
        };
      } catch (err: any) {
        const fallbackPayload = formatResult(0, 'none', false);
        const errorPayload = {
          ...fallbackPayload,
          error: err?.message || String(err),
        };
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(errorPayload, null, 2) }],
          details: {
            telemetry_id: telemetryId,
            ...fallbackPayload,
            latency_ms: Date.now() - start,
          },
        };
      }
    },
  };
}
