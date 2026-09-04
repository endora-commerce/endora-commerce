import { describe, expect, it } from 'vitest';
import { parseCsv, rowsToRecords, serializeCsv } from './csv-codec.js';

/**
 * RFC 4180 round-trips that matter in practice: quoted fields with commas,
 * embedded double-quotes, and embedded newlines. Plus the BOM strip Excel
 * adds when "Save as CSV UTF-8" is used.
 */

describe('CSV codec', () => {
  it('round-trips ordinary rows', () => {
    const csv = serializeCsv([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
    expect(parseCsv(csv)).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('escapes commas, quotes, and newlines on serialise', () => {
    const csv = serializeCsv([
      ['plain', 'has,comma', 'has"quote', 'has\nnewline'],
    ]);
    expect(csv).toContain('"has,comma"');
    expect(csv).toContain('"has""quote"');
    expect(csv).toContain('"has\nnewline"');
    const back = parseCsv(csv);
    expect(back[0]).toEqual(['plain', 'has,comma', 'has"quote', 'has\nnewline']);
  });

  it('strips a leading UTF-8 BOM (Excel "Save as CSV UTF-8")', () => {
    const csv = '﻿a,b\n1,2\n';
    expect(parseCsv(csv)).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('rowsToRecords zips header + data rows', () => {
    const rows = parseCsv('sku,name\nABC,Widget\nDEF,"Gizmo, deluxe"\n');
    expect(rowsToRecords(rows)).toEqual([
      { sku: 'ABC', name: 'Widget' },
      { sku: 'DEF', name: 'Gizmo, deluxe' },
    ]);
  });

  it('rowsToRecords rejects duplicate header columns', () => {
    expect(() => rowsToRecords([['sku', 'sku']])).toThrow(/duplicate header/);
  });
});
