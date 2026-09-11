import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Invoice } from '../../helpers/package-entities.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { InMemoryMailer } from '../../../../packages/modules/email/src/backend/services/mailer.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { ADMIN_COOKIE, seedInvoiceableOrder, setSellerSettings } from './helpers.js';

/**
 * What `invoices` reaches outside itself for, over the composed harness
 * (`specs/110-instance-repository/` T118c).
 *
 * `invoicesBridge` was one contributed name carrying six members, written as
 * closures in `backend/src/composition.ts` and again in
 * `backend/test/helpers/test-server.ts`. This file owns the half a co-located
 * unit test cannot see — that `backend/index.ts` wires each of them into the
 * module at all — and it exists because **four of the six were asserted by
 * nothing**, which is the state a drain has to be proved against:
 *
 *  - `getTransactionalEmailSender`, `resolveRecipientEmail` and
 *    `resolveLanguage` build `InvoiceEmailDispatcher`, and **no test in this
 *    tree had ever driven the composed one**. `invoices.email.send_on_issue`
 *    defaults to `false` and nothing enabled it, so the composed dispatcher
 *    never sent an e-mail; `email.test.ts` builds its own with three
 *    hand-written stubs (`resolveRecipientEmail: async () => 'buyer@example.com'`,
 *    `resolveLanguage: async () => 'en-US'`) and asserts that object rather than
 *    the platform. A composition that dropped all three would have left every
 *    invoices test in the tree green.
 *  - `resolveAdminUserId` names the issuing administrator on the invoice row,
 *    and `issuedBy` is asserted **nowhere** — the word appears in this module's
 *    sources and in no test. Dropped, `InvoiceService` writes `'system'`, which
 *    is a real value for the auto-issue path and therefore not a visible
 *    failure on the admin one.
 *
 * The other two members were covered and stay where they are:
 * `resolveCustomerContext` by `storefront-invoices.test.ts`' "denies access to
 * another party's order (404)", and `loadAssetImage` by
 * `logo-asset-bytes.test.ts`, which is one day old for the same reason (D-223).
 *
 * The mappings themselves are
 * `packages/modules/invoices/src/backend/services/cross-module-context.test.ts`,
 * which composes nothing.
 *
 * Two channels, both this file's own rows rather than the shared system default,
 * because the language is what discriminates and the default's is read by other
 * files. Delivery is set to `link`, so a send costs no PDF render: what is under
 * test is who the message went to and in which language, not the attachment.
 */
describe('invoices — the six ways this module reaches outside itself', () => {
  let h: BackendServerHandle;
  let mailer: InMemoryMailer;
  let polishChannelId: string;
  let englishChannelId: string;

  async function channel(slug: string, language: string): Promise<string> {
    const em = h.em();
    const code = `inv-x-${slug}-${randomUUID().slice(0, 8)}`;
    const row = em.create(SalesChannel, {
      code,
      name: { en: code },
      defaultLanguage: language,
      languages: [language],
      defaultCurrency: 'PLN',
      currencies: ['PLN'],
    });
    await em.persistAndFlush(row);
    const audit = { actorAdminUserId: '00000000-0000-0000-0000-000000000000' };
    await h.settings.adminService.setValueForSubset(
      'invoices.numbering.invoice.pattern',
      [code],
      `FVX${slug.toUpperCase()} {seq}/{YYYY}`,
      null,
      audit,
    );
    return row.id;
  }

  beforeAll(async () => {
    mailer = new InMemoryMailer();
    h = await setupBackendServer({ organizationsMailer: mailer });
    await setSellerSettings(h);
    const audit = { actorAdminUserId: '00000000-0000-0000-0000-000000000000' };
    // The setting that made the composed dispatcher unreachable: it defaults to
    // `false`, and nothing in the tree had ever turned it on.
    await h.settings.adminService.setValueForAllChannels(
      'invoices.email.send_on_issue',
      true,
      null,
      audit,
    );
    await h.settings.adminService.setValueForAllChannels(
      'invoices.email.delivery_mode',
      'link',
      null,
      audit,
    );
    await h.settings.adminService.setValueForAllChannels(
      'invoices.storefront_base_url',
      'https://shop.example.com',
      null,
      audit,
    );
    polishChannelId = await channel('pl', 'pl-PL');
    englishChannelId = await channel('en', 'en-US');
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function issueOn(salesChannelId: string): Promise<{ invoiceId: string; email: unknown }> {
    const { orderId } = await seedInvoiceableOrder(h.em(), { salesChannelId });
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orderId}/invoices`,
      cookies: ADMIN_COOKIE,
      payload: { kind: 'invoice' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { data: { id: string }; email: unknown };
    return { invoiceId: body.data.id, email: body.email };
  }

  function mailFor(invoiceId: string): (typeof mailer)['sent'][number] | undefined {
    return mailer.sent.find((m) => m.meta?.['invoiceId'] === invoiceId);
  }

  it('sends the issue e-mail to the buyer’s own account address', async () => {
    const { invoiceId, email } = await issueOn(englishChannelId);

    // The route's own answer first: `not_requested` means the setting above did
    // not take, `no_sender` means the accessor is unwired, `no_recipient` means
    // the address resolver is, and `failed` means one of them threw.
    expect(email).toEqual({ status: 'sent' });

    const mail = mailFor(invoiceId);
    expect(mail, 'no invoice_issued e-mail was sent at all').toBeTruthy();
    // `customer_accounts`' published record, resolved by this module. The seeded
    // order is placed by TEST_CUSTOMER_ID, whose account carries this address —
    // a resolver wired to anything else answers a different one or `null`.
    expect(mail!.to).toBe('stub-customer@example.com');
    expect(mail!.kind).toBe('invoice_issued');
  });

  it('renders it in the channel’s own default language', async () => {
    const { invoiceId } = await issueOn(polishChannelId);

    const mail = mailFor(invoiceId);
    expect(mail, 'no invoice_issued e-mail was sent at all').toBeTruthy();
    // The module's own `pl-PL` default subject for `invoice_issued`. Asserting
    // the Polish sentence rather than "not the English one" is what makes the
    // failure legible: a dropped resolver answers `en-US`, and `Invoice …` is
    // the subject that would arrive.
    expect(mail!.subject).toMatch(/^Faktura /);
  });

  it('renders an English channel’s in English, so the language is read and not assumed', async () => {
    const { invoiceId } = await issueOn(englishChannelId);

    expect(mailFor(invoiceId)!.subject).toMatch(/^Invoice /);
  });

  it('records the acting administrator as the issuer', async () => {
    const { invoiceId } = await issueOn(englishChannelId);

    const row = await h.em().findOneOrFail(Invoice, { id: invoiceId });
    // `adminContextResolver`, the platform's own contribution, read by this
    // module. Withheld, `InvoiceService` writes `'system'` — which is a correct
    // value for the auto-issue path and therefore says nothing on this one.
    expect(row.issuedBy).toBe(TEST_ADMIN_ID);
  });
});
