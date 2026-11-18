import { apiClient } from '@endora-commerce/admin-kit/lib';
import type {
  AdminEraseGuestDataResult,
  AdminReturnsListResponse,
  BulkTransitionResult,
  ReturnCaseCommentDto,
  ReturnCaseDetail,
  ReturnDeliveryMethodDto,
  ReturnReasonDto,
  RecordAlternativeConsentRequest,
  ReturnNotificationHealth,
  ReturnCaseClauseDto,
  CreateReturnCaseClauseRequest,
  ReturnStatusGraphResponse,
  SalesChannelListResponse,
  SettlementPrefill,
  SettlementResult,
} from '@endora-commerce/contracts';

type Wrap<T> = { data: T };

/** A clause as the clauses page sends it (180 admin-api.md §B5). */
export type ClauseBody = CreateReturnCaseClauseRequest;

/** A payment method as the refund field names it: the `payment_methods` admin list, read as is. */
export interface RefundPaymentMethodOption {
  id: string;
  code: string;
  name: Record<string, string>;
}
const unwrap = <T>(p: Promise<Wrap<T>>): Promise<T> => p.then((r) => r.data);

/** Typed admin client for the returns module (feature 046). */
export const returnsClient = {
  list: (qs: string): Promise<AdminReturnsListResponse> =>
    unwrap(apiClient.get<Wrap<AdminReturnsListResponse>>(`/api/v1/admin/returns${qs}`)),

  get: (id: string): Promise<ReturnCaseDetail> =>
    unwrap(apiClient.get<Wrap<ReturnCaseDetail>>(`/api/v1/admin/returns/${id}`)),

  authorize: (id: string): Promise<{ rmaNumber: string; statusCode: string }> =>
    unwrap(apiClient.post<Wrap<{ rmaNumber: string; statusCode: string }>>(`/api/v1/admin/returns/${id}/authorize`, {})),

  reject: (id: string, reason: string): Promise<ReturnCaseDetail> =>
    unwrap(apiClient.post<Wrap<ReturnCaseDetail>>(`/api/v1/admin/returns/${id}/reject`, { reason })),

  transition: (id: string, to: string, reason?: string): Promise<ReturnCaseDetail> =>
    unwrap(apiClient.post<Wrap<ReturnCaseDetail>>(`/api/v1/admin/returns/${id}/transition`, { to, ...(reason ? { reason } : {}) })),

  // A guest's case (`specs/181-guest-complaints/` admin-api.md A3, A5)
  reissueTrackingLink: (id: string): Promise<{ trackingVersion: number }> =>
    unwrap(apiClient.post<Wrap<{ trackingVersion: number }>>(`/api/v1/admin/returns/${id}/guest/tracking-link`, {})),
  eraseGuestData: (id: string): Promise<AdminEraseGuestDataResult> =>
    unwrap(apiClient.post<Wrap<AdminEraseGuestDataResult>>(`/api/v1/admin/returns/${id}/guest/erase`, { confirm: true })),

  bulkTransition: (ids: string[], to: string): Promise<BulkTransitionResult> =>
    unwrap(apiClient.post<Wrap<BulkTransitionResult>>('/api/v1/admin/returns/bulk-transition', { ids, to })),

  // Comments
  comments: (id: string): Promise<ReturnCaseCommentDto[]> =>
    unwrap(apiClient.get<Wrap<ReturnCaseCommentDto[]>>(`/api/v1/admin/returns/${id}/comments`)),
  addComment: (id: string, body: string, isCustomerVisible: boolean, notifyCustomer: boolean): Promise<ReturnCaseCommentDto> =>
    unwrap(apiClient.post<Wrap<ReturnCaseCommentDto>>(`/api/v1/admin/returns/${id}/comments`, { body, isCustomerVisible, notifyCustomer })),

  // Settlement
  settlementPrefill: (id: string): Promise<SettlementPrefill> =>
    unwrap(apiClient.get<Wrap<SettlementPrefill>>(`/api/v1/admin/returns/${id}/settlement`)),
  settle: (
    id: string,
    body: {
      resolutionType: string;
      lines: Array<{ returnCaseItemId: string; approvedRefundAmount: number }>;
      refundPaymentMethodId?: string;
      createCorrectiveInvoice?: boolean;
      /** Issue #876 — the delivery and surcharge refunds of a consumer's completing withdrawal. */
      deliveryRefundAmount?: number;
      surchargeRefundAmount?: number;
      /** 180 FR-B33a — how an off-platform case was settled outside the platform. */
      resolutionNote?: string;
    },
  ): Promise<SettlementResult> =>
    unwrap(apiClient.post<Wrap<SettlementResult>>(`/api/v1/admin/returns/${id}/settlement`, body)),

  // The consumer's consent to another resolution (issue #905)
  recordAlternativeConsent: (id: string, body: RecordAlternativeConsentRequest): Promise<ReturnCaseDetail> =>
    unwrap(apiClient.post<Wrap<ReturnCaseDetail>>(`/api/v1/admin/returns/${id}/alternative-consent`, body)),
  revokeAlternativeConsent: (id: string): Promise<ReturnCaseDetail> =>
    unwrap(apiClient.delete<Wrap<ReturnCaseDetail>>(`/api/v1/admin/returns/${id}/alternative-consent`)),

  /**
   * The payment methods a refund can name, so the settlement form offers names
   * instead of an id to type (issue #905). The list belongs to `payment_methods`:
   * when that module is off or the operator may not read it, the call fails and
   * the form keeps the id field, as `orders`' list filters do.
   */
  refundPaymentMethods: (): Promise<RefundPaymentMethodOption[]> =>
    unwrap(apiClient.get<Wrap<RefundPaymentMethodOption[]>>('/api/v1/admin/payment-methods?pageSize=200')),

  // Shipments
  shipments: (id: string): Promise<Array<{ id: string; direction: string; status: string; externalReference: string | null }>> =>
    unwrap(apiClient.get<Wrap<Array<{ id: string; direction: string; status: string; externalReference: string | null }>>>(`/api/v1/admin/returns/${id}/shipments`)),
  createShipment: (id: string, direction: string, externalReference?: string): Promise<{ id: string }> =>
    unwrap(apiClient.post<Wrap<{ id: string }>>(`/api/v1/admin/returns/${id}/shipments`, { direction, ...(externalReference ? { externalReference } : {}) })),
  receiveShipment: (id: string, shipmentId: string): Promise<{ status: string }> =>
    unwrap(apiClient.post<Wrap<{ status: string }>>(`/api/v1/admin/returns/${id}/shipments/${shipmentId}/receive`, {})),

  // Status graph config
  statuses: (): Promise<ReturnStatusGraphResponse> =>
    unwrap(apiClient.get<Wrap<ReturnStatusGraphResponse>>('/api/v1/admin/returns/statuses')),
  createStatus: (body: { code: string; name: Record<string, string>; defaultName: string; isTerminal?: boolean; weight?: number }): Promise<ReturnStatusGraphResponse> =>
    unwrap(apiClient.post<Wrap<ReturnStatusGraphResponse>>('/api/v1/admin/returns/statuses', body)),
  updateStatus: (code: string, patch: { notifyCustomerOnEntry?: boolean }): Promise<ReturnStatusGraphResponse> =>
    unwrap(apiClient.patch<Wrap<ReturnStatusGraphResponse>>(`/api/v1/admin/returns/statuses/${code}`, patch)),
  deleteStatus: (code: string): Promise<ReturnStatusGraphResponse> =>
    unwrap(apiClient.delete<Wrap<ReturnStatusGraphResponse>>(`/api/v1/admin/returns/statuses/${code}`)),
  setTransitions: (transitions: Array<{ fromStatusCode: string; toStatusCode: string }>): Promise<ReturnStatusGraphResponse> =>
    unwrap(apiClient.put<Wrap<ReturnStatusGraphResponse>>('/api/v1/admin/returns/transitions', { transitions })),

  /** Where the new-case e-mail goes to nobody (`specs/180-off-platform-complaints/` D-7). */
  notificationHealth: (): Promise<ReturnNotificationHealth> =>
    unwrap(apiClient.get<Wrap<ReturnNotificationHealth>>('/api/v1/admin/returns/notification-health')),

  /**
   * The channels' names, for the "no recipient" alert. The list belongs to
   * `sales_channels`: an operator who may not read it gets the channel codes'
   * fallback (the alert still says something is missing).
   */
  salesChannels: (): Promise<SalesChannelListResponse> =>
    apiClient.get<SalesChannelListResponse>('/api/v1/admin/sales-channels?pageSize=100'),

  // Clauses (180 US7)
  clauses: (): Promise<ReturnCaseClauseDto[]> =>
    unwrap(apiClient.get<Wrap<ReturnCaseClauseDto[]>>('/api/v1/admin/returns/clauses')),
  createClause: (body: ClauseBody): Promise<ReturnCaseClauseDto> =>
    unwrap(apiClient.post<Wrap<ReturnCaseClauseDto>>('/api/v1/admin/returns/clauses', body)),
  updateClause: (id: string, body: Partial<ClauseBody>): Promise<ReturnCaseClauseDto> =>
    unwrap(apiClient.patch<Wrap<ReturnCaseClauseDto>>(`/api/v1/admin/returns/clauses/${id}`, body)),
  deleteClause: (id: string): Promise<unknown> => apiClient.delete(`/api/v1/admin/returns/clauses/${id}`),

  // Reasons
  reasons: (): Promise<ReturnReasonDto[]> =>
    unwrap(apiClient.get<Wrap<ReturnReasonDto[]>>('/api/v1/admin/returns/reasons')),
  createReason: (body: { label: Record<string, string>; appliesTo: string; weight?: number }): Promise<ReturnReasonDto> =>
    unwrap(apiClient.post<Wrap<ReturnReasonDto>>('/api/v1/admin/returns/reasons', body)),
  updateReason: (id: string, patch: { isActive?: boolean; weight?: number }): Promise<ReturnReasonDto> =>
    unwrap(apiClient.patch<Wrap<ReturnReasonDto>>(`/api/v1/admin/returns/reasons/${id}`, patch)),
  deleteReason: (id: string): Promise<unknown> => apiClient.delete(`/api/v1/admin/returns/reasons/${id}`),

  // Return delivery methods
  deliveryMethods: (): Promise<ReturnDeliveryMethodDto[]> =>
    unwrap(apiClient.get<Wrap<ReturnDeliveryMethodDto[]>>('/api/v1/admin/returns/delivery-methods')),
  createDeliveryMethod: (body: { deliveryMethodId: string; returnCost: number; currency: string }): Promise<ReturnDeliveryMethodDto> =>
    unwrap(apiClient.post<Wrap<ReturnDeliveryMethodDto>>('/api/v1/admin/returns/delivery-methods', body)),
  deleteDeliveryMethod: (id: string): Promise<unknown> => apiClient.delete(`/api/v1/admin/returns/delivery-methods/${id}`),
};
