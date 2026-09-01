import { apiClient } from '@endora-commerce/admin-kit/lib';
import type {
  AdminReturnsListResponse,
  BulkTransitionResult,
  ReturnCaseCommentDto,
  ReturnCaseDetail,
  ReturnDeliveryMethodDto,
  ReturnReasonDto,
  ReturnStatusGraphResponse,
  SettlementPrefill,
  SettlementResult,
} from '@endora-commerce/contracts';

type Wrap<T> = { data: T };
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
    },
  ): Promise<SettlementResult> =>
    unwrap(apiClient.post<Wrap<SettlementResult>>(`/api/v1/admin/returns/${id}/settlement`, body)),

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
  deleteStatus: (code: string): Promise<ReturnStatusGraphResponse> =>
    unwrap(apiClient.delete<Wrap<ReturnStatusGraphResponse>>(`/api/v1/admin/returns/statuses/${code}`)),
  setTransitions: (transitions: Array<{ fromStatusCode: string; toStatusCode: string }>): Promise<ReturnStatusGraphResponse> =>
    unwrap(apiClient.put<Wrap<ReturnStatusGraphResponse>>('/api/v1/admin/returns/transitions', { transitions })),

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
