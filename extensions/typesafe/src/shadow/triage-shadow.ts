import crypto from 'node:crypto';
import type { TelemetryDb } from '../storage/telemetry-db.ts';
import { evaluateSystemOne as defaultEvaluateSystemOne } from '../providers/typesafe-client.ts';
import type { QuestionDefinition } from '../types.ts';
import { sanitizeState } from '../security.ts';

export interface ShadowResult {
  telemetry_id: string;
  shadow_predicted_route: string;
  shadow_actual_route: string;
  shadow_agreement: number;
  latency_ms: number;
  confidence?: number;
  is_complex_workflow_prob?: number;
  requires_investigation_prob?: number;
}

export interface ShadowTriageOptions {
  client?: {
    evaluateSystemOne: typeof defaultEvaluateSystemOne;
  };
  db?: TelemetryDb;
  timeoutMs?: number;
}

export function buildTriageQuestions(): Record<string, QuestionDefinition> {
  return {
    suggested_lane: {
      type: 'choice',
      instructions:
        'Determine which workflow lane best fits the user request according to the triage policy: direct_orchestrator for trivial single-file edits, localized bug fixes, direct factual answers, or lightweight validation; planned_workflow for multi-step implementations, complex multi-file features, refactoring, or tasks requiring discovery and planning contracts; deep_researcher for pure investigation, codebase audits, documentation exploration, or comparisons without modifying code.',
      criteria: {
        direct_orchestrator:
          'Direct factual answers, single-file edits, localized bug fixes, lightweight verification, or when user explicitly authorizes direct work without delegation.',
        planned_workflow:
          'Multi-step implementation, complex multi-file features, refactoring, or tasks needing discovery/planning contracts under openspec.',
        deep_researcher:
          'Pure investigation, codebase audit, documentation exploration, or comparison without code changes.',
      },
    },
    is_complex_workflow: {
      type: 'noul',
      instructions:
        'Does this user request involve multi-file changes, architectural design, non-trivial refactoring, or multi-step execution that benefits from formal planning?',
      criteria: {
        true: 'Complex multi-step or multi-file change requiring formal planning',
        false: 'Simple, direct, localized, or research-only task',
      },
    },
    requires_investigation: {
      type: 'noul',
      instructions:
        'Does this request ask to investigate, research, explore, compare, or audit without modifying code?',
      criteria: {
        true: 'Standalone research or exploration request with no code modification requested',
        false: 'Implementation, fix, configuration, or direct question',
      },
    },
  };
}

export async function evaluateShadowTriage(
  userPrompt: string,
  actualRouteChosen: string,
  sessionId?: string,
  options?: ShadowTriageOptions
): Promise<ShadowResult | null> {
  // Deterministic guard: prompt must be non-empty string
  if (!userPrompt || typeof userPrompt !== 'string' || !userPrompt.trim()) {
    return null;
  }

  const client = options?.client || { evaluateSystemOne: defaultEvaluateSystemOne };
  const db = options?.db;
  const timeoutMs = options?.timeoutMs ?? 2500;
  const telemetryId = `shadow-${crypto.randomUUID()}`;

  const questions = buildTriageQuestions();
  const sanitizedPrompt = sanitizeState(userPrompt);

  try {
    const response = await client.evaluateSystemOne(
      {
        state: { user_prompt: sanitizedPrompt },
        questions,
        model: 'jev-latest',
      },
      {
        timeout: timeoutMs,
      }
    );

    const answers = response.answers || response.responses || {};
    const suggestedLaneAnswer = answers.suggested_lane;
    const predictedRoute =
      suggestedLaneAnswer && 'choice' in suggestedLaneAnswer ? suggestedLaneAnswer.choice : 'unknown';

    // Normalization check: if predictedRoute matches actualRouteChosen
    const agreement = predictedRoute === actualRouteChosen ? 1 : 0;

    const complexProb =
      answers.is_complex_workflow && 'noul' in answers.is_complex_workflow
        ? answers.is_complex_workflow.noul
        : undefined;
    const investProb =
      answers.requires_investigation && 'noul' in answers.requires_investigation
        ? answers.requires_investigation.noul
        : undefined;
    const confidence =
      suggestedLaneAnswer && 'confidence' in suggestedLaneAnswer
        ? suggestedLaneAnswer.confidence
        : undefined;

    if (db) {
      db.recordEvaluation({
        id: telemetryId,
        session_id: sessionId,
        source: 'shadow-triage',
        created_at: new Date().toISOString(),
        latency_ms: response.latency_ms,
        model: response.model,
        state_json: JSON.stringify({ user_prompt: sanitizedPrompt }),
        questions_json: JSON.stringify(questions),
        response_json: JSON.stringify(answers),
        input_tokens: response.usage?.input_tokens,
        output_tokens: response.usage?.output_tokens,
        shadow_actual_route: actualRouteChosen,
        shadow_predicted_route: predictedRoute,
        shadow_agreement: agreement,
        metadata_json: JSON.stringify({
          confidence,
          is_complex_workflow: complexProb,
          requires_investigation: investProb,
        }),
      });
    }

    return {
      telemetry_id: telemetryId,
      shadow_predicted_route: predictedRoute,
      shadow_actual_route: actualRouteChosen,
      shadow_agreement: agreement,
      latency_ms: response.latency_ms,
      confidence,
      is_complex_workflow_prob: complexProb,
      requires_investigation_prob: investProb,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    if (db) {
      try {
        db.recordEvaluation({
          id: telemetryId,
          session_id: sessionId,
          source: 'shadow-triage',
          created_at: new Date().toISOString(),
          latency_ms: 0,
          model: 'jev-latest',
          state_json: JSON.stringify({ user_prompt: sanitizedPrompt }),
          questions_json: JSON.stringify(questions),
          error: errorMsg,
          shadow_actual_route: actualRouteChosen,
        });
      } catch {}
    }
    // Never crash or interrupt host workflow
    return null;
  }
}
