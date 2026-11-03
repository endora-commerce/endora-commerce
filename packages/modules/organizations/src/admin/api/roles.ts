import type {
  CreateOrganizationRoleRequest,
  DeleteOrganizationRoleRequest,
  DeleteOrganizationRoleResponse,
  OrganizationPermissionCatalogueResponse,
  OrganizationRoleListResponse,
  OrganizationRoleResponse,
  UpdateOrganizationRoleRequest,
} from '@endora-commerce/contracts';
import { apiClient } from '@endora-commerce/admin-kit/lib';

/**
 * The operator's role endpoints of one Organization
 * (`specs/170-organization-roles/contracts/operator-api.md` §2). Reads need
 * `organizations:read-roles` or `organizations:manage-roles`, writes the second.
 * Source-of-truth shapes live in `@endora-commerce/contracts`.
 */
function base(organizationId: string): string {
  return `/api/v1/admin/organizations/${encodeURIComponent(organizationId)}`;
}

export const organizationRolesClient = {
  list(organizationId: string): Promise<OrganizationRoleListResponse> {
    return apiClient.get<OrganizationRoleListResponse>(`${base(organizationId)}/roles`);
  },

  /** Present codes only, grouped by declaring module, in the operator's language. */
  catalogue(organizationId: string): Promise<OrganizationPermissionCatalogueResponse> {
    return apiClient.get<OrganizationPermissionCatalogueResponse>(
      `${base(organizationId)}/permission-catalogue`,
    );
  },

  create(organizationId: string, body: CreateOrganizationRoleRequest): Promise<OrganizationRoleResponse> {
    return apiClient.post<OrganizationRoleResponse>(`${base(organizationId)}/roles`, body);
  },

  update(
    organizationId: string,
    roleId: string,
    body: UpdateOrganizationRoleRequest,
  ): Promise<OrganizationRoleResponse> {
    return apiClient.patch<OrganizationRoleResponse>(
      `${base(organizationId)}/roles/${encodeURIComponent(roleId)}`,
      body,
    );
  },

  /** The route reads its body on DELETE, so it travels in `init` (the client's `delete` takes none). */
  remove(
    organizationId: string,
    roleId: string,
    body: DeleteOrganizationRoleRequest,
  ): Promise<DeleteOrganizationRoleResponse> {
    return apiClient.delete<DeleteOrganizationRoleResponse>(
      `${base(organizationId)}/roles/${encodeURIComponent(roleId)}`,
      { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } },
    );
  },
};
