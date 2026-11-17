import type { AdminReturnRow, AdminReturnsListQuery } from '@endora-commerce/contracts';
import type { ReturnListService } from './return-list-service.js';

const MAX_EXPORT_ROWS = 10_000;
const COLUMNS = [
  'rmaNumber',
  'reference',
  'kind',
  'orderId',
  'statusCode',
  'totalRefundAmount',
  'currency',
  'submittedAt',
  'authorizedBy',
  // 180 FR-B35 — the case has no platform order.
  'offPlatform',
  // `specs/181-guest-complaints/` FR-061 — a guest without an account filed it.
  'guest',
] as const;

/**
 * A sentence of this module's bundle in the export's language
 * (`specs/180-off-platform-complaints/` FR-A41): the backend can resolve the reader's
 * language when it writes the file, so it words the file itself (`module-i18n.md`).
 */
export type ExportTranslate = (key: string) => Promise<string>;

/**
 * ReturnExportService — feature 046 (US8). Exports the current returns-list
 * view to CSV (RFC-4180 quoting, hard row cap). Mirrors `OrderExportService`.
 *
 * `specs/180-off-platform-complaints/` adds the case `reference` (FR-A44) and
 * `authorizedBy` (FR-A41): the name, *former administrator* for an id that no longer
 * resolves, *unknown* for an authorization recorded without one, empty while the case
 * is not authorized — the last two worded in the export language.
 */
export class ReturnExportService {
  constructor(private readonly listService: ReturnListService) {}

  async exportCsv(
    query: AdminReturnsListQuery,
    translate: ExportTranslate = async (key) => key,
  ): Promise<{ csv: string; rowCount: number; truncated: boolean }> {
    const result = await this.listService.list({ ...query, page: 1, pageSize: MAX_EXPORT_ROWS });
    const header = COLUMNS.join(',');
    const [former, unknown] = await Promise.all([
      translate('export.authorizedBy.former'),
      translate('export.authorizedBy.unknown'),
    ]);
    const authorizedBy = (r: AdminReturnRow): string => {
      if (!r.authorizedBy) return '';
      if (!r.authorizedBy.adminUserId) return unknown;
      return r.authorizedBy.name ?? former;
    };
    const lines = result.rows.map((r) =>
      COLUMNS.map((c) =>
        csvCell(c === 'authorizedBy' ? authorizedBy(r) : String((r as Record<string, unknown>)[c] ?? '')),
      ).join(','),
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
