// perf-weight: fast — about 4 s locally (2026-11-19: three organizations, one link, four listing reads); not yet timed on the CI runner.
import { randomUUID } from 'node:crypto';
import type { Knex } from '@mikro-orm/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { CustomerAccount } from '../../helpers/package-entities.js';
import { CUSTOMER_COOKIES } from '../../helpers/test-actors.js';
import { predefinedRoleIdOf } from '../../helpers/seed-organization-roles.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import { ADMIN, makeAddress, makeOrganization } from '../../integration/related_payers/fixtures.js';

/**
 * `specs/182-related-payers/` T057 (plan Performance Goals, research R-4 decision 4) — the
 * pricing-subject resolver costs an Organization with **no** payer's-terms link nothing: a warm
 * catalogue page issues exactly the statements it issues with `related_payers` switched off,
 * which is the composition master has (no resolver answers there either). The policy answers
 * "no such link" from its per-process cache, before any read of the basket.
 *
 * The buyer holds a link on the **buyer's** terms, so the cache is populated and the capability
 * is on for the channel — the case that must still cost nothing.
 */
const shouldRun = process.env['PERF_RUN'] === 'true';

describe.skipIf(!shouldRun)('related_payers — no extra statement for a buyer with no payer\'s-terms link', () => {
  let h: BackendServerHandle;
  const COOKIE = `stub-rp182-perf-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const enabled = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/related_payers.enabled/value',
      cookies: ADMIN,
      payload: { scope: 'all', value: true },
    });
    expect(enabled.statusCode, enabled.body).toBe(200);
    const buyer = await makeOrganization(em, 'Perf buyer');
    const payer = await makeOrganization(em, 'Perf payer');
    await makeAddress(em, payer, 'billing');
    const link = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${buyer}/related-payers`,
      cookies: ADMIN,
      payload: { payerOrganizationId: payer, commercialTerms: 'buyer' },
    });
    expect(link.statusCode, link.body).toBe(201);
    const accountId = randomUUID();
    await withSystemScope('test seed: perf buyer', async () => {
      em.create(CustomerAccount, {
        id: accountId,
        organizationId: buyer,
        email: `rp182-perf-${accountId.slice(0, 8)}@example.com`,
        passwordHash: 'not-a-real-hash',
        firstName: 'Perf',
        lastName: 'Buyer',
        organizationRoleId: await predefinedRoleIdOf(em, buyer, 'administrator'),
        emailVerifiedAt: new Date(),
        blockedAt: null,
      } as never);
      await em.flush();
    });
    CUSTOMER_COOKIES[COOKIE] = { customerAccountId: accountId, organizationId: buyer };
  }, 5 * 60_000);

  afterAll(async () => {
    delete CUSTOMER_COOKIES[COOKIE];
    await teardownBackendServer(h);
  });

  /** Statements of one warm listing request (the second of two). */
  async function warmListingStatements(): Promise<number> {
    const page = () => h.app.inject({ method: 'GET', url: '/api/v1/catalog/products?limit=20', cookies: { b2b_session: COOKIE } });
    expect((await page()).statusCode).toBe(200);
    const knex: Knex = h.em().getConnection().getKnex();
    let statements = 0;
    const count = (): void => {
      statements += 1;
    };
    knex.on('query', count);
    try {
      expect((await page()).statusCode).toBe(200);
    } finally {
      knex.off('query', count);
    }
    return statements;
  }

  it('a warm page costs what it costs with the module off', async () => {
    const on = await warmListingStatements();
    let off = -1;
    await withModuleOff('related_payers', 'deactivated', async () => {
      off = await warmListingStatements();
    });
    expect(on).toBe(off);
  });
});
