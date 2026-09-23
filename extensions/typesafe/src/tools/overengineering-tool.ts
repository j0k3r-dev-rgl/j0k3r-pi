import type { TelemetryDb } from '../storage/telemetry-db.ts';
import type { evaluateSystemOne as defaultEvaluateSystemOne } from '../providers/typesafe-client.ts';
import type { QuestionDefinition } from '../types.ts';
import { createConvenienceTool, SolutionSchema } from './convenience-factory.ts';

export const OverengineeringToolSchema = SolutionSchema;

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
  return createConvenienceTool(client, {
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
    buildState: (args: any) =>
      args.context
        ? { proposed_solution: args.proposed_solution, problem_context: args.context }
        : { proposed_solution: args.proposed_solution },
    buildQuestions: buildOverengineeringQuestions,
    extractScore: (answers) => {
      const score = answers?.is_overengineering?.noul ?? 0;
      const decision = answers?.simplicity_verdict?.choice ?? 'simplest_sufficient';
      return { score, decision, isTriggered: score >= 0.70 || decision === 'overengineered' };
    },
    formatResult: (score, decision, isTriggered) => ({
      overengineered: isTriggered,
      overengineering_score: score,
      verdict: decision,
      recommendation: isTriggered
        ? 'REJECT SPECULATIVE COMPLEXITY: Strip unnecessary layers or abstractions; adopt the simplest direct solution that satisfies the contract.'
        : 'APPROVED: Proportional, minimal, and adheres to simplest-sufficient principles.',
    }),
    telemetrySource: 'overengineering-tool',
    telemetryPrefix: 'oe',
    threshold: 0.70,
  }, db);
}
