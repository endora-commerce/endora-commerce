import type { EntityManager } from '@mikro-orm/postgresql';
import {
  GALLERY_ROLE_LABELS,
  PRODUCT_FIELD_SCOPE_SETS,
  attributeFieldSpec,
  levelOf,
  resolveScoped,
  type AssetReadPort,
  type CatalogAttributeView,
  type CompletenessSummary,
  type FieldScopeSpec,
  type InheritedLevel,
  type LanguageReadPort,
  type OrganizationDetailsPort,
  type ScopeMissingValue,
  type ScopeRef,
  type ScopedFieldView,
  type ScopedRow,
  type ScopedValuesData,
} from '@endora-commerce/contracts';
import type { SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';

import { checkCompleteness, requiredAttributeKeys, type CompletenessFacts } from './scope-completeness.js';
import {
  channelScopeRows,
  familyOverrideRows,
  galleryRoleRows,
  languageStatusRows,
  valueOverrideRows,
  type AudienceValue,
  type WindowValue,
} from './scoped-store-adapters.js';
import {
  atValidScopes,
  loadScopedState,
  resolveRequestScope,
  type MemberChannel,
  type ScopedProductState,
} from './scoped-values-state.js';

/**
 * Feature 170 (T036; `contracts/scoped-values-api.md` §2) — `GET …/products/:id/scoped-values`:
 * every scoped field of the product at one scope, with its source, in **one** request per scope
 * switch (FR-109). Orphaned rows never contribute. `seo` is `seo`'s own view at the scope
 * (`seoProductMetaPort.readScoped`, US10), `null` while `seo` is off.
 */

/** The camelCase role keys of the API (Principle VI) for the stored labels. */
export const GALLERY_ROLE_KEYS = {
  base_image: 'baseImage',
  small_image: 'smallImage',
  thumbnail: 'thumbnail',
} as const;

export interface ScopedValuesReadDeps {
  membership: Pick<SalesChannelMembershipPort, 'listChannelsForEntity'>;
  listAttributes: () => Promise<CatalogAttributeView[]>;
  languages?: Pick<LanguageReadPort, 'list'>;
  assets?: Pick<AssetReadPort, 'findByIds'>;
  organizations?: Pick<OrganizationDetailsPort, 'findByIds'>;
  /**
   * Feature 170 (T123, FR-090, FR-092) — `seo`'s view of the product's metadata at one scope
   * (`seoProductMetaPort.readScoped`), `null` while `seo` is not effectively present. Absent = no
   * SEO block.
   */
  readSeo?: ReadSeoProductScoped;
}

/** `seo`'s five fields at one scope, or `null` while `seo` is off (presence decided by the wiring). */
export type ReadSeoProductScoped = (productId: string, scope: ScopeRef) => Promise<ScopedValuesData['seo']>;

/** The scope is one the product sells at now — `seo`'s scoped read refuses any other (422). */
function isLiveScope(state: ScopedProductState, scope: ScopeRef): boolean {
  if (scope.level === 'global') return true;
  const channel = state.members.find((member) => member.id === scope.channelId);
  if (!channel) return false;
  if (scope.level === 'channel') return true;
  return channel.languages.some((code) => code.toLowerCase() === scope.languageCode.toLowerCase());
}

/** One field's view at `scope` (FR-109): the effective value, its source and the own value. */
export function fieldView<T>(
  spec: FieldScopeSpec,
  global: T | null | undefined,
  rows: readonly ScopedRow<T>[],
  scope: ScopeRef,
  members: readonly MemberChannel[],
): ScopedFieldView<T> {
  const valid = atValidScopes(rows, members);
  const resolved = resolveScoped<T>({ global: global ?? null, rows: valid, scope, levels: spec.levels });
  const own = resolved.source === 'set' || resolved.source === 'set_empty';
  return {
    value: resolved.value,
    source: resolved.source,
    ...(own ? { ownValue: resolved.value } : {}),
    ...(scope.level === 'global' ? {} : { inheritedValue: inheritedAt(spec, global ?? null, valid, scope) }),
    levels: [...spec.levels],
    supportedHere: spec.levels.includes(levelOf(scope)),
    required: spec.required,
  };
}

/**
 * What the field would read if it inherited at `scope` (owner decision 2026-11-03): the same
 * resolution without the scope's own row, so an empty parent stays empty rather than falling
 * through to Global.
 */
function inheritedAt<T>(
  spec: FieldScopeSpec,
  global: T | null,
  rows: readonly ScopedRow<T>[],
  scope: Exclude<ScopeRef, { level: 'global' }>,
): { value: T | null; level: InheritedLevel } {
  const isOwn = (row: ScopedRow<T>) =>
    row.channelId === scope.channelId &&
    (scope.level === 'channel'
      ? row.languageCode === null
      : row.languageCode !== null && row.languageCode.toLowerCase() === scope.languageCode.toLowerCase());
  const resolved = resolveScoped<T>({ global, rows: rows.filter((row) => !isOwn(row)), scope, levels: spec.levels });
  // Without its own row a non-Global scope resolves to the channel row or to Global (which may
  // hold no value: `value: null`, level `G`).
  return { value: resolved.value, level: resolved.source === 'inherited_channel' ? 'C' : 'G' };
}

const textOf = (name: Record<string, string> | string | null, fallback: string): string => {
  if (typeof name === 'string' && name !== '') return name;
  if (name && typeof name === 'object') {
    return name['en-US'] ?? Object.values(name).find((value) => typeof value === 'string' && value !== '') ?? fallback;
  }
  return fallback;
};

/** The facts the completeness rule reads (R16), from the loaded state. */
export function completenessFacts(state: ScopedProductState): CompletenessFacts {
  const views = [...state.attributes.values()];
  return {
    name: state.product.name ?? '',
    slug: state.product.slug ?? '',
    attributeValues: state.product.attributeValues ?? {},
    requiredAttributes: requiredAttributeKeys(views, new Set(views.map((view) => view.customFieldDefinitionId))),
    attributeLevels: new Map(views.map((view) => [view.key, view.scopeLevels])),
    valueOverrides: state.valueOverrides.map((row) => ({
      attributeKey: row.attributeKey,
      channelId: row.channelId,
      languageCode: row.languageCode ?? null,
      value: row.value,
    })),
    urlKeys: state.urlKeys.map((row) => ({ languageCode: row.languageCode, salesChannelId: row.salesChannelId })),
  };
}

/** §2.1 — the completeness summary at the scope's level. */
export function completenessSummary(state: ScopedProductState, scope: ScopeRef): CompletenessSummary {
  const facts = completenessFacts(state);
  if (scope.level === 'channel_language') {
    return { level: 'channel_language', missing: checkCompleteness(facts, scope.channelId, scope.languageCode) };
  }
  if (scope.level === 'channel') {
    const channel = state.members.find((member) => member.id === scope.channelId);
    const byField = new Map<ScopeMissingValue, string[]>();
    for (const languageCode of channel?.languages ?? []) {
      for (const field of checkCompleteness(facts, scope.channelId, languageCode)) {
        byField.set(field, [...(byField.get(field) ?? []), languageCode]);
      }
    }
    return { level: 'channel', missing: [...byField].map(([field, languages]) => ({ field, languages })) };
  }
  let incompleteScopes = 0;
  for (const channel of state.members) {
    for (const languageCode of channel.languages) {
      if (checkCompleteness(facts, channel.id, languageCode).length > 0) incompleteScopes += 1;
    }
  }
  return { level: 'global', incompleteScopes };
}

/** The `fields`, `attributes`, `gallery`, `attachments` and `packagingUnits` of a read, at `scope`. */
export function scopedViews(
  state: ScopedProductState,
  scope: ScopeRef,
): Pick<ScopedValuesData, 'fields' | 'attributes' | 'gallery' | 'attachments' | 'packagingUnits'> & {
  galleryAssetIds: string[];
} {
  const { product, members } = state;
  const sets = PRODUCT_FIELD_SCOPE_SETS;
  const overrides = state.valueOverrides.map((row) => ({
    attributeKey: row.attributeKey,
    channelId: row.channelId,
    languageCode: row.languageCode ?? null,
    value: row.value,
  }));
  const statusRows = [...channelScopeRows(state.channelRows, 'status'), ...languageStatusRows(state.languageRows)];
  const urlKeyRows: ScopedRow<string>[] = state.urlKeys.map((row) => ({
    channelId: row.salesChannelId,
    languageCode: row.languageCode,
    value: { kind: 'value', value: row.key },
  }));
  const fields: ScopedValuesData['fields'] = {
    name: fieldView(sets.name, product.name, valueOverrideRows<string>(overrides, 'name'), scope, members),
    description: fieldView(sets.description, product.description, valueOverrideRows<string>(overrides, 'description'), scope, members),
    status: fieldView(sets.status, product.status, statusRows as ScopedRow<'active' | 'inactive'>[], scope, members),
    window: fieldView<WindowValue>(
      sets.window,
      { from: product.publishFrom?.toISOString() ?? null, until: product.publishUntil?.toISOString() ?? null },
      channelScopeRows(state.channelRows, 'window') as ScopedRow<WindowValue>[],
      scope,
      members,
    ),
    audience: fieldView<AudienceValue>(
      sets.audience,
      { visibility: product.visibility, allowedOrganizationIds: [...product.allowedOrganizationIds] },
      channelScopeRows(state.channelRows, 'audience') as ScopedRow<AudienceValue>[],
      scope,
      members,
    ),
    minOrderQuantity: fieldView<number>(
      sets.minOrderQuantity,
      product.minOrderQuantity ?? null,
      channelScopeRows(state.channelRows, 'minOrderQuantity') as ScopedRow<number>[],
      scope,
      members,
    ),
    returnable: fieldView<boolean>(
      sets.returnable,
      product.returnable,
      channelScopeRows(state.channelRows, 'returnable') as ScopedRow<boolean>[],
      scope,
      members,
    ),
    urlKey: fieldView(sets.urlKey, product.slug, urlKeyRows, scope, members),
  };
  const attributes = [...state.attributes.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((view) => ({
      key: view.key,
      label: view.label,
      valueType: view.valueType,
      isRequired: view.isRequired,
      view: fieldView<unknown>(
        attributeFieldSpec(view),
        product.attributeValues?.[view.key] ?? null,
        valueOverrideRows(overrides, view.key),
        scope,
        members,
      ),
    }));

  const itemOverrides = state.galleryOverrides.map((row) => ({ ...row, subjectId: row.galleryItemId }));
  const items = state.galleryItems.map((item) => ({
    id: item.id,
    assetId: item.assetId,
    url: '',
    position: item.position,
    altText: fieldView<string>(sets['gallery:altText'], item.altText, familyOverrideRows(itemOverrides, item.id, 'alt_text'), scope, members),
    hidden: fieldView<boolean>(sets['gallery:hidden'], item.hidden, familyOverrideRows(itemOverrides, item.id, 'hidden'), scope, members),
    assetAltText: null as string | null,
  }));
  const roles = Object.fromEntries(
    GALLERY_ROLE_LABELS.map((label) => {
      const holder = state.galleryLabels.find((row) => row.label === label)?.galleryItemId ?? null;
      const view = fieldView<string>(sets.galleryRole, holder, galleryRoleRows(state.roleOverrides, label), scope, members);
      // A holder effectively hidden at this scope holds the role for nobody (163 rule kept).
      const held = items.find((item) => item.id === view.value);
      if (view.value !== null && (!held || held.hidden.value === true)) view.value = null;
      const inheritedHolder = view.inheritedValue ? items.find((item) => item.id === view.inheritedValue!.value) : undefined;
      if (view.inheritedValue && view.inheritedValue.value !== null && (!inheritedHolder || inheritedHolder.hidden.value === true)) {
        view.inheritedValue.value = null;
      }
      return [GALLERY_ROLE_KEYS[label], view];
    }),
  ) as ScopedValuesData['gallery']['roles'];

  const attachmentOverrides = state.attachmentOverrides.map((row) => ({ ...row, subjectId: row.attachmentId }));
  const attachments = state.attachments.map((attachment) => ({
    id: attachment.id,
    assetId: attachment.assetId,
    typeId: attachment.attachmentTypeId,
    position: attachment.position,
    fileName: '',
    name: fieldView<string>(sets['attachment:name'], attachment.name, familyOverrideRows(attachmentOverrides, attachment.id, 'name'), scope, members),
    description: fieldView<string>(
      sets['attachment:description'],
      attachment.description ?? null,
      familyOverrideRows(attachmentOverrides, attachment.id, 'description'),
      scope,
      members,
    ),
    hidden: fieldView<boolean>(sets['attachment:hidden'], attachment.hidden, familyOverrideRows(attachmentOverrides, attachment.id, 'hidden'), scope, members),
  }));

  const unitOverrides = state.packagingOverrides.map((row) => ({ ...row, subjectId: row.packagingUnitId }));
  const packagingUnits = state.packagingUnits.map((unit) => ({
    id: unit.id,
    baseQuantity: unit.baseQuantity,
    position: unit.position,
    isDefault: unit.isDefault,
    minOrderUnits: unit.minOrderUnits ?? null,
    name: fieldView<string>(sets['packagingUnit:name'], unit.name, familyOverrideRows(unitOverrides, unit.id, 'name'), scope, members),
  }));

  return {
    fields,
    attributes,
    gallery: { items, roles },
    attachments,
    packagingUnits,
    galleryAssetIds: [...new Set([...state.galleryItems.map((item) => item.assetId), ...state.attachments.map((a) => a.assetId)])],
  };
}

export class ScopedValuesReadService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly deps: ScopedValuesReadDeps,
  ) {}

  /** `GET …/products/:id/scoped-values` — the product at the request's scope. */
  async read(
    productId: string,
    request: { channelId?: string | undefined; languageCode?: string | undefined },
  ): Promise<ScopedValuesData> {
    const em = this.emFactory();
    const state = await loadScopedState(em, productId, this.deps);
    const scope = resolveRequestScope(state.members, request);
    return this.project(state, scope);
  }

  /** The read body for an already-loaded state — the save answers with it, re-read at the same scope. */
  async project(state: ScopedProductState, scope: ScopeRef): Promise<ScopedValuesData> {
    const { product } = state;
    const views = scopedViews(state, scope);
    const languageCode = scope.level === 'channel_language' ? scope.languageCode : null;

    const assets = views.galleryAssetIds.length > 0 && this.deps.assets ? await this.deps.assets.findByIds(views.galleryAssetIds) : [];
    const assetById = new Map(assets.map((asset) => [asset.id, asset]));
    for (const item of views.gallery.items) {
      const asset = assetById.get(item.assetId);
      item.url = asset?.storageUrl ?? '';
      const alt = asset?.altText ?? null;
      item.assetAltText = alt ? (languageCode ? (alt[languageCode] ?? null) : (alt['en-US'] ?? Object.values(alt)[0] ?? null)) : null;
    }
    for (const attachment of views.attachments) attachment.fileName = assetById.get(attachment.assetId)?.filename ?? '';

    const languageNames = new Map<string, string>();
    if (this.deps.languages) {
      for (const language of await this.deps.languages.list()) languageNames.set(language.code.toLowerCase(), language.label);
    }

    const named = new Set<string>();
    for (const row of state.channelRows) for (const id of row.allowedOrganizationIds ?? []) named.add(id);
    for (const id of product.allowedOrganizationIds) named.add(id);
    const organizations = await this.#organizationNames([...named]);

    return {
      scope,
      version: state.version,
      validScopes: {
        channels: state.members.map((channel) => ({
          channelId: channel.id,
          name: textOf(channel.name, channel.code),
          languages: channel.languages.map((code) => ({ code, name: languageNames.get(code.toLowerCase()) ?? code })),
        })),
      },
      product: {
        sku: product.sku,
        type: product.type,
        attributeSetId: product.attributeSetId,
        categoryIds: state.categoryIds,
        archivedAt: product.archivedAt?.toISOString() ?? null,
        slugGlobal: product.slug,
        manageStock: product.manageStock,
        backorderEnabled: product.backorderEnabled,
        lowStockThreshold: product.lowStockThreshold ?? null,
        lowStockThresholdMode: product.lowStockThresholdMode,
        fulfilmentStrategy: product.fulfilmentStrategy ?? null,
        fulfilmentStrategyWarehouseOrder: product.fulfilmentStrategyWarehouseOrder ?? null,
        downloadAssetId: product.downloadAssetId ?? null,
        downloadUrl: product.downloadUrl ?? null,
        allowedOrganizationIds: [...product.allowedOrganizationIds],
      },
      fields: views.fields,
      attributes: views.attributes,
      gallery: views.gallery,
      attachments: views.attachments,
      packagingUnits: views.packagingUnits,
      // An orphaned scope (a removal-only save's answer) has no SEO view: seo refuses that scope.
      seo: this.deps.readSeo && isLiveScope(state, scope) ? await this.deps.readSeo(product.id, scope) : null,
      completeness: completenessSummary(state, scope),
      organizations,
    };
  }

  async #organizationNames(ids: readonly string[]): Promise<Array<{ id: string; name: string }>> {
    if (!this.deps.organizations || ids.length === 0) return [];
    let records: Array<{ id: string; name: string }>;
    try {
      records = await this.deps.organizations.findByIds(ids);
    } catch {
      // Best effort (163 U1): with `organizations` off or refusing, the editor shows ids.
      return [];
    }
    return records.map((record) => ({ id: record.id, name: record.name }));
  }
}
