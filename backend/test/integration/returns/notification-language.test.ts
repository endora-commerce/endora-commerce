import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { InMemoryMailer } from '../../../../packages/modules/email/src/backend/services/mailer.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { ADMIN_COOKIE, CUSTOMER_COOKIE, anyReasonId, resetReturnGraph, seedReturnableOrder } from './helpers.js';

/**
 * The language a return e-mail is rendered in, over the composed harness
 * (`specs/110-instance-repository/` T118c).
 *
 * `resolveChannelLanguage` was a `returnsBridge` member: a closure each of the two
 * composition roots wrote for itself, reading the case's channel and falling back
 * to `en-US`. This module resolves it now
 * (`packages/modules/returns/src/backend/services/notification-context.ts`), and
 * **nothing in the suite asserted the language before this file** — the word
 * appears in no returns test. That is precisely the shape a drain has to be
 * proved against: a resolver that answers `en-US` for every case is a shop with
 * no translations, which is a plausible state rather than a visible failure, so
 * the wiring could have been dropped in the move and every existing returns test
 * would still have passed.
 *
 * The co-located unit test
 * (`packages/modules/returns/src/backend/services/notification-context.test.ts`)
 * owns the mapping and its fallbacks; this file owns the half that one cannot
 * see — that `backend/index.ts` wires the resolver into the notifier at all, in a
 * composition the harness built.
 *
 * The channel is this file's own row rather than the system default's, which is
 * shared and whose language other files read.
 */
describe('returns — the notification language comes from the case’s channel', () => {
  let h: BackendServerHandle;
  let mailer: InMemoryMailer;
  let polishChannelId: string;

  beforeAll(async () => {
    mailer = new InMemoryMailer();
    h = await setupBackendServer({ organizationsMailer: mailer });
    await resetReturnGraph(h.em());

    const em = h.em();
    const code = `returns-pl-${randomUUID().slice(0, 8)}`;
    const channel = em.create(SalesChannel, {
      code,
      name: { en: code },
      defaultLanguage: 'pl-PL',
      languages: ['pl-PL', 'en-US'],
      defaultCurrency: 'PLN',
      currencies: ['PLN'],
    });
    await em.persistAndFlush(channel);
    polishChannelId = channel.id;
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('renders the authorization e-mail in the channel’s default language', async () => {
    const { orderId, itemIds } = await seedReturnableOrder(h.em(), {
      salesChannelId: polishChannelId,
    });
    const reasonId = await anyReasonId(h.em());
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/returns',
      cookies: CUSTOMER_COOKIE,
      payload: { orderId, kind: 'return', lines: [{ orderItemId: itemIds[0], quantity: 1, reasonId }] },
    });
    expect(created.statusCode).toBe(201);
    const id = (created.json() as { data: { id: string } }).data.id;

    const authorized = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/returns/${id}/authorize`,
      cookies: ADMIN_COOKIE,
    });
    expect(authorized.statusCode).toBe(200);

    const mail = mailer.sent.find(
      (m) => m.meta?.['kind'] === 'return_authorized' && m.meta?.['returnCaseId'] === id,
    );
    expect(mail, 'no return_authorized e-mail was sent at all').toBeTruthy();

    // The module's own `pl-PL` default for `return_authorized`. Asserting the
    // Polish subject rather than "not the English one" is what makes the failure
    // legible: a dropped resolver answers `en-US`, and the English subject is the
    // sentence that would arrive.
    expect(mail!.subject).toContain('Twój zwrot został zaakceptowany');
  });
});
