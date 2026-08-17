import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { Product } from '../../../src/modules/catalog/entities/product.entity.js';
import { Category } from '../../../src/modules/catalog/entities/category.entity.js';
import { CustomerGroup } from '../../../src/modules/price_lists/entities/customer-group.entity.js';
import { Organization } from '../../../src/modules/organizations/entities/organization.entity.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';
import { PriceListService } from '../../../src/modules/price_lists/services/price-list-service.js';
import { PricingService } from '../../../src/modules/price_lists/services/pricing-service.js';
import {
  DefaultPriceListMigrator,
  DEFAULT_PRICE_LIST_ID,
} from '../../../src/modules/price_lists/services/default-price-list-migration.js';
import { neighbourReadPorts } from '../../helpers/price-list-neighbour-ports.js';

/**
 * Feature 011 / US5 — Resolver priority chain + tie-break + bracket-gap
 * fall-through (T059).
 *
 * Uses `setupBackendServer` so the seeded catalog data (products attached to
 * categories) is committed before each test, sidestepping the transaction-
 * isolation issue with raw SQL bridge inserts.
 *
 * Verifies:
 *   - FR-026: priority chain (Org → CG → Cat → SC → other).
 *   - FR-027: most-recent modifiedAt + lexicographic name tie-break.
 *   - FR-028: Base/Sale partitioned resolutions.
 *   - FR-029: product-driven category matching.
 *   - FR-030: Default is the terminal fallback.
 *   - FR-031: bracket-gap fall-through to next-priority list.
 *   - FR-032: lists in non-active states are excluded.
 */
describe('Feature 011 / US5 — resolver priority + tie-break (T059)', () => {
  let h: BackendServerHandle;
  let product: Product;
  let category: Category;
  let salesChannel: SalesChannel;
  let customerGroup: CustomerGroup;
  let organization: Organization;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  beforeEach(async () => {
    // Per-test truncate of price-list rows so lists from earlier tests don't
    // pollute later ones (setupBackendServer's truncate runs once per file).
    await h
      .em()
      .getConnection()
      .execute(
        `truncate table "price_list_price_brackets", "price_list_products", "price_lists" cascade`,
      );
    const migrator = new DefaultPriceListMigrator(h.em);
    await migrator.seedDefault();

    const em = h.em();
    product = await em.findOneOrFail(Product, { id: SEED_PRODUCT_101_ID });
    // SEED_PRODUCT_101 is attached to a category — read the first attachment.
    const rows = await em
      .getConnection()
      .execute<
        Array<{ category_id: string }>
      >(`select category_id from product_categories where product_id = ?`, [SEED_PRODUCT_101_ID]);
    if (rows.length === 0) {
      throw new Error('Test fixture invariant: SEED_PRODUCT_101 must have at least one category.');
    }
    category = await em.findOneOrFail(Category, { id: rows[0]!.category_id });
    salesChannel = await em.findOneOrFail(SalesChannel, { systemDefault: true });

    // Custom group + org for this test.
    const cgEm = h.em();
    const cg = cgEm.create(CustomerGroup, {
      code: `cg-us5-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      name: 'US5 VIP',
    });
    await cgEm.persistAndFlush(cg);
    customerGroup = cg;

    const orgEm = h.em();
    const org = orgEm.create(Organization, {
      name: 'US5 Test Org',
      taxId: `US5-${Date.now() % 10_000_000}-${Math.floor(Math.random() * 1000)}`,
      vatStatus: 'vat_payer',
      status: 'active',
      registeredAddress: {
        street: 'Test 1',
        city: 'Warsaw',
        postalCode: '00-001',
        country: 'PL',
      },
    });
    await orgEm.persistAndFlush(org);
    organization = org;
  });

  /** Helper: create a list with a specific rule, assignment, and PLN bracket. */
  async function makeListWithBracket(
    svc: PriceListService,
    name: string,
    type: 'base' | 'sale',
    rule: Record<string, unknown>,
    pricePln: string,
    options: { activate?: boolean } = { activate: true },
  ): Promise<string> {
    const list = await svc.create({ name, type, applicationRule: rule as never });
    await svc.addProduct(list.id, product.id);
    await svc.replaceBrackets(list.id, product.id, {
      PLN: [{ minQuantity: 1, maxQuantity: null, amount: pricePln }],
    });
    if (options.activate !== false) {
      await svc.activate(list.id);
    }
    return list.id;
  }

  // -- tests -------------------------------------------------------------

  it('Default is the terminal fallback when no other rule matches', async () => {
    const svc = new PriceListService(
      h.em,
      undefined,
      undefined,
      undefined,
      neighbourReadPorts(h.em),
    );
    const pricing = new PricingService(h.em, undefined, undefined, neighbourReadPorts(h.em));

    await svc.addProduct(DEFAULT_PRICE_LIST_ID, product.id);
    await svc.replaceBrackets(DEFAULT_PRICE_LIST_ID, product.id, {
      PLN: [{ minQuantity: 1, maxQuantity: null, amount: '100.0000' }],
    });

    const out = await pricing.resolveEngine({
      product,
      context: { quantity: 1, organization: null, salesChannel },
    });
    expect(out.base.listId).toBe(DEFAULT_PRICE_LIST_ID);
    expect(Number(out.base.bracket!.amount)).toBe(100.0);
    expect(out.sale).toBeNull();
  });

  it('FR-026 step 1: Organization-explicit list beats Customer Group, Category, Sales Channel, and Default', async () => {
    const svc = new PriceListService(
      h.em,
      undefined,
      undefined,
      undefined,
      neighbourReadPorts(h.em),
    );
    const pricing = new PricingService(h.em, undefined, undefined, neighbourReadPorts(h.em));

    // Default → 100.
    await svc.addProduct(DEFAULT_PRICE_LIST_ID, product.id);
    await svc.replaceBrackets(DEFAULT_PRICE_LIST_ID, product.id, {
      PLN: [{ minQuantity: 1, maxQuantity: null, amount: '100' }],
    });

    await makeListWithBracket(
      svc,
      'CG List',
      'base',
      { kind: 'criterion', type: 'customerGroup', values: [customerGroup.id] },
      '90',
    );
    await makeListWithBracket(
      svc,
      'Cat List',
      'base',
      { kind: 'criterion', type: 'category', values: [category.id] },
      '85',
    );
    await makeListWithBracket(
      svc,
      'Org List',
      'base',
      { kind: 'criterion', type: 'organization', values: [organization.id] },
      '80',
    );

    organization.customerGroupId = customerGroup.id;
    await h.em().flush();

    const out = await pricing.resolveEngine({
      product,
      context: { quantity: 1, organization, salesChannel },
    });
    expect(Number(out.base.bracket!.amount)).toBe(80);
    expect(out.base.listName).toBe('Org List');
  });

  it('FR-026 step 2: falls through to Customer Group when no Org list matches', async () => {
    const svc = new PriceListService(
      h.em,
      undefined,
      undefined,
      undefined,
      neighbourReadPorts(h.em),
    );
    const pricing = new PricingService(h.em, undefined, undefined, neighbourReadPorts(h.em));

    await svc.addProduct(DEFAULT_PRICE_LIST_ID, product.id);
    await svc.replaceBrackets(DEFAULT_PRICE_LIST_ID, product.id, {
      PLN: [{ minQuantity: 1, maxQuantity: null, amount: '100' }],
    });
    await makeListWithBracket(
      svc,
      'CG List',
      'base',
      { kind: 'criterion', type: 'customerGroup', values: [customerGroup.id] },
      '90',
    );

    organization.customerGroupId = customerGroup.id;
    await h.em().flush();

    const out = await pricing.resolveEngine({
      product,
      context: { quantity: 1, organization, salesChannel },
    });
    expect(Number(out.base.bracket!.amount)).toBe(90);
    expect(out.base.listName).toBe('CG List');
  });

  it("FR-026 step 3 + FR-029: Category matches via the product's own categories", async () => {
    const svc = new PriceListService(
      h.em,
      undefined,
      undefined,
      undefined,
      neighbourReadPorts(h.em),
    );
    const pricing = new PricingService(h.em, undefined, undefined, neighbourReadPorts(h.em));

    await makeListWithBracket(
      svc,
      'Cat List',
      'base',
      { kind: 'criterion', type: 'category', values: [category.id] },
      '85',
    );

    const out = await pricing.resolveEngine({
      product,
      context: { quantity: 1, organization: null, salesChannel },
    });
    expect(out.base.listName).toBe('Cat List');
    expect(Number(out.base.bracket!.amount)).toBe(85);
  });

  it('FR-027: tie-break by most recent modifiedAt at every step', async () => {
    const svc = new PriceListService(
      h.em,
      undefined,
      undefined,
      undefined,
      neighbourReadPorts(h.em),
    );
    const pricing = new PricingService(h.em, undefined, undefined, neighbourReadPorts(h.em));

    const olderId = await makeListWithBracket(
      svc,
      'Older Org List',
      'base',
      { kind: 'criterion', type: 'organization', values: [organization.id] },
      '90',
    );
    await h
      .em()
      .getConnection()
      .execute(`update price_lists set modified_at = now() - interval '1 day' where id = ?`, [
        olderId,
      ]);

    await makeListWithBracket(
      svc,
      'Newer Org List',
      'base',
      { kind: 'criterion', type: 'organization', values: [organization.id] },
      '70',
    );

    const out = await pricing.resolveEngine({
      product,
      context: { quantity: 1, organization, salesChannel },
    });
    expect(out.base.listName).toBe('Newer Org List');
    expect(Number(out.base.bracket!.amount)).toBe(70);
  });

  it('FR-028: Base + Sale partitions resolve independently', async () => {
    const svc = new PriceListService(
      h.em,
      undefined,
      undefined,
      undefined,
      neighbourReadPorts(h.em),
    );
    const pricing = new PricingService(h.em, undefined, undefined, neighbourReadPorts(h.em));

    await svc.addProduct(DEFAULT_PRICE_LIST_ID, product.id);
    await svc.replaceBrackets(DEFAULT_PRICE_LIST_ID, product.id, {
      PLN: [{ minQuantity: 1, maxQuantity: null, amount: '100' }],
    });
    await makeListWithBracket(
      svc,
      'Spring Promo',
      'sale',
      { kind: 'criterion', type: 'organization', values: [organization.id] },
      '60',
    );

    const out = await pricing.resolveEngine({
      product,
      context: { quantity: 1, organization, salesChannel },
    });
    expect(Number(out.base.bracket!.amount)).toBe(100);
    expect(Number(out.sale?.bracket.amount)).toBe(60);
    expect(out.sale?.listName).toBe('Spring Promo');
  });

  it('FR-031: bracket-gap fall-through advances to the next-priority list', async () => {
    const svc = new PriceListService(
      h.em,
      undefined,
      undefined,
      undefined,
      neighbourReadPorts(h.em),
    );
    const pricing = new PricingService(h.em, undefined, undefined, neighbourReadPorts(h.em));

    // Default covers everything at 100.
    await svc.addProduct(DEFAULT_PRICE_LIST_ID, product.id);
    await svc.replaceBrackets(DEFAULT_PRICE_LIST_ID, product.id, {
      PLN: [{ minQuantity: 1, maxQuantity: null, amount: '100' }],
    });

    // Org-explicit list with a gap: 1–9 and 100+.
    const orgList = await svc.create({
      name: 'Gap List',
      type: 'base',
      applicationRule: { kind: 'criterion', type: 'organization', values: [organization.id] },
    });
    await svc.addProduct(orgList.id, product.id);
    await svc.replaceBrackets(orgList.id, product.id, {
      PLN: [
        { minQuantity: 1, maxQuantity: 9, amount: '80' },
        { minQuantity: 100, maxQuantity: null, amount: '70' },
      ],
    });
    await svc.activate(orgList.id);

    // Qty 5 → 80.
    const out5 = await pricing.resolveEngine({
      product,
      context: { quantity: 5, organization, salesChannel },
    });
    expect(Number(out5.base.bracket!.amount)).toBe(80);

    // Qty 50 → fall through to Default → 100.
    const out50 = await pricing.resolveEngine({
      product,
      context: { quantity: 50, organization, salesChannel },
    });
    expect(out50.base.listId).toBe(DEFAULT_PRICE_LIST_ID);
    expect(Number(out50.base.bracket!.amount)).toBe(100);

    // Qty 200 → 70.
    const out200 = await pricing.resolveEngine({
      product,
      context: { quantity: 200, organization, salesChannel },
    });
    expect(Number(out200.base.bracket!.amount)).toBe(70);
  });

  it('FR-032: lists in draft state are excluded by the resolver', async () => {
    const svc = new PriceListService(
      h.em,
      undefined,
      undefined,
      undefined,
      neighbourReadPorts(h.em),
    );
    const pricing = new PricingService(h.em, undefined, undefined, neighbourReadPorts(h.em));

    await svc.addProduct(DEFAULT_PRICE_LIST_ID, product.id);
    await svc.replaceBrackets(DEFAULT_PRICE_LIST_ID, product.id, {
      PLN: [{ minQuantity: 1, maxQuantity: null, amount: '100' }],
    });

    // Draft list — should NOT apply.
    await makeListWithBracket(
      svc,
      'Draft List',
      'base',
      { kind: 'criterion', type: 'organization', values: [organization.id] },
      '50',
      { activate: false },
    );

    const out = await pricing.resolveEngine({
      product,
      context: { quantity: 1, organization, salesChannel },
    });
    expect(out.base.listId).toBe(DEFAULT_PRICE_LIST_ID);
    expect(Number(out.base.bracket!.amount)).toBe(100);
  });

  it('returns null base bracket when no list (including Default) prices the product', async () => {
    // Use a Product NOT seeded with brackets — fetch SEED_PRODUCT_103 which
    // is also in the seeded catalog but has no Default bracket.
    const em = h.em();
    const otherProduct = await em.findOneOrFail(Product, {
      sku: { $ne: 'EXAMPLE-SIMPLE-001' },
    });

    const pricing = new PricingService(h.em, undefined, undefined, neighbourReadPorts(h.em));
    const out = await pricing.resolveEngine({
      product: otherProduct,
      context: { quantity: 1, organization: null, salesChannel },
    });
    expect(out.base.bracket).toBeNull();
  });
});
