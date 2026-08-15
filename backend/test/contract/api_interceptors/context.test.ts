import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  TEST_CUSTOMER_ID,
  TEST_ORGANIZATION_ID,
} from '../../helpers/test-actors.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { getTenantContext, type TenantContext } from '../../../src/tenancy/tenant-context.js';
import { forkScopedEm } from '../../../src/tenancy/scoped-em.js';
import { ShoppingList } from '../../../src/modules/shopping_lists/entities/shopping-list.entity.js';

/**
 * Feature 060 / US1 (T011) — interceptors run inside the SAME ambient
 * TenantContext as the endpoint: the caller identity matches, and the
 * Principle XI data-layer guard applies to any query the interceptor makes —
 * an out-of-scope organization's rows are unreachable.
 */

const FIXTURE_MODULE = 'interceptor_fixture';
const OTHER_ORG_ID = '00000000-0000-4000-8000-0000000000ab';

describe('API interceptor context propagation (feature 060 / US1)', () => {
  let h: BackendServerHandle;
  let baselineEnabled: string[] = [];
  let capturedCtx: TenantContext | undefined;
  let listsSeenByInterceptor: ShoppingList[] = [];

  beforeAll(async () => {
    h = await setupBackendServer({
      configureInterceptors: (registry) => {
        registry.register({
          module: FIXTURE_MODULE,
          id: 'capture-context',
          target: 'GET /api/v1/shopping-lists',
          phase: 'pre',
          handler: async () => {
            capturedCtx = getTenantContext();
            // A query made from inside the interceptor runs under the ambient
            // tenant guard exactly like the endpoint's own queries.
            listsSeenByInterceptor = await forkScopedEm(h.orm).find(ShoppingList, {});
          },
        });
      },
    });
    baselineEnabled = registryCache.enabledIds();
    registryCache.__setEnabledForTesting([...baselineEnabled, FIXTURE_MODULE]);

    // Seed one in-scope and one OUT-of-scope shopping list via raw SQL
    // (bypassing the ORM guard on purpose — this is test arrangement).
    const knex = h.em().getKnex();
    await knex.raw(
      `insert into shopping_lists (id, organization_id, customer_account_id, name, is_default, created_at, updated_at)
       values (?, ?, ?, ?, false, now(), now()), (?, ?, ?, ?, false, now(), now())`,
      [
        randomUUID(),
        TEST_ORGANIZATION_ID,
        TEST_CUSTOMER_ID,
        'In-scope list',
        randomUUID(),
        OTHER_ORG_ID,
        '00000000-0000-4000-8000-0000000000a4',
        'Out-of-scope list',
      ],
    );
  });

  afterAll(async () => {
    registryCache.__setEnabledForTesting(baselineEnabled);
    await teardownBackendServer(h);
  });

  it('observes the endpoint caller identity and tenant scope, and cannot reach out-of-scope rows', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/shopping-lists',
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(res.statusCode).toBe(200);

    // Same identity/scope the endpoint itself sees (FR-005).
    expect(capturedCtx).toBeDefined();
    expect(capturedCtx?.mode).toBe('single-org');
    expect(capturedCtx?.organizationId).toBe(TEST_ORGANIZATION_ID);
    expect(capturedCtx?.customerAccountId).toBe(TEST_CUSTOMER_ID);

    // The out-of-scope row exists in the database...
    const knex = h.em().getKnex();
    const raw = (await knex.raw(`select count(*)::int as n from shopping_lists where organization_id = ?`, [
      OTHER_ORG_ID,
    ])) as { rows: Array<{ n: number }> };
    expect(raw.rows[0]?.n).toBeGreaterThan(0);

    // ...but the interceptor's guarded query never saw it (Principle XI).
    expect(listsSeenByInterceptor.length).toBeGreaterThan(0);
    expect(listsSeenByInterceptor.every((l) => l.organizationId === TEST_ORGANIZATION_ID)).toBe(true);
  });
});
