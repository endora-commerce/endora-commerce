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

/**
 * `specs/093-backend-delivered-prose/` § Out of scope — the seam-B carve-out,
 * over the whole running stack rather than over doubles.
 *
 * The unit twin (`test/unit/organizations/moderation-email-language.test.ts`)
 * proves the selection by driving the same transition against two channel
 * languages. What it cannot see is whether the platform holds a definition for
 * the two codes at all: the rows are created by `transactional_emails`' boot
 * reconciler out of the manifest plus the defaults registry, and a code that
 * never reaches that reconciler falls through `trySend` silently and is
 * delivered by the in-code builder for ever.
 *
 * So this asserts the composed answer: the delivery is recorded under the
 * **code**, and its subject is the **English** one the harness's system-default
 * sales channel (`en-US`) resolves — where the tree used to send Polish to
 * every recipient of both messages, whatever their channel.
 */
describe('organizations — moderation e-mails are rendered from a template, in the channel language', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const seedPendingOrg = async (
    label: string,
  ): Promise<{ organization: Organization; email: string }> => {
    const em = h.em();
    const organization = em.create(Organization, {
      name: `Language ${label} Co`,
      taxId: `PL093${label.slice(0, 3)}${Date.now().toString().slice(-6)}`,
      vatStatus: 'vat_payer',
      registeredAddress: {
        street: 'ul. Testowa 1',
        city: 'Warszawa',
        postalCode: '00-093',
        country: 'PL',
      },
    });
    await em.persistAndFlush(organization);
    const email = `o93-${label}-${Date.now()}@example.test`;
    await em.persistAndFlush(
      em.create(CustomerAccount, {
        organizationId: organization.id,
        email,
        passwordHash: 'x'.repeat(60),
        firstName: 'Org',
        lastName: 'Admin',
        role: 'organization_admin',
        emailVerifiedAt: new Date(),
      }),
    );
    return { organization, email };
  };

  const deliveriesTo = async (email: string): Promise<EmailDeliveryRow[]> => {
    const em = h.em();
    em.clear();
    return em.find(EmailDelivery, { recipient: email });
  };

  it('renders the approval from `organization_approved` in the channel language', async () => {
    const { organization, email } = await seedPendingOrg('approve');

    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${organization.id}/approve`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { expectedVersion: organization.version },
    });
    expect(res.statusCode).toBe(200);

    const deliveries = await deliveriesTo(email);
    expect(deliveries).toHaveLength(1);
    expect(
      deliveries[0]?.kind,
      'the approval message must be addressed by its transactional code, not composed inline',
    ).toBe('organization_approved');
    expect(
      deliveries[0]?.subject,
      'the harness channel is en-US, so the recipient must read English',
    ).toBe('Your organization has been verified');
  });

  it('renders the rejection from `organization_rejected` in the channel language', async () => {
    const { organization, email } = await seedPendingOrg('reject');

    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${organization.id}/reject`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { expectedVersion: organization.version, reason: 'Tax id could not be verified.' },
    });
    expect(res.statusCode).toBe(200);

    const deliveries = await deliveriesTo(email);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]?.kind).toBe('organization_rejected');
    expect(deliveries[0]?.subject).toBe('Organization registration rejected');
  });
});
