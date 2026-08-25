import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it } from 'vitest';
import type {
  CatalogAttributeReadPort,
  CatalogAttributeView,
  CatalogGalleryPort,
  CatalogProductReadPort,
  CatalogProductRecord,
  CustomerAccountReadPort,
  CustomerAccountRecord,
} from '@endora-commerce/contracts';
import type { SettingsService } from '../../../src/kernel/settings/settings.service.js';
import type { SalesChannelMembershipPort } from '../../../src/kernel/ports/sales-channel.js';
import { ComparableAttributeProjection } from '../../../../packages/modules/comparisons/src/backend/services/comparable-attribute-projection.js';
import { ComparisonAdminService } from '../../../../packages/modules/comparisons/src/backend/services/comparison-admin.service.js';
import {
  ComparisonService,
  ProductNotFoundError,
  type ComparisonOwner,
} from '../../../../packages/modules/comparisons/src/backend/services/comparison-service.js';
import { ShareTokenGenerator } from '../../../../packages/modules/comparisons/src/backend/services/share-token-generator.js';

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
 * Feature 075, Phase C — `comparisons` asks `catalog` and `customer_accounts`
 * for their rows instead of querying their tables (FR-012).
 *
 * Both reads used to be `em.find(<their entity>, …)` from inside this module,
 * which is the shape Principle XVII cannot gate: deactivation drops no tables,
 * so a comparison kept resolving product names and owner e-mails out of a
 * module an operator had switched off. Through a port the same read answers
 * 503 `MODULE_DISABLED`, and both edges are binding dependencies this module's
 * manifest already declares.
 *
 * These cases assert the demand, not the plumbing: an `EntityManager` that
 * **refuses** to serve a foreign entity, plus stub ports, must be enough. A
 * fake that would notice the old query is what makes the test able to fail.
 */

const OWNER: ComparisonOwner = { kind: 'customer', customerAccountId: 'cust-1' };

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

function accountRecord(id: string, email: string): CustomerAccountRecord {
  return {
    id,
    organizationId: 'org-1',
    email,
    firstName: 'Ada',
    lastName: 'Lovelace',
    role: 'regular_user',
    emailVerifiedAt: null,
    twoFactorEnabled: false,
    lastLoginAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    customFieldValues: {},
    deletedAt: null,
    customerGroupId: null,
    subtreeRollupEnabled: false,
    blockedAt: null,
    blockReason: null,
    blockSource: null,
    blockedByAdminUserId: null,
    blockedByCustomerAccountId: null,
    deletionRequestedByAdminUserId: null,
    anonymizedAt: null,
  };
}

/**
 * An `EntityManager` that serves this module's own rows and refuses every
 * other module's. `handlers` is keyed by entity class name.
 */
function fakeEm(handlers: Record<string, unknown>): () => EntityManager {
  const dispatch = (entity: { name?: string }, fallback: unknown): unknown => {
    const name = entity.name ?? '(anonymous)';
    if (!(name in handlers)) {
      throw new Error(
        `comparisons queried '${name}' directly — that row belongs to another module`,
      );
    }
    return handlers[name] ?? fallback;
  };
  const em = {
    findOne: async (entity: { name?: string }) => dispatch(entity, null),
    find: async (entity: { name?: string }) => dispatch(entity, []),
    getConnection: () => ({ execute: async () => [] }),
  };
  return () => em as unknown as EntityManager;
}

const settingsStub = {
  get: async () => 4,
} as unknown as SettingsService;

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

describe('comparisons — catalog rows arrive over catalogProductReadPort', () => {
  it('asks the port whether the product exists, and never the catalog table', async () => {
    const asked: string[] = [];
    const catalogProducts: CatalogProductReadPort = {
      findById: async (id) => {
        asked.push(id);
        return null;
      },
      findByIds: async () => [],
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

    const service = new ComparisonService(
      fakeEm({ Comparison: null, ComparisonProduct: [] }),
      new ComparableAttributeProjection(),
      new ShareTokenGenerator(),
      catalogProducts,
      refusingChannelMembership,
      imagelessGallery,
      settingsStub,
      attributePortStub,
    );

    await expect(service.addProduct(OWNER, 'channel-1', 'prod-9')).rejects.toBeInstanceOf(
      ProductNotFoundError,
    );
    expect(asked).toEqual(['prod-9']);
  });

  it('reads the comparison columns through findByIds', async () => {
    const asked: string[][] = [];
    const catalogProducts: CatalogProductReadPort = {
      findById: async () => null,
      findByIds: async (ids) => {
        asked.push([...ids]);
        return ids.map((id) => productRecord(id));
      },
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

    const service = new ComparisonService(
      fakeEm({
        ComparisonProduct: [
          { productId: 'prod-1', position: 0, addedAt: new Date('2026-02-01T00:00:00.000Z') },
        ],
        SalesChannel: null,
      }),
      new ComparableAttributeProjection(),
      new ShareTokenGenerator(),
      catalogProducts,
      refusingChannelMembership,
      imagelessGallery,
      settingsStub,
      attributePortStub,
      { resolveListingPrices: async () => new Map() },
    );

    const view = await service.buildOwnerView(
      {
        id: 'cmp-1',
        shareToken: 'tok',
        displayMode: 'all',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      } as never,
      'channel-1',
    );

    expect(asked).toEqual([['prod-1']]);
    expect(view.products.map((p) => p.sku)).toEqual(['SKU-prod-1']);
  });
});

describe('comparisons — owner e-mail arrives over customerAccountReadPort', () => {
  it('resolves the owner through the port rather than the customer_accounts table', async () => {
    const asked: string[] = [];
    const customerAccounts = {
      findById: async (id: string) => {
        asked.push(id);
        return accountRecord(id, 'buyer@example.test');
      },
      findByIds: async () => [],
    } as unknown as CustomerAccountReadPort;

    const admin = new ComparisonAdminService(
      fakeEm({
        Comparison: {
          id: 'cmp-1',
          shareToken: 'tok',
          customerAccountId: 'cust-1',
          anonymousToken: null,
          salesChannelId: 'channel-1',
          displayMode: 'all',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
        SalesChannel: { id: 'channel-1', code: 'web' },
      }),
      {
        buildOwnerView: async () => ({
          id: 'cmp-1',
          shareToken: 'tok',
          displayMode: 'all' as const,
          maxProducts: 4,
          products: [],
          comparableAttributes: [],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }),
      } as never,
      customerAccounts,
    );

    const detail = await admin.detail('cmp-1');

    expect(asked).toEqual(['cust-1']);
    expect(detail.owner).toEqual({
      kind: 'customer',
      customerAccountId: 'cust-1',
      email: 'buyer@example.test',
      anonymousToken: null,
    });
    expect(detail.salesChannel.code).toBe('web');
  });
});
