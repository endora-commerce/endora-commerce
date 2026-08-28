import type { OrderListQuery, OrderListScope, OrderListService } from './order-list-service.js';

/** Hard cap on CSV export rows; the route surfaces truncation in a header. */
export const ORDER_EXPORT_MAX_ROWS = 10_000;

const COLUMNS: Array<{ header: string; value: (r: ExportRow) => string }> = [
  { header: 'businessId', value: (r) => r.businessId },
  { header: 'customer', value: (r) => r.customerName ?? '' },
  { header: 'organization', value: (r) => r.organizationName ?? '' },
  { header: 'status', value: (r) => r.status },
  { header: 'paymentStatus', value: (r) => r.paymentStatus },
  { header: 'total', value: (r) => r.total.toFixed(2) },
  { header: 'currency', value: (r) => r.currency },
  { header: 'placedAt', value: (r) => r.placedAt },
];

interface ExportRow {
  businessId: string;
  customerName: string | null;
  organizationName: string | null;
  status: string;
  paymentStatus: string;
  total: number;
  currency: string;
  placedAt: string;
}

/**
 * OrderExportService — feature 038 (US2, T040).
 *
 * Streams the current list view's rows to CSV, assembled natively (no library,
 * per Constitution IV). Reflects the same filters/sort as the list; bounded at
 * {@link ORDER_EXPORT_MAX_ROWS} with the truncation flag surfaced to the caller.
 */
export class OrderExportService {
  constructor(private readonly listService: OrderListService) {}

  async exportCsv(
    query: Omit<OrderListQuery, 'page' | 'pageSize'>,
    scope?: OrderListScope,
  ): Promise<{ csv: string; rowCount: number; truncated: boolean }> {
    const { rows, total } = await this.listService.list(
      { ...query, page: 1, pageSize: ORDER_EXPORT_MAX_ROWS },
      scope,
    );
    const truncated = total > rows.length;
    const lines = [
      COLUMNS.map((c) => csvCell(c.header)).join(','),
      ...rows.map((r) => COLUMNS.map((c) => csvCell(c.value(r))).join(',')),
    ];
    return { csv: lines.join('\r\n'), rowCount: rows.length, truncated };
  }
}

/** RFC-4180 quoting: wrap in quotes and double any embedded quote. */
function csvCell(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
