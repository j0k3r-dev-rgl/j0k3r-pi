import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { TelemetryDb } from '../storage/telemetry-db.ts';
import { evaluateSystemOne as defaultEvaluateSystemOne } from '../providers/typesafe-client.ts';
import type { QuestionDefinition } from '../types.ts';
import { sanitizeState } from '../security.ts';

// ── Compact triage policy: the rules of the game Jev must know ──────────────
export const TRIAGE_POLICY_SUMMARY = `
TRIAGE RULES FOR WORKFLOW ROUTING:

1. direct_orchestrator:
   - Trivial single-file edits, localized bug fixes
   - Direct factual answers, exact known reads
   - Lightweight validation, explicit direct-authorization
   - "Review/audit existing code" WITH named files → direct_orchestrator

2. planned_workflow:
   - Multi-step implementations, complex multi-file features
   - Refactoring, tasks needing discovery/planning contracts
   - Scoped work WITH named technologies/stacks
   - "Investigate/implement X in React Native" = scoped implementation

3. deep_researcher:
   - Pure investigation, codebase audits, documentation exploration
   - Comparisons WITHOUT code changes
   - "Investigate HOW to do X" with NO stack mentioned → deep_researcher
   - Open-ended exploration, learning before implementing

KEY DISTINCTIONS:
- The verb "investigate" ALONE does NOT determine the lane.
- "Investigate HOW" (cómo) → research first → deep_researcher
- "Implement X in [technology]" → scoped work → planned_workflow
- Named files/technologies = concrete scope, NOT pure research
- Confirmation turns ("yes", "proceed") are NOT triage decisions

CIRCUIT BREAKER:
- When missing material decisions, unresolved ambiguity, or unauthorized config changes
- When Jev prediction DISAGREES with orchestrator choice → STOP and ask USER
- The USER decides the final route, not the agent.
`;

export interface ShadowResult {
  telemetry_id: string;
  shadow_predicted_route: string;
  shadow_actual_route: string;
  shadow_agreement: number;
  latency_ms: number;
  confidence?: number;
  is_complex_workflow_prob?: number;
  requires_investigation_prob?: number;
  discrepancy_detected?: boolean;
  jev_recommendation?: string;
  orchestrator_recommendation?: string;
  user_decision_required?: boolean;
}

export interface ShadowTriageOptions {
  client?: {
    evaluateSystemOne: typeof defaultEvaluateSystemOne;
  };
  db?: TelemetryDb;
  timeoutMs?: number;
}

export { detectProjectContext };

export interface ProjectContext {
  stack?: string;
  file_count_approx?: number;
  has_codegraph_index?: boolean;
}

function detectProjectContext(cwd: string = process.cwd()): ProjectContext {
  const ctx: ProjectContext = {};
  try {
    if (fs.existsSync(path.join(cwd, 'package.json'))) {
      ctx.stack = 'nodejs';
    } else if (
      fs.existsSync(path.join(cwd, 'requirements.txt')) ||
      fs.existsSync(path.join(cwd, 'pyproject.toml'))
    ) {
      ctx.stack = 'python';
    } else if (fs.existsSync(path.join(cwd, 'Cargo.toml'))) {
      ctx.stack = 'rust';
    } else if (
      fs.existsSync(path.join(cwd, 'pom.xml')) ||
      fs.existsSync(path.join(cwd, 'build.gradle')) ||
      fs.existsSync(path.join(cwd, 'build.gradle.kts'))
    ) {
      ctx.stack = 'jvm';
    } else if (fs.existsSync(path.join(cwd, 'go.mod'))) {
      ctx.stack = 'go';
    }

    ctx.has_codegraph_index =
      fs.existsSync(path.join(cwd, '.codegraph')) ||
      fs.existsSync(path.join(cwd, '.codegraph', 'index'));

    let count = 0;
    const entries = fs.readdirSync(cwd, { withFileTypes: true });
    for (const e of entries) {
      if (e.isFile()) {
        count++;
      } else if (
        e.isDirectory() &&
        !e.name.startsWith('.') &&
        e.name !== 'node_modules' &&
        e.name !== 'vendor' &&
        e.name !== 'target' &&
        e.name !== 'dist' &&
        e.name !== 'build'
      ) {
        try {
          const sub = fs.readdirSync(path.join(cwd, e.name));
          count += sub.length;
        } catch {
          // ignore unreadable dirs
        }
      }
    }
    ctx.file_count_approx = count;
  } catch {
    // best effort: leave context empty on failure
  }
  return ctx;
}

export function buildTriageQuestions(): Record<string, QuestionDefinition> {
  return {
    suggested_lane: {
      type: 'choice',
      instructions:
        'Determine which workflow lane best fits the user request. Consider: (1) If the prompt names specific technologies, frameworks, files, or concrete implementation details, the task has defined scope. (2) "Investigate how to do X" with no stack mentioned is research; "investigate/implement OAuth2 in React Native" is scoped implementation. (3) "Review/audit existing code" with named files is direct_orchestrator or planned_workflow, not deep_researcher. (4) direct_orchestrator: trivial edits, single-file fixes, factual answers, or explicit direct-authorization. (5) planned_workflow: multi-step, multi-file, architectural, or formal contract work. (6) deep_researcher: pure open-ended exploration without code changes or concrete stack.',
      criteria: {
        direct_orchestrator:
          'Direct factual answers, single-file edits, localized bug fixes, lightweight verification, explicit direct work, or review/audit of named code with concrete files.',
        planned_workflow:
          'Multi-step implementation, complex multi-file features, refactoring, scoped tasks with named technologies/stacks needing discovery/planning contracts.',
        deep_researcher:
          'Pure investigation without named technologies/files, open-ended documentation exploration, or comparison with no code modification intent.',
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
        'Does this request ask to investigate, research, explore, or compare WITHOUT naming a concrete technology stack, specific files, or implementation details? A request that names specific technologies (React Native, OAuth2) or files is scoped work, NOT pure investigation — even if it contains words like "investigate" or "research".',
      criteria: {
        true: 'Standalone open-ended research with no stack, files, or concrete scope defined',
        false: 'Implementation, fix, configuration, or scoped task with named technologies/files',
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
  const projectContext = detectProjectContext();

  try {
    const response = await client.evaluateSystemOne(
      {
        state: {
          user_prompt: sanitizedPrompt,
          project_context: projectContext,
          triage_policy: TRIAGE_POLICY_SUMMARY,
        },
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
    const discrepancyDetected = agreement === 0;

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

    const jevRec = `Jev recommends: ${predictedRoute}`;
    const orchRec = `Orchestrator chose: ${actualRouteChosen}`;

    if (db) {
      db.recordEvaluation({
        id: telemetryId,
        session_id: sessionId,
        source: 'shadow-triage',
        created_at: new Date().toISOString(),
        latency_ms: response.latency_ms,
        model: response.model,
        state_json: JSON.stringify({ user_prompt: sanitizedPrompt, project_context: projectContext, triage_policy: 'included' }),
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
          discrepancy_detected: discrepancyDetected,
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
      discrepancy_detected: discrepancyDetected,
      jev_recommendation: jevRec,
      orchestrator_recommendation: orchRec,
      user_decision_required: discrepancyDetected,
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
          state_json: JSON.stringify({ user_prompt: sanitizedPrompt, project_context: projectContext, triage_policy: 'included' }),
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
