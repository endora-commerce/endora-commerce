import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CAPABILITY_KEYS,
  INVOICE_LEDGER_UNREADABLE_VENDOR_ERROR,
} from '@endora-commerce/contracts';
import {
  InvoiceLedgerClientMap,
  InvoiceLedgerDelivery,
  InvoiceLedgerDocumentMap,
} from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ScriptedLedgerFixtureClient } from '../../helpers/ledger-fixture-client.js';
import { switchCapabilityFamilyOff } from '../../helpers/capability-families.js';
import { ensureSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import { seedInvoiceableOrder, setSellerSettings } from '../invoices/helpers.js';
import { ADMIN, findDelivery, issueInvoice, waitForDelivery } from './helpers.js';

/**
 * The free ledger suite's **vendor-independent** subject — feature 134,
 * `specs/080-f4-real-scope/rulings.md` **D-256**, wave 4's prologue.
 *
 * ## What is being proved, and why no other file in this directory proves it
 *
 * Every other file under `backend/test/{integration,contract}/invoice_ledger/`
 * drives `invoice_ledger` *through* `wfirma` or `infakt`. That is the reason
 * `contracts/extraction-procedure.md` **E5** refuses both of those extractions:
 * the free module's own suite would leave with the paid packages it exercises
 * itself against. D-256's answer is a **fixture ledger vendor** —
 * `backend/src/apps/example/modules/ledger_vendor_fixture/`, the example
 * deployment's synthetic vendor, on the shape `carrier_fixture` and
 * `erp_incumbent_fixture` already use for the carrier and ERP families.
 *
 * So this file names **no vendor package, no vendor credential code and no
 * vendor sentence**. It drives the whole enqueue → deliver → map → retry path
 * over a vendor that is not going anywhere, which makes it the file that stays
 * green on the day the paid four leave.
 *
 * ## `deployment: 'example'`
 *
 * The fixture is an overlay module, so it composes only when the deployment that
 * owns it is selected — exactly as a `DEPLOYMENT=example` build does, and the
 * same thing `integration/erp_connector/overlay-joins.test.ts` already does for
 * `erp_incumbent_fixture`. An overlay module contributes no entity and no
 * migration (`specs/conventions/overlay-modules.md`, D-106); this one needs
 * neither, because every row below belongs to `invoice_ledger` — which is also
 * true of the two real vendors, and is what makes the overlay placement work at
 * all rather than being a constraint designed around.
 *
 * ## The vendor family is derived, so the fixture joins by declaring
 *
 * Nothing in `invoice_ledger` names this module. It appears in the mutex, in the
 * routing read and in the dead-letter attribution because its manifest declares
 * `capabilities: ['invoice-ledger-vendor']` and feature 132 derives the family
 * from the members' own declarations. `switchCapabilityFamilyOff` below is that
 * derivation used from the other end: every shipped member off, then the fixture
 * on, with no sibling named anywhere in this file.
 */

const FIXTURE_MODULE_ID = 'ledger_vendor_fixture';
const FIXTURE_CREDENTIAL_CODE = 'ledger_vendor_fixture';
const FIXTURE_API_KEY = 'ledger-fixture-api-key-256';
const AUDIT = { actorAdminUserId: '00000000-0000-0000-0000-000000000000' };

/** A sentence shaped like an operator sentence: it must survive the ledger's floor. */
const FIXTURE_REFUSAL = 'The fixture ledger vendor rejected this document.';

describe('invoice ledger — the fixture vendor, end to end [integration]', () => {
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

    channelId = await ensureSalesChannelId(h.em(), 'il-fixture');
    await setSellerSettings(h);
    await h.settings.adminService.setValueForSubset(
      'invoices.numbering.invoice.pattern',
      ['il-fixture'],
      'FVFIX {seq}/{YYYY}',
      null,
      AUDIT,
    );

    // Every shipped member of the exclusive family off, then the fixture on —
    // derived, never a written-down sibling list (D-100).
    await switchCapabilityFamilyOff(h, CAPABILITY_KEYS.INVOICE_LEDGER_VENDOR);
    const activated = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/modules/${FIXTURE_MODULE_ID}/activation`,
      ...ADMIN,
      payload: { active: true },
    });
    expect(activated.statusCode, activated.body).toBe(200);

    // The vendor's credential, written through the owner's port rather than
    // through a vendor connection route: the fixture serves none, deliberately,
    // because a connection screen is a vendor's own surface and nothing the free
    // ledger publishes reads it.
    await withSystemScope('seed fixture ledger credential', () =>
      h.credentials.service.create({
        code: FIXTURE_CREDENTIAL_CODE,
        name: 'Ledger vendor fixture',
        typeCode: FIXTURE_CREDENTIAL_CODE,
        providerCode: FIXTURE_CREDENTIAL_CODE,
        values: { apiKey: FIXTURE_API_KEY, environment: 'sandbox' },
      }),
    );

    const routing = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/invoice-ledger/routing',
      ...ADMIN,
      payload: { numberingMode: 'endora', ksefRouting: 'native', confirm: true },
    });
    expect(routing.statusCode, routing.body).toBe(200);
  }, 120_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('enqueues against the declared fixture vendor and delivers once', async () => {
    ledgerFixtureHttp.reset();
    ledgerFixtureHttp.nextRemoteDocumentId = 'fixture-doc-vat-1';
    const { orderId } = await seedInvoiceableOrder(h.em(), { salesChannelId: channelId });
    const issued = await issueInvoice(h, orderId, 'invoice');

    const queued = await waitForDelivery(h, issued.id);
    expect(queued.adapterId).toBe(FIXTURE_MODULE_ID);
    expect(queued.status).toBe('queued');
    expect(queued.credentialCode).toBe(FIXTURE_CREDENTIAL_CODE);
    expect(queued.environment).toBe('sandbox');
    expect(queued.numberingMode).toBe('endora');
    expect(queued.ksefRouting).toBe('native');

    await h.ledgerDeliveryProcessor('ledgerFixtureDeliveryProcessor')(queued.id);

    const done = await withSystemScope('read fixture delivery', () =>
      h.em().fork().findOneOrFail(InvoiceLedgerDelivery, { id: queued.id }),
    );
    expect(done.status).toBe('succeeded');
    expect(done.remoteDocumentId).toBe('fixture-doc-vat-1');
    expect(done.lastError ?? null).toBeNull();

    // The ledger's own maps, written by the ledger from the vendor's calls.
    const documentMap = await withSystemScope('read fixture document map', () =>
      h.em().fork().findOne(InvoiceLedgerDocumentMap, { invoiceId: issued.id }),
    );
    expect(documentMap).toMatchObject({
      adapterId: FIXTURE_MODULE_ID,
      remoteDocumentId: 'fixture-doc-vat-1',
      environment: 'sandbox',
      credentialCode: FIXTURE_CREDENTIAL_CODE,
    });
    const clientMap = await withSystemScope('read fixture client map', () =>
      h.em().fork().findOne(InvoiceLedgerClientMap, { adapterId: FIXTURE_MODULE_ID }),
    );
    expect(clientMap).not.toBeNull();

    // Idempotent: a second call is a no-op, not a second document.
    const createsBefore = ledgerFixtureHttp.createCalls.length;
    await h.ledgerDeliveryProcessor('ledgerFixtureDeliveryProcessor')(queued.id);
    expect(ledgerFixtureHttp.createCalls).toHaveLength(createsBefore);
  }, 60_000);

  it("stores a vendor refusal verbatim and floors a dump, through the vendor's own words", async () => {
    // D-256's floor, asserted end to end rather than over the function: the free
    // ledger keeps a **shape** floor, not a vocabulary. A sentence passes because
    // it is sentence-shaped, not because a free file recognised it.
    ledgerFixtureHttp.reset();
    ledgerFixtureHttp.next = { ok: false, message: FIXTURE_REFUSAL, transient: false };
    const refused = await seedInvoiceableOrder(h.em(), { salesChannelId: channelId });
    const refusedInvoice = await issueInvoice(h, refused.orderId, 'invoice');
    const refusedDelivery = await waitForDelivery(h, refusedInvoice.id);
    await h.ledgerDeliveryProcessor('ledgerFixtureDeliveryProcessor')(refusedDelivery.id);
    const refusedRow = await withSystemScope('read refused delivery', () =>
      h.em().fork().findOneOrFail(InvoiceLedgerDelivery, { id: refusedDelivery.id }),
    );
    expect(refusedRow.status).toBe('dead');
    expect(refusedRow.lastError).toBe(FIXTURE_REFUSAL);

    // A serialised body is not a sentence, and the ledger says so without knowing
    // whose body it is.
    ledgerFixtureHttp.reset();
    ledgerFixtureHttp.next = {
      ok: false,
      message: '{"error":{"code":422,"body":"<html><b>nope</b></html>"}}',
      transient: false,
    };
    const dumped = await seedInvoiceableOrder(h.em(), { salesChannelId: channelId });
    const dumpedInvoice = await issueInvoice(h, dumped.orderId, 'invoice');
    const dumpedDelivery = await waitForDelivery(h, dumpedInvoice.id);
    await h.ledgerDeliveryProcessor('ledgerFixtureDeliveryProcessor')(dumpedDelivery.id);
    const dumpedRow = await withSystemScope('read dumped delivery', () =>
      h.em().fork().findOneOrFail(InvoiceLedgerDelivery, { id: dumpedDelivery.id }),
    );
    expect(dumpedRow.lastError).toBe(INVOICE_LEDGER_UNREADABLE_VENDOR_ERROR);
  }, 60_000);

  it('enqueues nothing while the vendor is operator-deactivated (Principle XVII)', async () => {
    // Item 6 of `specs/conventions/module-activation.md` over the one seam this
    // module owns: an absent vendor is not the active vendor, so the ledger has
    // nobody to enqueue against and writes no row at all.
    const off = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/modules/${FIXTURE_MODULE_ID}/activation`,
      ...ADMIN,
      payload: { active: false },
    });
    expect(off.statusCode, off.body).toBe(200);
    ledgerFixtureHttp.reset();

    try {
      const { orderId } = await seedInvoiceableOrder(h.em(), { salesChannelId: channelId });
      const issued = await issueInvoice(h, orderId, 'invoice');
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(await findDelivery(h, issued.id)).toBeNull();
      expect(ledgerFixtureHttp.createCalls).toEqual([]);
    } finally {
      // Restored, which is the half a test of the off state alone cannot see.
      const on = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/modules/${FIXTURE_MODULE_ID}/activation`,
        ...ADMIN,
        payload: { active: true },
      });
      expect(on.statusCode, on.body).toBe(200);
    }

    const { orderId } = await seedInvoiceableOrder(h.em(), { salesChannelId: channelId });
    const issued = await issueInvoice(h, orderId, 'invoice');
    const queued = await waitForDelivery(h, issued.id);
    expect(queued.adapterId).toBe(FIXTURE_MODULE_ID);
  }, 60_000);
});
