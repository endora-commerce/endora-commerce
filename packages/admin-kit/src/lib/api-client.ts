/**
 * The admin's HTTP client — the fetch wrapper, the origin it talks to and the
 * unauthorized-listener seam around both.
 *
 * The wrapper below was `@endora-commerce/api-client` until D-202. That
 * package's own header called it *"the typed HTTP client shared by storefront
 * and admin"*, and half of that sentence had never been true: no storefront
 * file ever imported it, and this file was its only production consumer —
 * 81 lines behind a package boundary, wrapped by the 30 lines that follow them.
 * The ruling folded it in here rather than answer what the boundary was for.
 *
 * It stays deliberately thin: it carries cookies for session auth and an
 * optional API key for integration-scope calls, applies the project's envelope
 * conventions, and surfaces typed errors from `@endora-commerce/contracts`.
 */
import type { ErrorEnvelope } from '@endora-commerce/contracts';

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

/**
 * The API origin this admin talks to, and the **one** place the environment
 * variable behind it is read.
 *
 * Published (feature 091) because a screen that builds a URL the fetch client
 * cannot make for it — a `<a download>` href, a form action — needs the same
 * origin, and a module package cannot read `import.meta.env` for itself
 * without acquiring `vite/client` types and a second copy of this fallback.
 * Vite replaces the expression `import.meta.env.VITE_API_BASE_URL` at build
 * time, so it is written **verbatim** here: a cast or an indirection is a
 * chance for that replacement to stop happening in a way no type-check can
 * see.
 */
export const apiBaseUrl: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:3001';

const inner = createApiClient({ baseUrl: apiBaseUrl });

type Listener = () => void;
const unauthorizedListeners = new Set<Listener>();

export function onUnauthorized(listener: Listener): () => void {
  unauthorizedListeners.add(listener);
  return (): void => {
    unauthorizedListeners.delete(listener);
  };
}

function trap<T>(promise: Promise<T>): Promise<T> {
  return promise.catch((err: unknown) => {
    if (err instanceof ApiError && err.status === 401) {
      for (const l of unauthorizedListeners) l();
    }
    throw err;
  });
}

export const apiClient: ApiClient = {
  get: (p, init) => trap(inner.get(p, init)),
  post: (p, b, init) => trap(inner.post(p, b, init)),
  put: (p, b, init) => trap(inner.put(p, b, init)),
  patch: (p, b, init) => trap(inner.patch(p, b, init)),
  delete: (p, init) => trap(inner.delete(p, init)),
};
