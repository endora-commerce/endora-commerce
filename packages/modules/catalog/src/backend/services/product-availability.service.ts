import type { EntityManager } from '@mikro-orm/postgresql';
import {
  effectiveAudience,
  effectiveOrderRules,
  effectiveStatus,
  effectiveSystemText,
  effectiveWindow,
  isOn,
  isProductEffectivelyAvailable,
  resolveScopeLanguage,
  resolveScoped,
  sameLanguage,
  type CatalogProductAvailabilityPort,
  type EffectiveProductTexts,
  type ChannelAvailability,
  type ProductAudience,
  type ProductAvailabilityScope,
  type ProductChannelLanguageScopeRecord,
  type ProductChannelScopeRecord,
  type ProductGlobalScopeFields,
  type ProductScopeStatus,
  type ProductVisibility,
  type ScopeChannel,
  toScopeChannel,
} from '@endora-commerce/contracts';
import type {
  SalesChannelMembershipPort,
  SalesChannelResolutionPort,
} from '@endora-commerce/platform/kernel';

import { Product } from '../entities/product.entity.js';
import { ProductChannelScope } from '../entities/product-channel-scope.entity.js';
import { ProductChannelLanguageScope } from '../entities/product-channel-language-scope.entity.js';
import { availabilityCondition } from './product-availability.sql.js';
import { loadChannelOverridesByProduct } from './storefront-value-overrides.js';
import { inIdChunks, uuidArrayLiteral } from './sql-id-arrays.js';

/**
 * Feature 163 — `catalogProductAvailabilityPort` (`contracts/product-scopes.md`
 * §3) and the batched reads catalog's own storefront paths share with it.
 *
 * Two forms of one rule, held equal by a parity test: `filterAvailable` asks
 * the database through `availabilityCondition`, and the page-side helpers below
 * ({@link availableAmong}) evaluate the pure `isProductEffectivelyAvailable` over
 * rows already held. Membership is always the kernel's accessor (Constitution
 * XII), and the channel is always a record the caller resolved — this service
 * never takes a channel from a client.
 */

/** A product row as the rule reads it. */
export interface ScopedProduct {
  id: string;
  status: ProductScopeStatus;
  deletedAt?: Date | null | undefined;
  archivedAt?: Date | null | undefined;
  publishFrom?: Date | null | undefined;
  publishUntil?: Date | null | undefined;
  visibility: ProductVisibility;
  allowedOrganizationIds: string[];
  minOrderQuantity?: number | null | undefined;
  returnable: boolean;
}

/** A channel record as the rule needs it — the one normalisation, in `@endora-commerce/contracts`. */
export { toScopeChannel };

/** The global values the rule reads off the product row. */
export function globalScopeFields(product: ScopedProduct): ProductGlobalScopeFields {
  return {
    status: product.status,
    deletedAt: product.deletedAt ?? null,
    archivedAt: product.archivedAt ?? null,
    window: { from: product.publishFrom ?? null, until: product.publishUntil ?? null },
    visibility: product.visibility,
    allowedOrganizationIds: product.allowedOrganizationIds,
    minOrderQuantity: product.minOrderQuantity ?? null,
    returnable: product.returnable,
  };
}

function toChannelRecord(row: ProductChannelScope): ProductChannelScopeRecord {
  return {
    productId: row.productId,
    channelId: row.salesChannelId,
    status: row.status ?? null,
    window: row.windowOverridden
      ? { from: row.publishFrom ?? null, until: row.publishUntil ?? null }
      : null,
    audience:
      row.visibility !== null && row.visibility !== undefined
        ? { visibility: row.visibility, allowedOrganizationIds: row.allowedOrganizationIds ?? [] }
        : null,
    minOrderQuantityOverridden: row.minOrderQuantityOverridden,
    minOrderQuantity: row.minOrderQuantity ?? null,
    returnable: row.returnable ?? null,
  };
}

/** The scope rows of a set of products in one channel, keyed by product id. */
export interface ChannelScopeRows {
  channelRows: Map<string, ProductChannelScopeRecord>;
  /** Product id → its channel × language rows in this channel. */
  languageRows: Map<string, ProductChannelLanguageScopeRecord[]>;
}

/** Two statements for any number of products. */
export async function loadChannelScopeRows(
  em: EntityManager,
  productIds: readonly string[],
  channelId: string,
): Promise<ChannelScopeRows> {
  const channelRows = new Map<string, ProductChannelScopeRecord>();
  const languageRows = new Map<string, ProductChannelLanguageScopeRecord[]>();
  if (productIds.length === 0) return { channelRows, languageRows };
  const ids = [...new Set(productIds)];
  // Chunked: a caller can hand a whole channel's members (code review W2).
  const [cRows, clRows] = await Promise.all([
    inIdChunks(ids, (chunk) =>
      em.find(ProductChannelScope, { productId: { $in: chunk }, salesChannelId: channelId }),
    ),
    inIdChunks(ids, (chunk) =>
      em.find(ProductChannelLanguageScope, { productId: { $in: chunk }, salesChannelId: channelId }),
    ),
  ]);
  for (const row of cRows) channelRows.set(row.productId, toChannelRecord(row));
  for (const row of clRows) {
    const list = languageRows.get(row.productId) ?? [];
    list.push({
      productId: row.productId,
      channelId: row.salesChannelId,
      languageCode: row.languageCode,
      status: row.status,
    });
    languageRows.set(row.productId, list);
  }
  return { channelRows, languageRows };
}

/** Where a page-side availability check is asked. */
export interface PageAvailabilityScope {
  channel: ScopeChannel;
  languageCode: string;
  audience: ProductAudience;
  now: Date;
}

/**
 * The pure rule over rows already held — one membership read and two scope
 * reads for the whole set. An id not returned is unavailable for any reason;
 * the caller answers its seam's single not-found.
 *
 * `membersKnown` skips the membership read when the statement the rows came
 * from already held the kernel's membership subquery.
 */
export async function availableAmong(
  em: EntityManager,
  membership: Pick<SalesChannelMembershipPort, 'filterEntityIdsInChannel'>,
  products: readonly ScopedProduct[],
  scope: PageAvailabilityScope,
  options: { membersKnown?: boolean; rows?: ChannelScopeRows } = {},
): Promise<Set<string>> {
  const out = new Set<string>();
  if (products.length === 0) return out;
  const ids = products.map((p) => p.id);
  const members = options.membersKnown
    ? new Set(ids)
    : new Set(await membership.filterEntityIdsInChannel(scope.channel.id, 'product', ids));
  const rows = options.rows ?? (await loadChannelScopeRows(em, ids, scope.channel.id));
  for (const product of products) {
    if (
      isAvailableWith(product, rows, members.has(product.id), scope)
    ) {
      out.add(product.id);
    }
  }
  return out;
}

/** The pure rule for one product, given its rows and its membership. */
export function isAvailableWith(
  product: ScopedProduct,
  rows: ChannelScopeRows,
  isMember: boolean,
  scope: PageAvailabilityScope,
): boolean {
  return isProductEffectivelyAvailable({
    global: globalScopeFields(product),
    channelRow: rows.channelRows.get(product.id),
    clRow: rows.languageRows
      .get(product.id)
      ?.find((row) => row.languageCode === scope.languageCode),
    isMember,
    channel: scope.channel,
    languageCode: scope.languageCode,
    audience: scope.audience,
    now: scope.now,
  });
}

/** The fields `filterAvailable` / `describeChannelAvailability` load. */
const SCOPED_PRODUCT_FIELDS = [
  'id',
  'status',
  'deletedAt',
  'archivedAt',
  'publishFrom',
  'publishUntil',
  'visibility',
  'allowedOrganizationIds',
  'minOrderQuantity',
  'returnable',
] as const;


export class ProductAvailabilityService implements CatalogProductAvailabilityPort {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly membership: SalesChannelMembershipPort,
    private readonly channels: Pick<SalesChannelResolutionPort, 'getById'>,
  ) {}

  /** The channel as the rule needs it, or `null` for an id no channel has (FR-007: matches nothing). */
  async scopeChannel(channelId: string): Promise<ScopeChannel | null> {
    const channel = await this.channels.getById(channelId);
    return channel ? toScopeChannel(channel) : null;
  }

  async filterAvailable(
    productIds: readonly string[],
    scope: ProductAvailabilityScope,
  ): Promise<Set<string>> {
    const ids = [...new Set(productIds)];
    if (ids.length === 0) return new Set();
    const channel = await this.scopeChannel(scope.channelId);
    if (!channel) return new Set();
    const condition = availabilityCondition(
      {
        channelId: channel.id,
        languageCode: scope.languageCode ?? channel.defaultLanguage,
        channelLanguages: channel.languages,
        audience: scope.audience,
        now: scope.now ?? new Date(),
      },
      this.membership,
    );
    // One array parameter whatever the size of the set — the sitemap, a
    // reindex and a feed's count hand a whole channel (code review W2).
    const rows = await this.emFactory().execute<Array<{ id: string }>>(
      `select p.id::text as id from products p ` +
        `where p.id = any(?::uuid[]) and ${condition.sql('p')}`,
      [uuidArrayLiteral(ids), ...condition.params],
    );
    return new Set(rows.map((row) => row.id));
  }

  async describeChannelAvailability(
    productIds: readonly string[],
    channelId: string,
  ): Promise<Map<string, ChannelAvailability>> {
    const out = new Map<string, ChannelAvailability>();
    const ids = [...new Set(productIds)];
    if (ids.length === 0) return out;
    const channel = await this.scopeChannel(channelId);
    if (!channel) return out;
    const em = this.emFactory();
    const members = new Set(await this.membership.filterEntityIdsInChannel(channel.id, 'product', ids));
    if (members.size === 0) return out;
    const products = await inIdChunks([...members], (chunk) =>
      em.find(Product, { id: { $in: chunk } }, { fields: [...SCOPED_PRODUCT_FIELDS] }),
    );
    const rows = await loadChannelScopeRows(em, [...members], channel.id);
    for (const product of products) {
      const global = globalScopeFields(product);
      const channelRow = rows.channelRows.get(product.id);
      const gone = global.deletedAt !== null || global.archivedAt !== null;
      const liveLanguages = gone
        ? []
        : channel.languages.filter((languageCode) =>
            isOn(
              effectiveStatus(
                global,
                channelRow,
                rows.languageRows.get(product.id)?.find((r) => r.languageCode === languageCode),
              ),
            ),
          );
      out.set(product.id, {
        liveLanguages,
        window: effectiveWindow(global, channelRow),
        audience: effectiveAudience(global, channelRow),
      });
    }
    return out;
  }

  /**
   * Feature 168 (`contracts/readers.md` §2) — the effective name and description at (C, L) along
   * C×L → C → Global. `languageCode` `null` = the channel's default language (an operator, N2). An
   * unknown channel answers the Global texts.
   */
  async effectiveTexts(
    productIds: readonly string[],
    scope: { channelId: string; languageCode: string | null },
  ): Promise<Map<string, EffectiveProductTexts>> {
    const out = new Map<string, EffectiveProductTexts>();
    const ids = [...new Set(productIds)];
    if (ids.length === 0) return out;
    const channel = await this.scopeChannel(scope.channelId);
    const em = this.emFactory();
    const products = await inIdChunks(ids, (chunk) =>
      em.find(Product, { id: { $in: chunk } }, { fields: ['id', 'name', 'description'] }),
    );
    const overrides = channel ? await loadChannelOverridesByProduct(em, ids, channel.id) : new Map();
    const ctx = channel
      ? { channelId: channel.id, languageCode: resolveScopeLanguage(channel, scope.languageCode) }
      : null;
    for (const product of products) {
      const rows = overrides.get(product.id);
      out.set(product.id, {
        name: ctx ? (effectiveSystemText(rows, 'name', ctx, product.name) ?? '') : product.name,
        description: ctx ? effectiveSystemText(rows, 'description', ctx, product.description) : product.description,
      });
    }
    return out;
  }

  /**
   * Feature 168 — the effective packaging-unit name per unit id at (C, L); `null` = an empty
   * override (nothing shown). An id no unit has is absent.
   */
  async effectivePackagingUnitNames(
    unitIds: readonly string[],
    scope: { channelId: string; languageCode: string | null },
  ): Promise<Map<string, string | null>> {
    const out = new Map<string, string | null>();
    const ids = [...new Set(unitIds)];
    if (ids.length === 0) return out;
    const channel = await this.scopeChannel(scope.channelId);
    const em = this.emFactory();
    const units = await em.execute<Array<{ id: string; name: string }>>(
      `select id::text as id, name from product_packaging_units where id = any(?::uuid[])`,
      [uuidArrayLiteral(ids)],
    );
    const rows = channel
      ? await em.execute<Array<{ packaging_unit_id: string; language_code: string | null; value: { v: unknown } }>>(
          `select packaging_unit_id::text as packaging_unit_id, language_code, value
             from product_packaging_unit_scope_overrides
            where packaging_unit_id = any(?::uuid[]) and sales_channel_id = ? and field = 'name'`,
          [uuidArrayLiteral(ids), channel.id],
        )
      : [];
    const languageCode = channel ? resolveScopeLanguage(channel, scope.languageCode) : null;
    for (const unit of units) {
      if (!channel || languageCode === null) {
        out.set(unit.id, unit.name);
        continue;
      }
      const resolved = resolveScoped<string>({
        global: unit.name,
        rows: rows
          .filter((row) => row.packaging_unit_id === unit.id)
          .filter((row) => row.language_code === null || sameLanguage(row.language_code, languageCode))
          .map((row) => ({
            channelId: channel.id,
            languageCode: row.language_code,
            value:
              typeof row.value?.v === 'string' ? { kind: 'value' as const, value: row.value.v } : { kind: 'empty' as const },
          })),
        scope: { level: 'channel_language', channelId: channel.id, languageCode },
        levels: ['G', 'C', 'CL'],
      });
      out.set(unit.id, resolved.value);
    }
    return out;
  }

  async effectiveOrderRules(
    productIds: readonly string[],
    channelId: string,
  ): Promise<Map<string, { minOrderQuantity: number | null; returnable: boolean }>> {
    const out = new Map<string, { minOrderQuantity: number | null; returnable: boolean }>();
    const ids = [...new Set(productIds)];
    if (ids.length === 0) return out;
    const em = this.emFactory();
    const products = await inIdChunks(ids, (chunk) =>
      em.find(Product, { id: { $in: chunk } }, { fields: ['id', 'minOrderQuantity', 'returnable'] }),
    );
    const rows = await loadChannelScopeRows(em, ids, channelId);
    for (const product of products) {
      out.set(
        product.id,
        effectiveOrderRules(
          { minOrderQuantity: product.minOrderQuantity ?? null, returnable: product.returnable },
          rows.channelRows.get(product.id),
        ),
      );
    }
    return out;
  }
}
