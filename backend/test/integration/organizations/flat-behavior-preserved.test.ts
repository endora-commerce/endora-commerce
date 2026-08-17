import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { randomUUID } from 'node:crypto';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { Organization } from '../../../src/modules/organizations/entities/organization.entity.js';
import { OrganizationSalesRepAssignment } from '../../../src/modules/organizations/entities/organization-sales-rep-assignment.entity.js';
import { Product } from '../../../src/modules/catalog/entities/product.entity.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';
import { CustomerGroup } from '../../../src/modules/price_lists/entities/customer-group.entity.js';
import { OrganizationTreeService } from '../../../src/modules/organizations/services/organization-tree-service.js';
import { OrganizationInheritanceService } from '../../../src/modules/organizations/services/organization-inheritance-service.js';
import { SalesRepAssignmentService } from '../../../src/modules/organizations/services/sales-rep-assignment-service.js';
import { PriceListService } from '../../../src/modules/price_lists/services/price-list-service.js';
import { PricingService } from '../../../src/modules/price_lists/services/pricing-service.js';
import {
  DefaultPriceListMigrator,
  DEFAULT_PRICE_LIST_ID,
} from '../../../src/modules/price_lists/services/default-price-list-migration.js';
import { CreditLimitService } from '../../../src/modules/credit_limits/services/credit-limit-service.js';
import { EventBus } from '../../../src/events/bus.js';
import { neighbourReadPorts } from '../../helpers/price-list-neighbour-ports.js';

/**
 * Feature 056 — flat-behavior preservation lock (T028, FR-001/FR-013).
 *
 * Every org is a root when no parent is set. This test pins that the
 * feature-056-wired services (subtree-aware scope, inheritance-aware pricing +
 * credit) produce byte-for-byte the SAME results for root orgs as the
 * pre-feature flat services (constructed without any hierarchy wiring). If a
 * future change accidentally alters the flat path, this test fails.
 */

let seq = 0;
async function makeRootOrg(em: EntityManager, name: string): Promise<Organization> {
  seq += 1;
  const org = em.create(Organization, {
    name,
    taxId: `PL056FLAT${String(seq).padStart(5, '0')}`,
    status: 'active',
    vatStatus: 'vat_payer',
    registeredAddress: { street: '-', city: '-', postalCode: '-', country: 'PL' },
  });
  await em.persistAndFlush(org);
  org.path = `/${org.id}/`;
  await em.flush();
  return org;
}

describe('flat-behavior preservation (feature 056, FR-001/FR-013)', () => {
  let h: BackendServerHandle;
  let tree: OrganizationTreeService;
  let inheritance: OrganizationInheritanceService;

  beforeAll(async () => {
    h = await setupBackendServer();
    tree = new OrganizationTreeService(h.em);
    inheritance = new OrganizationInheritanceService(h.em, tree, async () => 'shared_pool');
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('scope: a rep on a root org resolves the same allowed set with or without subtree wiring', async () => {
    const em = h.em();
    const org = await makeRootOrg(em, 'Flat Scope Org');
    const rep = randomUUID();
    em.create(OrganizationSalesRepAssignment, { organizationId: org.id, adminUserId: rep });
    await em.flush();

    const flat = new SalesRepAssignmentService(h.em);
    // rollup granted, but the org is a leaf root → subtree = {org} = flat set.
    const wired = new SalesRepAssignmentService(h.em, undefined, {
      treeService: tree,
      hasRollupCapability: async () => true,
    });

    const flatSet = new Set(await flat.listAssignedOrganizationIds(rep));
    const wiredSet = new Set(await wired.listAssignedOrganizationIds(rep));
    expect(wiredSet).toEqual(flatSet);
    expect(wiredSet).toEqual(new Set([org.id]));

    expect(await wired.canSeeOrganization(rep, org.id)).toBe(
      await flat.canSeeOrganization(rep, org.id),
    );
  });

  it('pricing: a root org resolves the same list with or without the org-chain resolver', async () => {
    await h
      .em()
      .getConnection()
      .execute(
        `truncate table "price_list_price_brackets", "price_list_products", "price_lists" cascade`,
      );
    await new DefaultPriceListMigrator(h.em).seedDefault();

    const em = h.em();
    const product = await em.findOneOrFail(Product, { id: SEED_PRODUCT_101_ID });
    const salesChannel = await em.findOneOrFail(SalesChannel, { systemDefault: true });
    const org = await makeRootOrg(em, 'Flat Pricing Org');
    const cg = em.create(CustomerGroup, { code: `flat-cg-${Date.now()}`, name: 'Flat CG' });
    await em.persistAndFlush(cg);
    org.customerGroupId = cg.id;
    await em.flush();

    const svc = new PriceListService(h.em, undefined, undefined, undefined, neighbourReadPorts(h.em));
    await svc.addProduct(DEFAULT_PRICE_LIST_ID, product.id);
    await svc.replaceBrackets(DEFAULT_PRICE_LIST_ID, product.id, {
      PLN: [{ minQuantity: 1, maxQuantity: null, amount: '100' }],
    });
    const orgList = await svc.create({
      name: 'Flat Org List',
      type: 'base',
      applicationRule: { kind: 'criterion', type: 'organization', values: [org.id] } as never,
    });
    await svc.addProduct(orgList.id, product.id);
    await svc.replaceBrackets(orgList.id, product.id, {
      PLN: [{ minQuantity: 1, maxQuantity: null, amount: '80' }],
    });
    await svc.activate(orgList.id);

    const flatPricing = new PricingService(h.em, undefined, undefined, neighbourReadPorts(h.em));
    const wiredPricing = new PricingService(h.em, undefined, (id) => inheritance.priceListOrgChain(id));

    const flatOut = await flatPricing.resolveEngine({
      product,
      context: { quantity: 1, organization: org, salesChannel },
    });
    const wiredOut = await wiredPricing.resolveEngine({
      product,
      context: { quantity: 1, organization: org, salesChannel },
    });
    expect(wiredOut.base.listId).toBe(flatOut.base.listId);
    expect(wiredOut.base.listName).toBe(flatOut.base.listName);
    expect(Number(wiredOut.base.bracket!.amount)).toBe(Number(flatOut.base.bracket!.amount));
    expect(wiredOut.base.listName).toBe('Flat Org List');
  });

  it('credit: a root org reserves identically with or without inheritance wiring', async () => {
    const em = h.em();
    const orgFlat = await makeRootOrg(em, 'Flat Credit A');
    const orgWired = await makeRootOrg(em, 'Flat Credit B');

    const flatSvc = new CreditLimitService(h.em, new EventBus());
    const wiredSvc = new CreditLimitService(h.em, new EventBus(), undefined, inheritance);
    await flatSvc.grant({ organizationId: orgFlat.id, grantedAmount: 100, currency: 'PLN' });
    await wiredSvc.grant({ organizationId: orgWired.id, grantedAmount: 100, currency: 'PLN' });

    // getForOrganization: a root returns its own row in both.
    expect((await wiredSvc.getForOrganization(orgWired.id))!.organizationId).toBe(orgWired.id);
    expect((await flatSvc.getForOrganization(orgFlat.id))!.organizationId).toBe(orgFlat.id);

    // Identical reserve outcomes for the same draw sequence.
    const flat1 = await flatSvc.reserve({ organizationId: orgFlat.id, orderId: randomUUID(), amount: 60, currency: 'PLN' });
    const wired1 = await wiredSvc.reserve({ organizationId: orgWired.id, orderId: randomUUID(), amount: 60, currency: 'PLN' });
    expect(wired1.ok).toBe(flat1.ok);
    expect(wired1.ok && flat1.ok && wired1.availableAmountAfter).toBe(flat1.ok && flat1.availableAmountAfter);

    // Over-draw fails in both with the same code.
    const flat2 = await flatSvc.reserve({ organizationId: orgFlat.id, orderId: randomUUID(), amount: 50, currency: 'PLN' });
    const wired2 = await wiredSvc.reserve({ organizationId: orgWired.id, orderId: randomUUID(), amount: 50, currency: 'PLN' });
    expect(wired2.ok).toBe(false);
    expect(flat2.ok).toBe(false);
    expect(!wired2.ok && wired2.code).toBe(!flat2.ok && flat2.code);
  });

  it('credit: an ungranted root resolves to null in both paths', async () => {
    const em = h.em();
    const org = await makeRootOrg(em, 'Flat Ungranted');
    const flatSvc = new CreditLimitService(h.em, new EventBus());
    const wiredSvc = new CreditLimitService(h.em, new EventBus(), undefined, inheritance);
    expect(await wiredSvc.getForOrganization(org.id)).toBe(await flatSvc.getForOrganization(org.id));
    expect(await wiredSvc.getForOrganization(org.id)).toBeNull();
  });
});
