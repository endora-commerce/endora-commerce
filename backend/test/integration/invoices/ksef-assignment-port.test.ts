import { Invoice } from '../../helpers/package-entities.js';
import { randomBytes } from 'crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';

import { seedInvoiceableOrder, setSellerSettings } from '../invoices/helpers.js';

import { issueInvoice } from './helpers.js';

import { ensureSalesChannelId } from '../../helpers/sales-channel-fixtures.js';


/**
 * Feature 059 US1 (T019) — the invoices-owned `recordKsefAssignment` port:
 * writes both columns, same-number re-record is a no-op, a different number is
 * refused with 409 (KSeF identity is immutable).
 */
describe('recordKsefAssignment port [real DB]', () => {
  let h: BackendServerHandle;
  // Feature 078, D-95: `{channel}` is rendered from the `sales_channels`
  // row, so this file's channel has to be one. The per-file code keeps this
  // file's numbers distinct in the shared test database, which is what the
  // fabricated id used to be for.
  let CH: string;

  beforeAll(async () => {
    process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] =
      process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] ?? randomBytes(32).toString('base64');
    h = await setupBackendServer();
    CH = await ensureSalesChannelId(h.em(), 'ksef-invoice-port');
    await setSellerSettings(h);
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('writes, is idempotent for the same number, and refuses a different one', async () => {
    const { orderId } = await withSystemScope('seed', () => seedInvoiceableOrder(h.em(), { salesChannelId: CH }));
    const invoiceId = await issueInvoice(h, orderId);
    const number = '1234567890-20260722-PORT01-01';
    const processedAt = new Date('2026-07-22T10:00:00Z');

    await withSystemScope('port', () =>
      h.invoices.invoiceService.recordKsefAssignment(invoiceId, {
        ksefReferenceNumber: number,
        ksefProcessedAt: processedAt,
      }),
    );
    const invoice = await withSystemScope('read', () => h.em().fork().findOneOrFail(Invoice, { id: invoiceId }));
    expect(invoice.ksefReferenceNumber).toBe(number);
    expect(invoice.ksefProcessedAt?.toISOString()).toBe(processedAt.toISOString());

    // Same number — no-op.
    await withSystemScope('port', () =>
      h.invoices.invoiceService.recordKsefAssignment(invoiceId, {
        ksefReferenceNumber: number,
        ksefProcessedAt: new Date(),
      }),
    );
    const unchanged = await withSystemScope('read', () => h.em().fork().findOneOrFail(Invoice, { id: invoiceId }));
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
});
