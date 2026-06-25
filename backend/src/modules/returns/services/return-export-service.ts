import type { AdminReturnsListQuery } from '@b2b/contracts';
import type { ReturnListService } from './return-list-service.js';

const MAX_EXPORT_ROWS = 10_000;
const COLUMNS = ['rmaNumber', 'kind', 'orderId', 'statusCode', 'totalRefundAmount', 'currency', 'submittedAt'] as const;

/**
 * ReturnExportService — feature 046 (US8). Exports the current returns-list
 * view to CSV (RFC-4180 quoting, hard row cap). Mirrors `OrderExportService`.
 */
export class ReturnExportService {
  constructor(private readonly listService: ReturnListService) {}

  async exportCsv(query: AdminReturnsListQuery): Promise<{ csv: string; rowCount: number; truncated: boolean }> {
    const result = await this.listService.list({ ...query, page: 1, pageSize: MAX_EXPORT_ROWS });
    const header = COLUMNS.join(',');
    const lines = result.rows.map((r) =>
      COLUMNS.map((c) => csvCell(String((r as Record<string, unknown>)[c] ?? ''))).join(','),
    );
    return {
      csv: [header, ...lines].join('\r\n'),
      rowCount: result.rows.length,
      truncated: result.total > result.rows.length,
    };
  }
}

/** RFC-4180: quote when the cell contains a quote, comma, or newline. */
function csvCell(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
