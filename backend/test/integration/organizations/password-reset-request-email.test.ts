import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { channelUrlLanguages } from '@endora-commerce/contracts';
import { SalesChannel } from '@endora-commerce/platform/kernel';

import { CustomerAccount, Organization } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { predefinedRoleIdOf } from '../../helpers/seed-organization-roles.js';

/**
 * Issue #1371 — the self-service password reset sends the e-mail.
 *
 * `POST /api/v1/auth/password-reset/request` minted a token, answered 202 and
 * mailed nothing, so a customer who forgot the password could not get back in
 * from the storefront. The route now sends the `customer_password_reset`
 * transactional e-mail — over the whole running stack here, so the template
 * definition, its defaults and the link are all the composed ones.
 *
 * The mailer is the harness spy (`organizationsMailer`), which every sender in
 * the composition reaches through `emailMailer`: it keeps the rendered text,
 * which is where the link is. The delivery record is deliberately not the
 * witness — it does not keep the body, and a reset link must not be stored.
 *
 * The unknown address is the half that keeps the route from enumerating
 * accounts: the same 202, and nothing sent.
 *
 * The send runs **after** the 202 and is not awaited (architect ruling on PR
 * #1418: how long the transport takes must not say whether the account
 * exists), so each case waits for the mail with a bounded poll rather than
 * expecting it when the response arrives — and one case proves the reply does
 * not wait for a transport that never answers.
 */

interface SentMessage {
  to: string;
  subject?: string;
  text?: string;
  kind?: string;
}

const NEW_PASSWORD = 'Replaced-pass-1371!';
/** The bounded wait for a mail sent after the reply. */
const MAIL_WAIT = { timeout: 10_000, interval: 50 };

describe('organizations — the self-service password reset e-mails the link (issue #1371)', () => {
  let h: BackendServerHandle;
  const sent: SentMessage[] = [];
  /** Messages handed to a transport that never answers. */
  const hanging: SentMessage[] = [];

  beforeAll(async () => {
    h = await setupBackendServer({
      organizationsMailer: {
        send: async (message: SentMessage) => {
          if (message.to.startsWith('reset-1371-failing-')) throw new Error('transport down');
          if (message.to.startsWith('reset-1371-hanging-')) {
            hanging.push(message);
            return new Promise<never>(() => {});
          }
          sent.push(message);
          return { status: 'sent' as const };
        },
      } as never,
    });
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  beforeEach(() => {
    sent.length = 0;
  });

  const seedCustomer = async (prefix = 'reset-1371-'): Promise<string> => {
    const em = h.em();
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const organization = em.create(Organization, {
      name: `Reset 1371 ${stamp} Co`,
      taxId: `PL1371${stamp.slice(-6)}`,
      vatStatus: 'vat_payer',
      registeredAddress: {
        street: 'ul. Testowa 1',
        city: 'Warszawa',
        postalCode: '00-137',
        country: 'PL',
      },
    });
    await em.persistAndFlush(organization);
    const email = `${prefix}${stamp}@example.test`;
    const account = em.create(CustomerAccount, {
      organizationId: organization.id,
      email,
      passwordHash: 'x'.repeat(60),
      firstName: 'Reset',
      lastName: 'Customer',
      organizationRoleId: await predefinedRoleIdOf(em, organization.id, 'administrator'),
      emailVerifiedAt: new Date(),
    });
    await em.persistAndFlush(account);
    return email;
  };

  const waitForMailTo = (email: string): Promise<void> =>
    vi.waitFor(() => expect(sent.some((m) => m.to === email)).toBe(true), MAIL_WAIT);

  const requestReset = (email: string) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/password-reset/request',
      payload: { email },
    });

  it('sends one e-mail with the reset link to a known address', async () => {
    const email = await seedCustomer();

    const res = await requestReset(email);
    expect(res.statusCode).toBe(202);

    await waitForMailTo(email);
    const mine = sent.filter((m) => m.to === email);
    expect(mine, 'exactly one reset e-mail must go to the address').toHaveLength(1);
    expect(
      mine[0]?.kind,
      'the message must be the transactional template, not composed inline',
    ).toBe('customer_password_reset');
    expect(mine[0]?.subject, 'the harness channel is en-US').toBe('Reset your password');

    const channel = (await h.em().findOne(SalesChannel, { systemDefault: true }))!;
    const main = channelUrlLanguages(channel).find((l) => l.isDefault)!;
    const prefix = main.prefixed ? `/${main.prefix}` : '';
    const link = new RegExp(
      `http://localhost:3000${prefix}/password-reset/confirm\\?token=([A-Za-z0-9_%-]+)`,
    ).exec(mine[0]?.text ?? '');
    expect(link, `the text part must carry the link: ${mine[0]?.text}`).not.toBeNull();

    // The link is the real one: its token sets a new password.
    const confirm = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/password-reset/confirm',
      payload: { token: decodeURIComponent(link![1]!), newPassword: NEW_PASSWORD },
    });
    expect(confirm.statusCode, confirm.body).toBe(200);
  });

  it('still answers 202 for a known address when the transport fails, so the answer reveals nothing', async () => {
    const email = await seedCustomer('reset-1371-failing-');

    const res = await requestReset(email);
    expect(res.statusCode).toBe(202);
    expect(res.body).toBe('');
  });

  it('answers an empty 202 promptly while the transport never answers', async () => {
    const email = await seedCustomer('reset-1371-hanging-');

    const started = Date.now();
    const res = await requestReset(email);
    const elapsed = Date.now() - started;
    expect(res.statusCode).toBe(202);
    expect(res.body).toBe('');
    expect(elapsed, 'the reply must not wait for the transport').toBeLessThan(5_000);
    // The send did start: the reply simply did not wait for it.
    await vi.waitFor(() => expect(hanging.filter((m) => m.to === email)).toHaveLength(1), MAIL_WAIT);
  });

  it('answers 202 and sends nothing for an address no account has', async () => {
    const email = `nobody-1371-${Date.now()}@example.test`;

    const res = await requestReset(email);
    expect(res.statusCode).toBe(202);
    expect(res.body).toBe('');
    // A barrier: a known address's mail, requested afterwards, has arrived —
    // so a send for the unknown one, had any been scheduled, has had its turn.
    const known = await seedCustomer();
    await requestReset(known);
    await waitForMailTo(known);
    expect(sent.filter((m) => m.to === email)).toHaveLength(0);
  });
});
