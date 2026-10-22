/**
 * The demo's prices, written by `price_lists` (feature 160, FR-044, N12;
 * `contracts/conversion-and-removal.md` §4).
 *
 * **This module's published install surface for the demo, not its demo body.**
 * Every row here names another module's row — a base price names a demo
 * product, a book row a product or the *Screws* category, an audience member
 * the demo organisation or the *VIP* group, a channel row the demo channel — so
 * the step that joins them is a composition step (§5.1) in
 * `@endora-commerce/demo-composition`, and this module keeps `demo: false` in
 * its manifest. The composition resolves the demo's natural keys to ids and
 * hands them over; these functions write **only this module's own tables**
 * (`price_lists`, `price_list_matrix_entries`, `price_list_audience_members`
 * and its registered channel bridge `sales_channel_price_lists`) and read no
 * other module's.
 *
 * Both run inside the demo runner's transaction, on the `EntityManager` the
 * composition is given, and both are idempotent: a second seed creates nothing,
 * and the withdrawal removes exactly the demo's books (by their fixed ids) and
 * the demo products' base rows.
 *
 * **The price surface.** The surface is a cache of sort orders built by the
 * worker. A demo seed or reset changes prices outside any audited write, so it
 * drops every built profile: the next price-sorted request registers its
 * profile and asks the worker to build it (`contracts/price-surface.md` §3),
 * and cards are priced live meanwhile.
 *
 * Demo data, reached only by `endora demo seed` and `endora demo reset`, whose
 * entry point calls `mustBeNonProduction()` first (feature 113 contract §2.7):
 * these writes have no operator and no audit reader, and each function says so
 * to `check:command-coverage`.
 */
import type { EntityManager } from '@mikro-orm/postgresql';
import { randomUUID } from 'node:crypto';
import { PriceList } from '../entities/price-list.entity.js';
import { PriceListAudienceMember } from '../entities/price-list-audience-member.entity.js';
import { PriceListMatrixEntry } from '../entities/price-list-matrix-entry.entity.js';
import { syncProductLines } from '../services/price-book-product-lines.js';
import {
  DEMO_BASE_CURRENCIES,
  DEMO_PRICE_BOOKS,
  DEMO_PRICE_BOOK_IDS,
  DEMO_PRICE_CURRENCY,
  demoBasePrice,
  type DemoBook,
} from './rows.js';

/** The demo's rows of other modules, by id, as the composition resolved them. */
export interface DemoPriceBookRefs {
  /** The demo channel every demo book is offered in. */
  readonly channelId: string;
  /** Every demo product, with the SKU its base price is keyed on. */
  readonly products: ReadonlyArray<{ readonly id: string; readonly sku: string }>;
  readonly screwsCategoryId: string;
  readonly acmeOrganizationId: string;
  readonly vipCustomerGroupId: string;
}

export interface DemoPriceBooksResult {
  readonly baseRows: number;
  readonly books: number;
}

/** The base book of a currency — created, as the base-price write does, on first use. */
async function baseBookOf(em: EntityManager, currency: string): Promise<string> {
  // command-coverage-ignore: demo data, reached only by `endora demo seed` /
  // `endora demo reset`, whose entry point calls `mustBeNonProduction()` first
  // (feature 113 contract §2.7); no operator and no audit reader.
  const existing = await em.findOne(PriceList, { isSystem: true, currency }, { fields: ['id'] });
  if (existing) return existing.id;
  const id = randomUUID();
  const book = em.create(PriceList, {
    id,
    name: `Base prices (${currency})`,
    currency,
    priority: 0,
    type: 'regular',
    status: 'active',
    audienceKind: 'everyone',
    isSystem: true,
    everActivated: true,
  });
  em.persist(book);
  await em.flush();
  return id;
}

/** Write the demo's base prices and price books. */
export async function seedDemoPriceBooks(em: EntityManager, refs: DemoPriceBookRefs): Promise<DemoPriceBooksResult> {
  // command-coverage-ignore: demo data, reached only by `endora demo seed` /
  // `endora demo reset`, whose entry point calls `mustBeNonProduction()` first
  // (feature 113 contract §2.7); no operator and no audit reader.
  const productBySku = new Map(refs.products.map((p) => [p.sku, p.id]));

  // ── base prices: a fixed 1+ row per demo product and currency the base book does not price yet
  let baseRows = 0;
  for (const currency of DEMO_BASE_CURRENCIES) {
    const baseBookId = await baseBookOf(em, currency);
    const priced = new Set(
      (
        await em.find(
          PriceListMatrixEntry,
          { priceListId: baseBookId, variantId: null, productId: { $in: refs.products.map((p) => p.id) } },
          { fields: ['productId'] },
        )
      ).map((row) => row.productId),
    );
    baseRows += priced.size;
    for (const product of refs.products) {
      const amount = demoBasePrice(product.sku);
      if (amount === null || priced.has(product.id)) continue;
      em.persist(
        em.create(PriceListMatrixEntry, {
          priceListId: baseBookId,
          productId: product.id,
          minQuantity: 1,
          maxQuantity: null,
          priceType: 'fixed',
          amount,
        }),
      );
      baseRows += 1;
    }
    await em.flush();
  }

  // ── the E1–E3 books, each complete and on the demo channel
  const existing = new Set(
    (await em.find(PriceList, { id: { $in: [...DEMO_PRICE_BOOK_IDS] } }, { fields: ['id'] })).map((b) => b.id),
  );
  const books = Object.values(DEMO_PRICE_BOOKS) as readonly DemoBook[];
  for (const spec of books) {
    if (existing.has(spec.id)) continue;
    const book = em.create(PriceList, {
      id: spec.id,
      name: spec.name,
      currency: DEMO_PRICE_CURRENCY,
      priority: 0,
      type: 'regular',
      status: spec.status,
      audienceKind:
        spec.audience === 'everyone' ? 'everyone' : 'organizations' in spec.audience ? 'organizations' : 'customer_groups',
      isSystem: false,
      everActivated: spec.status === 'active',
    });
    em.persist(book);
    // No ORM relation orders the inserts, so the header goes first.
    await em.flush();
    if (spec.audience !== 'everyone') {
      em.persist(
        em.create(PriceListAudienceMember, {
          priceListId: spec.id,
          organizationId: 'organizations' in spec.audience ? refs.acmeOrganizationId : null,
          customerGroupId: 'customerGroups' in spec.audience ? refs.vipCustomerGroupId : null,
        }),
      );
    }
    for (const row of spec.rows) {
      const selection = row.selection;
      const productId = 'product' in selection ? (productBySku.get(selection.product) ?? null) : null;
      if ('product' in selection && productId === null) continue;
      em.persist(
        em.create(PriceListMatrixEntry, {
          priceListId: spec.id,
          productId,
          categoryId: 'category' in selection ? refs.screwsCategoryId : null,
          attributeKey: 'attribute' in selection ? selection.attribute[0] : null,
          attributeValue: 'attribute' in selection ? selection.attribute[1] : null,
          minQuantity: 1,
          maxQuantity: null,
          priceType: row.price.type,
          amount: row.price.type === 'fixed' ? row.price.amount : null,
          percent: row.price.type === 'percent' ? row.price.percent : null,
        }),
      );
    }
    await em.flush();
    // The book's channel set: this module's registered bridge, written on the
    // demo runner's transaction like the composition's other bridge rows.
    await em.execute(
      `insert into "sales_channel_price_lists" ("sales_channel_id", "price_list_id") values (?, ?) on conflict do nothing`,
      [refs.channelId, spec.id],
    );
  }

  // 161 G15 — the books' product lines, as every write of this module keeps them.
  await syncProductLines(em, [...(await em.find(PriceList, { isSystem: true }, { fields: ['id'] })).map((b) => b.id), ...DEMO_PRICE_BOOK_IDS], refs.products.map((p) => p.id));
  await em.execute(`delete from "price_profiles"`);
  return { baseRows, books: books.length };
}

/** Withdraw exactly what {@link seedDemoPriceBooks} wrote. */
export async function withdrawDemoPriceBooks(
  em: EntityManager,
  demoProductIds: readonly string[],
): Promise<DemoPriceBooksResult> {
  // command-coverage-ignore: demo data, reached only by `endora demo seed` /
  // `endora demo reset`, whose entry point calls `mustBeNonProduction()` first
  // (feature 113 contract §2.7); no operator and no audit reader.
  // Rows, members and channel rows cascade with their book.
  const books = await em.nativeDelete(PriceList, { id: { $in: [...DEMO_PRICE_BOOK_IDS] }, isSystem: false });
  const baseRows =
    demoProductIds.length === 0
      ? 0
      : await em.nativeDelete(PriceListMatrixEntry, {
          productId: { $in: [...demoProductIds] },
          priceListId: {
            $in: (await em.find(PriceList, { isSystem: true }, { fields: ['id'] })).map((b) => b.id),
          },
        });
  // 161 G15 — the base books' lines of the withdrawn products (the demo books' cascade with them).
  if (demoProductIds.length > 0) {
    await syncProductLines(em, (await em.find(PriceList, { isSystem: true }, { fields: ['id'] })).map((b) => b.id), demoProductIds);
  }
  await em.execute(`delete from "price_profiles"`);
  return { baseRows, books };
}
