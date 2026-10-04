import { describe, expect, it } from 'vitest';
import {
  consumeInteractionResponse,
  consumeLatestInteractionRequest,
  interactionRequestFromCandidate,
  publishInteractionRequest,
  publishInteractionResponse,
  resolveInteractionRequest,
  sanitizeInteractionTransportText,
} from '../src/interaction-channel.js';

describe('generic subagent interaction channel', () => {
  it('publishes arbitrary interaction requests and responses by handle/request id', () => {
    const request = {
      type: 'interaction_required' as const,
      requestId: 'req-anything',
      kind: 'custom-form',
      origin: 'subagent',
      requester: { subagentName: 'analyst', taskId: 'task-1' },
      prompt: { title: 'Need a decision', message: 'Choose how to continue.' },
      payload: { form: { fields: [{ name: 'strategy', type: 'string' }] } },
      response: { expected: 'json' as const },
    };

    const published = publishInteractionRequest(request);
    expect(published.handle).toMatch(/^interaction_/);
    expect(resolveInteractionRequest(published.handle)).toEqual(request);
    expect(consumeLatestInteractionRequest({ origin: 'subagent' })).toEqual(request);
    expect(resolveInteractionRequest(published.handle)).toBeUndefined();

    publishInteractionResponse({ type: 'interaction_response', requestId: request.requestId, status: 'answered', value: { strategy: 'safe' } });
    expect(consumeInteractionResponse(request.requestId)).toMatchObject({
      type: 'interaction_response',
      requestId: 'req-anything',
      status: 'answered',
      value: { strategy: 'safe' },
    });
  });

  it('extracts nested generic interaction requests from arbitrary carriers', () => {
    const request = {
      type: 'interaction_required' as const,
      requestId: 'req-nested',
      kind: 'operator-decision',
      origin: 'subagent',
      prompt: { title: 'Need operator decision', message: 'Pick a rollout strategy.', choices: ['safe', 'fast'] },
      payload: { rollout: { environments: ['staging', 'prod'] } },
    };

    expect(interactionRequestFromCandidate({ details: { interactionRequest: { payload: request } } })).toMatchObject(request);
  });

  it('sanitizes generic interaction marker transport text', () => {
    const text = [
      'interaction_required:{"requestId":"req-1"}',
      'safe text',
    ].join('\n');

    expect(sanitizeInteractionTransportText(text)).toBe([
      '[interaction request hidden]',
      'safe text',
    ].join('\n'));
  });
});
