import { describe, expect, it } from 'vitest';
import { parseCsvLine, parseCsvRows, rowsFromTable } from './import-rows.js';

describe('parseCsvLine', () => {
  it('splits plain comma-separated cells', () => {
    expect(parseCsvLine('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  it('honours double-quoted fields with embedded commas and escaped quotes', () => {
    expect(parseCsvLine('"a,b","c""d"')).toEqual(['a,b', 'c"d']);
  });
});

describe('parseCsvRows', () => {
  it('returns headerOk=false when sku/quantity headers are missing', () => {
    expect(parseCsvRows('foo,bar\n1,2')).toEqual({ headerOk: false, rows: [] });
  });

  it('returns headerOk=false for empty input', () => {
    expect(parseCsvRows('')).toEqual({ headerOk: false, rows: [] });
  });

  it('parses sku + quantity in any order, case-insensitive, skipping blank lines', () => {
    const out = parseCsvRows('Quantity,SKU\n3,ABC\n\n5,DEF\n');
    expect(out.headerOk).toBe(true);
    expect(out.rows).toEqual([
      { rowNumber: 2, raw: '3,ABC', sku: 'ABC', quantityRaw: '3', attributes: {} },
      { rowNumber: 4, raw: '5,DEF', sku: 'DEF', quantityRaw: '5', attributes: {} },
    ]);
  });

  it('captures extra columns as variant attributes (blank values dropped)', () => {
    const out = parseCsvRows('sku,quantity,color,size\nABC,2,Red,\nDEF,1,Blue,L');
    expect(out.rows[0]).toEqual({
      rowNumber: 2,
      raw: 'ABC,2,Red,',
      sku: 'ABC',
      quantityRaw: '2',
      attributes: { color: 'Red' },
    });
    expect(out.rows[1]!.attributes).toEqual({ color: 'Blue', size: 'L' });
  });
});

describe('rowsFromTable', () => {
  it('maps header columns to sku/quantity/attributes by name', () => {
    const out = rowsFromTable(
      ['SKU', 'Color', 'Quantity'],
      [{ rowNumber: 2, raw: 'X,Red,4', cells: ['X', 'Red', '4'] }],
    );
    expect(out.headerOk).toBe(true);
    expect(out.rows[0]).toEqual({
      rowNumber: 2,
      raw: 'X,Red,4',
      sku: 'X',
      quantityRaw: '4',
      attributes: { color: 'Red' },
    });
  });
});
