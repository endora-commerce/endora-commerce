import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  effectiveStatus,
  effectiveWindow,
  isInsideWindow,
  isOn,
  isSystemAttributeKey,
  sameLanguage,
  type LanguageReadPort,
  type OverrideRow,
  type ProductChannelLanguageScopeRecord,
  type ProductChannelScopeRecord,
  type ProductScopeStatus,
  type PublicationWindow,
  type ScopeLevel,
  type ScopeOverviewResponse,
  toScopeChannel,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { Product } from '../entities/product.entity.js';
import { ProductChannelLanguageScope } from '../entities/product-channel-language-scope.entity.js';
import { ProductChannelScope } from '../entities/product-channel-scope.entity.js';
import { ProductUrlKey } from '../entities/product-url-key.entity.js';
import { ProductValueOverride } from '../entities/product-value-override.entity.js';
import type { CatalogAttributeReadService } from './catalog-attribute-read.service.js';
import { toChannelRecord, toLanguageRecord } from './product-scopes.service.js';
import { attributeSetDefinitionIds, checkCompleteness, requiredAttributeKeys } from './scope-completeness.js';
import { loadMediaScopedFields } from './gallery-scopes.js';
import { loadAttachmentPackagingScopedFields } from './attachment-packaging-scopes.js';

/**
 * Feature 163 (`specs/163-product-data-scopes/`) — the scope overview of one product,
 * `GET /api/v1/admin/catalog/products/:id/scope-overview` (`contracts/admin-scopes-api.md`
 * §3; US4, FR-015, FR-041).
 *
 * A read: channels × languages, each cell's effective status and where it comes from,
 * the fields overridden at the cell, at the channel row and at the language column, and
 * every override the resolution ignores (orphans, FR-015) with the reason.
 *
 * Field names are the owning write's: `status`, `window`, `audience`,
 * `minOrderQuantity`, `returnable` (the scopes PATCH), `name`, `description`,
 * `attribute:<key>` (the value overrides — the spelling `ScopeMissingValue` uses) and
 * `urlKey` (the URL keys). A cell lists each field once, at the level that wins there
 * (C × L, then C, then L — FR-008).
 *
 * The **language** level of a per-language baseline (`products.name`,
 * `products.description`, a language-scoped attribute's value) is a value in a language
 * other than the platform's default one: the default language's value is the global
 * value, as the resolver reports it (`resolveAttribute`). A language URL key is always a
 * language override of the global `products.slug`.
 *
 * Status is shown as stored; "available" is composed from the shared rule's pieces
 * (`isOn`, `effectiveStatus`, `effectiveWindow`, `isInsideWindow`) and the product's
 * `archivedAt`, never from a status value. The audience is shown as the rule, not
 * evaluated (SC-003). `cells[].missing` is the completeness gate's own check
 * (`checkCompleteness`, T080a, FR-041) for every cell whose channel the product is a
 * member of and whose language that channel offers, whatever its status — so a cell
 * made live by a change that does not fire the gate shows what it lacks; absent on
 * every other cell.
 */

export type ScopeOverview = ScopeOverviewResponse['data'];
type OverviewCell = ScopeOverview['cells'][number];
type OverriddenField = OverviewCell['overriddenFields'][number];
type Orphan = ScopeOverview['orphans'][number];

export interface ScopeOverviewChannel {
  id: string;
  name: Record<string, string>;
  /** The channel's current content languages. */
  languages: readonly string[];
  isMember: boolean;
}

/** Everything {@link buildScopeOverview} reads, already loaded. */
export interface ScopeOverviewInput {
  product: {
    status: ProductScopeStatus;
    archivedAt: Date | null;
    window: PublicationWindow;
    /** Feature 168 — the Global name and description, one string each. */
    name: string;
    description: string | null;
    attributeValues: Record<string, unknown>;
    /** The global URL key. */
    slug: string;
  };
  /** The required attributes of the product's attribute set (the gate's list, R16). */
  requiredAttributes: readonly string[];
  /** The member channels and every other channel a row of this product names, in display order. */
  channels: readonly ScopeOverviewChannel[];
  channelRows: readonly ProductChannelScopeRecord[];
  languageRows: readonly ProductChannelLanguageScopeRecord[];
  valueOverrides: readonly OverrideRow[];
  /** `languageCode` `null` = a Channel key. */
  urlKeys: ReadonlyArray<{ languageCode: string | null; salesChannelId: string }>;
  /** The user-defined attributes' scope sets, by key. A key absent here no longer exists. */
  attributeLevels: ReadonlyMap<string, readonly ScopeLevel[]>;
  /** Every active platform language: the languages axis when the product is in no channel (US4 #4). */
  platformLanguages: readonly string[];
  /**
   * Feature 163 (T134b, T139b, T118c) — overrides kept outside the scope and value
   * tables: the gallery (`media:roles`, `media:hidden`, `media:altText`), the
   * attachments (`attachments:hidden`, `attachments:name`, `attachments:description`),
   * the packaging units (`packagingUnits:name`) and SEO (`seo:<field>`). The level is
   * the shape: a channel alone, a language alone, or both. Absent = none.
   */
  scopedFields?: ReadonlyArray<ScopedField>;
  now: Date;
}

/** One override held outside the scope and value tables, at a channel, a language, or both. */
export interface ScopedField {
  field: string;
  channelId: string | null;
  languageCode: string | null;
}

const CHANNEL_FIELDS = ['status', 'window', 'audience', 'minOrderQuantity', 'returnable'] as const;
type ChannelField = (typeof CHANNEL_FIELDS)[number];

/** The value-override field name: system attributes by key, user attributes as `attribute:<key>`. */
function overrideField(attributeKey: string): string {
  return isSystemAttributeKey(attributeKey) ? attributeKey : `attribute:${attributeKey}`;
}

/** name, description, then attributes by key, the URL key, media / attachments / packaging units, then SEO. */
function fieldOrder(field: string): [number, string] {
  if (field === 'name') return [0, ''];
  if (field === 'description') return [1, ''];
  if (field === 'urlKey') return [3, ''];
  if (field.startsWith('seo:')) return [5, field];
  if (field.startsWith('media:') || field.startsWith('attachments:') || field.startsWith('packagingUnits:')) {
    return [4, field];
  }
  return [2, field];
}

function byFieldOrder(a: string, b: string): number {
  const [ra, ka] = fieldOrder(a);
  const [rb, kb] = fieldOrder(b);
  return ra - rb || ka.localeCompare(kb);
}

function channelFieldSet(row: ProductChannelScopeRecord | undefined): ChannelField[] {
  if (!row) return [];
  return CHANNEL_FIELDS.filter((field) =>
    field === 'minOrderQuantity' ? row.minOrderQuantityOverridden : row[field] !== null,
  );
}

/** The scope set of an override's field, or `null` when the attribute no longer exists. */
function levelsOf(attributeKey: string, attributeLevels: ReadonlyMap<string, readonly ScopeLevel[]>): readonly ScopeLevel[] | null {
  if (isSystemAttributeKey(attributeKey)) return ['G', 'C', 'CL'];
  return attributeLevels.get(attributeKey) ?? null;
}

/** The pure core of the overview (`admin-scopes-api.md` §3). */
export function buildScopeOverview(input: ScopeOverviewInput): ScopeOverview {
  const channelById = new Map(input.channels.map((channel) => [channel.id, channel]));
  const isMember = (channelId: string): boolean => channelById.get(channelId)?.isMember === true;
  const offers = (channelId: string, languageCode: string): boolean =>
    channelById.get(channelId)?.languages.includes(languageCode) === true;

  const orphans: Orphan[] = [];

  // --- Scope rows -----------------------------------------------------------------
  const channelRowOf = new Map<string, ProductChannelScopeRecord>();
  for (const row of input.channelRows) {
    if (isMember(row.channelId)) {
      channelRowOf.set(row.channelId, row);
      continue;
    }
    for (const field of channelFieldSet(row)) {
      orphans.push({ field, channelId: row.channelId, languageCode: null, reason: 'not_a_member' });
    }
  }
  const languageRowOf = new Map<string, ProductChannelLanguageScopeRecord>();
  for (const row of input.languageRows) {
    if (!isMember(row.channelId)) {
      orphans.push({ field: 'status', channelId: row.channelId, languageCode: row.languageCode, reason: 'not_a_member' });
    } else if (!offers(row.channelId, row.languageCode)) {
      orphans.push({
        field: 'status',
        channelId: row.channelId,
        languageCode: row.languageCode,
        reason: 'language_not_offered',
      });
    } else {
      languageRowOf.set(`${row.channelId}|${row.languageCode}`, row);
    }
  }

  // --- Value overrides ------------------------------------------------------------
  /** channelId → languageCode ('' for the channel-only slot) → fields with a value there. */
  const overrideFields = new Map<string, Map<string, Set<string>>>();
  for (const row of input.valueOverrides) {
    const field = overrideField(row.attributeKey);
    const levels = levelsOf(row.attributeKey, input.attributeLevels);
    const base = { field, channelId: row.channelId, languageCode: row.languageCode };
    if (!isMember(row.channelId)) {
      orphans.push({ ...base, reason: 'not_a_member' });
      continue;
    }
    if (row.languageCode !== null && !offers(row.channelId, row.languageCode)) {
      orphans.push({ ...base, reason: 'language_not_offered' });
      continue;
    }
    // The resolver's own test: a C row needs `C` in the field's scope set, a C×L row `CL`.
    if (levels === null || !levels.includes(row.languageCode === null ? 'C' : 'CL')) {
      orphans.push({ ...base, reason: 'attribute_scope_changed' });
      continue;
    }
    const byLanguage = overrideFields.get(row.channelId) ?? new Map<string, Set<string>>();
    overrideFields.set(row.channelId, byLanguage);
    const slot = byLanguage.get(row.languageCode ?? '') ?? new Set<string>();
    byLanguage.set(row.languageCode ?? '', slot);
    slot.add(field);
  }

  // --- Media, attachments, packaging units, SEO (T134b, T139b, T118c) ----------------
  for (const scoped of input.scopedFields ?? []) {
    if (scoped.channelId === null) continue; // Global (SEO): not an override cell
    const base = { field: scoped.field, channelId: scoped.channelId, languageCode: scoped.languageCode };
    if (!isMember(scoped.channelId)) {
      orphans.push({ ...base, reason: 'not_a_member' });
      continue;
    }
    let slotLanguage = '';
    if (scoped.languageCode !== null) {
      const offered = channelById.get(scoped.channelId)?.languages.find((code) => sameLanguage(code, scoped.languageCode));
      if (offered === undefined) {
        orphans.push({ ...base, reason: 'language_not_offered' });
        continue;
      }
      slotLanguage = offered;
    }
    const byLanguage = overrideFields.get(scoped.channelId) ?? new Map<string, Set<string>>();
    overrideFields.set(scoped.channelId, byLanguage);
    const slot = byLanguage.get(slotLanguage) ?? new Set<string>();
    byLanguage.set(slotLanguage, slot);
    slot.add(scoped.field);
  }

  // --- URL keys -------------------------------------------------------------------
  const channelKeys = new Set<string>();
  for (const key of input.urlKeys) {
    const base = { field: 'urlKey', channelId: key.salesChannelId, languageCode: key.languageCode };
    if (!isMember(key.salesChannelId)) orphans.push({ ...base, reason: 'not_a_member' });
    else if (key.languageCode !== null && !offers(key.salesChannelId, key.languageCode)) {
      orphans.push({ ...base, reason: 'language_not_offered' });
    } else channelKeys.add(`${key.salesChannelId}|${key.languageCode ?? ''}`);
  }

  // --- Axes -----------------------------------------------------------------------
  const members = input.channels.filter((channel) => channel.isMember);
  const languages = [
    ...new Set(members.length > 0 ? members.flatMap((channel) => channel.languages) : input.platformLanguages),
  ].sort();

  const channelRows = input.channels.map((channel) => {
    if (!channel.isMember) return { channelId: channel.id, overriddenFields: [] };
    const channelOnly = [...(overrideFields.get(channel.id)?.get('') ?? [])];
    if (channelKeys.has(`${channel.id}|`)) channelOnly.push('urlKey');
    channelOnly.sort(byFieldOrder);
    return {
      channelId: channel.id,
      overriddenFields: [...channelFieldSet(channelRowOf.get(channel.id)), ...channelOnly],
    };
  });

  // --- Cells ----------------------------------------------------------------------
  const global = { status: input.product.status, window: input.product.window };
  const completeness = {
    name: input.product.name,
    slug: input.product.slug,
    attributeValues: input.product.attributeValues,
    requiredAttributes: input.requiredAttributes,
    attributeLevels: input.attributeLevels,
    valueOverrides: input.valueOverrides,
    urlKeys: input.urlKeys,
  };
  const cells: OverviewCell[] = [];
  for (const channel of input.channels) {
    for (const languageCode of languages) {
      const member = channel.isMember;
      const offered = member && channel.languages.includes(languageCode);
      const channelRow = member ? channelRowOf.get(channel.id) : undefined;
      const clRow = offered ? languageRowOf.get(`${channel.id}|${languageCode}`) : undefined;
      const status = effectiveStatus(global, channelRow, clRow);
      const statusSource: OverviewCell['statusSource'] = clRow
        ? 'channel_language'
        : channelRow?.status != null
          ? 'channel'
          : 'global';
      const available =
        offered &&
        input.product.archivedAt === null &&
        isOn(status) &&
        isInsideWindow(effectiveWindow(global, channelRow), input.now);

      const overriddenFields: OverriddenField[] = [];
      if (offered) {
        if (clRow) overriddenFields.push({ field: 'status', level: 'channel_language' });
        for (const field of channelFieldSet(channelRow)) {
          if (field === 'status' && clRow) continue;
          overriddenFields.push({ field, level: 'channel' });
        }
        const atCell = new Set(overrideFields.get(channel.id)?.get(languageCode) ?? []);
        const atChannel = overrideFields.get(channel.id)?.get('') ?? new Set<string>();
        if (channelKeys.has(`${channel.id}|${languageCode}`)) atCell.add('urlKey');
        if (channelKeys.has(`${channel.id}|`)) atChannel.add('urlKey');
        const fields = [...new Set([...atCell, ...atChannel])].sort(byFieldOrder);
        for (const field of fields) {
          overriddenFields.push({ field, level: atCell.has(field) ? 'channel_language' : 'channel' });
        }
      }
      cells.push({
        channelId: channel.id,
        languageCode,
        available,
        effectiveStatus: status,
        statusSource,
        overriddenFields,
        ...(offered ? { missing: checkCompleteness(completeness, channel.id, languageCode) } : {}),
      });
    }
  }

  return {
    channels: input.channels.map((channel) => ({
      channelId: channel.id,
      name: { ...channel.name },
      isMember: channel.isMember,
      languages: [...channel.languages],
    })),
    languages,
    cells,
    channelRows,
    orphans,
  };
}

/**
 * Feature 163 (T118c) — `seo`'s scopes of a product for the overview; `[]` while `seo`
 * is not effectively present (the caller probes before resolving the port).
 */
export type ListSeoProductScopes = (
  productId: string,
) => Promise<Array<{ channelId: string | null; languageCode: string | null; fields: readonly string[] }>>;

export class ScopeOverviewService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly membership: Pick<SalesChannelMembershipPort, 'listChannelsForEntity'>,
    private readonly languages: Pick<LanguageReadPort, 'listActive' | 'getDefault'>,
    private readonly attributeRead: Pick<CatalogAttributeReadService, 'listAll'>,
    /** Without it the overview lists no SEO field (as with `seo` off). */
    private readonly seoScopes?: ListSeoProductScopes,
  ) {}

  /** `GET /admin/catalog/products/:id/scope-overview`. */
  async read(productId: string, now: Date = new Date()): Promise<ScopeOverview> {
    const em = this.emFactory();
    const product = await em.findOne(Product, { id: productId, deletedAt: null });
    if (!product) throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'Product not found.');
    const [
      members,
      channelRows,
      languageRows,
      overrides,
      urlKeys,
      attributes,
      active,
      ,
      setDefinitions,
      mediaFields,
      attachmentPackagingFields,
      seoScopes,
    ] = await Promise.all([
        this.membership.listChannelsForEntity('product', productId),
        em.find(ProductChannelScope, { productId }),
        em.find(ProductChannelLanguageScope, { productId }),
        em.find(ProductValueOverride, { productId }),
        em.find(ProductUrlKey, { productId }),
        this.attributeRead.listAll(),
        this.languages.listActive(),
        this.languages.getDefault(),
        attributeSetDefinitionIds(em, product.attributeSetId),
        loadMediaScopedFields(em, productId),
        loadAttachmentPackagingScopedFields(em, productId),
        this.seoScopes ? this.seoScopes(productId) : Promise.resolve([]),
      ]);
    const scopedFields: ScopedField[] = [
      ...mediaFields,
      ...attachmentPackagingFields,
      ...seoScopes.flatMap((scope) =>
        scope.fields.map((field) => ({
          field: `seo:${field}`,
          channelId: scope.channelId,
          languageCode: scope.languageCode,
        })),
      ),
    ];

    const memberIds = new Set(members.map((channel) => channel.id));
    const otherIds = [
      ...new Set(
        [
          ...channelRows.map((row) => row.salesChannelId),
          ...languageRows.map((row) => row.salesChannelId),
          ...overrides.map((row) => row.channelId),
          ...urlKeys.flatMap((row) => (row.salesChannelId == null ? [] : [row.salesChannelId])),
          ...scopedFields.flatMap((row) => (row.channelId === null ? [] : [row.channelId])),
        ].filter((id) => !memberIds.has(id)),
      ),
    ];
    const others = otherIds.length === 0 ? [] : await em.find(SalesChannel, { id: { $in: otherIds } });
    const channels = [...members, ...others]
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((channel) => ({
        id: channel.id,
        name: channel.name,
        // The default is offered even when the list omits it (`toScopeChannel`).
        languages: toScopeChannel(channel).languages,
        isMember: memberIds.has(channel.id),
      }));

    return buildScopeOverview({
      product: {
        status: product.status,
        archivedAt: product.archivedAt ?? null,
        window: { from: product.publishFrom ?? null, until: product.publishUntil ?? null },
        name: product.name,
        description: product.description ?? null,
        attributeValues: product.attributeValues ?? {},
        slug: product.slug ?? '',
      },
      requiredAttributes: requiredAttributeKeys(attributes, setDefinitions),
      channels,
      channelRows: channelRows.map(toChannelRecord),
      languageRows: languageRows.map(toLanguageRecord),
      valueOverrides: overrides.map((row) => ({
        attributeKey: row.attributeKey,
        channelId: row.channelId,
        languageCode: row.languageCode ?? null,
        value: row.value,
      })),
      urlKeys: urlKeys.map((row) => ({ languageCode: row.languageCode, salesChannelId: row.salesChannelId })),
      attributeLevels: new Map(attributes.map((attribute) => [attribute.key, attribute.scopeLevels])),
      platformLanguages: active.map((language) => language.code),
      scopedFields,
      now,
    });
  }
}
