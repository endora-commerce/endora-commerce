import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { parseXlsxRows } from './excel-importer.js';

async function buildXlsx(rows: Array<Array<string | number>>): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Sheet1');
  for (const row of rows) sheet.addRow(row);
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

describe('parseXlsxRows', () => {
  it('reads the first worksheet with the same column semantics as CSV', async () => {
    const buffer = await buildXlsx([
      ['SKU', 'Quantity', 'Color'],
      ['ABC', 3, 'Red'],
      ['DEF', 1, 'Blue'],
    ]);
    const out = await parseXlsxRows(buffer);
    expect(out.headerOk).toBe(true);
    expect(out.rows).toHaveLength(2);
    expect(out.rows[0]).toMatchObject({
      sku: 'ABC',
      quantityRaw: '3',
      attributes: { color: 'Red' },
    });
    expect(out.rows[1]).toMatchObject({ sku: 'DEF', quantityRaw: '1', attributes: { color: 'Blue' } });
  });

  it('normalizes numeric quantity cells to their text form', async () => {
    const buffer = await buildXlsx([
      ['sku', 'quantity'],
      ['X', 12],
    ]);
    const out = await parseXlsxRows(buffer);
    expect(out.rows[0]!.quantityRaw).toBe('12');
  });

  it('returns headerOk=false when sku/quantity headers are absent', async () => {
    const buffer = await buildXlsx([
      ['foo', 'bar'],
      ['1', '2'],
    ]);
    const out = await parseXlsxRows(buffer);
    expect(out.headerOk).toBe(false);
  });
});
