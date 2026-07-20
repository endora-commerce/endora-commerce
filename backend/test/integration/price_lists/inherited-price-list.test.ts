import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { Product } from '../../../src/modules/catalog/entities/product.entity.js';
import { CustomerGroup } from '../../../src/modules/price_lists/entities/customer-group.entity.js';
import { Organization } from '../../../src/modules/organizations/entities/organization.entity.js';
import { SalesChannel } from '../../../src/modules/sales_channels/entities/sales-channel.entity.js';
import { PriceListService } from '../../../src/modules/price_lists/services/price-list-service.js';
import { PricingService } from '../../../src/modules/price_lists/services/pricing-service.js';
import {
  DefaultPriceListMigrator,
  DEFAULT_PRICE_LIST_ID,
} from '../../../src/modules/price_lists/services/default-price-list-migration.js';
import { OrganizationTreeService } from '../../../src/modules/organizations/services/organization-tree-service.js';
import { OrganizationInheritanceService } from '../../../src/modules/organizations/services/organization-inheritance-service.js';

/**
 * Feature 056 US3 — price-list inheritance up the organization tree (T021).
 *
 * A descendant with no own org-named list resolves the nearest ancestor's
 * (US3 AS1); a branch override outranks the ancestor and diverges only that
 * branch (AS3); the resolver priority (organization > customerGroup > category
 * > salesChannel) is preserved — an inherited ancestor org list still beats a
 * customer-group list. Single resolution pass, no schema change (R5).
 */

let seq = 0;
async function makeRootOrg(em: EntityManager, name: string): Promise<Organization> {
  seq += 1;
  const org = em.create(Organization, {
    name,
    taxId: `PL056IPL${String(seq).padStart(6, '0')}`,
    status: 'active',
    vatStatus: 'vat_payer',
    registeredAddress: { street: '-', city: '-', postalCode: '-', country: 'PL' },
  });
  await em.persistAndFlush(org);
  org.path = `/${org.id}/`;
  await em.flush();
  return org;
}

async function reparent(
  h: BackendServerHandle,
  tree: OrganizationTreeService,
  nodeId: string,
  newParentId: string,
): Promise<void> {
  const em = h.em();
  await em.transactional(async (tx) => {
    const node = await tx.findOneOrFail(Organization, { id: nodeId });
    const parent = await tx.findOneOrFail(Organization, { id: newParentId });
    tree.assertNoCycle(node, parent);
    await tree.assertMaxDepth(tx, node, parent);
    await tree.applyReparentPaths(tx, node, parent);
  });
}

describe('price-list inheritance up the org tree (US3)', () => {
  let h: BackendServerHandle;
  let product: Product;
  let salesChannel: SalesChannel;
  let tree: OrganizationTreeService;
  let pricing: PricingService;
  let head: Organization;
  let branchA: Organization;
  let branchB: Organization;

  beforeAll(async () => {
    h = await setupBackendServer();
    tree = new OrganizationTreeService(h.em);
    const inheritance = new OrganizationInheritanceService(h.em, tree);
    pricing = new PricingService(h.em, undefined, (orgId) => inheritance.priceListOrgChain(orgId));
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  beforeEach(async () => {
    await h
      .em()
      .getConnection()
      .execute(
        `truncate table "price_list_price_brackets", "price_list_products", "price_lists" cascade`,
      );
    await new DefaultPriceListMigrator(h.em).seedDefault();

    const em = h.em();
    product = await em.findOneOrFail(Product, { id: SEED_PRODUCT_101_ID });
    salesChannel = await em.findOneOrFail(SalesChannel, { systemDefault: true });

    head = await makeRootOrg(em, 'IPL Head');
    branchA = await makeRootOrg(em, 'IPL Branch A');
    branchB = await makeRootOrg(em, 'IPL Branch B');
    await reparent(h, tree, branchA.id, head.id);
    await reparent(h, tree, branchB.id, head.id);
  });

  async function makeOrgList(name: string, orgId: string, pricePln: string): Promise<string> {
    const svc = new PriceListService(h.em);
    const list = await svc.create({
      name,
      type: 'base',
      applicationRule: { kind: 'criterion', type: 'organization', values: [orgId] } as never,
    });
    await svc.addProduct(list.id, product.id);
    await svc.replaceBrackets(list.id, product.id, {
      PLN: [{ minQuantity: 1, maxQuantity: null, amount: pricePln }],
    });
    await svc.activate(list.id);
    return list.id;
  }

  async function seedDefault(price: string): Promise<void> {
    const svc = new PriceListService(h.em);
    await svc.addProduct(DEFAULT_PRICE_LIST_ID, product.id);
    await svc.replaceBrackets(DEFAULT_PRICE_LIST_ID, product.id, {
      PLN: [{ minQuantity: 1, maxQuantity: null, amount: price }],
    });
  }

  it('AS1 — a descendant with no own list resolves the parent org-named list', async () => {
    await seedDefault('100');
    await makeOrgList('Head Org List', head.id, '80');

    const out = await pricing.resolveEngine({
      product,
      context: { quantity: 1, organization: branchA, salesChannel },
    });
    expect(out.base.listName).toBe('Head Org List');
    expect(Number(out.base.bracket!.amount)).toBe(80);
  });

  it('AS3 — a branch override outranks the ancestor and diverges only that branch', async () => {
    await seedDefault('100');
    await makeOrgList('Head Org List', head.id, '80');
    await makeOrgList('Branch A Override', branchA.id, '70');

    // Branch A resolves its own (nearer) list.
    const a = await pricing.resolveEngine({
      product,
      context: { quantity: 1, organization: branchA, salesChannel },
    });
    expect(a.base.listName).toBe('Branch A Override');
    expect(Number(a.base.bracket!.amount)).toBe(70);

    // Branch B (sibling, no own list) is unaffected — still inherits head's list.
    const b = await pricing.resolveEngine({
      product,
      context: { quantity: 1, organization: branchB, salesChannel },
    });
    expect(b.base.listName).toBe('Head Org List');
    expect(Number(b.base.bracket!.amount)).toBe(80);
  });

  it('preserves resolver priority — an inherited ancestor org list beats a customer-group list', async () => {
    await seedDefault('100');
    // Customer-group list at 90 (cheaper than default) that branch A would match.
    const cg = h.em().create(CustomerGroup, {
      code: `cg-ipl-${Date.now()}`,
      name: 'IPL Group',
    });
    await h.em().persistAndFlush(cg);
    const svc = new PriceListService(h.em);
    const cgList = await svc.create({
      name: 'CG List',
      type: 'base',
      applicationRule: { kind: 'criterion', type: 'customerGroup', values: [cg.id] } as never,
    });
    await svc.addProduct(cgList.id, product.id);
    await svc.replaceBrackets(cgList.id, product.id, {
      PLN: [{ minQuantity: 1, maxQuantity: null, amount: '90' }],
    });
    await svc.activate(cgList.id);
    await makeOrgList('Head Org List', head.id, '95');

    branchA.customerGroupId = cg.id;
    await h.em().flush();

    // Even though the CG list (90) is cheaper, the inherited ancestor org list
    // (95) wins because organization outranks customerGroup (R5).
    const out = await pricing.resolveEngine({
      product,
      context: { quantity: 1, organization: branchA, salesChannel },
    });
    expect(out.base.listName).toBe('Head Org List');
    expect(Number(out.base.bracket!.amount)).toBe(95);
  });

  it('flat behavior — a root org with no ancestors resolves its own list only', async () => {
    await seedDefault('100');
    await makeOrgList('Head Org List', head.id, '80');
    const out = await pricing.resolveEngine({
      product,
      context: { quantity: 1, organization: head, salesChannel },
    });
    expect(out.base.listName).toBe('Head Org List');
    expect(Number(out.base.bracket!.amount)).toBe(80);
  });
});
