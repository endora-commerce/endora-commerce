import { createApiClient, type ApiClient } from '@b2b/api-client';

const baseUrl =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:3000';

export const apiClient: ApiClient = createApiClient({ baseUrl });

export { ApiError } from '@b2b/api-client';
