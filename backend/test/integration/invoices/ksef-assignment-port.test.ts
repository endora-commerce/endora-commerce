import { randomBytes } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Invoice } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import { ensureSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import { ADMIN_COOKIE, seedInvoiceableOrder, setSellerSettings } from './helpers.js';

/**
 * The KSeF identity an invoice carries is `invoices`' own statutory state
 * (`specs/134-paid-module-extraction/` T067; `research.md` D22 §2), and so are
 * the two guards on it:
 *
 * - **the assignment port is write-once** — feature 059 US1 (T019): the
 *   `recordKsefAssignment` port writes both columns, a re-record of the same
 *   number is a no-op, and a different number is refused with 409;
 * - **an invoice is never edited or deleted through the API** — feature 059
 *   FR-020's immutability pin: no `PATCH`/`PUT`/`DELETE` route exists for an
 *   admin invoice, and none for a customer's.
 *
 * ## Why this file is here, and why it names no module that writes the number
 *
 * Both assertions lived under `integration/ksef/` and `contract/ksef/`, the
 * host directories of the module that submits invoices to KSeF natively, and
 * would have left with it (feature 134, T069). Neither is that module's
 * behaviour: the port and the route table are `invoices`', and any delivery path
 * writes the number — native submission, a ledger vendor, a third-party adapter
 * on the free ledger seam. `research.md` D22 §5 asked whether `invoices` still
 * refuses to edit or delete an invoice that carries a KSeF number while the
 * module that submitted it is off. Measured: it does, and nothing it does
 * depends on that module — there is no route to refuse through, and the port's
 * refusal reads only the invoice row. This file is that measurement, taken with
 * no KSeF-writing module involved at all, so it cannot pass because one of them
 * happened to be present.
 */
describe('invoices — the KSeF identity is write-once and the invoice is immutable [integration]', () => {
  let h: BackendServerHandle;
  // Feature 078, D-95: `{channel}` is rendered from the `sales_channels` row, so
  // this file's channel has to be one. The per-file code keeps this file's
  // numbers distinct in the shared test database.
  let channelId: string;

  beforeAll(async () => {
    process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] =
      process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] ?? randomBytes(32).toString('base64');
    h = await setupBackendServer();
    channelId = await ensureSalesChannelId(h.em(), 'invoices-ksef-identity');
    await setSellerSettings(h);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function issueInvoice(): Promise<string> {
    const { orderId } = await withSystemScope('seed', () =>
      seedInvoiceableOrder(h.em(), { salesChannelId: channelId }),
    );
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orderId}/invoices`,
      payload: { kind: 'invoice' },
      cookies: ADMIN_COOKIE,
    });
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { data: { id: string } }).data.id;
  }

  it('writes, is idempotent for the same number, and refuses a different one', async () => {
    const invoiceId = await issueInvoice();
    const number = '1234567890-20260722-PORT01-01';
    const processedAt = new Date('2026-07-22T10:00:00Z');

    await withSystemScope('port', () =>
      h.invoices.invoiceService.recordKsefAssignment(invoiceId, {
        ksefReferenceNumber: number,
        ksefProcessedAt: processedAt,
      }),
    );
    const invoice = await withSystemScope('read', () =>
      h.em().fork().findOneOrFail(Invoice, { id: invoiceId }),
    );
    expect(invoice.ksefReferenceNumber).toBe(number);
    expect(invoice.ksefProcessedAt?.toISOString()).toBe(processedAt.toISOString());

    // Same number — no-op.
    await withSystemScope('port', () =>
      h.invoices.invoiceService.recordKsefAssignment(invoiceId, {
        ksefReferenceNumber: number,
        ksefProcessedAt: new Date(),
      }),
    );
    const unchanged = await withSystemScope('read', () =>
      h.em().fork().findOneOrFail(Invoice, { id: invoiceId }),
    );
    expect(unchanged.ksefProcessedAt?.toISOString()).toBe(processedAt.toISOString());

    // Different number — refused.
    await expect(
      withSystemScope('port', () =>
        h.invoices.invoiceService.recordKsefAssignment(invoiceId, {
          ksefReferenceNumber: 'DIFFERENT-NUMBER',
          ksefProcessedAt: new Date(),
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('exposes no route that edits or deletes an invoice carrying a KSeF number', async () => {
    const invoiceId = await issueInvoice();
    const number = '1234567890-20260722-PORT02-01';
    await withSystemScope('port', () =>
      h.invoices.invoiceService.recordKsefAssignment(invoiceId, {
        ksefReferenceNumber: number,
        ksefProcessedAt: new Date('2026-07-22T11:00:00Z'),
      }),
    );
    const before = await withSystemScope('read', () =>
      h.em().fork().findOneOrFail(Invoice, { id: invoiceId }),
    );

    // A real invoice's URL rather than a nil id, so a 404 is the router's
    // answer about the method and not a handler's answer about a missing row.
    const invoiceUrl = `/api/v1/admin/invoices/${invoiceId}`;
    for (const method of ['PATCH', 'PUT', 'DELETE'] as const) {
      const res = await h.app.inject({
        method,
        url: invoiceUrl,
        payload: { number: 'EDITED', ksefReferenceNumber: null },
        cookies: ADMIN_COOKIE,
      });
      expect(res.statusCode, `${method} ${invoiceUrl}: ${res.body}`).toBe(404);
    }
    const customerDelete = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/orders/${before.orderId}/invoices/${invoiceId}`,
      cookies: ADMIN_COOKIE,
    });
    expect(customerDelete.statusCode).toBe(404);

    const after = await withSystemScope('read', () =>
      h.em().fork().findOneOrFail(Invoice, { id: invoiceId }),
    );
    expect(after.number).toBe(before.number);
    expect(after.ksefReferenceNumber).toBe(number);
  });
});
