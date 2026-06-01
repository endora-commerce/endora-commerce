import exceljs from 'exceljs';
import { rowsFromTable, type ParseOutcome } from './import-rows.js';

/**
 * Parse an `.xlsx` workbook into the shared `NormalizedRow[]` (feature 039,
 * FR-001). Only the first worksheet is read (research §R1); the header +
 * column semantics are identical to the CSV path via `rowsFromTable`.
 *
 * The dependency on `exceljs` is isolated to this adapter — the rest of the
 * import pipeline only ever sees normalized rows.
 */
export async function parseXlsxRows(content: Buffer): Promise<ParseOutcome> {
  const workbook = new exceljs.Workbook();
  // Hand exceljs a plain ArrayBuffer slice: @types/node now types Buffer as
  // the generic `Buffer<ArrayBufferLike>`, which is not assignable to the
  // `Buffer<ArrayBuffer>` exceljs's bundled typings expect.
  const arrayBuffer = content.buffer.slice(
    content.byteOffset,
    content.byteOffset + content.byteLength,
  ) as ArrayBuffer;
  await workbook.xlsx.load(arrayBuffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return { headerOk: false, rows: [] };

  // exceljs rows + cells are 1-based; row.values[0] is unused.
  const cellText = (cell: exceljs.Cell | undefined): string => {
    if (!cell) return '';
    const text = cell.text;
    return typeof text === 'string' ? text.trim() : String(cell.value ?? '').trim();
  };

  let header: string[] = [];
  let headerColumnCount = 0;
  const dataRows: Array<{ rowNumber: number; raw: string; cells: string[] }> = [];

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) {
      headerColumnCount = row.cellCount;
      header = Array.from({ length: headerColumnCount }, (_, i) => cellText(row.getCell(i + 1)));
      return;
    }
    const columnCount = Math.max(headerColumnCount, row.cellCount);
    const cells = Array.from({ length: columnCount }, (_, i) => cellText(row.getCell(i + 1)));
    if (cells.every((c) => c.length === 0)) return;
    dataRows.push({ rowNumber, raw: cells.join(','), cells });
  });

  if (header.length === 0) return { headerOk: false, rows: [] };
  return rowsFromTable(header, dataRows);
}
