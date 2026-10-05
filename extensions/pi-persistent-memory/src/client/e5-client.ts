import type {
  ErrorCategory,
  HealthStatus,
  ValidatedChunk,
  ValidatedEmbeddingResult,
} from './types.ts';

export const CANONICAL_MODEL = 'intfloat/e5-small-v2';
export const CANONICAL_REVISION = 'ffb93f3bd4047442299a41ebb6fa998a38507c52';
export const CANONICAL_DIMENSIONS = 384;
export const CANONICAL_NORMALIZATION = 'l2';
export const CANONICAL_MAX_INPUT_TOKENS = 512;
export const DEFAULT_EMBED_TIMEOUT_MS = 120_000;
export const DEFAULT_HEALTH_TIMEOUT_MS = 3_000;
export const MAX_REQUEST_BYTES = 1_048_576; // 1 MiB
export const MAX_RESPONSE_BYTES = 4_194_304; // 4 MiB internal safety ceiling
export const MAX_CHUNKS = 256;
export const MAX_INPUT_STRINGS = 64;

export class E5ClientError extends Error {
  readonly category: ErrorCategory;
  readonly code: string;
  readonly status?: number;

  constructor(category: ErrorCategory, code: string, message: string, status?: number) {
    super(message);
    this.name = 'E5ClientError';
    this.category = category;
    this.code = code;
    this.status = status;
  }
}

export interface E5ClientOptions {
  timeoutMs?: number;
  healthTimeoutMs?: number;
}

export class E5Client {
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly healthTimeoutMs: number;

  constructor(baseUrl: string = 'http://127.0.0.1:8000', options?: E5ClientOptions) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_EMBED_TIMEOUT_MS;
    this.healthTimeoutMs = options?.healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS;
  }

  async health(signal?: AbortSignal): Promise<HealthStatus> {
    if (signal?.aborted) {
      return { state: 'unavailable', message: 'Operation cancelled by caller' };
    }

    const timeoutCtrl = new AbortController();
    const timer = setTimeout(() => {
      timeoutCtrl.abort(new Error('timeout'));
    }, this.healthTimeoutMs);

    const combinedSignal = signal
      ? AbortSignal.any([signal, timeoutCtrl.signal])
      : timeoutCtrl.signal;

    try {
      const res = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: combinedSignal,
      });

      const raw = await this.readBoundedBody(res);
      let payload: any;
      try {
        payload = JSON.parse(raw);
      } catch {
        return { state: 'incompatible', message: 'Invalid JSON response from health endpoint' };
      }

      if (res.status === 200) {
        if (
          payload?.status === 'ready' &&
          payload?.model === CANONICAL_MODEL &&
          payload?.model_revision === CANONICAL_REVISION &&
          payload?.dimensions === CANONICAL_DIMENSIONS &&
          payload?.normalization === CANONICAL_NORMALIZATION &&
          payload?.max_input_tokens === CANONICAL_MAX_INPUT_TOKENS
        ) {
          return {
            state: 'ready',
            model: payload.model,
            model_revision: payload.model_revision,
            dimensions: payload.dimensions,
            normalization: payload.normalization,
            max_input_tokens: payload.max_input_tokens,
          };
        }
        return { state: 'incompatible', message: 'Health response has incompatible model metadata' };
      }

      if (res.status === 503) {
        if (
          payload?.status === 'not_ready' &&
          payload?.model === CANONICAL_MODEL &&
          payload?.model_revision === null &&
          payload?.dimensions === CANONICAL_DIMENSIONS &&
          payload?.normalization === CANONICAL_NORMALIZATION &&
          payload?.max_input_tokens === CANONICAL_MAX_INPUT_TOKENS
        ) {
          return { state: 'not_ready', message: 'E5 service is not ready' };
        }
        return { state: 'incompatible', message: 'Health 503 response has unexpected structure' };
      }

      return { state: 'incompatible', message: `Unexpected HTTP status ${res.status} from health endpoint` };
    } catch {
      return { state: 'unavailable', message: 'Failed to connect to E5 health endpoint' };
    } finally {
      clearTimeout(timer);
    }
  }

  async embedQuery(input: string, signal?: AbortSignal): Promise<ValidatedEmbeddingResult> {
    if (typeof input !== 'string' || input.length === 0) {
      throw new E5ClientError('input_error', 'invalid_input', 'Query input must be a non-empty string');
    }

    const payload = JSON.stringify({ input, mode: 'query' });
    const byteLength = Buffer.byteLength(payload, 'utf8');
    if (byteLength > MAX_REQUEST_BYTES) {
      throw new E5ClientError('input_error', 'request_too_large', 'Request body exceeds 1MiB limit');
    }

    const resJson = await this.postEmbeddings(payload, signal);
    this.validateCanonicalMetadata(resJson);

    if (!Array.isArray(resJson.data) || resJson.data.length !== 1) {
      throw new E5ClientError('integration_error', 'invalid_response', 'Query response must contain exactly one data item');
    }

    const item = resJson.data[0];
    if (item.input_index !== 0 || !Array.isArray(item.chunks) || item.chunks.length !== 1) {
      throw new E5ClientError('integration_error', 'invalid_response', 'Query response must contain exactly one chunk at input_index 0');
    }

    const chunks = this.validateChunks(input, item.chunks, true);

    return {
      model: resJson.model,
      model_revision: resJson.model_revision,
      dimensions: resJson.dimensions,
      normalization: resJson.normalization,
      max_input_tokens: resJson.max_input_tokens,
      chunks,
    };
  }

  async embedPassage(input: string | string[], signal?: AbortSignal): Promise<ValidatedEmbeddingResult> {
    const inputs = Array.isArray(input) ? input : [input];
    if (inputs.length === 0 || inputs.length > MAX_INPUT_STRINGS) {
      throw new E5ClientError(
        'input_error',
        'invalid_input',
        `Passage input must contain between 1 and ${MAX_INPUT_STRINGS} strings`,
      );
    }
    for (const item of inputs) {
      if (typeof item !== 'string' || item.length === 0) {
        throw new E5ClientError('input_error', 'invalid_input', 'Passage strings must be non-empty');
      }
    }

    const payload = JSON.stringify({ input: Array.isArray(input) ? input : input, mode: 'passage' });
    const byteLength = Buffer.byteLength(payload, 'utf8');
    if (byteLength > MAX_REQUEST_BYTES) {
      throw new E5ClientError('input_error', 'request_too_large', 'Request body exceeds 1MiB limit');
    }

    const resJson = await this.postEmbeddings(payload, signal);
    this.validateCanonicalMetadata(resJson);

    if (!Array.isArray(resJson.data) || resJson.data.length !== inputs.length) {
      throw new E5ClientError(
        'integration_error',
        'invalid_response',
        `Data item count mismatch: expected ${inputs.length}, got ${resJson.data?.length}`,
      );
    }

    let totalChunks = 0;
    const allValidatedChunks: ValidatedChunk[] = [];

    for (let i = 0; i < inputs.length; i++) {
      const dataItem = resJson.data[i];
      if (dataItem.input_index !== i) {
        throw new E5ClientError('integration_error', 'invalid_response', `Data item index mismatch at position ${i}`);
      }
      if (!Array.isArray(dataItem.chunks)) {
        throw new E5ClientError('integration_error', 'invalid_response', `Data item ${i} missing chunks array`);
      }
      totalChunks += dataItem.chunks.length;
      if (totalChunks > MAX_CHUNKS) {
        throw new E5ClientError(
          'integration_error',
          'chunk_count_exceeded',
          `Total chunk count across response exceeded ${MAX_CHUNKS}`,
        );
      }
      const validated = this.validateChunks(inputs[i], dataItem.chunks, false);
      allValidatedChunks.push(...validated);
    }

    return {
      model: resJson.model,
      model_revision: resJson.model_revision,
      dimensions: resJson.dimensions,
      normalization: resJson.normalization,
      max_input_tokens: resJson.max_input_tokens,
      chunks: allValidatedChunks,
    };
  }

  private async postEmbeddings(payload: string, callerSignal?: AbortSignal): Promise<any> {
    if (callerSignal?.aborted) {
      throw new E5ClientError('cancelled', 'caller_cancelled', 'Operation cancelled by caller');
    }

    const timeoutCtrl = new AbortController();
    const timer = setTimeout(() => {
      timeoutCtrl.abort(new Error('timeout'));
    }, this.timeoutMs);

    const combinedSignal = callerSignal
      ? AbortSignal.any([callerSignal, timeoutCtrl.signal])
      : timeoutCtrl.signal;

    let res: Response;
    let rawBody = '';

    try {
      res = await fetch(`${this.baseUrl}/v1/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: payload,
        signal: combinedSignal,
      });

      rawBody = await this.readBoundedBody(res);
    } catch (err: any) {
      if (callerSignal?.aborted) {
        throw new E5ClientError('cancelled', 'caller_cancelled', 'Operation cancelled by caller');
      }
      if (timeoutCtrl.signal.aborted) {
        throw new E5ClientError('unavailable', 'request_timeout', 'Request timed out');
      }
      if (err instanceof E5ClientError) {
        throw err;
      }
      throw new E5ClientError('unavailable', 'transport_failure', 'Failed to communicate with embedding service');
    } finally {
      clearTimeout(timer);
    }

    // Check cancellation after body read
    if (callerSignal?.aborted) {
      throw new E5ClientError('cancelled', 'caller_cancelled', 'Operation cancelled by caller');
    }

    let parsed: any;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      throw new E5ClientError('integration_error', 'malformed_json', 'Service returned malformed JSON');
    }

    if (res.status === 200) {
      return parsed;
    }

    // Error status handling
    const errEnvelope = parsed?.error;
    if (!errEnvelope || typeof errEnvelope !== 'object' || Array.isArray(errEnvelope)) {
      if (res.status === 400 || res.status === 413 || res.status === 422 || res.status === 500 || res.status === 503) {
        throw new E5ClientError('integration_error', 'invalid_error_response', 'Error response missing or malformed error envelope', res.status);
      }
      throw new E5ClientError('integration_error', 'unexpected_status', `Unexpected HTTP status ${res.status}`, res.status);
    }

    if (
      typeof errEnvelope.code !== 'string' ||
      errEnvelope.code.length === 0 ||
      typeof errEnvelope.message !== 'string' ||
      (errEnvelope.input_index !== undefined && (!Number.isInteger(errEnvelope.input_index) || errEnvelope.input_index < 0))
    ) {
      throw new E5ClientError('integration_error', 'invalid_error_response', 'Malformed error envelope fields', res.status);
    }

    if (res.status === 400) {
      if (errEnvelope.code === 'invalid_input') {
        throw new E5ClientError('input_error', 'invalid_input', 'Invalid input provided to embedding service', 400);
      }
      throw new E5ClientError('integration_error', 'invalid_error_response', 'Mismatched error code for status 400', 400);
    }
    if (res.status === 422) {
      if (errEnvelope.code === 'query_too_long') {
        throw new E5ClientError('input_error', 'query_too_long', 'Query exceeds maximum token limit', 422);
      }
      throw new E5ClientError('integration_error', 'invalid_error_response', 'Mismatched error code for status 422', 422);
    }
    if (res.status === 413) {
      if (errEnvelope.code === 'request_too_large') {
        throw new E5ClientError('input_error', 'request_too_large', 'Request payload exceeded server limits', 413);
      }
      throw new E5ClientError('integration_error', 'invalid_error_response', 'Mismatched error code for status 413', 413);
    }
    if (res.status === 500) {
      if (errEnvelope.code === 'internal_error') {
        throw new E5ClientError('unavailable', 'internal_error', 'Embedding service encountered internal error', 500);
      }
      throw new E5ClientError('integration_error', 'invalid_error_response', 'Mismatched error code for status 500', 500);
    }
    if (res.status === 503) {
      if (errEnvelope.code === 'model_not_ready') {
        throw new E5ClientError('unavailable', 'model_not_ready', 'Embedding service model is not ready', 503);
      }
      throw new E5ClientError('integration_error', 'invalid_error_response', 'Mismatched error code for status 503', 503);
    }

    throw new E5ClientError('integration_error', 'unexpected_status', `Unexpected HTTP status ${res.status}`, res.status);
  }

  private async readBoundedBody(res: Response): Promise<string> {
    if (!res.body) {
      return '';
    }

    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytesRead = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          bytesRead += value.byteLength;
          if (bytesRead > MAX_RESPONSE_BYTES) {
            await reader.cancel();
            throw new E5ClientError('integration_error', 'oversized_response_body', 'Response body exceeded safety ceiling');
          }
          chunks.push(value);
        }
      }
    } finally {
      reader.releaseLock();
    }

    const totalBuffer = Buffer.concat(chunks, bytesRead);
    return totalBuffer.toString('utf8');
  }

  private validateCanonicalMetadata(resJson: any): void {
    if (
      resJson?.model !== CANONICAL_MODEL ||
      resJson?.model_revision !== CANONICAL_REVISION ||
      resJson?.dimensions !== CANONICAL_DIMENSIONS ||
      resJson?.normalization !== CANONICAL_NORMALIZATION ||
      resJson?.max_input_tokens !== CANONICAL_MAX_INPUT_TOKENS
    ) {
      throw new E5ClientError('integration_error', 'incompatible_metadata', 'Service returned incompatible model metadata');
    }
  }

  private validateChunks(source: string, rawChunks: any[], isQuery: boolean): ValidatedChunk[] {
    if (!Array.isArray(rawChunks) || rawChunks.length === 0) {
      throw new E5ClientError('integration_error', 'invalid_response', 'No chunks returned');
    }

    const codePoints = Array.from(source);
    const sourceLen = codePoints.length;
    let coveredEnd = 0;
    const validatedChunks: ValidatedChunk[] = [];

    for (let i = 0; i < rawChunks.length; i++) {
      const c = rawChunks[i];
      if (c?.chunk_index !== i) {
        throw new E5ClientError('integration_error', 'invalid_chunk_order', `Chunk index mismatch at ${i}`);
      }
      if (
        typeof c?.start !== 'number' ||
        typeof c?.end !== 'number' ||
        !Number.isInteger(c.start) ||
        !Number.isInteger(c.end)
      ) {
        throw new E5ClientError('integration_error', 'invalid_span', `Invalid chunk span integers at ${i}`);
      }
      if (i === 0 && c.start !== 0) {
        throw new E5ClientError('integration_error', 'invalid_span', 'First chunk start must be 0');
      }
      if (c.start < 0 || c.start >= c.end || c.end > sourceLen) {
        throw new E5ClientError('integration_error', 'invalid_span', `Chunk bounds out of range at ${i}`);
      }
      if (c.start > coveredEnd) {
        throw new E5ClientError('integration_error', 'invalid_span', `Gap detected before chunk ${i}`);
      }
      if (c.end <= coveredEnd) {
        throw new E5ClientError('integration_error', 'invalid_span', `Chunk ${i} does not advance covered end`);
      }

      const expectedText = codePoints.slice(c.start, c.end).join('');
      if (c.text !== expectedText) {
        throw new E5ClientError('integration_error', 'invalid_span', `Chunk text does not match code point slice at ${i}`);
      }

      if (typeof c.token_count !== 'number' || c.token_count < 1 || c.token_count > CANONICAL_MAX_INPUT_TOKENS) {
        throw new E5ClientError('integration_error', 'invalid_token_count', `Invalid token count at ${i}`);
      }

      this.validateEmbedding(c.embedding, i);

      validatedChunks.push({
        chunk_index: c.chunk_index,
        text: c.text,
        start: c.start,
        end: c.end,
        token_count: c.token_count,
        embedding: c.embedding,
      });

      coveredEnd = c.end;
    }

    if (coveredEnd !== sourceLen) {
      throw new E5ClientError('integration_error', 'invalid_span', 'Chunks do not cover entire source length');
    }

    if (isQuery && rawChunks.length !== 1) {
      throw new E5ClientError('integration_error', 'invalid_response', 'Query must return exactly one chunk');
    }

    return validatedChunks;
  }

  private validateEmbedding(embedding: any, chunkIndex: number): void {
    if (!Array.isArray(embedding) || embedding.length !== CANONICAL_DIMENSIONS) {
      throw new E5ClientError(
        'integration_error',
        'invalid_vector',
        `Embedding at chunk ${chunkIndex} must have length ${CANONICAL_DIMENSIONS}`,
      );
    }

    let sumSq = 0;
    for (let j = 0; j < embedding.length; j++) {
      const v = embedding[j];
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        throw new E5ClientError(
          'integration_error',
          'invalid_vector',
          `Embedding at chunk ${chunkIndex} component ${j} is not a finite number`,
        );
      }
      sumSq += v * v;
    }

    const norm = Math.sqrt(sumSq);
    if (Math.abs(norm - 1.0) > 1e-4) {
      throw new E5ClientError(
        'integration_error',
        'invalid_vector',
        `Embedding at chunk ${chunkIndex} L2 norm ${norm} is not within 1e-4 of 1.0`,
      );
    }
  }
}
