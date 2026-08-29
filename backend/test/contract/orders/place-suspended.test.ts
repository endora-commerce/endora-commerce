import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedSuspendedOrganization } from '../../helpers/seed-commerce.js';
import { TranslationBundle } from '../../helpers/package-entities.js';

/**
 * T099 — `POST /orders` on a suspended Organization must be refused with 423.
 * Members of a suspended Organization can read the catalog but cannot place
 * Orders or RFQs.
 *
 * The code is `FORBIDDEN` carrying `details.code = 'organization_cannot_transact'`,
 * which is what `specs/062-distributor-api/contracts/orders-api-key-intake.md`
 * and the published `docs/docs/integrations/api-access.md` both specify, and
 * what the three sibling surfaces (external orders, RFQ submission, cart
 * mutation) already emit.
 *
 * Until feature 072 T141 this asserted `ORGANIZATION_SUSPENDED`, and passed —
 * because the test harness never wired `assertOrganizationCanTransact`, so the
 * request fell past the route gate to `OrderService`'s own service-seam check.
 * Production has always wired the gate, so the suite was pinning a code
 * production does not emit here. Wiring the guard through the container made
 * both compositions take the same path and the assertion had to follow.
 *
 * Issue #65 — and the code was only half the answer. `FORBIDDEN` is shared by
 * every permission failure, so the error envelope replaced the route's written
 * message with the family sentence and the buyer read "You do not have
 * permission to perform this action." The second case below is the one that
 * pins what the buyer is actually told, which is the part support hears about.
 *
 * That case has to install `_i18n`'s bundle itself. `setupBackendServer` passes
 * no lifecycle manifest registry, so `reconcileBundles` is a no-op under the
 * harness (`test/unit/_i18n/reconcile-timing.test.ts` says so in full) and
 * `translation_bundles` stays empty — every error message therefore falls back
 * to the written one, and an assertion over the message would pass whatever the
 * hook does. Installing the bundle is what lets this case go red: without the
 * fix it renders the `errors.FORBIDDEN` family sentence.
 */

const I18N_MODULE_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../packages/modules/_i18n',
);

describe('POST /api/v1/orders — suspended Organization', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedSuspendedOrganization(h.em());
    await h.adminI18n.i18nService.installBundlesForModule('_i18n', I18N_MODULE_PATH, 'i18n');
  });

  afterAll(async () => {
    // `translation_bundles` is not in the harness' truncate list, so the rows
    // installed above would outlive this file and leave the next suite in a
    // state no other file produces.
    await h.em().nativeDelete(TranslationBundle, { moduleId: '_i18n' });
    await teardownBackendServer(h);
  });

  it('returns 423 FORBIDDEN with the organization_cannot_transact detail', async () => {
    // Fixture: tests suspend the TEST_ORGANIZATION before hitting this endpoint
    // once the organizations module is wired up (Phase 4b). The current assertion
    // probes the contract shape.
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      payload: {
        deliveryAddressId: '00000000-0000-4000-8000-0000000000d1',
        billingAddressId: '00000000-0000-4000-8000-0000000000d2',
        deliveryMethodId: '00000000-0000-4000-8000-0000000000e1',
        paymentMethodId: '00000000-0000-4000-8000-0000000000f1',
      },
      cookies: { b2b_session: 'stub-customer-session-suspended' },
    });
    expect(res.statusCode).toBe(423);
    const body = res.json() as {
      error: { code: string; details?: { code?: string; status?: string } };
    };
    expect(body.error.code).toBe(ERROR_CODES.FORBIDDEN);
    // The detail is the part the contract names — `FORBIDDEN` alone is shared
    // with every other refusal, so asserting only the code would pass against
    // an ordinary permission failure.
    expect(body.error.details?.code).toBe('organization_cannot_transact');
    // `blocked`, not `suspended` — `seedSuspendedOrganization` is named for the
    // user-facing concept and seeds the `blocked` status that carries it.
    expect(body.error.details?.status).toBe('blocked');
  });

  it('tells the buyer the Organization cannot order, not that they lack permission', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      payload: {
        deliveryAddressId: '00000000-0000-4000-8000-0000000000d1',
        billingAddressId: '00000000-0000-4000-8000-0000000000d2',
        deliveryMethodId: '00000000-0000-4000-8000-0000000000e1',
        paymentMethodId: '00000000-0000-4000-8000-0000000000f1',
      },
      cookies: { b2b_session: 'stub-customer-session-suspended' },
    });
    const message = (res.json() as { error: { message: string } }).error.message;
    // The sentence the token routes to, resolved out of `_i18n`'s bundle by
    // the same `preSerialization` hook that used to overwrite it.
    expect(message).toBe(
      'Your organization cannot place orders in its current status. ' +
        'Contact your account manager to restore ordering.',
    );
    // Stated separately, because this is the sentence the issue is about and a
    // future edit to the wording above must not quietly bring it back.
    expect(message).not.toContain('permission');
  });
});
