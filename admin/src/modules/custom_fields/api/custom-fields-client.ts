import { apiClient } from '@/lib/api-client';
import type {
  CreateCustomFieldDefinitionRequest,
  CustomFieldDefinitionDto,
  SupportedEntityType,
  UpdateCustomFieldDefinitionRequest,
} from '@b2b/contracts';

/** Typed admin client for the custom-fields definition API (feature 055). */
type Wrap<T> = { data: T };
const unwrap = <T>(p: Promise<Wrap<T>>): Promise<T> => p.then((r) => r.data);

export const customFieldsClient = {
  list: (entityType?: SupportedEntityType): Promise<CustomFieldDefinitionDto[]> =>
    unwrap(
      apiClient.get<Wrap<CustomFieldDefinitionDto[]>>(
        `/api/v1/admin/custom-fields/definitions${entityType ? `?entityType=${entityType}` : ''}`,
      ),
    ),
  create: (body: CreateCustomFieldDefinitionRequest): Promise<CustomFieldDefinitionDto> =>
    unwrap(apiClient.post<Wrap<CustomFieldDefinitionDto>>('/api/v1/admin/custom-fields/definitions', body)),
  update: (id: string, patch: UpdateCustomFieldDefinitionRequest): Promise<CustomFieldDefinitionDto> =>
    unwrap(apiClient.patch<Wrap<CustomFieldDefinitionDto>>(`/api/v1/admin/custom-fields/definitions/${id}`, patch)),
  remove: (id: string): Promise<unknown> =>
    apiClient.delete(`/api/v1/admin/custom-fields/definitions/${id}`),
};
