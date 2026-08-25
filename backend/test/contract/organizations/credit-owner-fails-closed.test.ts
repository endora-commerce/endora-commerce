import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { CreditLimitReadPort, OrganizationInheritancePort } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { Organization } from '../../../src/modules/organizations/entities/organization.entity.js';
import { OrganizationTreeService } from '../../../src/modules/organizations/services/organization-tree-service.js';
import { CreditLimit } from '../../helpers/package-entities.js';

/**
 * `organizationInheritancePort.creditOwner` over the composed container
 * (feature 077, D-87 — the `organizations` boundary shard).
 *
 * The method answers "which organisation in this chain actually holds the
 * credit limit", and it answered it out of `credit_limits`' own table in raw
 * SQL. Two things are proved here that the unit test cannot:
 *
 *  - the composed wiring still crosses organisation scope on purpose. The
 *    owner is by definition an ancestor outside the caller's tenant filter, so
 *    a port implementation that forgot `filters: { org: false }` would return
 *    an empty set and the inheritance would silently stop working.
 *  - with `credit_limits` platform-unavailable the call **refuses**. That is
 *    the substance of the conversion: the statement read the table whatever the
 *    owner's state, and "nobody in this chain holds a limit" is a plausible
 *    answer and the wrong one.
 *
 * The refusal is asserted at the seam rather than over a route because no route
 * reaches this port with `credit_limits` off — the only caller is that module's
 * own service, which its own gate stops first.
 */
describe('organizations — creditOwner asks credit_limits and fails closed (D-87)', () => {
  let h: BackendServerHandle;
  let head: string;
  let leaf: string;

  const port = (): OrganizationInheritancePort =>
    (h.container.cradle as unknown as { organizationInheritancePort: OrganizationInheritancePort })
      .organizationInheritancePort;

  const readPort = (): CreditLimitReadPort =>
    (h.container.cradle as unknown as { creditLimitReadPort: CreditLimitReadPort })
      .creditLimitReadPort;

  const makeOrg = async (em: EntityManager, name: string): Promise<Organization> => {
    const org = em.create(Organization, {
      name,
      taxId: `PL077D${Math.floor(Math.random() * 1_000_000_000)
        .toString()
        .padStart(9, '0')}`,
      status: 'active',
      vatStatus: 'vat_payer',
      registeredAddress: {
        street: 'ul. Kredytowa 1',
        city: 'Warszawa',
        postalCode: '00-007',
        country: 'PL',
      },
    });
    await em.persistAndFlush(org);
    org.path = `/${org.id}/`;
    await em.flush();
    return org;
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const tree = new OrganizationTreeService(h.em);
    const headOrg = await makeOrg(em, 'D87 Credit Head');
    const leafOrg = await makeOrg(em, 'D87 Credit Leaf');
    await em.transactional(async (tx) => {
      const node = await tx.findOneOrFail(Organization, { id: leafOrg.id });
      const parent = await tx.findOneOrFail(Organization, { id: headOrg.id });
      await tree.applyReparentPaths(tx, node, parent);
    });
    head = headOrg.id;
    leaf = leafOrg.id;

    em.create(CreditLimit, {
      organizationId: head,
      grantedAmount: '5000.00',
      currency: 'PLN',
    });
    await em.flush();
    em.clear();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('resolves the ancestor holding the limit, across organisation scope', async () => {
    const owner = await port().creditOwner(leaf);
    expect(owner.ownerOrgId).toBe(head);
  });

  it('answers with ids, so the owner cannot hand a managed row across the seam', async () => {
    const ids = await readPort().organizationsWithLimit([leaf, head]);
    expect(ids).toEqual([head]);
    // !983's shape: an ORM entity is structurally assignable to plenty of record
    // types, and `tsc` accepts the hand-back. A `string[]` cannot carry one, and
    // this is the assertion that fails loudly if the return type is ever widened
    // into something that can.
    expect(ids.some((id) => typeof id !== 'string')).toBe(false);
    expect(await readPort().organizationsWithLimit([])).toEqual([]);
  });

  it('refuses while `credit_limits` is platform-unavailable', async () => {
    await withModuleOff('credit_limits', 'platform-unavailable', async () => {
      await expect(port().creditOwner(leaf)).rejects.toMatchObject({
        statusCode: 503,
        code: 'MODULE_DISABLED',
      });
    });

    // Restored: the refusal is the owner's state, not a broken wiring.
    expect((await port().creditOwner(leaf)).ownerOrgId).toBe(head);
  });
});
