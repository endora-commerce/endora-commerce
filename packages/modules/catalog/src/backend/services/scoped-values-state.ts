import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  scopeFromRequest,
  sameLanguage,
  toScopeChannel,
  type CatalogAttributeView,
  type ScopeChannel,
  type ScopeRef,
  type ScopedRow,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';

import { GalleryItem } from '../entities/gallery-item.entity.js';
import { GalleryItemLabel } from '../entities/gallery-item-label.entity.js';
import { GalleryItemScopeOverride } from '../entities/gallery-item-scope-override.entity.js';
import { GalleryRoleScopeOverride } from '../entities/gallery-role-scope-override.entity.js';
import { Product } from '../entities/product.entity.js';
import { ProductAttachment } from '../entities/product-attachment.entity.js';
import { ProductAttachmentScopeOverride } from '../entities/product-attachment-scope-override.entity.js';
import { ProductChannelLanguageScope } from '../entities/product-channel-language-scope.entity.js';
import { ProductChannelScope } from '../entities/product-channel-scope.entity.js';
import { ProductPackagingUnit } from '../entities/product-packaging-unit.entity.js';
import { ProductPackagingUnitScopeOverride } from '../entities/product-packaging-unit-scope-override.entity.js';
import { ProductUrlKey } from '../entities/product-url-key.entity.js';
import { ProductValueOverride } from '../entities/product-value-override.entity.js';
import { attributeSetDefinitionIds } from './scope-completeness.js';

/**
 * Feature 174 (`contracts/scoped-values-api.md` §1–§3) — everything the scoped-values read and
 * the save Command read about one product, loaded in one place so both see the same stores.
 */

/** A member channel as the scoped values read it. */
export interface MemberChannel extends ScopeChannel {
  code: string;
  name: Record<string, string> | string | null;
}

export interface ScopedProductState {
  product: Product;
  version: string;
  categoryIds: string[];
  members: MemberChannel[];
  channelRows: ProductChannelScope[];
  languageRows: ProductChannelLanguageScope[];
  valueOverrides: ProductValueOverride[];
  galleryItems: GalleryItem[];
  galleryLabels: GalleryItemLabel[];
  galleryOverrides: GalleryItemScopeOverride[];
  roleOverrides: GalleryRoleScopeOverride[];
  attachments: ProductAttachment[];
  attachmentOverrides: ProductAttachmentScopeOverride[];
  packagingUnits: ProductPackagingUnit[];
  packagingOverrides: ProductPackagingUnitScopeOverride[];
  urlKeys: ProductUrlKey[];
  /**
   * The user attributes of the product's attribute set that hold scoped values, by key. A Page
   * Builder content attribute (`specs/172-product-content-attributes/`) is left out: its document
   * per language lives in `product_content_values` and is edited on the product content screen,
   * so to the read, the save and the import it is no field at all (172 FR-011, FR-014, FR-042).
   */
  attributes: Map<string, CatalogAttributeView>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A `:id` that is not a uuid names no product — 404, never a 500 from the cast. */
/**
 * The attributes of a set that hold scoped values, by key: every member but a Page Builder content
 * attribute (`ScopedProductState.attributes`). The one filter for the product's set and for the
 * set a save switches to, so the two cannot disagree.
 */
export function scopedAttributesOf(
  views: readonly CatalogAttributeView[],
  setDefinitions: ReadonlySet<string>,
): Map<string, CatalogAttributeView> {
  return new Map(
    views
      .filter((view) => setDefinitions.has(view.customFieldDefinitionId) && view.valueType !== 'page_builder')
      .map((view) => [view.key, view]),
  );
}

export function assertProductId(productId: string): void {
  if (!UUID.test(productId)) throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'Product not found.');
}

/** The product's current `scope_version` (R7), as the opaque string the API carries. */
export async function readScopeVersion(em: EntityManager, productId: string): Promise<string> {
  const [row] = await em.execute<Array<{ v: string }>>(`select scope_version::text as v from products where id = ?`, [productId]);
  return row?.v ?? '0';
}

export async function loadScopedState(
  em: EntityManager,
  productId: string,
  deps: {
    membership: Pick<SalesChannelMembershipPort, 'listChannelsForEntity'>;
    listAttributes: () => Promise<CatalogAttributeView[]>;
  },
): Promise<ScopedProductState> {
  assertProductId(productId);
  const product = await em.findOne(Product, { id: productId, deletedAt: null });
  if (!product) throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'Product not found.');
  const [
    version,
    categoryRows,
    members,
    channelRows,
    languageRows,
    valueOverrides,
    galleryItems,
    galleryLabels,
    galleryOverrides,
    roleOverrides,
    attachments,
    attachmentOverrides,
    packagingUnits,
    packagingOverrides,
    urlKeys,
    views,
    setDefinitions,
  ] = await Promise.all([
    readScopeVersion(em, productId),
    em.execute<Array<{ category_id: string }>>(
      `select category_id::text as category_id from product_categories where product_id = ? order by category_id`,
      [productId],
    ),
    deps.membership.listChannelsForEntity('product', productId),
    em.find(ProductChannelScope, { productId }),
    em.find(ProductChannelLanguageScope, { productId }),
    em.find(ProductValueOverride, { productId }),
    em.find(GalleryItem, { productId }, { orderBy: { position: 'asc', id: 'asc' } }),
    em.find(GalleryItemLabel, { productId }),
    em.find(GalleryItemScopeOverride, { productId }),
    em.find(GalleryRoleScopeOverride, { productId }),
    em.find(ProductAttachment, { productId }, { orderBy: { position: 'asc', id: 'asc' } }),
    em.find(ProductAttachmentScopeOverride, { productId }),
    em.find(ProductPackagingUnit, { productId }, { orderBy: { position: 'asc', id: 'asc' } }),
    em.find(ProductPackagingUnitScopeOverride, { productId }),
    em.find(ProductUrlKey, { productId }),
    deps.listAttributes(),
    attributeSetDefinitionIds(em, product.attributeSetId),
  ]);
  return {
    product,
    version,
    categoryIds: categoryRows.map((row) => row.category_id),
    members: members
      .map((channel) => ({
        ...toScopeChannel(channel),
        code: channel.code,
        name: (channel as { name?: Record<string, string> | string | null }).name ?? null,
      }))
      .sort((a, b) => a.code.localeCompare(b.code)),
    channelRows,
    languageRows,
    valueOverrides,
    galleryItems,
    galleryLabels,
    galleryOverrides,
    roleOverrides,
    attachments,
    attachmentOverrides,
    packagingUnits,
    packagingOverrides,
    urlKeys,
    attributes: scopedAttributesOf(views, setDefinitions),
  };
}

/**
 * The scope a request names (§1), resolved against the product's member channels: neither →
 * Global; a channel → Channel; both → Channel × language, the language in the channel's own
 * spelling. A language without a channel is `422 VALIDATION_FAILED` (`details.field = 'scope'`,
 * FR-010: there is no Language scope); a channel the product is not a member of, or a language
 * it does not offer, is `422 SCOPE_INVALID`.
 */
export function resolveRequestScope(
  members: readonly ScopeChannel[],
  request: { channelId?: string | null | undefined; languageCode?: string | null | undefined },
  /**
   * FR-101 (163 FR-015) — the write only removes overrides (`{ inherit: true }` in every cell):
   * an orphaned scope — a channel the product left, a language the channel dropped — is
   * accepted as named, so the overview's orphan deletion keeps working. A value there is still
   * `SCOPE_INVALID`.
   */
  options: { removalOnly?: boolean } = {},
): ScopeRef {
  const parsed = scopeFromRequest(request);
  if (!parsed.ok) {
    throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'A language scope needs a sales channel.', { field: 'scope' });
  }
  const scope = parsed.scope;
  if (scope.level === 'global') return scope;
  const channel = members.find((member) => member.id === scope.channelId);
  if (options.removalOnly === true) {
    const spelling = channel?.languages.find((language) => scope.level === 'channel_language' && sameLanguage(language, scope.languageCode));
    if (!channel || (scope.level === 'channel_language' && spelling === undefined)) return scope;
  }
  if (!channel) {
    throw new HttpError(422, ERROR_CODES.SCOPE_INVALID, 'The product is not a member of this sales channel.', {
      channelId: scope.channelId,
      reason: 'not_a_member',
    });
  }
  if (scope.level === 'channel') return scope;
  const spelling = channel.languages.find((language) => sameLanguage(language, scope.languageCode));
  if (spelling === undefined) {
    throw new HttpError(422, ERROR_CODES.SCOPE_INVALID, 'The sales channel does not offer this language.', {
      channelId: scope.channelId,
      languageCode: scope.languageCode,
      reason: 'language_not_offered',
    });
  }
  return { level: 'channel_language', channelId: channel.id, languageCode: spelling };
}

/** Rows at a valid scope only: a member channel, and at C×L a language that channel offers (orphans dropped). */
export function atValidScopes<T>(rows: readonly ScopedRow<T>[], members: readonly ScopeChannel[]): ScopedRow<T>[] {
  return rows.filter((row) => {
    const channel = members.find((member) => member.id === row.channelId);
    if (!channel) return false;
    return row.languageCode === null || channel.languages.some((language) => sameLanguage(language, row.languageCode));
  });
}

/**
 * The **one** writer of `products.scope_version`: `+ 1`, conditioned on `expected` when the
 * caller holds a version (the save, the copy). Runs as the first statement of the Command, so
 * the row lock it takes serialises every later read of the transaction. A stale `expected` is
 * `409 VERSION_CONFLICT`; an unknown or deleted product `404 PRODUCT_NOT_FOUND`.
 */
export async function bumpScopeVersion(em: EntityManager, productId: string, expected?: string): Promise<string> {
  const rows = await em.execute<Array<{ v: string }>>(
    expected === undefined
      ? `update products set scope_version = scope_version + 1 where id = ? and deleted_at is null returning scope_version::text as v`
      : `update products set scope_version = scope_version + 1 where id = ? and deleted_at is null and scope_version = ?::bigint returning scope_version::text as v`,
    expected === undefined ? [productId] : [productId, expected],
  );
  if (rows[0]) return rows[0].v;
  const [exists] = await em.execute<Array<{ id: string }>>(`select id from products where id = ? and deleted_at is null`, [productId]);
  if (!exists) throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'Product not found.');
  throw new HttpError(409, ERROR_CODES.VERSION_CONFLICT, 'The product was saved by someone else; reload it and try again.');
}
