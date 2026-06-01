import type { QuickOrderImportRequest } from '@b2b/contracts';
import { parseCsvRows, type ParseOutcome } from './import-rows.js';
import { parseXlsxRows } from './excel-importer.js';

/**
 * Turn an import request body (pasted CSV or an uploaded CSV / .xlsx file)
 * into normalized rows. Shared by the storefront and admin import routes so
 * both branch on format identically (feature 039).
 */
export async function parseImportRequest(
  body: Pick<QuickOrderImportRequest, 'csv' | 'file'>,
): Promise<ParseOutcome> {
  if (body.file) {
    const buffer = Buffer.from(body.file.contentBase64, 'base64');
    return body.file.filename.toLowerCase().endsWith('.xlsx')
      ? parseXlsxRows(buffer)
      : parseCsvRows(buffer.toString('utf8'));
  }
  return parseCsvRows(body.csv ?? '');
}
