import { apiClient } from '@endora-commerce/admin-kit/lib';
import type {
  CreateCustomFieldDefinitionRequest,
  CustomFieldDefinitionDto,
  CustomFieldEntityTypeInfo,
  SupportedEntityType,
  UpdateCustomFieldDefinitionRequest,
} from '@endora-commerce/contracts';

/** Typed admin client for the custom-fields definition API (feature 055). */
type Wrap<T> = { data: T };
const unwrap = <T>(p: Promise<Wrap<T>>): Promise<T> => p.then((r) => r.data);

export const customFieldsClient = {
  /** Supported host entity types + host-managed metadata (feature 061). */
  listEntityTypes: (): Promise<CustomFieldEntityTypeInfo[]> =>
    unwrap(
      apiClient.get<Wrap<CustomFieldEntityTypeInfo[]>>('/api/v1/admin/custom-fields/entity-types'),
    ),
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
