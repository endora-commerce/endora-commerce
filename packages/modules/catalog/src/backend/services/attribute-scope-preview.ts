import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  attributeScopeSet,
  type AttributeScope,
  type AttributeScopeChangePreviewResponse,
  type ScopeLevel,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { CatalogAttributeReadService } from './catalog-attribute-read.service.js';

/**
 * Feature 163 (`specs/163-product-data-scopes/`) — the FR-090 preview of a change to a
 * user-defined attribute's scope flags,
 * `GET /api/v1/admin/catalog/attributes/:idOrKey/scope-change-preview`
 * (`contracts/admin-scopes-api.md` §6, research R27).
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

/** The slots the resolver reads for an attribute's scope set (feature 168, `attributeScopeSet`). */
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

/** The requested flag: `"true"` / `"false"`; absent keeps the attribute's current flag. */
export function parseScopeChangeQuery(query: Record<string, unknown>, current: AttributeScope): AttributeScope {
  const raw = query['scopable'];
  if (raw === undefined) return current;
  if (raw === 'true') return { scopable: true };
  if (raw === 'false') return { scopable: false };
  throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, '"scopable" must be "true" or "false".', { field: 'scopable' });
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
    // 168-shim: the value-type half of the preview (text → non-text orphans C×L rows) is T113's.
    const current: AttributeScope = { scopable: attribute.scopable };
    const next = parseScopeChangeQuery(query, current);
    const slots = slotsOrphanedByScopeChange(
      attributeScopeSet({ scopable: current.scopable, valueType: attribute.valueType }),
      attributeScopeSet({ scopable: next.scopable, valueType: attribute.valueType }),
    );
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
