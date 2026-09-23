import {
  AuthError,
  TimeoutError,
  RateLimitError,
  ApiError,
  NetworkError,
  TypeSafeError,
  type SystemOneRequest,
  type SystemOneResponse,
  type RequestOptions,
  type QuestionDefinition,
  type AnswerDefinition,
} from '../types.ts';
import { sanitizeState, sanitizeError } from '../security.ts';

const DEFAULT_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const DEFAULT_MODEL = 'jev-latest';
const DEFAULT_TIMEOUT_MS = 5000;

function normalizeQuestions(questions: Record<string, QuestionDefinition>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const [id, q] of Object.entries(questions)) {
    const rawType = String(q.type).toLowerCase();
    if (rawType === 'choice') {
      let criteria = q.criteria;
      if (Array.isArray(criteria)) {
        const criteriaMap: Record<string, string | null> = {};
        for (const item of criteria) {
          const key = typeof item === 'string' ? item : String((item as any)?.description ?? item);
          criteriaMap[key] = null;
        }
        criteria = criteriaMap;
      }
      normalized[id] = {
        type: 'choice',
        instructions: q.instructions,
        criteria,
      };
    } else if (rawType === 'noul') {
      const entry: Record<string, unknown> = {
        type: 'noul',
        instructions: q.instructions,
      };
      if (q.criteria) {
        entry.criteria = q.criteria;
      }
      normalized[id] = entry;
    } else if (rawType === 'score') {
      let criteria = q.criteria;
      if (Array.isArray(criteria) && criteria.length > 0 && typeof criteria[0] === 'object' && criteria[0] !== null) {
        // Map [{ level: 1, description: '...' }] to strings
        criteria = (criteria as Array<{ description?: string }>).map(
          (item) => item.description ?? String(item)
        );
      }
      normalized[id] = {
        type: 'score',
        instructions: q.instructions,
        criteria,
      };
    } else {
      normalized[id] = {
        ...q,
        type: rawType,
      };
    }
  }
  return normalized;
}

export async function evaluateSystemOne(
  request: SystemOneRequest,
  options?: RequestOptions
): Promise<SystemOneResponse> {
  const apiKey = options?.apiKey !== undefined ? options.apiKey : process.env.TYPESAFE_API_KEY;
  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
    throw new AuthError('Missing or empty TypeSafe API key. Please configure TYPESAFE_API_KEY.');
  }

  const endpoint = options?.endpoint || DEFAULT_ENDPOINT;
  const timeoutMs = options?.timeout ?? DEFAULT_TIMEOUT_MS;
  const model = request.model || options?.model || DEFAULT_MODEL;

  // Sanitize the state object prior to network dispatch
  const sanitizedState = sanitizeState(request.state);
  const normalizedQuestions = normalizeQuestions(request.questions);

  const payload = {
    model,
    state: sanitizedState,
    questions: normalizedQuestions,
  };

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new TimeoutError(`TypeSafe request timed out after ${timeoutMs}ms.`));
  }, timeoutMs);

  let callerAbortCleanup: (() => void) | undefined;
  if (options?.signal) {
    if (options.signal.aborted) {
      clearTimeout(timer);
      throw options.signal.reason || new Error('Request was aborted');
    }
    const onCallerAbort = () => {
      controller.abort(options.signal?.reason);
    };
    options.signal.addEventListener('abort', onCallerAbort, { once: true });
    callerAbortCleanup = () => {
      options.signal?.removeEventListener('abort', onCallerAbort);
    };
  }

  const startTime = performance.now();
  let response: Response;

  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey.trim()}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err: unknown) {
    clearTimeout(timer);
    callerAbortCleanup?.();

    if (timedOut || (err instanceof Error && err.name === 'TimeoutError')) {
      throw new TimeoutError(`TypeSafe request timed out after ${timeoutMs}ms.`);
    }
    if (options?.signal?.aborted) {
      throw options.signal.reason || new Error('Request aborted by caller');
    }
    if (err instanceof TypeSafeError) {
      throw err;
    }
    const safeMsg = sanitizeError(err);
    throw new NetworkError(`Network connection failed: ${safeMsg}`);
  } finally {
    clearTimeout(timer);
    callerAbortCleanup?.();
  }

  const latency_ms = Math.round(performance.now() - startTime);

  if (!response.ok) {
    let errorDetail: unknown;
    try {
      errorDetail = await response.json();
    } catch {
      try {
        errorDetail = await response.text();
      } catch {
        errorDetail = response.statusText;
      }
    }

    if (response.status === 401 || response.status === 403) {
      throw new AuthError(`Authentication failed (${response.status}): ${sanitizeError(errorDetail)}`);
    }
    if (response.status === 429) {
      throw new RateLimitError(`TypeSafe rate limit exceeded (429): ${sanitizeError(errorDetail)}`);
    }
    throw new ApiError(
      `TypeSafe API error HTTP ${response.status}: ${sanitizeError(errorDetail)}`,
      response.status,
      errorDetail
    );
  }

  let data: any;
  try {
    data = await response.json();
  } catch (err) {
    throw new ApiError(`Failed to parse TypeSafe JSON response: ${sanitizeError(err)}`, response.status);
  }

  const answers: Record<string, AnswerDefinition> = data.answers || data.responses || {};
  const usage = data.usage || { input_tokens: 0, output_tokens: 0 };
  const resolvedModel = data.model || model;

  return {
    id: data.id,
    model: resolvedModel,
    answers,
    responses: answers,
    usage: {
      input_tokens: Number(usage.input_tokens || 0),
      output_tokens: Number(usage.output_tokens || 0),
    },
    latency_ms,
  };
}
