import { apiBaseUrl, apiClient } from '@endora-commerce/admin-kit/lib';

/**
 * The API description, as the Admin UI reads it.
 *
 * Gated on `platform.api_description.read` — the code an administrator's role
 * holds to read it, and the scope an API key is issued with for the same.
 */
export const API_DESCRIPTION_SCOPE = 'platform.api_description.read';

/** The slice of an OpenAPI document this screen reads. */
export interface ApiDescriptionDocument {
  readonly openapi?: string;
  readonly info?: { readonly title?: string; readonly version?: string };
  readonly paths?: Record<string, Record<string, unknown> | undefined>;
}

export interface ApiDescriptionSummary {
  readonly title: string;
  readonly version: string;
  /** Method-and-path pairs the document describes. */
  readonly operations: number;
}

const OPERATION_METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);

export async function getApiDescription(): Promise<ApiDescriptionDocument> {
  return apiClient.get<ApiDescriptionDocument>('/api/v1/admin/api-description');
}

export function summariseApiDescription(document: ApiDescriptionDocument): ApiDescriptionSummary {
  let operations = 0;
  for (const item of Object.values(document.paths ?? {})) {
    for (const key of Object.keys(item ?? {})) {
      if (OPERATION_METHODS.has(key)) operations += 1;
    }
  }
  return {
    title: document.info?.title ?? '',
    version: document.info?.version ?? '',
    operations,
  };
}

/** The interactive reference the backend serves, on the API's own address. */
export function apiReferenceUrl(base: string = apiBaseUrl): string {
  return `${base.replace(/\/+$/, '')}/api/v1/_docs`;
}
