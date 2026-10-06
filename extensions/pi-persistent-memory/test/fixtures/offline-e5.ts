import {
  E5Client,
  E5ClientError,
  CANONICAL_MODEL,
  CANONICAL_REVISION,
} from '../../src/client/e5-client.ts';
import type { HealthStatus, ValidatedEmbeddingResult } from '../../src/client/types.ts';

/** Test-only deterministic client: no fetch, credentials, live inference or corpus access. */
export class OfflineE5Client extends E5Client {
  constructor() {
    super('http://offline-fixture.invalid');
  }

  override async health(): Promise<HealthStatus> {
    return { state: 'ready', ...this.metadata() };
  }

  override async embedQuery(input: string, signal?: AbortSignal): Promise<ValidatedEmbeddingResult> {
    return this.embed(input, signal);
  }

  override async embedPassage(input: string | string[], signal?: AbortSignal): Promise<ValidatedEmbeddingResult> {
    if (Array.isArray(input)) {
      if (input.length !== 1) throw new Error('Offline fixture only supports one source per indexing request');
      return this.embed(input[0], signal);
    }
    return this.embed(input, signal);
  }

  private metadata() {
    return { model: CANONICAL_MODEL, model_revision: CANONICAL_REVISION, dimensions: 384, normalization: 'l2', max_input_tokens: 512 };
  }

  private embed(input: string, signal?: AbortSignal): ValidatedEmbeddingResult {
    if (signal?.aborted) throw new E5ClientError('cancelled', 'caller_cancelled', 'Operation cancelled by caller');
    return {
      ...this.metadata(),
      chunks: [{ chunk_index: 0, text: input, start: 0, end: Array.from(input).length, token_count: 10,
        embedding: Array.from({ length: 384 }, (_, index) => index === 0 ? 1 : 0) }],
    };
  }
}
