import { ApiError, createApiClient, type ApiClient } from '@endora-commerce/api-client';

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

export { ApiError } from '@endora-commerce/api-client';
