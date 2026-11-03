import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  attributeScopeSet,
  attributeValueTypeSchema,
  type AttributeScopeChangePreviewResponse,
  type AttributeValueType,
  type ScopeLevel,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { CatalogAttributeReadService } from './catalog-attribute-read.service.js';

/**
 * Feature 163 (`specs/163-product-data-scopes/`) — the FR-090 preview of a change to a
 * user-defined attribute's scope, on feature 170's one flag and its value type (R15, FR-012):
 * `GET /api/v1/admin/catalog/attributes/:idOrKey/scope-change-preview?scopable=&valueType=`
 * (`contracts/admin-scopes-api.md` §6, research R27). The scope set is derived from both — a
 * scopable text attribute {G, C, C×L}, a scopable non-text one {G, C}, a non-scopable one {G} —
 * so scopable → not scopable orphans every override and text → non-text the C×L ones.
 *
 * A read only. The attribute update itself is unchanged and keeps every
 * `product_value_overrides` row; the resolver skips the ones the new flags no longer
 * allow and the scope overview lists them as orphaned (FR-015).
 *
 * Counted: the rows the **current** flags let the resolver read and the **requested**
 * ones do not. A row already skipped is not counted again, so a widening answers 0.
 * The count is per scope flag only: a row that is also orphaned because its product
 * left the channel, or the channel dropped its language, is still counted — telling
 * those apart needs the channel membership of every product holding a row, which the
 * preview does not read (Constitution XII: membership is the kernel accessor's, per
 * entity). Rows of soft-deleted products are not counted.
 */

export type AttributeScopeChangePreview = AttributeScopeChangePreviewResponse['data'];

/** Which override slots a flag change orphans: `channel` = `(C, null)`, `channelLanguage` = `(C, L)`. */
export interface OrphanedSlots {
  channel: boolean;
  channelLanguage: boolean;
}

/** The slots the resolver reads for an attribute's scope set (feature 170, `attributeScopeSet`). */
function readable(levels: readonly ScopeLevel[]): OrphanedSlots {
  return { channel: levels.includes('C'), channelLanguage: levels.includes('CL') };
}

/** The slots readable under `current` and not under `next`. */
export function slotsOrphanedByScopeChange(current: readonly ScopeLevel[], next: readonly ScopeLevel[]): OrphanedSlots {
  const before = readable(current);
  const after = readable(next);
  return {
    channel: before.channel && !after.channel,
    channelLanguage: before.channelLanguage && !after.channelLanguage,
  };
}

/** What the scope set is derived from (feature 170, `attributeScopeSet`). */
export interface AttributeScopeInput {
  scopable: boolean;
  valueType: AttributeValueType;
}

/**
 * The requested scope: `scopable` `"true"` / `"false"` and `valueType` one of the attribute value
 * types; an absent parameter keeps the attribute's current one.
 */
export function parseScopeChangeQuery(query: Record<string, unknown>, current: AttributeScopeInput): AttributeScopeInput {
  const rawScopable = query['scopable'];
  let scopable = current.scopable;
  if (rawScopable === 'true') scopable = true;
  else if (rawScopable === 'false') scopable = false;
  else if (rawScopable !== undefined) {
    throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, '"scopable" must be "true" or "false".', { field: 'scopable' });
  }
  const rawType = query['valueType'];
  let valueType = current.valueType;
  if (rawType !== undefined) {
    const parsed = attributeValueTypeSchema.safeParse(rawType);
    if (!parsed.success) {
      throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, '"valueType" is not an attribute value type.', { field: 'valueType' });
    }
    valueType = parsed.data;
  }
  return { scopable, valueType };
}

export class AttributeScopePreviewService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly attributeRead: Pick<CatalogAttributeReadService, 'getByIdOrKey'>,
  ) {}

  async preview(idOrKey: string, query: Record<string, unknown>): Promise<AttributeScopeChangePreview> {
    // System attributes (`name`, `description`) are not rows: their scope is pinned and
    // has no preview, so they answer as an unknown attribute does.
    const attribute = await this.attributeRead.getByIdOrKey(idOrKey);
    if (!attribute) throw new HttpError(404, ERROR_CODES.NOT_FOUND, `Attribute "${idOrKey}" not found.`);
    const current: AttributeScopeInput = { scopable: attribute.scopable, valueType: attribute.valueType };
    const next = parseScopeChangeQuery(query, current);
    const slots = slotsOrphanedByScopeChange(attributeScopeSet(current), attributeScopeSet(next));
    if (!slots.channel && !slots.channelLanguage) return { orphanedOverrides: 0, byChannel: [] };

    const slotCondition =
      slots.channel && slots.channelLanguage
        ? 'true'
        : slots.channel
          ? 'o.language_code is null'
          : 'o.language_code is not null';
    const rows = await this.emFactory()
      .getConnection()
      .execute<Array<{ channel_id: string; n: string }>>(
        `select o.channel_id, count(*)::text as n
           from product_value_overrides o
           join products p on p.id = o.product_id and p.deleted_at is null
          where o.attribute_key = ? and ${slotCondition}
          group by o.channel_id
          order by o.channel_id`,
        [attribute.key],
      );
    const byChannel = rows.map((row) => ({ channelId: row.channel_id, count: Number(row.n) }));
    return { orphanedOverrides: byChannel.reduce((sum, row) => sum + row.count, 0), byChannel };
  }
}
