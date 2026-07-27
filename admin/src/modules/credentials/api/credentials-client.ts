import { apiClient } from '@/lib/api-client';
import type {
  ConfigurationDto,
  ConfigurationTypeDescriptor,
  CreateConfiguration,
  UpdateConfiguration,
} from '@b2b/contracts';

/**
 * Admin API client for the credentials module (feature 058).
 *
 * Thin wrapper over `apiClient` calls to `/api/v1/admin/credentials/...`; every
 * shape comes from `@b2b/contracts`. Secrets are never returned in plaintext —
 * a `ConfigurationDto` field carries only `isSet` for secret fields.
 */
const BASE = '/api/v1/admin/credentials';

export const credentialsClient = {
  listTypes(): Promise<ConfigurationTypeDescriptor[]> {
    return apiClient
      .get<{ types: ConfigurationTypeDescriptor[] }>(`${BASE}/types`)
      .then((r) => r.types);
  },

  list(type?: string): Promise<ConfigurationDto[]> {
    const q = type ? `?type=${encodeURIComponent(type)}` : '';
    return apiClient
      .get<{ configurations: ConfigurationDto[] }>(`${BASE}${q}`)
      .then((r) => r.configurations);
  },

  get(code: string): Promise<ConfigurationDto> {
    return apiClient.get<ConfigurationDto>(`${BASE}/${encodeURIComponent(code)}`);
  },

  preview(code: string): Promise<ConfigurationDto> {
    return apiClient.get<ConfigurationDto>(`${BASE}/${encodeURIComponent(code)}/preview`);
  },

  create(body: CreateConfiguration): Promise<ConfigurationDto> {
    return apiClient.post<ConfigurationDto>(BASE, body);
  },

  update(code: string, body: UpdateConfiguration): Promise<ConfigurationDto> {
    return apiClient.put<ConfigurationDto>(`${BASE}/${encodeURIComponent(code)}`, body);
  },

  delete(code: string): Promise<void> {
    return apiClient.delete<void>(`${BASE}/${encodeURIComponent(code)}`);
  },
};
