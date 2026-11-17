import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
 */

interface SentMessage {
  to: string;
  subject?: string;
  text?: string;
  kind?: string;
}

const NEW_PASSWORD = 'Replaced-pass-1371!';

describe('organizations — the self-service password reset e-mails the link (issue #1371)', () => {
  let h: BackendServerHandle;
  const sent: SentMessage[] = [];

  beforeAll(async () => {
    h = await setupBackendServer({
      organizationsMailer: {
        send: async (message: SentMessage) => {
          if (message.to.startsWith('reset-1371-failing-')) throw new Error('transport down');
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

  it('answers 202 and sends nothing for an address no account has', async () => {
    const email = `nobody-1371-${Date.now()}@example.test`;

    const res = await requestReset(email);
    expect(res.statusCode).toBe(202);
    expect(res.body).toBe('');
    expect(sent.filter((m) => m.to === email)).toHaveLength(0);
  });
});
