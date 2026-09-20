import { Type } from 'typebox';
import crypto from 'node:crypto';
import type { TelemetryDb } from '../storage/telemetry-db.ts';
import type { evaluateSystemOne as defaultEvaluateSystemOne } from '../providers/typesafe-client.ts';
import type { QuestionDefinition, SystemOneRequest } from '../types.ts';
import { sanitizeState } from '../security.ts';

export const CircuitBreakerToolSchema = Type.Object({
  task: Type.String({
    minLength: 1,
    description: 'The user prompt, subagent task, or proposed action to evaluate for ambiguity or missing decisions.',
  }),
  context: Type.Optional(
    Type.String({
      description: 'Optional additional context or current progress.',
    })
  ),
});

export interface CircuitBreakerClientAdapter {
  evaluateSystemOne: typeof defaultEvaluateSystemOne;
}

function buildCircuitBreakerQuestions(): Record<string, QuestionDefinition> {
  return {
    circuit_breaker_needed: {
      type: 'noul',
      instructions:
        'Does this task or prompt contain missing material decisions, unresolved ambiguity, unauthorized configuration mutations, or speculative scope that requires asking the user directly instead of guessing?',
      criteria: {
        true: 'Missing material decision, unresolved ambiguity, unapproved config change, or excessive scope requiring immediate stop.',
        false: 'Clear, unambiguous, and safe to execute directly within stated scope.',
      },
    },
    decision_type: {
      type: 'choice',
      instructions: 'What category of missing decision, blocker, or trade-off is present?',
      criteria: {
        none: 'Execution is clear and authorized; no blocker.',
        missing_product_decision: 'Product or feature requirement is ambiguous or requires user-owned choice.',
        unauthorized_configuration_mutation: 'Implies altering configuration, tooling, environment, or system settings without explicit approval.',
        speculative_scope_creep: 'Scope has expanded beyond approved boundary or includes unrequested work.',
        missing_technical_fact: 'Material factual context or desired outcome is unknown.',
      },
    },
  };
}

export function createCircuitBreakerTool(client: CircuitBreakerClientAdapter, db?: TelemetryDb) {
  return {
    name: 'typesafe_circuit_breaker',
    label: 'TypeSafe Circuit Breaker',
    description:
      'Evaluate whether a task, prompt, or action has missing material decisions, configuration violations, or ambiguity that requires tripping the Circuit Breaker to ask the user directly.',
    promptSnippet: 'Check whether a task or prompt requires tripping the Circuit Breaker before executing',
    promptGuidelines: [
      'Use typesafe_circuit_breaker when a task or prompt appears ambiguous, broad, or risky before performing work.',
      'If tripped (blocked: true), stop execution immediately, formulate one concise question, and ask the user.',
    ],
    parameters: CircuitBreakerToolSchema,
    execute: async (_toolCallId: string, args: any, context?: any) => {
      const task = args.task;
      if (!task || typeof task !== 'string' || !task.trim()) {
        throw new Error('Missing required parameter: task');
      }

      const telemetryId = `cb-${crypto.randomUUID()}`;
      const sessionId = context?.sessionManager?.getSessionId?.() ?? context?.sessionId;
      const state = args.context ? { task, context: args.context } : { task };

      const questions = buildCircuitBreakerQuestions();
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
        const cbScore = answers?.circuit_breaker_needed?.noul ?? 0;
        const decisionType = answers?.decision_type?.choice ?? 'none';
        const blocked = cbScore >= 0.70 && decisionType !== 'none';

        if (db) {
          try {
            db.recordEvaluation({
              id: telemetryId,
              source: 'circuit-breaker-tool',
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
                  blocked,
                  circuit_breaker_score: cbScore,
                  decision_type: decisionType,
                  recommendation: blocked
                    ? `TRIP CIRCUIT BREAKER: Stop execution immediately and ask the user to clarify the ${decisionType.replace(/_/g, ' ')}.`
                    : 'SAFE: Clear to proceed within authorized scope.',
                },
                null,
                2
              ),
            },
          ],
          details: {
            telemetry_id: telemetryId,
            blocked,
            score: cbScore,
            decision_type: decisionType,
            latency_ms: latencyMs,
          },
        };
      } catch (err: any) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                blocked: false,
                error: err?.message || String(err),
                fallback: 'Safe fallback: review task manually against AGENTS.md rules.',
              }),
            },
          ],
          details: {
            telemetry_id: telemetryId,
            blocked: false,
            score: 0,
            decision_type: 'none',
            latency_ms: Date.now() - start,
          },
        };
      }
    },
  };
}
