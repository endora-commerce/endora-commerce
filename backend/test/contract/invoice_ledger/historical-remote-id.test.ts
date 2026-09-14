import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { invoiceLedgerDeliveryListItemSchema } from '@endora-commerce/contracts';
import {
  InvoiceLedgerDelivery,
  InvoiceLedgerDocumentMap,
} from '../../helpers/package-entities.js';
import {
  activateInfakt,
  deactivateInfakt,
} from '../../integration/invoice_ledger/helpers.js';
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
 * ledger read. Infakt off must not hide them and must not delete the map.
 */
describe('invoice_ledger — historical remote id [contract]', () => {
  let h: BackendServerHandle;
  const invoiceId = randomUUID();

  beforeAll(async () => {
    process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] =
      process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] ?? randomBytes(32).toString('base64');
    h = await setupBackendServer();
    await activateInfakt(h);
    await withSystemScope('seed historical ledger remote id', async () => {
      const em = h.em();
      // Both rows carry their own organization since the two ledger tables
      // stopped hanging off `Invoice`, and the column is a real foreign key, so
      // the fixture seeds an organization rather than inventing a UUID.
      const org = await seedAdHocOrganization(em, 'Historical Remote Id Fixture');
      em.create(InvoiceLedgerDocumentMap, {
        adapterId: 'infakt',
        invoiceId,
        organizationId: org.id,
        remoteDocumentId: REMOTE_ID,
        environment: 'sandbox',
        credentialCode: 'infakt',
      });
      em.create(InvoiceLedgerDelivery, {
        adapterId: 'infakt',
        invoiceId,
        organizationId: org.id,
        kind: 'invoice',
        credentialCode: 'infakt',
        environment: 'sandbox',
        numberingMode: 'endora',
        ksefRouting: 'native',
        status: 'succeeded',
        remoteDocumentId: REMOTE_ID,
        idempotencyKey: `infakt:${invoiceId}`,
      });
      await em.flush();
    });
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('returns the remote document id from the ledger while Infakt is off', async () => {
    await deactivateInfakt(h);

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
