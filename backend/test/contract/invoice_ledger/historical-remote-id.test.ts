import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { invoiceLedgerDeliveryListItemSchema } from '@endora-commerce/contracts';
import {
  InvoiceLedgerDelivery,
  InvoiceLedgerDocumentMap,
} from '../../helpers/package-entities.js';
import { LEDGER_FIXTURE } from '../../helpers/ledger-fixture-client.js';
import {
  activateLedgerFixture,
  deactivateLedgerFixture,
} from '../../integration/invoice_ledger/fixture-vendor.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import { seedAdHocOrganization } from '../../helpers/seed-organizations.js';

const LIST_URL = '/api/v1/admin/invoice-ledger/deliveries';
const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const REMOTE_ID = 'inv-us9-ledger-read-1';

/**
 * T077 / FR-040 / C1. Historical remote ids stay on invoice admin through a
 * ledger read: **the vendor being off must not hide them and must not delete the
 * map**, because a row outlives the module that wrote it and hiding it would look
 * like data loss.
 *
 * Feature 134 / D-256 — the vendor is `ledger_vendor_fixture`, the example
 * deployment's synthetic one, where it used to be `infakt`. Nothing about the
 * assertion is a vendor's: the two rows are seeded directly and the subject is
 * the free ledger's own admin list. Driving it through a paid module is what
 * `contracts/extraction-procedure.md` E5 refuses, and this file is the free
 * module's own API contract, so it is re-pointed rather than moved.
 */
describe('invoice_ledger — historical remote id [contract]', () => {
  let h: BackendServerHandle;
  const invoiceId = randomUUID();

  beforeAll(async () => {
    process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] =
      process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] ?? randomBytes(32).toString('base64');
    h = await setupBackendServer({ deployment: 'example' });
    await activateLedgerFixture(h);
    await withSystemScope('seed historical ledger remote id', async () => {
      const em = h.em();
      // Both rows carry their own organization since the two ledger tables
      // stopped hanging off `Invoice`, and the column is a real foreign key, so
      // the fixture seeds an organization rather than inventing a UUID.
      const org = await seedAdHocOrganization(em, 'Historical Remote Id Fixture');
      em.create(InvoiceLedgerDocumentMap, {
        adapterId: LEDGER_FIXTURE.moduleId,
        invoiceId,
        organizationId: org.id,
        remoteDocumentId: REMOTE_ID,
        environment: 'sandbox',
        credentialCode: LEDGER_FIXTURE.credentialCode,
      });
      em.create(InvoiceLedgerDelivery, {
        adapterId: LEDGER_FIXTURE.moduleId,
        invoiceId,
        organizationId: org.id,
        kind: 'invoice',
        credentialCode: LEDGER_FIXTURE.credentialCode,
        environment: 'sandbox',
        numberingMode: 'endora',
        ksefRouting: 'native',
        status: 'succeeded',
        remoteDocumentId: REMOTE_ID,
        idempotencyKey: `${LEDGER_FIXTURE.moduleId}:${invoiceId}`,
      });
      await em.flush();
    });
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('returns the remote document id from the ledger while the vendor is off', async () => {
    await deactivateLedgerFixture(h);

    const maps = await withSystemScope('count historical maps after deactivate', () =>
      h.em().fork().count(InvoiceLedgerDocumentMap, { invoiceId, remoteDocumentId: REMOTE_ID }),
    );
    expect(maps).toBe(1);

    const listed = await h.app.inject({
      method: 'GET',
      url: `${LIST_URL}?invoiceId=${invoiceId}`,
      ...ADMIN,
    });
    expect(listed.statusCode, listed.body).toBe(200);
    const items = (listed.json() as { data?: unknown }).data;
    expect(Array.isArray(items)).toBe(true);
    expect(items).toHaveLength(1);
    const parsed = invoiceLedgerDeliveryListItemSchema.safeParse((items as unknown[])[0]);
    expect(parsed.success, JSON.stringify((items as unknown[])[0])).toBe(true);
    expect(parsed.success && parsed.data.remoteDocumentId).toBe(REMOTE_ID);
    expect(parsed.success && parsed.data.invoiceId).toBe(invoiceId);
  });
});
