import type { GalleryRoleLabel, ProductScopeStatus, ProductVisibility, ScopedRow, ScopedValue } from '@endora-commerce/contracts';

/**
 * Feature 170 (T034; research R1, `data-model.md` §2–§7) — every store of a scoped value read as
 * the one {@link ScopedRow} shape `resolveScoped` takes.
 *
 * A row's **presence** is the override; its value is either a value or the **empty** override:
 * `{"v": null}` in a value-override table, a role row naming no image, an overridden minimum
 * order quantity with none. A store column that inherits (`status null`, `windowOverridden
 * false`, …) contributes no row. Orphan rows — a channel the product has left, a language the
 * channel no longer offers — are passed through: whether they count is the caller's decision
 * (they never do at a valid scope, and the Scopes tab lists them).
 */

const wrapped = <T>(value: unknown): ScopedValue<T> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || !Object.hasOwn(value, 'v')) {
    // A value that is not wrapped is unreadable, never a value (the migration wrapped every row).
    return { kind: 'empty' };
  }
  const v = (value as { v: unknown }).v;
  return v === null ? { kind: 'empty' } : { kind: 'value', value: v as T };
};

/** `product_value_overrides` rows of one key: `name`, `description` or an attribute key. */
export function valueOverrideRows<T = unknown>(
  rows: ReadonlyArray<{ attributeKey: string; channelId: string; languageCode?: string | null; value: unknown }>,
  attributeKey: string,
): ScopedRow<T>[] {
  return rows
    .filter((row) => row.attributeKey === attributeKey)
    .map((row) => ({ channelId: row.channelId, languageCode: row.languageCode ?? null, value: wrapped<T>(row.value) }));
}

/** One `product_channel_scopes` row as the adapter reads it. */
export interface ChannelScopeRowLike {
  salesChannelId: string;
  status?: ProductScopeStatus | null;
  windowOverridden: boolean;
  publishFrom?: Date | null;
  publishUntil?: Date | null;
  visibility?: ProductVisibility | null;
  allowedOrganizationIds?: string[] | null;
  minOrderQuantityOverridden: boolean;
  minOrderQuantity?: number | null;
  returnable?: boolean | null;
}

export type ChannelScopedField = 'status' | 'window' | 'audience' | 'minOrderQuantity' | 'returnable';

export interface WindowValue {
  from: string | null;
  until: string | null;
}
export interface AudienceValue {
  visibility: ProductVisibility;
  allowedOrganizationIds: string[];
}

/** The Channel-level rows of one field from `product_channel_scopes` (data-model §4). */
export function channelScopeRows(rows: readonly ChannelScopeRowLike[], field: ChannelScopedField): ScopedRow<unknown>[] {
  const out: ScopedRow<unknown>[] = [];
  for (const row of rows) {
    const at = (value: ScopedValue<unknown>) => out.push({ channelId: row.salesChannelId, languageCode: null, value });
    switch (field) {
      case 'status':
        if (row.status != null) at({ kind: 'value', value: row.status });
        break;
      case 'window':
        if (row.windowOverridden) {
          at({
            kind: 'value',
            value: {
              from: row.publishFrom ? row.publishFrom.toISOString() : null,
              until: row.publishUntil ? row.publishUntil.toISOString() : null,
            } satisfies WindowValue,
          });
        }
        break;
      case 'audience':
        if (row.visibility != null) {
          at({
            kind: 'value',
            value: { visibility: row.visibility, allowedOrganizationIds: [...(row.allowedOrganizationIds ?? [])] } satisfies AudienceValue,
          });
        }
        break;
      case 'minOrderQuantity':
        if (row.minOrderQuantityOverridden) {
          at(row.minOrderQuantity == null ? { kind: 'empty' } : { kind: 'value', value: row.minOrderQuantity });
        }
        break;
      case 'returnable':
        if (row.returnable != null) at({ kind: 'value', value: row.returnable });
        break;
    }
  }
  return out;
}

/** `product_channel_language_scopes` — the status at Channel × language. */
export function languageStatusRows(
  rows: ReadonlyArray<{ salesChannelId: string; languageCode: string; status: ProductScopeStatus }>,
): ScopedRow<ProductScopeStatus>[] {
  return rows.map((row) => ({ channelId: row.salesChannelId, languageCode: row.languageCode, value: { kind: 'value', value: row.status } }));
}

/**
 * A family override table's rows of one subject and field — `gallery_item_scope_overrides`,
 * `product_attachment_scope_overrides`, `product_packaging_unit_scope_overrides`, the subject
 * column normalised to `subjectId` by the caller.
 */
export function familyOverrideRows<T = unknown>(
  rows: ReadonlyArray<{ subjectId: string; salesChannelId: string; languageCode: string | null; field: string; value: unknown }>,
  subjectId: string,
  field: string,
): ScopedRow<T>[] {
  return rows
    .filter((row) => row.subjectId === subjectId && row.field === field)
    .map((row) => ({ channelId: row.salesChannelId, languageCode: row.languageCode, value: wrapped<T>(row.value) }));
}

/** `gallery_role_scope_overrides` of one role: a row naming no item = no image holds the role there. */
export function galleryRoleRows(
  rows: ReadonlyArray<{ label: GalleryRoleLabel; salesChannelId: string; languageCode: string | null; galleryItemId: string | null }>,
  label: GalleryRoleLabel,
): ScopedRow<string>[] {
  return rows
    .filter((row) => row.label === label)
    .map((row) => ({
      channelId: row.salesChannelId,
      languageCode: row.languageCode,
      value: row.galleryItemId === null ? { kind: 'empty' } : { kind: 'value', value: row.galleryItemId },
    }));
}
