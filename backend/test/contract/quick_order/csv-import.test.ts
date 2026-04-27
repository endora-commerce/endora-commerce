import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
// SKUs come from the seed-catalog fixture (EXAMPLE-SIMPLE-001 / EXAMPLE-BLUE-002).
const EXAMPLE_SIMPLE_001_SKU = 'EXAMPLE-SIMPLE-001';
const EXAMPLE_SIMPLE_002_SKU = 'EXAMPLE-BLUE-002';

/**
 * T198 — `POST /quick-order/import` returns a recognised + rejected
 * partition with line numbers preserved so the UI can highlight problem
 * rows.
 */

describe('Quick-order CSV import', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('partitions rows into recognised + rejected with line numbers', async () => {
    const csv = [
      'sku,quantity',
      `${EXAMPLE_SIMPLE_001_SKU},5`,
      'NOT-A-REAL-SKU,3',
      `${EXAMPLE_SIMPLE_002_SKU},`,
      `${EXAMPLE_SIMPLE_002_SKU},2`,
      ',7',
    ].join('\n');

    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quick-order/import',
      cookies: { b2b_session: 'stub-customer-session' },
      payload: { csv },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: {
        recognized: Array<{ line: number; sku: string; quantity: number }>;
        rejected: Array<{ line: number; reason: string }>;
      };
    };
    // Line 2 (recognized), line 5 (recognized).
    expect(body.data.recognized.map((r) => r.line)).toEqual([2, 5]);
    expect(body.data.recognized[0]?.sku).toBe(EXAMPLE_SIMPLE_001_SKU);
    expect(body.data.recognized[0]?.quantity).toBe(5);
    // Line 3 not_found, line 4 quantity_invalid, line 6 sku_missing.
    const rejectedByLine = new Map(body.data.rejected.map((r) => [r.line, r.reason]));
    expect(rejectedByLine.get(3)).toBe('product_not_found');
    expect(rejectedByLine.get(4)).toBe('quantity_invalid');
    expect(rejectedByLine.get(6)).toBe('sku_missing');
  });

  it('rejects every data row when the header is missing', async () => {
    const csv = [
      `${EXAMPLE_SIMPLE_001_SKU},5`,
      `${EXAMPLE_SIMPLE_002_SKU},2`,
    ].join('\n');
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quick-order/import',
      cookies: { b2b_session: 'stub-customer-session' },
      payload: { csv },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { recognized: unknown[]; rejected: Array<{ reason: string }> };
    };
    expect(body.data.recognized).toEqual([]);
    body.data.rejected.forEach((r) => expect(r.reason).toBe('malformed_row'));
  });
});
