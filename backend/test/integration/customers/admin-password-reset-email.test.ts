import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  CustomerAccount,
  EmailDelivery,
  Organization,
  type EmailDeliveryRow,
} from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { predefinedRoleIdOf } from '../../helpers/seed-organization-roles.js';

/**
 * Issue #1295 — the operator-triggered password-reset e-mail, over the whole
 * running stack rather than over doubles.
 *
 * The unit twin (`test/unit/customers/admin-password-reset-email-language.test.ts`)
 * proves the language selection, Polish included. What it cannot see is whether
 * the platform holds a definition for the code at all: the row is created by
 * `transactional_emails`' boot reconciler out of the manifest plus the defaults
 * registry, and a code that never reaches that reconciler falls through
 * `trySend` and is sent by the English in-code fallback for ever — which is
 * exactly what the e-mail was before this issue.
 *
 * So this asserts the composed answer: the delivery is recorded under the
 * **code**, with the subject of the harness channel's language (`en-US`).
 */
describe('customers — the admin password-reset e-mail is rendered from a template (issue #1295)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const seedCustomer = async (): Promise<{ id: string; email: string }> => {
    const em = h.em();
    const organization = em.create(Organization, {
      name: `Reset ${Date.now()} Co`,
      taxId: `PL1295${Date.now().toString().slice(-6)}`,
      vatStatus: 'vat_payer',
      registeredAddress: {
        street: 'ul. Testowa 1',
        city: 'Warszawa',
        postalCode: '00-129',
        country: 'PL',
      },
    });
    await em.persistAndFlush(organization);
    const email = `reset-1295-${Date.now()}@example.test`;
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
    return { id: account.id, email };
  };

  const deliveriesTo = async (email: string): Promise<EmailDeliveryRow[]> => {
    const em = h.em();
    em.clear();
    return em.find(EmailDelivery, { recipient: email });
  };

  it('records the delivery under `customer_password_reset_by_admin`, in the channel language', async () => {
    const customer = await seedCustomer();

    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/customers/${customer.id}/password-reset`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);

    const deliveries = await deliveriesTo(customer.email);
    expect(deliveries).toHaveLength(1);
    expect(
      deliveries[0]?.kind,
      'the reset message must be addressed by its transactional code, not composed inline',
    ).toBe('customer_password_reset_by_admin');
    expect(
      deliveries[0]?.subject,
      'the harness channel is en-US, so the recipient must read English',
    ).toBe('Set a new password');
  });
});
