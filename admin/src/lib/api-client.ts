import { ApiError, createApiClient, type ApiClient } from '@b2b/api-client';

const baseUrl =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:3001';

const inner = createApiClient({ baseUrl });

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

export { ApiError } from '@b2b/api-client';
