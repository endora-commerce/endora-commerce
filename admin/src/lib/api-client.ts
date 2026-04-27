import { createApiClient, type ApiClient } from '@b2b/api-client';

// VITE_API_BASE_URL points at the backend host without an /api/v1 suffix —
// the api-client appends fully-qualified paths like `/api/v1/admin/...`.
const baseUrl =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:3001';

export const apiClient: ApiClient = createApiClient({ baseUrl });

export { ApiError } from '@b2b/api-client';
