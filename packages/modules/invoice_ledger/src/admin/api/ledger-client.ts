import { apiClient } from '@endora-commerce/admin-kit/lib';
import type {
  InvoiceLedgerRoutingDto,
  InvoiceLedgerRoutingWriteBody,
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
};
