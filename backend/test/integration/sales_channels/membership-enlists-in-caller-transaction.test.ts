import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SALES_CHANNEL_AUDIT_ACTIONS } from '@endora-commerce/contracts';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Issue #1926 (`specs/186-aggregate-ports/` research R-16.1) [real DB] — when a
 * caller hands the kernel's membership writer its transaction's `em`, the writer
 * enlists in that transaction: the Organization's access-cache drop runs only
 * after the commit, and still before `sales_channels.membership_changed` is
 * dispatched (D-93).
 *
 * "After the commit" is observed, not inferred: the spy on the drop counts the
 * Organization's bridge rows on a connection of its own, which sees only what
 * has committed. Before the fix the drop ran inside the creating transaction and
 * that count was zero — the window in which a request re-caches the old set.
 *
 * Two callers, one per kind of transaction that reaches the writer:
 *  - `organization.create`, a Command, whose bus scope encloses its commit;
 *  - standalone customer registration, a plain `em.transactional` in
 *    `customer_accounts` that provisions a personal Organization, which now
 *    opens an EventBus scope around its transaction for the same guarantee.
 */
describe('the membership writer enlists in the caller’s transaction (#1926)', () => {
  let h: BackendServerHandle;
  let channel: string;
  const stamp = Date.now().toString().slice(-8);
  const drops: Array<{ organizationId: string; committedBindings: number }> = [];
  const order: string[] = [];

  async function committedBindings(organizationId: string): Promise<number> {
    const rows = (await h.orm.em
      .fork()
      .getConnection()
      .execute(
        `select count(*)::int as n from "sales_channel_organizations" where "organization_id" = ?`,
        [organizationId],
      )) as Array<{ n: number }>;
    return rows[0]!.n;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const sales = em.create(SalesChannel, {
      code: `enlist-${stamp}`,
      name: { en: 'enlist' },
      defaultLanguage: 'en',
      languages: ['en'],
      defaultCurrency: 'PLN',
      currencies: ['PLN'],
    });
    await em.persist(sales).flush();
    channel = sales.id;

    const cache = h.container.cradle['salesChannelAccessCache'] as {
      invalidateAfterWrite(organizationId: string): Promise<number | null>;
    };
    const original = cache.invalidateAfterWrite.bind(cache);
    vi.spyOn(cache, 'invalidateAfterWrite').mockImplementation(async (organizationId: string) => {
      drops.push({ organizationId, committedBindings: await committedBindings(organizationId) });
      order.push(`drop:${organizationId}`);
      return original(organizationId);
    });
    h.eventBus.on('sales_channels.membership_changed', (payload) => {
      const { entityType, entityId } = payload as unknown as { entityType: string; entityId: string };
      if (entityType === 'organization') order.push(`event:${entityId}`);
    });
  }, 120_000);

  afterAll(async () => {
    vi.restoreAllMocks();
    await teardownBackendServer(h);
  });

  async function membershipEntries(organizationId: string): Promise<number> {
    const rows = (await h.orm.em
      .fork()
      .getConnection()
      .execute(
        `select count(*)::int as n from "audit_log_entries" where "action" = ? and "object_id" like ?`,
        [SALES_CHANNEL_AUDIT_ACTIONS.MEMBERSHIP_CHANGED, `%:organization:${organizationId}`],
      )) as Array<{ n: number }>;
    return rows[0]!.n;
  }

  function expectDropAfterCommitAndBeforeEvent(organizationId: string): void {
    const mine = drops.filter((d) => d.organizationId === organizationId);
    expect(mine.length).toBeGreaterThan(0);
    for (const drop of mine) expect(drop.committedBindings).toBeGreaterThan(0);
    const firstDrop = order.indexOf(`drop:${organizationId}`);
    const firstEvent = order.indexOf(`event:${organizationId}`);
    expect(firstEvent).toBeGreaterThan(-1);
    expect(firstDrop).toBeLessThan(firstEvent);
  }

  it('organization.create: the drop sees the committed binding and precedes the event', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/organizations',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        name: `Enlist ${stamp}`,
        taxId: `PL1926${stamp}`,
        registeredAddress: { street: 'ul. Kanałowa 1', city: 'Gdańsk', postalCode: '80-001', country: 'PL' },
        salesChannelIds: [channel],
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    const organizationId = (res.json() as { data: { id: string } }).data.id;

    expectDropAfterCommitAndBeforeEvent(organizationId);
    expect(await membershipEntries(organizationId)).toBeGreaterThan(0);
  });

  it('standalone registration (a plain transaction): the drop sees the committed binding and precedes the event', async () => {
    const port = h.container.cradle['customerAccountLifecycleWritePort'] as {
      createStandalone(input: {
        email: string;
        password: string;
        firstName: string;
        lastName: string;
      }): Promise<{ organizationId: string | null }>;
    };
    const account = await port.createStandalone({
      email: `enlist-${stamp}@example.test`,
      password: 'a-very-strong-pass-1926',
      firstName: 'En',
      lastName: 'List',
    });
    const organizationId = account.organizationId!;
    expect(organizationId).toBeTruthy();

    expectDropAfterCommitAndBeforeEvent(organizationId);
    expect(await membershipEntries(organizationId)).toBeGreaterThan(0);
  });
});
