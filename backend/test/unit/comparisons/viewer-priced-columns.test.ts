import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it } from 'vitest';
import {
  ANONYMOUS_PRODUCT_AUDIENCE,
  type CatalogAttributeReadPort,
  type CatalogAttributeView,
  type CatalogGalleryPort,
  type CatalogProductReadPort,
  type CatalogProductRecord,
  type ListingPrice,
  type ListingPricePort,
  type OrganizationDetailsPort,
  type OrganizationRecord,
  type PriceOrganization,
  type ProductAudience,
} from '@b2b/contracts';
import type { SettingsService } from '../../../src/kernel/settings/settings.service.js';
import type { SalesChannelMembershipPort } from '../../../src/kernel/ports/sales-channel.js';
import { ComparableAttributeProjection } from '../../../src/modules/comparisons/services/comparable-attribute-projection.js';
import {
  ComparisonService,
  type ComparisonViewer,
} from '../../../src/modules/comparisons/services/comparison-service.js';
import { ShareTokenGenerator } from '../../../src/modules/comparisons/services/share-token-generator.js';

/**
 * Issue #259 — `addProduct` narrows to the channel it was handed, through the
 * kernel bridge accessor. These cases never reach that call (the product is
 * absent, or the exercise is a read), so a port that throws on every method is
 * the assertion that they do not.
 */
const refusingChannelMembership = new Proxy(
  {},
  {
    get: (_target, property) => () => {
      throw new Error(`comparisons unexpectedly called the channel bridge.${String(property)}`);
    },
  },
) as SalesChannelMembershipPort;


/**
 * The viewer's identity decides the price a comparison column shows.
 *
 * A share token decides *which products* are in the comparison, never *which
 * prices* are shown, so the three viewers of one comparison get three answers:
 * the owner sees their organisation's, a signed-in recipient from another
 * organisation sees **theirs**, and an anonymous recipient sees the channel's.
 * The middle case is the one that proves the token carries no pricing
 * identity — a service that simply priced "for the comparison's owner" would
 * pass the other two.
 *
 * The prices themselves are the pricing engine's; what these cases assert is
 * the *context* this module hands it, which is the whole of the decision it
 * owns.
 */

const OWNER_ORG_ID = '00000000-0000-4000-8000-00000000c0a1';
const RECIPIENT_ORG_ID = '00000000-0000-4000-8000-00000000c0b1';
const OWNER_GROUP_ID = '00000000-0000-4000-8000-00000000c0a2';

const COMPARISON = {
  id: 'cmp-1',
  shareToken: 'tok-12345678',
  displayMode: 'all',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
} as never;

function productRecord(id: string): CatalogProductRecord {
  return {
    id,
    sku: `SKU-${id}`,
    slug: `slug-${id}`,
    type: 'simple',
    status: 'active',
    name: { en: `Product ${id}` },
    description: {},
    stockMode: null,
    visibility: 'public',
    attributeValues: {},
    allowedOrganizationIds: [],
    attributeSetId: 'set-1',
    downloadAssetId: null,
    downloadUrl: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    archivedAt: null,
    deletedAt: null,
    manageStock: false,
    backorderEnabled: false,
    lowStockThreshold: null,
    lowStockThresholdMode: 'cumulative',
    fulfilmentStrategy: null,
    fulfilmentStrategyWarehouseOrder: null,
  };
}

function organizationRecord(
  id: string,
  customerGroupId: string | null,
): OrganizationRecord {
  return {
    id,
    name: `Org ${id}`,
    legalName: null,
    taxId: 'PL0000000000',
    status: 'active',
    vatStatus: 'vat_payer',
    isPersonal: false,
    customerGroupId,
    registeredAddress: {
      street: 'ul. Testowa 1',
      city: 'Warszawa',
      postalCode: '00-001',
      country: 'PL',
    },
    orderConfirmationEmails: [],
    vatValidatedAt: null,
    vatValidationProvider: null,
    vatValidationOutcome: null,
    blockedReason: null,
    blockedAt: null,
    rejectedReason: null,
    rejectedAt: null,
    approvedAt: null,
    approvedByAdminUserId: null,
    requiresCartApproval: false,
    fulfilmentStrategy: null,
    fulfilmentStrategyWarehouseOrder: null,
    parentId: null,
    path: `/${id}/`,
    creditInheritanceMode: null,
    customFieldValues: {},
    version: 1,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
  };
}

function fakeEm(): () => EntityManager {
  const em = {
    findOne: async (entity: { name?: string }) =>
      entity.name === 'SalesChannel'
        ? { id: 'channel-1', defaultCurrency: 'PLN', isPublic: true }
        : null,
    find: async (entity: { name?: string }) =>
      entity.name === 'ComparisonProduct'
        ? [{ productId: 'prod-1', position: 0, addedAt: new Date('2026-02-01T00:00:00.000Z') }]
        : [],
    getConnection: () => ({ execute: async () => [] }),
  };
  return () => em as unknown as EntityManager;
}

const settingsStub = { get: async () => 4 } as unknown as SettingsService;

/**
 * Feature 075 / D-87 — `catalog`'s gallery port. These cases are about
 * entitlement and prices, so a port that answers "no base image" for every
 * requested id is all they need from it; the map holding one entry per
 * requested id is the part of the contract the view indexes on.
 */
const imagelessGallery = {
  baseImageUrls: async (ids: readonly string[]) =>
    new Map<string, string | null>(ids.map((id) => [id, null])),
} as unknown as CatalogGalleryPort;

const attributePortStub: CatalogAttributeReadPort = {
  listAll: async () => [],
  getByIdOrKey: async () => null,
  listByFlag: async () => [] as CatalogAttributeView[],
  optionLabelIndex: async () => new Map(),
};

const catalogProductsStub: CatalogProductReadPort = {
  findById: async () => null,
  findByIds: async (ids) => ids.map((id) => productRecord(id)),
  findBySku: async () => null,
  findBySkus: async () => [],
  countByIds: async () => 0,
  listAll: async () => [],
  listVariantsByProductIds: async () => [],
  findVariantsBySkus: async () => [],
  findVariantInProduct: async () => null,
  findPackagingUnitInProduct: async () => null,
  listLinksBySourceIds: async () => [],
  listValueOverridesByProductIds: async () => [],
};

/**
 * A pricing port that answers per organisation, so a context that lost the
 * viewer shows up as the wrong figure rather than only as a missing field.
 */
function pricingByOrganization(
  amounts: Record<string, string>,
  seen: Array<PriceOrganization | null | undefined>,
): ListingPricePort {
  return {
    resolveListingPrices: async (input) => {
      seen.push(input.context.organization);
      const key = input.context.organization?.id ?? 'channel';
      const out = new Map<string, ListingPrice>();
      for (const product of input.products) {
        out.set(product.id, {
          source: 'price_list',
          amount: amounts[key] ?? amounts['channel']!,
          currency: 'PLN',
          priceListId: `list-${key}`,
          isSale: false,
        });
      }
      return out;
    },
  };
}

function organizationsPort(
  records: Record<string, OrganizationRecord>,
  asked: string[] = [],
): OrganizationDetailsPort {
  return {
    findById: async (id) => {
      asked.push(id);
      return records[id] ?? null;
    },
    findByIds: async () => [],
    countByIds: async () => 0,
    searchByName: async () => [],
    searchIdsByName: async () => [],
  };
}

function serviceWith(
  listingPrices: ListingPricePort,
  organizations: OrganizationDetailsPort,
): ComparisonService {
  return new ComparisonService(
    fakeEm(),
    new ComparableAttributeProjection(),
    new ShareTokenGenerator(),
    catalogProductsStub,
    refusingChannelMembership,
    imagelessGallery,
    settingsStub,
    attributePortStub,
    listingPrices,
    organizations,
  );
}

const AMOUNTS = {
  channel: '30.00',
  [OWNER_ORG_ID]: '10.00',
  [RECIPIENT_ORG_ID]: '20.00',
};

const ORGANIZATIONS = {
  [OWNER_ORG_ID]: organizationRecord(OWNER_ORG_ID, OWNER_GROUP_ID),
  [RECIPIENT_ORG_ID]: organizationRecord(RECIPIENT_ORG_ID, null),
};

const audienceOf = (organizationId: string | null, authenticated: boolean): ProductAudience => ({
  organizationId,
  authenticated,
});

const signedIn = (organizationId: string): ComparisonViewer => ({
  kind: 'buyer',
  audience: audienceOf(organizationId, true),
});

const anonymous: ComparisonViewer = {
  kind: 'buyer',
  audience: ANONYMOUS_PRODUCT_AUDIENCE,
};

describe('comparison columns are priced for the viewer', () => {
  it("prices the owner's own view for the owner's organisation", async () => {
    const seen: Array<PriceOrganization | null | undefined> = [];
    const service = serviceWith(
      pricingByOrganization(AMOUNTS, seen),
      organizationsPort(ORGANIZATIONS),
    );

    const view = await service.buildOwnerView(
      COMPARISON,
      'channel-1',
      signedIn(OWNER_ORG_ID),
    );

    expect(seen).toEqual([{ id: OWNER_ORG_ID, customerGroupId: OWNER_GROUP_ID }]);
    expect(view.products[0]?.price?.amount).toBe(10);
    expect(view.pricedFor).toBe('organization');
  });

  it("prices a signed-in recipient's view for THEIR organisation, not the owner's", async () => {
    const seen: Array<PriceOrganization | null | undefined> = [];
    const service = serviceWith(
      pricingByOrganization(AMOUNTS, seen),
      organizationsPort(ORGANIZATIONS),
    );

    // The same comparison the owner created — only the viewer differs.
    const view = await service.buildOwnerView(
      COMPARISON,
      'channel-1',
      signedIn(RECIPIENT_ORG_ID),
    );

    expect(seen).toEqual([{ id: RECIPIENT_ORG_ID, customerGroupId: null }]);
    expect(view.products[0]?.price?.amount).toBe(20);
    expect(view.pricedFor).toBe('organization');
  });

  it('prices an anonymous recipient at the channel price', async () => {
    const seen: Array<PriceOrganization | null | undefined> = [];
    const service = serviceWith(
      pricingByOrganization(AMOUNTS, seen),
      organizationsPort(ORGANIZATIONS),
    );

    const view = await service.buildOwnerView(
      COMPARISON,
      'channel-1',
      anonymous,
    );

    expect(seen).toEqual([null]);
    expect(view.products[0]?.price?.amount).toBe(30);
    expect(view.pricedFor).toBe('channel');
  });

  it('prices at the channel price for a signed-in buyer with no organisation', async () => {
    // Feature 026's guest-style account: authenticated, no Organization. The
    // audience's two fields exist to keep this caller apart from the crawler,
    // and for pricing both get the same answer — there is no negotiated list
    // to resolve against.
    const seen: Array<PriceOrganization | null | undefined> = [];
    const service = serviceWith(
      pricingByOrganization(AMOUNTS, seen),
      organizationsPort(ORGANIZATIONS),
    );

    const view = await service.buildOwnerView(COMPARISON, 'channel-1', {
      kind: 'buyer',
      audience: audienceOf(null, true),
    });

    expect(seen).toEqual([null]);
    expect(view.pricedFor).toBe('channel');
  });

  it('falls back to the channel price when the viewer names an organisation that is gone', async () => {
    const seen: Array<PriceOrganization | null | undefined> = [];
    const asked: string[] = [];
    const service = serviceWith(
      pricingByOrganization(AMOUNTS, seen),
      organizationsPort({}, asked),
    );

    const view = await service.buildOwnerView(
      COMPARISON,
      'channel-1',
      signedIn(OWNER_ORG_ID),
    );

    expect(asked).toEqual([OWNER_ORG_ID]);
    expect(seen).toEqual([null]);
    // And it says so, rather than labelling a channel figure as the buyer's.
    expect(view.pricedFor).toBe('channel');
  });

  it('defaults to the anonymous viewer when a caller supplies none', async () => {
    const seen: Array<PriceOrganization | null | undefined> = [];
    const service = serviceWith(
      pricingByOrganization(AMOUNTS, seen),
      organizationsPort(ORGANIZATIONS),
    );

    const view = await service.buildOwnerView(COMPARISON, 'channel-1');

    expect(seen).toEqual([null]);
    expect(view.pricedFor).toBe('channel');
  });
});

/**
 * The same derivation, one step earlier: a share token grants access to the
 * **comparison**, never to what is in it.
 *
 * The owner may put a product restricted to their own organisation into a
 * comparison — `addProduct` checks that when they add it — and then send the
 * link to anyone. So the products are filtered by the *viewer's* entitlement
 * before they are priced, which is also the only sensible order: a price is
 * not resolved for a row the reader may not see.
 *
 * The allow-listed recipient is the case that discriminates. Without it, an
 * implementation that simply hides restricted products from every non-owner
 * passes — and that is a different rule, one that would hide a distributor's
 * own assortment from the distributor.
 */

const ALLOWED_ORG_ID = '00000000-0000-4000-8000-00000000c0c1';

function restrictedProduct(id: string, allowed: string[]): CatalogProductRecord {
  return { ...productRecord(id), visibility: 'organization_restricted', allowedOrganizationIds: allowed };
}

function fakeEmWith(productIds: readonly string[]): () => EntityManager {
  const em = {
    findOne: async (entity: { name?: string }) =>
      entity.name === 'SalesChannel'
        ? { id: 'channel-1', defaultCurrency: 'PLN', isPublic: true }
        : null,
    find: async (entity: { name?: string }) =>
      entity.name === 'ComparisonProduct'
        ? productIds.map((productId, position) => ({
            productId,
            position,
            addedAt: new Date('2026-02-01T00:00:00.000Z'),
          }))
        : [],
    getConnection: () => ({ execute: async () => [] }),
  };
  return () => em as unknown as EntityManager;
}

/** One public product and one restricted to `ALLOWED_ORG_ID` and the owner. */
function mixedVisibilityService(priced: string[][]): ComparisonService {
  const records: Record<string, CatalogProductRecord> = {
    'prod-public': productRecord('prod-public'),
    'prod-restricted': restrictedProduct('prod-restricted', [OWNER_ORG_ID, ALLOWED_ORG_ID]),
  };
  const catalogProducts: CatalogProductReadPort = {
    ...catalogProductsStub,
    findByIds: async (ids) => ids.map((id) => records[id]!).filter(Boolean),
  };
  const listingPrices: ListingPricePort = {
    resolveListingPrices: async (input) => {
      priced.push(input.products.map((p) => p.id));
      const out = new Map<string, ListingPrice>();
      for (const product of input.products) {
        out.set(product.id, {
          source: 'price_list',
          amount: '10.00',
          currency: 'PLN',
          priceListId: 'list-1',
          isSale: false,
        });
      }
      return out;
    },
  };
  return new ComparisonService(
    fakeEmWith(['prod-public', 'prod-restricted']),
    new ComparableAttributeProjection(),
    new ShareTokenGenerator(),
    catalogProducts,
    refusingChannelMembership,
    imagelessGallery,
    settingsStub,
    attributePortStub,
    listingPrices,
    organizationsPort({
      ...ORGANIZATIONS,
      [ALLOWED_ORG_ID]: organizationRecord(ALLOWED_ORG_ID, null),
    }),
  );
}

describe('a share token grants the comparison, not what is in it', () => {
  it("shows the owner the product restricted to the owner's organisation", async () => {
    const priced: string[][] = [];
    const view = await mixedVisibilityService(priced).buildOwnerView(
      COMPARISON,
      'channel-1',
      signedIn(OWNER_ORG_ID),
    );

    expect(view.products.map((p) => p.id)).toEqual(['prod-public', 'prod-restricted']);
    expect(view.hiddenProductCount).toBe(0);
  });

  it('withholds it from an anonymous recipient, and says how many are withheld', async () => {
    const priced: string[][] = [];
    const view = await mixedVisibilityService(priced).buildOwnerView(
      COMPARISON,
      'channel-1',
      anonymous,
    );

    expect(view.products.map((p) => p.id)).toEqual(['prod-public']);
    expect(view.hiddenProductCount).toBe(1);
    // Not priced either: a price resolved for a row the reader may not see is
    // work done to produce a figure that must not be sent.
    expect(priced).toEqual([['prod-public']]);
  });

  it('withholds it from a signed-in recipient of another organisation', async () => {
    const priced: string[][] = [];
    const view = await mixedVisibilityService(priced).buildOwnerView(
      COMPARISON,
      'channel-1',
      signedIn(RECIPIENT_ORG_ID),
    );

    expect(view.products.map((p) => p.id)).toEqual(['prod-public']);
    expect(view.hiddenProductCount).toBe(1);
  });

  it('shows it to a signed-in recipient who is on the allow-list', async () => {
    // The discrimination: the filter is the audience's, not "hide everything
    // from anyone who is not the owner".
    const priced: string[][] = [];
    const view = await mixedVisibilityService(priced).buildOwnerView(
      COMPARISON,
      'channel-1',
      signedIn(ALLOWED_ORG_ID),
    );

    expect(view.products.map((p) => p.id)).toEqual(['prod-public', 'prod-restricted']);
    expect(view.hiddenProductCount).toBe(0);
  });

  it('shows an administrator every row, at the channel price', async () => {
    // The admin audit screen answers "what did this customer put in their
    // comparison?", and an administrator has no buying organisation for the
    // predicate to match. Filtering it by the anonymous audience would drop
    // exactly the rows the screen exists to show.
    const priced: string[][] = [];
    const view = await mixedVisibilityService(priced).buildOwnerView(
      COMPARISON,
      'channel-1',
      { kind: 'administrator' },
    );

    expect(view.products.map((p) => p.id)).toEqual(['prod-public', 'prod-restricted']);
    expect(view.hiddenProductCount).toBe(0);
    expect(view.pricedFor).toBe('channel');
  });
});
