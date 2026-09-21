import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Invoice } from '../../helpers/package-entities.js';
import { ScriptedLedgerFixtureClient } from '../../helpers/ledger-fixture-client.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import { seedInvoiceableOrder, setSellerSettings } from './helpers.js';
import { ADMIN, waitForDelivery } from '../invoice_ledger/helpers.js';
import { prepareLedgerFixtureVatCopy } from '../invoice_ledger/fixture-vendor.js';

const VENDOR_NUMBER = 'FV/FIX/42';

/**
 * Feature 134 / D-256 — this is `invoices`' own test and `invoices` is free, so
 * the vendor it drives is `ledger_vendor_fixture` rather than `infakt`. Nothing
 * here was ever a vendor's: the subject is that mode B holds an invoice
 * `pending` and sends no e-mail until `applyVendorAssignedNumber` arrives, and
 * the scripted client is never even called. A free module's test reaching a paid
 * package by bare specifier is what `contracts/extraction-procedure.md` E7 stops
 * on, and it was the last one outside the two vendors' own host directories.
 */
const AUDIT = { actorAdminUserId: '00000000-0000-0000-0000-000000000000' };

describe('invoices — mode B waits for the vendor number [integration]', () => {
  let h: BackendServerHandle;
  let channelId: string;
  const ledgerFixtureHttp = new ScriptedLedgerFixtureClient();

  beforeAll(async () => {
    process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] =
      process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] ?? randomBytes(32).toString('base64');
    h = await setupBackendServer({
      deployment: 'example',
      moduleOverrides: { ledgerFixtureHttp },
    });
    channelId = await prepareLedgerFixtureVatCopy(h, 'il-mode-b', 'FVMB {seq}/{YYYY}');
    await setSellerSettings(h);
    await h.settings.adminService.setValueForSubset(
      'invoices.email.send_on_issue',
      ['il-mode-b'],
      true,
      null,
      AUDIT,
    );
    const routing = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/invoice-ledger/routing',
      ...ADMIN,
      payload: { numberingMode: 'vendor', confirm: true },
    });
    expect(routing.statusCode, routing.body).toBe(200);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('holds pending without email, then applyVendorAssignedNumber makes it ready', async () => {
    const { orderId } = await seedInvoiceableOrder(h.em(), { salesChannelId: channelId });
    const created = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orderId}/invoices`,
      payload: { kind: 'invoice' },
      ...ADMIN,
    });
    expect(created.statusCode, created.body).toBe(201);
    const body = created.json() as {
      data: { id: string; number: string; status: string };
      email: { status: string };
    };
    expect(body.data.status).toBe('pending');
    expect(body.email).toEqual({ status: 'not_requested' });

    const queued = await waitForDelivery(h, body.data.id);
    expect(queued.numberingMode).toBe('vendor');

    await withSystemScope('apply vendor number', () =>
      h.invoices.invoiceService.applyVendorAssignedNumber(body.data.id, VENDOR_NUMBER),
    );

    const ready = await withSystemScope('read mode B invoice', () =>
      h.em().fork().findOneOrFail(Invoice, { id: body.data.id }),
    );
    expect(ready.status).toBe('ready');
    expect(ready.number).toBe(VENDOR_NUMBER);
  });
});
