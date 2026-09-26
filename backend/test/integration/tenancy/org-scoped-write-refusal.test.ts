import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Address } from '../../helpers/package-entities.js';
import { OTHER_TEST_ORGANIZATION_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { seedOtherTestOrganization } from '../../helpers/seed-organizations.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import {
  runWithTenantContext,
  type TenantContext,
} from '../../../src/tenancy/tenant-context.js';

/**
 * D-260/A — the tenant guard authors **writes** at the flush boundary.
 *
 * The commercial-gateway route case that originally reproduced the escalation
 * travels with those packages. This host-owned half keeps the platform proof:
 * inserts and cross-organization moves are refused at the flush boundary even
 * when no commercial module is installed.
 */

/**
 * One composed server for the whole file, not one per `describe`.
 *
 * `setupBackendServer` composes a Fastify app, the ORM singleton, two ioredis
 * clients and the module container. This file keeps one instance for its
 * flush-boundary cases.
 */
let h: BackendServerHandle;

beforeAll(async () => {
  h = await setupBackendServer();
  await withSystemScope('seed the second organization the write guard needs', async () => {
    await seedOtherTestOrganization(h.em());
  });
}, 60_000);

afterAll(async () => {
  await teardownBackendServer(h);
});

/**
 * The guard at the flush boundary, in a context this block establishes rather
 * than one a route derived. This mechanism proof exists because one of the
 * things the guard catches has no route to go through: the
 * **cross-organization move**, `organizationId = B` on a row legitimately loaded
 * under org A. The read filter cannot see that write at all — the row was
 * visible when it was loaded — so no read-side repair reaches it, and
 * `beforeUpdate` is the only place it is visible.
 *
 * It is explicit about the trap the suite sets: `test/tenancy-setup.ts` enters
 * `mode: 'system'` in a global `beforeAll` **and** `beforeEach`, under which
 * `isOrgInScope` answers `true` for everything and every assertion here would
 * pass while proving nothing. Every flush below therefore runs inside
 * `runWithTenantContext(scopedToOrgA, …)`, and the two non-refusal cases are
 * here to prove the block is not passing because the flush fails for some
 * unrelated reason.
 */
describe('D-260/A — the same refusal at the flush boundary, in an explicit scoped context [integration]', () => {
  /** What a `sales_representative` assigned only to org A resolves to. */
  const scopedToOrgA: TenantContext = {
    mode: 'allowed-set',
    allowedOrganizationIds: [TEST_ORGANIZATION_ID],
    actor: { kind: 'admin', id: 'd260a-flush-boundary' },
  };

  const addressFor = (organizationId: string) => ({
    organizationId,
    kind: 'delivery' as const,
    recipientName: 'D-260/A',
    street: 'ul. Testowa 1',
    city: 'Warszawa',
    postalCode: '00-001',
    country: 'PL',
  });

  /** The organization a row actually holds, off the connection and past every filter. */
  const storedOrganizationOf = async (addressId: string): Promise<string | undefined> => {
    const rows = await h
      .em()
      .getConnection()
      .execute<Array<{ organization_id: string }>>(
        'select organization_id from addresses where id = ?',
        [addressId],
      );
    return rows[0]?.organization_id;
  };

  it('refuses an INSERT carrying an organization outside the ambient scope', async () => {
    await runWithTenantContext(scopedToOrgA, async () => {
      const em = h.orm.em.fork();
      em.persist(em.create(Address, addressFor(OTHER_TEST_ORGANIZATION_ID)));
      await expect(em.flush()).rejects.toThrow(/outside the active tenant scope/);
    });
  });

  it('allows the same INSERT for an organization inside it [not a ban on writing]', async () => {
    const id = await runWithTenantContext(scopedToOrgA, async () => {
      const em = h.orm.em.fork();
      const row = em.create(Address, addressFor(TEST_ORGANIZATION_ID));
      await em.persistAndFlush(row);
      return row.id;
    });
    expect(await storedOrganizationOf(id)).toBe(TEST_ORGANIZATION_ID);
  });

  it('refuses the cross-organization MOVE, which no read filter can see', async () => {
    const id = await runWithTenantContext(scopedToOrgA, async () => {
      const em = h.orm.em.fork();
      const row = em.create(Address, addressFor(TEST_ORGANIZATION_ID));
      await em.persistAndFlush(row);
      return row.id;
    });

    await runWithTenantContext(scopedToOrgA, async () => {
      const em = h.orm.em.fork();
      // A perfectly legitimate read: the row is org A's and the filter grants it.
      const row = await em.findOneOrFail(Address, { id });
      row.organizationId = OTHER_TEST_ORGANIZATION_ID;
      await expect(em.flush()).rejects.toThrow(/outside the active tenant scope/);
    });

    expect(await storedOrganizationOf(id)).toBe(TEST_ORGANIZATION_ID);
  });

  it('leaves a system-scoped write alone [`system` and `all` answer permitted trivially]', async () => {
    const id = await withSystemScope('D-260/A: the sanctioned cross-organization write', async () => {
      const em = h.orm.em.fork();
      const row = em.create(Address, addressFor(OTHER_TEST_ORGANIZATION_ID));
      await em.persistAndFlush(row);
      return row.id;
    });
    expect(await storedOrganizationOf(id)).toBe(OTHER_TEST_ORGANIZATION_ID);
  });
});
