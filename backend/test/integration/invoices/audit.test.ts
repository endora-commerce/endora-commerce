import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
/**
 * **The `invoices` services below are imported from the package's `dist`, not from
 * its `src`, and it is the only spelling that works here** (feature 080, T040b,
 * batch four; D-160.6.1).
 *
 * Each of them value-imports one of this module's entity classes — a decorated
 * `@Entity()` file — so importing the *service* from source evaluates the *entity*
 * from source, a second time, beside the copy the ORM registered out of `dist`.
 * For most packages that duplication is silent. For this one it is a hard refusal
 * at ORM init: `KsefSubmission` is `@TransitivelyScoped` through `Invoice`, and
 * `assertTransitiveParentsResolve` resolves a chain by **class name**, so two
 * `Invoice` classes are an ambiguity it refuses rather than guesses at —
 * `UnresolvableTenantParentError`, in `setupBackendServer`, taking every test file
 * in the process with it.
 *
 * `dist` is the same module instance the composed platform holds, so the provider
 * this file constructs operates on the entity classes the ORM knows. That is the
 * assertion these tests were always making; before the move it was true for free.
 */
import { CorrectiveInvoiceProvider } from '../../../../packages/modules/invoices/dist/backend/services/corrective-invoice.js';
import {
  InvoiceNumberGenerator,
  createSettingsPatternResolver,
} from '../../../../packages/modules/invoices/dist/backend/services/invoice-number-generator.js';
import { AuditLogEntry } from '../../../src/kernel/audit/audit-log-entry.entity.js';
import { ADMIN_COOKIE, seedInvoiceableOrder, setSellerSettings } from './helpers.js';
import { ensureSalesChannelId } from '../../helpers/sales-channel-fixtures.js';

// Feature 078, D-95: `{channel}` is rendered from the `sales_channels`

// row, so this file's channel has to be one. The per-file code keeps this

// file's numbers distinct in the shared test database, which is what the

// fabricated id used to be for.

let CH: string;

describe('invoices — audit logging (FR-035)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    CH = await ensureSalesChannelId(h.em(), 'inv-audit');
    await setSellerSettings(h);
    await h.settings.adminService.setValueForSubset(
      'invoices.numbering.invoice.pattern',
      ['inv-audit'],
      'FVAU {seq}/{YYYY}',
      null,
      { actorAdminUserId: '00000000-0000-0000-0000-000000000000' },
    );
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('records invoice.issued on issuance', async () => {
    const { orderId } = await seedInvoiceableOrder(h.em(), { salesChannelId: CH });
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orderId}/invoices`,
      cookies: ADMIN_COOKIE,
      payload: { kind: 'invoice' },
    });
    const id = (res.json() as { data: { id: string } }).data.id;
    const row = await h.em().findOne(AuditLogEntry, { action: 'invoice.issued', objectId: id });
    expect(row).not.toBeNull();
  });

  it('records invoice.corrected on a correction', async () => {
    const { orderId, itemIds } = await seedInvoiceableOrder(h.em(), { salesChannelId: CH });
    await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orderId}/invoices`,
      cookies: ADMIN_COOKIE,
      payload: { kind: 'invoice' },
    });
    const provider = new CorrectiveInvoiceProvider(
      h.em,
      () => new InvoiceNumberGenerator(createSettingsPatternResolver(h.settings.settingsService)),
      h.auditLogService,
    );
    const result = await provider.createCorrection({
      orderId,
      lines: [{ orderItemId: itemIds[0], productName: 'X', quantity: 1, amount: 100 }],
      total: 100,
      currency: 'PLN',
    });
    // The order was invoiced above, so a correction is due (#135).
    if (!result.issued) throw new Error(`Expected a correction: ${result.reason}`);
    const row = await h.em().findOne(AuditLogEntry, { action: 'invoice.corrected', objectId: result.invoiceId });
    expect(row).not.toBeNull();
  });
});
