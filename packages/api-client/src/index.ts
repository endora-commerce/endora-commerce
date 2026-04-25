// @b2b/api-client — typed HTTP client shared by storefront and admin.
//
// The client is deliberately thin: it carries cookies for session auth and an optional API-key
// for integration-scope calls, wraps fetch with the project's envelope conventions, and surfaces
// typed errors from @b2b/contracts. Module-specific methods (getProduct, createOrder, …) are
// added by their corresponding user-story phases in tasks.md.

import type { ErrorEnvelope } from '@b2b/contracts';

export interface ApiClientOptions {
  baseUrl: string;
  /** Optional API-key for server-to-server integrations. Overrides cookie auth when set. */
  apiKey?: string;
  /** Optional custom fetch implementation (useful in tests and server-side rendering). */
  fetchFn?: typeof fetch;
}

export class ApiError extends Error {
  readonly status: number;
  readonly envelope: ErrorEnvelope;
  constructor(status: number, envelope: ErrorEnvelope) {
    super(`${envelope.error.code}: ${envelope.error.message}`);
    this.status = status;
    this.envelope = envelope;
    this.name = 'ApiError';
  }
}

export interface ApiClient {
  get<T>(path: string, init?: RequestInit): Promise<T>;
  post<T>(path: string, body?: unknown, init?: RequestInit): Promise<T>;
  put<T>(path: string, body?: unknown, init?: RequestInit): Promise<T>;
  patch<T>(path: string, body?: unknown, init?: RequestInit): Promise<T>;
  delete<T>(path: string, init?: RequestInit): Promise<T>;
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const { baseUrl, apiKey, fetchFn = fetch } = options;

  async function request<T>(method: string, path: string, body?: unknown, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    if (body !== undefined) {
      headers.set('Content-Type', 'application/json');
    }
    if (apiKey) {
      headers.set('Authorization', `Bearer ${apiKey}`);
    }

    const response = await fetchFn(`${baseUrl}${path}`, {
      ...init,
      method,
      headers,
      credentials: apiKey ? 'omit' : 'include',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    if (!response.ok) {
      const envelope = (await response.json().catch(() => null)) as ErrorEnvelope | null;
      if (envelope && 'error' in envelope) {
        throw new ApiError(response.status, envelope);
      }
      throw new ApiError(response.status, {
        error: { code: 'INTERNAL', message: `HTTP ${response.status}` },
      });
    }

    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }

  return {
    get: <T>(path: string, init?: RequestInit) => request<T>('GET', path, undefined, init),
    post: <T>(path: string, body?: unknown, init?: RequestInit) => request<T>('POST', path, body, init),
    put: <T>(path: string, body?: unknown, init?: RequestInit) => request<T>('PUT', path, body, init),
    patch: <T>(path: string, body?: unknown, init?: RequestInit) => request<T>('PATCH', path, body, init),
    delete: <T>(path: string, init?: RequestInit) => request<T>('DELETE', path, undefined, init),
  };
}
