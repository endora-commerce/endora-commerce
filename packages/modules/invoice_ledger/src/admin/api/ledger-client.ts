import { apiClient } from '@endora-commerce/admin-kit/lib';
import type {
  InvoiceLedgerDeliveryListItem,
  InvoiceLedgerDeliveryListQuery,
  InvoiceLedgerRoutingDto,
  InvoiceLedgerRoutingWriteBody,
  LedgerDeliveryRecord,
} from '@endora-commerce/contracts';

const BASE = '/api/v1/admin/invoice-ledger';

export const invoiceLedgerAdminClient = {
  getRouting(): Promise<InvoiceLedgerRoutingDto> {
    return apiClient
      .get<{ data: InvoiceLedgerRoutingDto }>(`${BASE}/routing`)
      .then((r) => r.data);
  },

  saveRouting(body: InvoiceLedgerRoutingWriteBody): Promise<InvoiceLedgerRoutingDto> {
    return apiClient
      .put<{ data: InvoiceLedgerRoutingDto }>(`${BASE}/routing`, body)
      .then((r) => r.data);
  },

  listDeliveries(
    query: InvoiceLedgerDeliveryListQuery = { limit: 50 },
  ): Promise<{
    data: InvoiceLedgerDeliveryListItem[];
    pagination: { cursor: string | null; hasMore: boolean; limit: number };
  }> {
    const params = new URLSearchParams();
    if (query.status) params.set('status', query.status);
    if (query.salesChannelId) params.set('salesChannelId', query.salesChannelId);
    if (query.invoiceId) params.set('invoiceId', query.invoiceId);
    if (query.limit) params.set('limit', String(query.limit));
    if (query.cursor) params.set('cursor', query.cursor);
    const qs = params.toString();
    return apiClient.get(`${BASE}/deliveries${qs ? `?${qs}` : ''}`);
  },

  retryDelivery(id: string): Promise<LedgerDeliveryRecord> {
    return apiClient
      .post<{ data: LedgerDeliveryRecord }>(`${BASE}/deliveries/${id}/retry`)
      .then((r) => r.data);
  },
};
