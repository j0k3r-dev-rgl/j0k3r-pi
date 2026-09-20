import { Type } from 'typebox';
import type { TelemetryDb } from '../storage/telemetry-db.ts';
import {
  evaluateShadowTriage,
  type ShadowTriageOptions,
} from '../shadow/triage-shadow.ts';
import type { evaluateSystemOne as defaultEvaluateSystemOne } from '../providers/typesafe-client.ts';

export const CanonicalRouteEnum = Type.Union(
  [
    Type.Literal('direct_orchestrator'),
    Type.Literal('planned_workflow'),
    Type.Literal('deep_researcher'),
  ],
  {
    description:
      'The canonical workflow route already chosen by the orchestrator: direct_orchestrator, planned_workflow, or deep_researcher.',
  }
);

export const ShadowToolSchema = Type.Object({
  original_prompt: Type.Optional(
    Type.String({
      description: 'The original user request or triage prompt that initiated the workflow decision.',
    })
  ),
  prompt: Type.Optional(
    Type.String({
      description: 'Alias for original_prompt.',
    })
  ),
  route: CanonicalRouteEnum,
});

export interface ShadowClientAdapter {
  evaluateSystemOne: typeof defaultEvaluateSystemOne;
}

export function createShadowTool(client: ShadowClientAdapter, db: TelemetryDb) {
  return {
    name: 'typesafe_record_shadow_triage',
    label: 'TypeSafe Record Shadow Triage',
    description:
      'Explicitly record post-decision shadow triage telemetry comparing an already-selected canonical route against TypeSafe System One prediction. Non-authoritative consultative telemetry only; route selection remains 100% authoritative.',
    parameters: ShadowToolSchema,
    execute: async (_toolCallId: string, args: any, context?: any) => {
      const originalPrompt = args.original_prompt || args.prompt;
      if (!originalPrompt || typeof originalPrompt !== 'string' || !originalPrompt.trim()) {
        throw new Error('Missing required parameter: original_prompt');
      }

      const route = args.route;
      const validRoutes = ['direct_orchestrator', 'planned_workflow', 'deep_researcher'];
      if (!validRoutes.includes(route)) {
        throw new Error(`Invalid route: ${route}. Must be one of: ${validRoutes.join(', ')}`);
      }

      const sessionId = context?.sessionManager?.getSessionId?.() ?? context?.sessionId;
      const options: ShadowTriageOptions = {
        client,
        db,
        timeoutMs: 2500,
      };

      const result = await evaluateShadowTriage(originalPrompt, route, sessionId, options);

      const output = {
        telemetry_id: result?.telemetry_id,
        recorded: true,
        actual_route: route,
        predicted_route: result?.shadow_predicted_route ?? 'unknown',
        shadow_agreement: result?.shadow_agreement,
        non_authoritative: true,
      };

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(output, null, 2),
          },
        ],
        details: {
          telemetry_id: result?.telemetry_id,
          actual_route: route,
          predicted_route: result?.shadow_predicted_route,
          shadow_agreement: result?.shadow_agreement,
          latency_ms: result?.latency_ms,
          model: 'jev-latest',
        },
      };
    },
  };
}
