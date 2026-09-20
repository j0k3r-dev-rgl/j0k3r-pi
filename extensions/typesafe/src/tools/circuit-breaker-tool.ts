import type { TelemetryDb } from '../storage/telemetry-db.ts';
import type { evaluateSystemOne as defaultEvaluateSystemOne } from '../providers/typesafe-client.ts';
import type { QuestionDefinition } from '../types.ts';
import { createConvenienceTool, TaskSchema } from './convenience-factory.ts';

export const CircuitBreakerToolSchema = TaskSchema;

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
  return createConvenienceTool(client, {
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
    buildState: (args: any) => (args.context ? { task: args.task, context: args.context } : { task: args.task }),
    buildQuestions: buildCircuitBreakerQuestions,
    extractScore: (answers) => {
      const score = answers?.circuit_breaker_needed?.noul ?? 0;
      const decision = answers?.decision_type?.choice ?? 'none';
      return { score, decision, isTriggered: score >= 0.70 && decision !== 'none' };
    },
    formatResult: (score, decision, isTriggered) => ({
      blocked: isTriggered,
      circuit_breaker_score: score,
      decision_type: decision,
      recommendation: isTriggered
        ? `TRIP CIRCUIT BREAKER: Stop execution immediately and ask the user to clarify the ${decision.replace(/_/g, ' ')}.`
        : 'SAFE: Clear to proceed within authorized scope.',
    }),
    telemetrySource: 'circuit-breaker-tool',
    telemetryPrefix: 'cb',
    threshold: 0.70,
  }, db);
}
