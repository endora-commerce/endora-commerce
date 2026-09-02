import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { z } from 'zod';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { customerAccountPortsFor } from '../../helpers/customer-account-ports.js';
import { NewsletterTokenHelper } from '../../../../packages/modules/newsletter/src/backend/services/token.helper.js';
import { NewsletterOptInService } from '../../../../packages/modules/newsletter/src/backend/services/opt-in.service.js';
import { NewsletterSubscriberService } from '../../../../packages/modules/newsletter/src/backend/services/subscriber.service.js';
import { NewsletterSelfService } from '../../../../packages/modules/newsletter/src/backend/services/self.service.js';
import type { SettingsService } from '../../../src/kernel/settings/settings.service.js';
import {
  CustomerAccount,
  NewsletterSubscriber,
  Organization,
} from '../../helpers/package-entities.js';

class FakeSettings {
  async get<T>(code: string, _ch: string, schema: z.ZodType<T>): Promise<T> {
    if (code === 'newsletter.opt_in_mode') return schema.parse('single');
    if (code === 'newsletter.confirm_ttl_hours') return schema.parse(168);
    return schema.parse('' as unknown);
  }
}

describe('newsletter self-service (US9)', () => {
  let db: TestDb;
  let self: NewsletterSelfService;
  /** The signed-in customer this file subscribes, and the organisation behind it. */
  let accountId: string;
  let organizationId: string;

  beforeAll(async () => {
    db = await setupTestDb();
  });
  afterAll(async () => {
    await db.close();
  });
  beforeEach(async () => {
    const em = await db.beginTx();

    // Feature 087 Group B / D-187 — a **real** account and organisation, not a
    // fabricated uuid. `newsletter_subscribers_organization_attribution_chk`
    // refuses an owned row with no organisation, and the organisation is
    // derived from the account through `customerAccountReadPort`, so an id
    // naming no row is now a refusal at the write rather than a column nobody
    // reads. Both rows live in this test's transaction and go with its
    // rollback.
    const stamp = Date.now();
    const organization = em.create(Organization, {
      name: 'Newsletter self-service org',
      taxId: `PLNLSELF${String(stamp).slice(-7)}`,
      status: 'active',
      vatStatus: 'vat_payer',
      registeredAddress: {
        street: 'ul. Subskrypcji 1',
        city: 'Warszawa',
        postalCode: '00-100',
        country: 'PL',
      },
    });
    await em.persistAndFlush(organization);
    organizationId = organization.id;

    const account = em.create(CustomerAccount, {
      organizationId,
      email: `newsletter-self-${stamp}@x.test`,
      passwordHash: 'x'.repeat(60),
      firstName: 'Self',
      lastName: 'Service',
    });
    await em.persistAndFlush(account);
    accountId = account.id;

    const optIn = new NewsletterOptInService(new FakeSettings() as unknown as SettingsService, new NewsletterTokenHelper('s'));
    const subscribers = new NewsletterSubscriberService({
      emFactory: () => db.em(),
      optIn,
      defaultChannelId: null,
      // The real read port over this transaction's own rows, so the
      // organisation the subscriber carries is the one the account really has
      // rather than one a stub asserted.
      customerAccounts: customerAccountPortsFor(() => db.em()).read,
      links: { confirm: (t) => `c?${t}`, unsubscribe: (t) => `u?${t}` },
    });
    self = new NewsletterSelfService(() => db.em(), subscribers);
  });
  afterEach(async () => {
    await db.rollbackTx();
  });

  it('reports not-subscribed, then subscribes, shows status + tags, then unsubscribes', async () => {
    const email = 'me@x.test';

    expect(await self.getStatus(email)).toMatchObject({ subscribed: false, status: null, tags: [] });

    const sub = await self.subscribe(email, accountId, ['promo']);
    expect(sub.status).toBe('active');

    db.em().clear();
    const record = await db.em().findOneOrFail(NewsletterSubscriber, { email });
    expect(record.customerAccountId).toBe(accountId);
    // D-187 — the organisation arrives with the account, derived from the
    // account's own row and never from an ambient context.
    expect(record.organizationId).toBe(organizationId);

    const status = await self.getStatus(email);
    expect(status.subscribed).toBe(true);
    expect(status.status).toBe('active');

    await self.unsubscribe(email, 'no longer interested');
    const after = await self.getStatus(email);
    expect(after.subscribed).toBe(false);
    expect(after.status).toBe('unsubscribed');
  });
});
