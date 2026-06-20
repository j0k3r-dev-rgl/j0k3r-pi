import { ProviderFailure, fetchProviderErrorFromError, providerErrorFromResponse } from '../../security.js';
import type { Provider } from '../../types.js';

export async function readJsonObject<T>(provider: Provider, response: Response): Promise<T> {
  if (!response.ok) throw new ProviderFailure(providerErrorFromResponse(provider, response));
  const payload = await response.json();
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ProviderFailure({
      code: 'provider_error',
      category: 'provider_payload',
      message: `${provider} returned an unexpected payload shape.`,
      recoverable: true,
      provider,
    });
  }
  return payload as T;
}

export async function readText(provider: Provider, response: Response): Promise<string> {
  if (!response.ok) throw new ProviderFailure(providerErrorFromResponse(provider, response));
  return response.text();
}

export function providerRequestFailure(provider: Provider, error: unknown, fallbackMessage: string): ProviderFailure {
  if (error instanceof ProviderFailure) return error;
  return new ProviderFailure(fetchProviderErrorFromError(provider, error, fallbackMessage));
}
