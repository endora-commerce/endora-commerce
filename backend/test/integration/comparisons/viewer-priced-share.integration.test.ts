import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Organization, PriceListPriceBracket, PriceListProduct } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { CUSTOMER_COOKIES } from '../../helpers/test-actors.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';
import { Product } from '../../../src/modules/catalog/entities/product.entity.js';
import { CustomerAccount } from '../../helpers/package-entities.js';
import { PriceListService } from '../../../../packages/modules/price_lists/src/backend/services/price-list-service.js';
import {
  DefaultPriceListMigrator,
  DEFAULT_PRICE_LIST_ID,
} from '../../../../packages/modules/price_lists/src/backend/services/default-price-list-migration.js';
import { neighbourReadPorts } from '../../helpers/price-list-neighbour-ports.js';

/**
 * A share token grants the comparison, never what is in it.
 *
 * One link, four readers, and the same derivation settles both halves of what
 * each of them gets:
 *
 *  - **prices** — the owner their organisation's, a signed-in recipient from
 *    another organisation **their own**, an anonymous recipient the channel's.
 *    That is what makes a shared comparison trustworthy: the numbers on it are
 *    the reader's numbers, not a stranger's.
 *  - **products** — a row the owner restricted to their own organisation is
 *    not disclosed to a recipient outside it, and *is* disclosed to one the
 *    owner allow-listed.
 *
 * The two recipient cases are the ones that can fail alone. Pricing "for the
 * comparison's owner" satisfies the owner and the anonymous reader and is
 * exactly the leak the ruling forbids; hiding restricted rows from everyone
 * who is not the owner satisfies three of the four visibility cases and would
 * hide a distributor's own assortment from the distributor.
 */

const CHANNEL = { 'x-sales-channel': 'pl_retail' };

const OWNER_ORG_ID = '00000000-0000-4000-8000-00000000d0a1';
const RECIPIENT_ORG_ID = '00000000-0000-4000-8000-00000000d0b1';
const ALLOWED_ORG_ID = '00000000-0000-4000-8000-00000000d0c1';
const OWNER_CUSTOMER_ID = '00000000-0000-4000-8000-00000000d0a2';
const RECIPIENT_CUSTOMER_ID = '00000000-0000-4000-8000-00000000d0b2';
const ALLOWED_CUSTOMER_ID = '00000000-0000-4000-8000-00000000d0c2';
const OWNER_COOKIE = 'stub-compare-owner-session';
const RECIPIENT_COOKIE = 'stub-compare-recipient-session';
const ALLOWED_COOKIE = 'stub-compare-allowed-session';

/** Restricted to the owner's organisation and one allow-listed peer. */
const RESTRICTED_SKU = 'CMP-VIEWER-RESTRICTED-0001';

const CHANNEL_AMOUNT = 30;
const OWNER_AMOUNT = 10;
const RECIPIENT_AMOUNT = 20;

interface SharedBody {
  data: {
    pricedFor: 'organization' | 'channel';
    hiddenProductCount: number;
    products: Array<{
      id: string;
      sku: string;
      price: { amount: number; currency: string } | null;
    }>;
  };
  meta: { viewerIsOwner: boolean };
}

describe('a shared comparison is priced for whoever is looking', () => {
  let h: BackendServerHandle;
  let shareToken: string;
  let restrictedProductId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedBuyers(h);
    await seedPriceLists(h);
    restrictedProductId = await seedRestrictedProduct(h);
    shareToken = await mintOwnedComparison(h, restrictedProductId);
  }, 90_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it("shows the owner their own organisation's price, and their restricted row", async () => {
    const body = await openShare(h, shareToken, OWNER_COOKIE);
    expect(body.meta.viewerIsOwner).toBe(true);
    expect(priceOf(body)).toEqual({ amount: OWNER_AMOUNT, currency: 'PLN' });
    expect(body.data.pricedFor).toBe('organization');
    expect(skusOf(body)).toContain(RESTRICTED_SKU);
    expect(body.data.hiddenProductCount).toBe(0);
  });

  it("shows a signed-in recipient THEIR organisation's price, not the owner's", async () => {
    const body = await openShare(h, shareToken, RECIPIENT_COOKIE);
    expect(body.meta.viewerIsOwner).toBe(false);
    expect(priceOf(body)).toEqual({ amount: RECIPIENT_AMOUNT, currency: 'PLN' });
    expect(body.data.pricedFor).toBe('organization');
  });

  it('shows an anonymous recipient the channel price', async () => {
    const body = await openShare(h, shareToken, null);
    expect(body.meta.viewerIsOwner).toBe(false);
    expect(priceOf(body)).toEqual({ amount: CHANNEL_AMOUNT, currency: 'PLN' });
    expect(body.data.pricedFor).toBe('channel');
  });

  it("withholds the owner's restricted product from an anonymous recipient", async () => {
    const body = await openShare(h, shareToken, null);
    expect(skusOf(body)).not.toContain(RESTRICTED_SKU);
    expect(body.data.products.some((p) => p.id === restrictedProductId)).toBe(false);
    // Told, not silently shorter.
    expect(body.data.hiddenProductCount).toBe(1);
  });

  it('withholds it from a signed-in recipient of another organisation', async () => {
    const body = await openShare(h, shareToken, RECIPIENT_COOKIE);
    expect(skusOf(body)).not.toContain(RESTRICTED_SKU);
    expect(body.data.hiddenProductCount).toBe(1);
  });

  it('shows it to a signed-in recipient the owner allow-listed', async () => {
    // The discrimination: the filter is this reader's entitlement, not "hide
    // everything from everyone who is not the owner".
    const body = await openShare(h, shareToken, ALLOWED_COOKIE);
    expect(body.meta.viewerIsOwner).toBe(false);
    expect(skusOf(body)).toContain(RESTRICTED_SKU);
    expect(body.data.hiddenProductCount).toBe(0);
  });

  it("prices the owner's own /me view for their organisation too", async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/comparisons/me',
      headers: { ...CHANNEL, cookie: `b2b_session=${OWNER_COOKIE}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: {
        pricedFor: string;
        products: Array<{ id: string; price: { amount: number } | null }>;
      };
    };
    expect(body.data.pricedFor).toBe('organization');
    expect(
      body.data.products.find((p) => p.id === SEED_PRODUCT_101_ID)?.price?.amount,
    ).toBe(OWNER_AMOUNT);
  });
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function priceOf(body: SharedBody): { amount: number; currency: string } | null {
  return body.data.products.find((p) => p.id === SEED_PRODUCT_101_ID)?.price ?? null;
}

function skusOf(body: SharedBody): string[] {
  return body.data.products.map((p) => p.sku);
}

async function openShare(
  h: BackendServerHandle,
  token: string,
  cookie: string | null,
): Promise<SharedBody> {
  const res = await h.app.inject({
    method: 'GET',
    url: `/api/v1/comparisons/share/${token}`,
    headers: cookie ? { ...CHANNEL, cookie: `b2b_session=${cookie}` } : CHANNEL,
  });
  expect(res.statusCode).toBe(200);
  return res.json() as SharedBody;
}

async function seedBuyers(h: BackendServerHandle): Promise<void> {
  const em = h.em();
  const buyers = [
    [OWNER_ORG_ID, OWNER_CUSTOMER_ID, 'compare-owner@example.test', OWNER_COOKIE],
    [RECIPIENT_ORG_ID, RECIPIENT_CUSTOMER_ID, 'compare-recipient@example.test', RECIPIENT_COOKIE],
    [ALLOWED_ORG_ID, ALLOWED_CUSTOMER_ID, 'compare-allowed@example.test', ALLOWED_COOKIE],
  ] as const;
  for (const [orgId] of buyers) {
    em.create(Organization, {
      id: orgId,
      name: `Compare ${orgId.slice(-4)}`,
      taxId: `PL${orgId.slice(-10)}`,
      status: 'active',
      vatStatus: 'vat_payer',
      registeredAddress: {
        street: 'ul. Testowa 1',
        city: 'Warszawa',
        postalCode: '00-001',
        country: 'PL',
      },
    });
  }
  // Flushed on its own: the accounts below carry a foreign key to these rows.
  await em.flush();

  for (const [orgId, customerId, email, cookie] of buyers) {
    em.create(CustomerAccount, {
      id: customerId,
      organizationId: orgId,
      email,
      passwordHash: 'not-used-by-the-stub-cookie-path',
      firstName: 'Compare',
      lastName: 'Buyer',
      role: 'organization_admin',
      emailVerifiedAt: new Date(),
    });
    CUSTOMER_COOKIES[cookie] = { customerAccountId: customerId, organizationId: orgId };
  }
  await em.flush();
}

/**
 * A product only the owner's organisation and one allow-listed peer may see.
 * The owner may add it — `addProduct` runs the same predicate — which is what
 * makes the recipient cases about a *second* reader's entitlement rather than
 * about bad data.
 */
async function seedRestrictedProduct(h: BackendServerHandle): Promise<string> {
  const em = h.em();
  const product = em.create(Product, {
    sku: RESTRICTED_SKU,
    slug: RESTRICTED_SKU.toLowerCase(),
    type: 'simple',
    status: 'active',
    name: { 'en-US': 'Restricted comparison probe' },
    description: { 'en-US': '' },
    visibility: 'organization_restricted',
    allowedOrganizationIds: [OWNER_ORG_ID, ALLOWED_ORG_ID],
    attributeValues: { defaultPrice: 5 },
  });
  await em.persistAndFlush(product);
  // Publish it on the channel this file shops (issue #259). A comparison
  // column is an acquisition and is refused on a channel that does not sell
  // the row, so a probe bound to no channel could not be added at all — and
  // this file is about the *visibility* axis, which presupposes the product is
  // on the channel to begin with.
  const retail = await em.findOne(SalesChannel, { code: 'pl_retail' });
  if (!retail) throw new Error('the harness seeds pl_retail');
  await em
    .getConnection()
    .execute(
      `insert into sales_channel_products (sales_channel_id, product_id) values (?, ?) ` +
        `on conflict (sales_channel_id, product_id) do nothing`,
      [retail.id, product.id],
    );
  return product.id;
}

/**
 * One product on three lists: the platform default (what the channel quotes)
 * and one per organisation. Distinct amounts, so a view priced for the wrong
 * buyer names the buyer it was priced for.
 */
async function seedPriceLists(h: BackendServerHandle): Promise<void> {
  // Scoped to this file's own product (issue #166): emptying `price_lists`
  // would be a claim about the platform, and the two amounts below are only
  // meaningful against whatever else the platform is already serving.
  const em = h.em();
  await em.nativeDelete(PriceListPriceBracket, { productId: SEED_PRODUCT_101_ID });
  await em.nativeDelete(PriceListProduct, { productId: SEED_PRODUCT_101_ID });
  await new DefaultPriceListMigrator(h.em).seedDefault();
  const svc = new PriceListService(h.em, undefined, undefined, undefined, neighbourReadPorts(h.em));

  await svc.addProduct(DEFAULT_PRICE_LIST_ID, SEED_PRODUCT_101_ID);
  await svc.replaceBrackets(DEFAULT_PRICE_LIST_ID, SEED_PRODUCT_101_ID, {
    PLN: [{ minQuantity: 1, maxQuantity: null, amount: CHANNEL_AMOUNT.toFixed(2) }],
  });

  for (const [orgId, amount] of [
    [OWNER_ORG_ID, OWNER_AMOUNT],
    [RECIPIENT_ORG_ID, RECIPIENT_AMOUNT],
  ] as const) {
    const list = await svc.create({
      name: `Negotiated ${orgId.slice(-4)}`,
      type: 'base',
      applicationRule: { kind: 'criterion', type: 'organization', values: [orgId] },
    });
    await svc.addProduct(list.id, SEED_PRODUCT_101_ID);
    await svc.replaceBrackets(list.id, SEED_PRODUCT_101_ID, {
      PLN: [{ minQuantity: 1, maxQuantity: null, amount: amount.toFixed(2) }],
    });
    await svc.activate(list.id);
  }
}

async function mintOwnedComparison(
  h: BackendServerHandle,
  restrictedProductId: string,
): Promise<string> {
  let shareToken = '';
  for (const productId of [SEED_PRODUCT_101_ID, restrictedProductId]) {
    const added = await h.app.inject({
      method: 'POST',
      url: '/api/v1/comparisons/me/products',
      headers: {
        ...CHANNEL,
        'content-type': 'application/json',
        cookie: `b2b_session=${OWNER_COOKIE}`,
      },
      payload: { productId },
    });
    expect(added.statusCode).toBe(200);
    shareToken = (added.json() as { data: { shareToken: string } }).data.shareToken;
  }
  return shareToken;
}
