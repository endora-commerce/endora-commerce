import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';

/**
 * Feature 163 (`specs/163-product-data-scopes/` data-model §8, research R16; FR-078,
 * FR-079) — attachments and packaging units per scope.
 *
 * The per-language texts are columns of the attachment and packaging-unit rows
 * themselves; the one bridge row is an attachment hidden in a channel
 * (`product_attachment_channel_hidden`). Like the gallery's (`gallery-scopes.ts`), it has
 * one writer here, run only on the caller's `em` inside the caller's audited Command.
 */

// Feature 168 — 163's per-channel attachment writes are retired; Channel and Channel × language
// values of an attachment are scoped fields of the save Command (`product_attachment_scope_overrides`).

// --- Reads --------------------------------------------------------------------------

/** The attachments of `productId` hidden in `channelId` — what that channel's product page leaves out. */
export async function loadAttachmentsHiddenInChannel(
  em: EntityManager,
  productId: string,
  channelId: string,
): Promise<Set<string>> {
  const rows = await em.execute<Array<{ attachment_id: string }>>(
    // 168-shim: the Channel rows only; the C×L → C → G chain (Global `hidden`) is T041's.
    `select attachment_id::text as attachment_id
       from product_attachment_scope_overrides
      where product_id = ? and sales_channel_id = ? and language_code is null
        and field = 'hidden' and value -> 'v' = 'true'::jsonb`,
    [productId, channelId],
  );
  return new Set(rows.map((row) => row.attachment_id));
}

/**
 * The scope overview's attachment and packaging-unit fields of `productId` (T139b):
 * `attachments:hidden` per channel any attachment is hidden in; `attachments:name`,
 * `attachments:description` and `packagingUnits:name` per language any row has a
 * non-blank text in. One statement.
 */
export async function loadAttachmentPackagingScopedFields(
  em: EntityManager,
  productId: string,
): Promise<Array<{ field: string; channelId: string | null; languageCode: string | null }>> {
  const rows = await em.execute<Array<{ field: string; channel_id: string | null; language_code: string | null }>>(
    `select distinct 'attachments:' || field as field, sales_channel_id::text as channel_id, language_code
       from product_attachment_scope_overrides where product_id = ?
     union
     select distinct 'packagingUnits:name', sales_channel_id::text, language_code
       from product_packaging_unit_scope_overrides where product_id = ?
     order by 1, 2, 3`,
    [productId, productId],
  );
  return rows.map((row) => ({ field: row.field, channelId: row.channel_id, languageCode: row.language_code }));
}

// --- Shared by the scoped writes -----------------------------------------------------

/**
 * FR-014 — every channel in `channelIds` is one the product is a member of, else
 * `422 SCOPE_INVALID` (`reason: 'not_a_member'`) naming the first outside one. The
 * caller passes only the channels a write **adds**: removing one never asks (FR-015).
 */
export async function assertProductChannelMembers(
  membership: Pick<SalesChannelMembershipPort, 'listChannelsForEntity'> | undefined,
  productId: string,
  channelIds: readonly string[],
): Promise<void> {
  if (channelIds.length === 0) return;
  if (!membership) {
    throw new Error('The channel membership port is not wired — a channel override cannot be checked.');
  }
  const members = new Set(
    (await membership.listChannelsForEntity('product', productId)).map((channel) => channel.id),
  );
  const outside = channelIds.find((channelId) => !members.has(channelId));
  if (outside !== undefined) {
    throw new HttpError(422, ERROR_CODES.SCOPE_INVALID, 'The product is not a member of this sales channel.', {
      channelId: outside,
      reason: 'not_a_member',
    });
  }
}
