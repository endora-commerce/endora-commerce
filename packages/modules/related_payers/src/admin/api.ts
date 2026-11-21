import type {
  Address,
  AdminAddRelatedPayerBody,
  AdminCreatePayerOrganizationRequest,
  AdminCreateRequestOrganizationRequest,
  AdminOrganizationRelatedPayersResponse,
  AdminRelatedPayerRequestsQueryInput,
  AdminRelatedPayerRequestsResponse,
  AdminUpdateRelatedPayerLinkBody,
  RegistryLookupResponse,
  RelatedPayerLink,
} from '@endora-commerce/contracts';
import { apiClient } from '@endora-commerce/admin-kit/lib';

const base = (organizationId: string) => `/api/v1/admin/organizations/${encodeURIComponent(organizationId)}/related-payers`;
const linkUrl = (linkId: string) => `/api/v1/admin/related-payers/links/${encodeURIComponent(linkId)}`;

/** The operator's payer-link calls (`specs/182-related-payers/contracts/admin-api.md`). */
export const relatedPayersClient = {
  list(organizationId: string): Promise<AdminOrganizationRelatedPayersResponse> {
    return apiClient.get<AdminOrganizationRelatedPayersResponse>(base(organizationId));
  },

  add(organizationId: string, body: Partial<AdminAddRelatedPayerBody> & { payerOrganizationId: string }) {
    return apiClient.post<{ data: RelatedPayerLink }>(base(organizationId), body);
  },

  createOrganization(organizationId: string, body: AdminCreatePayerOrganizationRequest) {
    return apiClient.post<{ data: { organizationId: string; link: RelatedPayerLink } }>(
      `${base(organizationId)}/new-organization`,
      body,
    );
  },

  update(link: Pick<RelatedPayerLink, 'id' | 'version'>, body: AdminUpdateRelatedPayerLinkBody) {
    return apiClient.patch<{ data: RelatedPayerLink }>(linkUrl(link.id), body, {
      headers: { 'If-Match': `"${link.version}"` },
    });
  },

  revoke(link: Pick<RelatedPayerLink, 'id' | 'version'>) {
    return apiClient.post<{ data: RelatedPayerLink }>(`${linkUrl(link.id)}/revoke`, undefined, {
      headers: { 'If-Match': `"${link.version}"` },
    });
  },

  /** FR-023 — one page of the operator queue, `pending` unless asked otherwise (UX audit DS-05, #1439). */
  queue(query: AdminRelatedPayerRequestsQueryInput): Promise<AdminRelatedPayerRequestsResponse> {
    const params = new URLSearchParams({ state: query.state ?? 'pending' });
    if (query.reason) params.set('reason', query.reason);
    if (query.page !== undefined) params.set('page', String(query.page));
    if (query.pageSize !== undefined) params.set('pageSize', String(query.pageSize));
    return apiClient.get<AdminRelatedPayerRequestsResponse>(`/api/v1/admin/related-payers/requests?${params.toString()}`);
  },

  approveRequest(requestId: string) {
    return apiClient.post<{ data: { id: string; state: string } }>(
      `/api/v1/admin/related-payers/requests/${encodeURIComponent(requestId)}/approve`,
    );
  },

  rejectRequest(requestId: string, reason: string) {
    return apiClient.post<{ data: { id: string; state: string } }>(
      `/api/v1/admin/related-payers/requests/${encodeURIComponent(requestId)}/reject`,
      { reason },
    );
  },

  /** FR-023, T087 — name the Organization an unresolved request means: one of its candidates. */
  assignOrganization(requestId: string, organizationId: string) {
    return apiClient.post<{ data: { id: string; state: string } }>(
      `/api/v1/admin/related-payers/requests/${encodeURIComponent(requestId)}/assign-organization`,
      { organizationId },
    );
  },

  /** FR-023, US5-2 — create the Organization a request names, approved, and link it. */
  createRequestOrganization(requestId: string, body: AdminCreateRequestOrganizationRequest) {
    return apiClient.post<{ data: { id: string; state: string; organizationId: string; linkId: string } }>(
      `/api/v1/admin/related-payers/requests/${encodeURIComponent(requestId)}/create-organization`,
      body,
    );
  },

  /** FR-044, US5-2 — invite the request's contact e-mail to register, the tax ID pre-filled. */
  sendInvitation(requestId: string) {
    return apiClient.post<{ data: { id: string; state: string } }>(
      `/api/v1/admin/related-payers/requests/${encodeURIComponent(requestId)}/send-invitation`,
    );
  },

  /** The existing invitation of an Organization's first user (`organizations`' members route). */
  inviteFirstUser(organizationId: string, email: string) {
    return apiClient.post<{ data: { invitationId: string } }>(
      `/api/v1/admin/organizations/${encodeURIComponent(organizationId)}/members/invite`,
      { email },
    );
  },

  /**
   * FR-021 — the payer's live billing addresses, the choices of a link's address restriction.
   * The organization card's own address route (`organizations`, `customers:read`, in reach).
   */
  async payerBillingAddresses(organizationId: string): Promise<Address[]> {
    const res = await apiClient.get<{ data: Address[] }>(
      `/api/v1/admin/organizations/${encodeURIComponent(organizationId)}/addresses`,
    );
    return res.data.filter((address) => address.kind === 'billing');
  },

  /** The registry lookup the registration form uses — the prefill of a new payer (FR-021). */
  registryLookup(taxId: string, country: string): Promise<RegistryLookupResponse> {
    return apiClient.post<RegistryLookupResponse>('/api/v1/organizations/registry-lookup', { taxId, country });
  },
};
