import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import type { CustomerAccountReadPort } from '@endora-commerce/contracts';
import type { SettingsReadPort } from '@endora-commerce/platform/kernel';
import { CustomerAccount, NewsletterSubscriber } from '../../helpers/package-entities.js';
import { TEST_CUSTOMER_ID } from '../../helpers/test-actors.js';
import { NewsletterOptInService } from '../../../../packages/modules/newsletter/src/backend/services/opt-in.service.js';
import { NewsletterSubscriberService } from '../../../../packages/modules/newsletter/src/backend/services/subscriber.service.js';
import { NewsletterTokenHelper } from '../../../../packages/modules/newsletter/src/backend/services/token.helper.js';

/**
 * A newsletter subscriber written through the customer's own route carries the
 * organisation of the account that owns it — feature 087 Group B, ruling D-187.
 *
 * ## Why this is asserted at the route rather than on the service
 *
 * `newsletter_subscribers_organization_attribution_chk` refuses an owned row
 * with no organisation, and
 * `test/integration/tenancy/customer-scoped-organization-completeness.test.ts`
 * proves the refusal behaviourally for every class that carries the column. So
 * the question left over is not *"does the database refuse it"* — it is *"does
 * the one write path in this module produce a row the database accepts, and
 * does it produce the **right** organisation"*. `POST /api/v1/me/newsletter/subscribe`
 * derives the account from the session and never from the body, so entering at
 * the route is what makes the answer about the production path.
 *
 * ## The ownerless half is the other direction, and on this table it is the
 * ordinary case
 *
 * FR-011 requires an ownerless row to be representable, and nowhere more than
 * here: `POST /api/v1/newsletter/subscribe` takes an e-mail address and a
 * channel code and **no account at all**, so every subscriber who has never
 * signed in is such a row — on this table they are the majority, not the edge.
 * A constraint written as an equivalence, or a stamp that reached for the
 * request's ambient organisation, would refuse the storefront sign-up outright,
 * which is a customer-facing regression the `CHECK` alone cannot report.
 *
 * There is a second reason to assert the ownerless half here rather than to
 * assume it: `newsletter_subscribers.email` is globally unique and
 * `customer_accounts` has an `email` too, so an implementation that "helpfully"
 * matched the two would attribute this row. It must not — that is R-6 answer
 * (2) guessed rather than decided — and the assertion below is what says so in
 * a form that fails.
 */
describe('a newsletter subscriber carries the organisation of the account that owns it', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const rowFor = async (email: string): Promise<NewsletterSubscriber> => {
    h.em().clear();
    return h.em().findOneOrFail(NewsletterSubscriber, { email });
  };

  it('stamps the signed-in customer’s organisation on the self-service subscribe', async () => {
    h.em().clear();
    const account = await h.em().findOneOrFail(CustomerAccount, { id: TEST_CUSTOMER_ID });

    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/me/newsletter/subscribe',
      cookies: { b2b_session: 'stub-customer-session' },
      payload: {},
    });
    expect(res.statusCode).toBe(200);

    const row = await rowFor(account.email);
    expect(row.customerAccountId).toBe(TEST_CUSTOMER_ID);
    // Derived from the **account's own row**, through `customerAccountReadPort`,
    // and not from the request's ambient context: that is what lets one
    // implementation serve this route and any later caller that names an
    // account without one. Compared against the account rather than against a
    // constant, so the assertion is about the derivation and not about a
    // fixture two files share.
    expect(row.organizationId).toBe(account.organizationId);
  });

  it('leaves a storefront sign-up owned by nobody, and does not invent an organisation', async () => {
    const email = `attribution-anonymous-${Date.now()}@example.com`;
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/newsletter/subscribe',
      payload: { email, channelCode: 'default' },
    });
    expect(res.statusCode).toBe(200);

    // MikroORM's `forceUndefined` reads a `NULL` back as `undefined`, so both
    // columns are normalised before the comparison rather than asserted with a
    // matcher that would pass on either value.
    const row = await rowFor(email);
    expect(row.customerAccountId ?? null).toBeNull();
    expect(row.organizationId ?? null).toBeNull();
  });

  it('stamps the organisation when an ownerless subscriber is later adopted', async () => {
    // The module's **second** write site, and the one a create-only stamp would
    // miss: `subscriber.service.ts` fills in the account when a subscriber who
    // signed up anonymously later signs in. The account and the organisation
    // move together there, from the same `ownerColumns` value.
    //
    // **This one enters one layer in, and the reason is a live defect rather
    // than a preference.** The self route runs in a `single-org` tenant
    // context, so `customerFilterCond` narrows this service's
    // `findOne(NewsletterSubscriber, { email })` to
    // `customer_account_id = <the caller>` — and the row the adoption exists to
    // find has none. It is therefore invisible, the service takes its `em.create`
    // branch, and `newsletter_subscribers_email_unique` refuses the insert.
    // `[M]` Measured against the harness on 2026-08-30 — an ownerless row on the
    // signed-in customer's own address, then `POST /api/v1/me/newsletter/subscribe`:
    // **409 `VERSION_CONFLICT`**, "The resource was changed by another process",
    // and the row unchanged (`customer_account_id` and `organization_id` both
    // still null). Loud, and describing something that did not happen. That is
    // the class defect `pwa` and `inventory` were both found to carry — a "does
    // this already exist" read that passes through the tenant filter — and it is
    // deliberately **not** repaired by this merge request, which is about the
    // column. It is reported for the defect register.
    //
    // So the adoption is exercised where it is reachable: on the service, in
    // the harness's default `system` context, built from the container's own
    // `customerAccountReadPort` so it resolves the same gated port the composed
    // module does.
    h.em().clear();
    const account = await h.em().findOneOrFail(CustomerAccount, { id: TEST_CUSTOMER_ID });
    const cradle = h.container.cradle as never as {
      customerAccountReadPort: CustomerAccountReadPort;
      settingsReadPort: SettingsReadPort;
    };
    const service = new NewsletterSubscriberService({
      emFactory: h.em,
      optIn: new NewsletterOptInService(
        cradle.settingsReadPort,
        new NewsletterTokenHelper('attribution-probe-secret'),
      ),
      defaultChannelId: null,
      customerAccounts: cradle.customerAccountReadPort,
      links: { confirm: (t) => `confirm?${t}`, unsubscribe: (t) => `unsubscribe?${t}` },
    });

    const email = `attribution-adopted-${Date.now()}@example.com`;
    await service.subscribe({ email, salesChannelId: null });
    const before = await rowFor(email);
    expect(before.customerAccountId ?? null).toBeNull();
    expect(before.organizationId ?? null).toBeNull();

    await service.subscribe({ email, salesChannelId: null, customerAccountId: TEST_CUSTOMER_ID });

    const adopted = await rowFor(email);
    expect(adopted.customerAccountId).toBe(TEST_CUSTOMER_ID);
    expect(adopted.organizationId).toBe(account.organizationId);
  });
});
