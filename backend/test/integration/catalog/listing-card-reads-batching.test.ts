import type { Knex } from '@mikro-orm/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  RICH_CORPUS_AMOUNT,
  seedRichListingCorpus,
  type RichListingCorpus,
} from '../../helpers/rich-listing-corpus.js';
import { Product } from '../../../src/modules/catalog/entities/product.entity.js';

/**
 * A listing card's asset and its category slugs are read **for the page**, and
 * the page they are read for is the one the viewer may see.
 *
 * Two claims, and they need each other. Issue #263 hoisted three per-card reads
 * — the gallery, the legacy `product_assets` fallback and the category-slug
 * join — out of `toSummary` and up to `listProducts`, which is what makes the
 * page cost the same whatever its size. But a batched read is exactly the shape
 * that widens what a viewer sees: the per-card version could only ask about a
 * product that had already survived the channel filter and
 * `isProductVisibleTo`, while a page-wide `in (…)` asks about whatever id list
 * the caller assembled. MR !811 found that shape leaking invoice data across
 * organisations, so the id list is asserted here rather than reasoned about.
 *
 * ## Why the corpus is what it is
 *
 * `viewer-priced-fixture.ts` pins the per-card **values** over two cards. This
 * file pins the per-page **cost** and the per-page **scope**, which needs a
 * corpus wide enough for a per-card read to be visible as one and rows in every
 * table the card reads — see the header of `rich-listing-corpus.ts` for what a
 * bare-`Product` corpus hides.
 *
 * The measurement is the count of statements the page issues, taken at two page
 * sizes. A **constant** is the assertion rather than a ceiling: a re-opened
 * per-card read costs one statement per card, so it moves the difference
 * between the two counts off zero no matter how the absolute number is tuned,
 * and it cannot be made to pass by raising a budget.
 */

const CORPUS_SIZE = 24;
/** Every fourth product is `organization_restricted`, allow-listed to one org. */
const RESTRICTED_EVERY = 4;
const PREFIX = 'RICHCARD';
const SMALL_PAGE = 6;
/**
 * One wider than the corpus, so the over-fetch that detects `hasMore` covers
 * every row the query matches — including the off-channel one seeded below,
 * which would otherwise take a real card's place in the fetch and make the
 * page's size a statement about the over-fetch rather than about the filters.
 */
const FULL_PAGE = CORPUS_SIZE + 2;
const SIGNED_IN = { b2b_session: 'stub-customer-session' };
const RETAIL_CHANNEL = { 'x-sales-channel': 'pl_retail' };

interface Card {
  id: string;
  sku: string;
  categorySlugs: string[];
  primaryAssetUrl: string | null;
  price: { amount: number; currency: string } | null;
}

interface Statement {
  sql: string;
  bindings: readonly unknown[];
}

describe("a listing page reads its cards' assets and categories once, for the viewer", () => {
  let h: BackendServerHandle;
  let corpus: RichListingCorpus;
  /** Public, active, matches the query — and belongs to no sales channel. */
  let offChannelProductId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    corpus = await seedRichListingCorpus(em, CORPUS_SIZE, {
      restrictedEvery: RESTRICTED_EVERY,
      prefix: PREFIX,
    });
    // The other scoping axis (Principle XII). It is seeded here rather than in
    // the corpus helper because a corpus of channel members is what every other
    // caller wants; what this file needs is one row that the channel filter,
    // and only the channel filter, keeps off the page.
    const offChannel = em.create(Product, {
      sku: `${PREFIX}-OFF-CHANNEL`,
      slug: `${PREFIX.toLowerCase()}-off-channel`,
      type: 'simple',
      status: 'active',
      name: { 'en-US': 'Off-channel card' },
      description: { 'en-US': 'Belongs to no sales channel.' },
      visibility: 'public',
      allowedOrganizationIds: [],
      attributeValues: {},
    });
    await em.persistAndFlush(offChannel);
    offChannelProductId = offChannel.id;
  }, 120_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function page(
    limit: number,
    cookies?: Record<string, string>,
  ): Promise<{ cards: Card[]; statements: Statement[] }> {
    const url = `/api/v1/catalog/products?q=${PREFIX}&limit=${limit}`;
    const inject = async (): Promise<Awaited<ReturnType<typeof h.app.inject>>> =>
      h.app.inject({
        method: 'GET',
        url,
        headers: RETAIL_CHANNEL,
        ...(cookies ? { cookies } : {}),
      });

    // Warm first: the pricing resolution keeps an LRU, and a cold page would
    // count the entries it filled rather than the reads a card needs.
    await inject();

    const statements: Statement[] = [];
    const knex: Knex = h.em().getConnection().getKnex();
    const capture = (query: { sql: string; bindings?: readonly unknown[] }): void => {
      statements.push({ sql: query.sql, bindings: query.bindings ?? [] });
    };
    knex.on('query', capture);
    const res = await inject();
    knex.off('query', capture);

    expect(res.statusCode).toBe(200);
    // The subject is the Postgres listing. The Meilisearch-backed one projects
    // its card from the index document and is a different question.
    expect(res.headers['x-search-backend']).toBe('postgres');
    const body = res.json() as { data: Card[] };
    return { cards: body.data, statements };
  }

  /**
   * The statements that read a card's asset or its category slugs — the three
   * issue #263 hoisted, plus the two `assets` reads they make through
   * `assets_library`'s port, which is where a page-wide id list actually
   * reaches another module's table.
   */
  function cardReadStatements(statements: Statement[]): Statement[] {
    return statements.filter(
      (s) =>
        s.sql.includes('gallery_items') ||
        s.sql.includes('product_assets') ||
        s.sql.includes('product_categories') ||
        /from "assets"/.test(s.sql),
    );
  }

  /**
   * Every id those statements named — read out of the **SQL text** as well as
   * out of the parameter list, because MikroORM formats an `in (…)` with its
   * values inline and hands knex an empty `bindings` array. A version of this
   * helper that read `bindings` alone returned an empty set for every request,
   * which made the anonymous assertion below (`not.toContain`) pass without
   * looking at anything. That is what the signed-in mirror is for: the two
   * tests run the same extraction over the same corpus, and only one of them
   * can be satisfied by silence.
   */
  function idsNamedBy(statements: Statement[]): Set<string> {
    const out = new Set<string>();
    const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
    for (const statement of statements) {
      for (const match of statement.sql.matchAll(uuid)) out.add(match[0].toLowerCase());
      for (const binding of statement.bindings) {
        if (typeof binding === 'string') out.add(binding.toLowerCase());
      }
    }
    return out;
  }

  it('costs the same number of statements at a small page as at a full one', async () => {
    const small = await page(SMALL_PAGE);
    const full = await page(FULL_PAGE);

    // Non-vacuity, before any count is trusted (issue #140): both pages have
    // cards, the small one is genuinely smaller, and every card carries the rows
    // the reads under measurement read. A corpus with no gallery, no legacy
    // asset row and no category assignment issues three of these statements
    // against an empty id list and skips the two `assets` reads altogether.
    //
    // The small page's size is a range rather than a number because the
    // anonymous page is narrowed **after** the fetch: it comes back short of its
    // limit by however many restricted rows the over-fetch reached.
    expect(small.cards.length).toBeGreaterThan(0);
    expect(small.cards.length).toBeLessThanOrEqual(SMALL_PAGE);
    expect(small.cards.length).toBeLessThan(CORPUS_SIZE - CORPUS_SIZE / RESTRICTED_EVERY);
    expect(full.cards.length).toBe(CORPUS_SIZE - CORPUS_SIZE / RESTRICTED_EVERY);
    expect(full.cards.every((c) => c.primaryAssetUrl !== null)).toBe(true);
    expect(full.cards.every((c) => c.categorySlugs.length === 2)).toBe(true);
    expect(cardReadStatements(full.statements).length).toBeGreaterThanOrEqual(5);
    // Both pages resolve their cards through **both** arms of the asset chain.
    // Without this the count is not comparable: the gallery arm's
    // `assets.findByIds` is skipped when no card on the page has a gallery, so
    // two pages that differ in composition legitimately differ by a statement,
    // and the constancy below would be measuring the corpus rather than the
    // code. The corpus alternates the two arms and fixes `created_at`, which is
    // what makes this hold for every page size, not just this pair.
    for (const cost of [small, full]) {
      expect(cost.cards.some((c) => c.primaryAssetUrl?.endsWith('-thumbnail.svg'))).toBe(true);
      expect(cost.cards.some((c) => c.primaryAssetUrl?.endsWith('-legacy.svg'))).toBe(true);
    }

    expect(full.statements.length).toBe(small.statements.length);
  });

  it('renders every card its own asset and its own category slugs', async () => {
    const { cards } = await page(FULL_PAGE);

    for (const card of cards) {
      expect({
        sku: card.sku,
        primaryAssetUrl: card.primaryAssetUrl,
        categorySlugs: card.categorySlugs,
        price: card.price,
      }).toEqual({
        sku: card.sku,
        primaryAssetUrl: corpus.expectedAssetUrl.get(card.id),
        categorySlugs: corpus.expectedCategorySlugs.get(card.id),
        price: { amount: RICH_CORPUS_AMOUNT, currency: 'PLN' },
      });
    }
    // Both arms of the primary-asset chain were exercised on one page: the
    // gallery's `thumbnail` label for half the cards, the legacy
    // `product_assets` fallback for the other half.
    expect(cards.filter((c) => c.primaryAssetUrl?.endsWith('-thumbnail.svg')).length).toBeGreaterThan(0);
    expect(cards.filter((c) => c.primaryAssetUrl?.endsWith('-legacy.svg')).length).toBeGreaterThan(0);
  });

  it('never asks for the asset or the categories of a product the viewer may not see', async () => {
    const { cards, statements } = await page(FULL_PAGE);
    const named = idsNamedBy(cardReadStatements(statements));

    expect(corpus.restrictedProductIds.length).toBeGreaterThan(0);
    // The channel axis, on the same page and through the same statements: a row
    // no channel carries is never asked about either, for any viewer.
    expect(cards.map((c) => c.id)).not.toContain(offChannelProductId);
    expect(named).not.toContain(offChannelProductId);
    for (const restricted of corpus.restrictedProductIds) {
      expect(cards.map((c) => c.id)).not.toContain(restricted);
      // The product id itself — the key of the slug join and of both asset
      // reads' bridge queries.
      expect(named).not.toContain(restricted);
    }
    // The extraction is not silent: the *visible* cards are all named by those
    // same statements, so the restricted rows' absence is an absence from a set
    // that was populated.
    for (const card of cards) {
      expect(named).toContain(card.id);
    }
    // And the asset rows behind them: a page that asked `assets_library` for a
    // url it then dropped would still have read another module's row for a
    // product this caller may not know exists.
    for (const restricted of corpus.restrictedProductIds) {
      expect(named).not.toContain(corpus.expectedAssetId.get(restricted));
    }
  });

  it('asks for exactly those products for the buyer they are allow-listed to', async () => {
    const { cards, statements } = await page(FULL_PAGE, SIGNED_IN);
    const named = idsNamedBy(cardReadStatements(statements));

    // The mirror image of the previous test, and the reason it is not passing
    // for a trivial reason: with the same corpus and the same page size, the
    // restricted rows *are* read — so the anonymous page's silence about them
    // is this caller's audience being applied, not the batch having dropped
    // them for everybody.
    expect(cards.map((c) => c.id)).not.toContain(offChannelProductId);
    expect(named).not.toContain(offChannelProductId);
    for (const restricted of corpus.restrictedProductIds) {
      expect(cards.map((c) => c.id)).toContain(restricted);
      expect(named).toContain(restricted);
      expect(named).toContain(corpus.expectedAssetId.get(restricted));
    }
    expect(cards.length).toBe(CORPUS_SIZE);
    for (const card of cards) {
      expect(card.primaryAssetUrl).toBe(corpus.expectedAssetUrl.get(card.id));
      expect(card.categorySlugs).toEqual(corpus.expectedCategorySlugs.get(card.id));
    }
  });
});
