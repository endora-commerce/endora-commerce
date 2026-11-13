import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ERP_SALE_DOCUMENT_WRITE_PORT,
  adminInvoiceListResponseSchema,
  type AdminInvoiceListResponse,
  type ErpSaleDocumentWritePort,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { deepStrict, disagreements } from '../../helpers/strict-schema.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { ADMIN_COOKIE } from '../../integration/invoices/helpers.js';

/**
 * Issue #1120 — `GET /api/v1/admin/invoices` pages by cursor, as the
 * `pagination` block it has always published says it does. It answered
 * `hasMore: false` and `cursor: null` whatever was beyond the page, so an
 * instance with more invoices than one page could not reach the rest.
 *
 * The rows are ERP-imported sale documents in a date window no other file
 * writes into (a random day in 2091), so the `filter[issuedFrom]` /
 * `filter[issuedTo]` pair isolates them on a shared database. Two of them share
 * an `issuedAt`, which is the case a cursor on the timestamp alone would skip
 * or repeat.
 */
describe('GET /api/v1/admin/invoices — cursor paging (issue #1120)', () => {
  let h: BackendServerHandle;
  const day = `2091-0${1 + Math.floor(Math.random() * 9)}-1${Math.floor(Math.random() * 9)}`;
  const window = `filter[issuedFrom]=${day}T00:00:00.000Z&filter[issuedTo]=${day}T23:59:59.999Z`;
  /** Newest first — the order the list answers in, ties included. */
  const issuedAt = [
    `${day}T15:00:00.000Z`,
    `${day}T12:00:00.000Z`,
    `${day}T12:00:00.000Z`,
    `${day}T09:00:00.000Z`,
    `${day}T06:00:00.000Z`,
  ];
  const ids: string[] = [];

  beforeAll(async () => {
    h = await setupBackendServer();
    const port = h.container.resolve<ErpSaleDocumentWritePort>(ERP_SALE_DOCUMENT_WRITE_PORT);
    for (const [index, at] of issuedAt.entries()) {
      const tag = randomUUID().slice(0, 8);
      const imported = await port.upsertImportedDocument({
        organizationId: TEST_ORGANIZATION_ID,
        externalDocumentRef: { system: 'comarch_xl', externalId: `xl-1120-${tag}`, documentKind: 'wz' },
        kind: 'wz',
        number: `WZ/1120/${index}/${tag}`,
        currency: 'PLN',
        issuedAt: at,
        grossTotal: '10.00',
      });
      ids.push(imported.invoiceId);
    }
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function page(query: string): Promise<AdminInvoiceListResponse> {
    const res = await h.app.inject({ method: 'GET', url: `/api/v1/admin/invoices?${query}`, cookies: ADMIN_COOKIE });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as AdminInvoiceListResponse;
    expect(disagreements(deepStrict(adminInvoiceListResponseSchema), body)).toEqual([]);
    return body;
  }

  it('answers hasMore and a cursor while rows remain, and walks every row exactly once', async () => {
    const seen: string[] = [];
    const pages: AdminInvoiceListResponse[] = [];
    let cursor: string | null = null;
    do {
      const query = `limit=2&${window}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const body = await page(query);
      pages.push(body);
      seen.push(...body.data.map((row) => row.id));
      cursor = body.pagination.cursor;
      expect(pages.length).toBeLessThan(10);
    } while (cursor !== null);

    expect(pages.map((p) => p.data.length)).toEqual([2, 2, 1]);
    expect(pages.map((p) => p.pagination.hasMore)).toEqual([true, true, false]);
    expect(pages.every((p) => p.pagination.limit === 2)).toBe(true);
    expect(new Set(seen).size).toBe(seen.length);
    expect([...seen].sort()).toEqual([...ids].sort());
    // Newest first: the 15:00 row opens, the 06:00 row closes.
    expect(seen[0]).toBe(ids[0]);
    expect(seen[seen.length - 1]).toBe(ids[4]);
  });

  it('answers hasMore false and no cursor when the page holds the rest', async () => {
    const body = await page(`limit=5&${window}`);
    expect(body.data).toHaveLength(5);
    expect(body.pagination).toEqual({ cursor: null, hasMore: false, limit: 5 });
  });

  it('refuses a cursor it did not issue with 400', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/invoices?limit=2&cursor=not-a-cursor`,
      cookies: ADMIN_COOKIE,
    });
    expect(res.statusCode, res.body).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
  });
});
